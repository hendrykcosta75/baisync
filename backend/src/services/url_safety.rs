//! URL / IP validation used wherever the backend dereferences a
//! user-supplied URL (test_url, MCP servers, future webhook targets).
//!
//! Two-stage check:
//!   1. Scheme + hostname deny-list (catches `http://redis` kind of references
//!      to internal docker-compose service names).
//!   2. DNS resolution + IP deny-list (loopback, RFC 1918, CGNAT, link-local,
//!      IPv6 ULA/LL, IPv4-mapped IPv6, etc.).
//!
//! Because resolution is done here, each caller gets DNS-rebinding defense
//! for free when it calls `validate_public_url` right before every HTTP
//! request (not just once at registration).

use std::net::IpAddr;

pub const BLOCKED_HOSTS: &[&str] = &[
    "baileys",
    "cassandra",
    "redis",
    "livekit",
    "backend",
    "frontend",
    "localhost",
    "host.docker.internal",
];

pub fn is_blocked_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_multicast()
                || v4.is_unspecified()
                || v4.is_broadcast()
                // CGNAT 100.64.0.0/10 (RFC 6598)
                || (o[0] == 100 && (64..=127).contains(&o[1]))
                // Reserved 240.0.0.0/4
                || o[0] >= 240
        }
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() {
                return true;
            }
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(&IpAddr::V4(v4));
            }
            let s = v6.segments()[0];
            (s & 0xfe00) == 0xfc00 || (s & 0xffc0) == 0xfe80
        }
    }
}

/// Validate that `raw` is a publicly reachable http(s) URL. Rejects
/// internal hostnames, non-http(s) schemes, and URLs whose DNS resolves
/// to any loopback/private/link-local/CGNAT/reserved address.
pub async fn validate_public_url(raw: &str) -> Result<reqwest::Url, &'static str> {
    let url = reqwest::Url::parse(raw).map_err(|_| "URL inválida")?;
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err("esquema não suportado"),
    }
    let host = url.host_str().ok_or("sem host")?.to_lowercase();
    if BLOCKED_HOSTS.iter().any(|h| host == *h) {
        return Err("host interno");
    }
    let port = url.port_or_known_default().ok_or("porta inválida")?;
    let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| "DNS falhou")?
        .collect();
    if addrs.is_empty() {
        return Err("DNS vazio");
    }
    if addrs.iter().any(|a| is_blocked_ip(&a.ip())) {
        return Err("endereço bloqueado");
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn blocks_loopback_v4() {
        assert!(is_blocked_ip(&IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
    }

    #[test]
    fn blocks_private_v4() {
        assert!(is_blocked_ip(&IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))));
        assert!(is_blocked_ip(&IpAddr::V4(Ipv4Addr::new(172, 16, 0, 1))));
        assert!(is_blocked_ip(&IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));
    }

    #[test]
    fn blocks_cgnat() {
        assert!(is_blocked_ip(&IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1))));
        assert!(is_blocked_ip(&IpAddr::V4(Ipv4Addr::new(100, 127, 255, 255))));
    }

    #[test]
    fn blocks_aws_metadata() {
        assert!(is_blocked_ip(&IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))));
    }

    #[test]
    fn blocks_ipv6_loopback_and_ula() {
        assert!(is_blocked_ip(&IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(is_blocked_ip(&IpAddr::V6(
            "fd00::1".parse::<Ipv6Addr>().unwrap()
        )));
        assert!(is_blocked_ip(&IpAddr::V6(
            "fe80::1".parse::<Ipv6Addr>().unwrap()
        )));
    }

    #[test]
    fn blocks_ipv4_mapped_private() {
        assert!(is_blocked_ip(&IpAddr::V6(
            "::ffff:10.0.0.1".parse::<Ipv6Addr>().unwrap()
        )));
    }

    #[test]
    fn public_v4_passes() {
        assert!(!is_blocked_ip(&IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
        assert!(!is_blocked_ip(&IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))));
    }

    #[tokio::test]
    async fn rejects_non_http_scheme() {
        assert!(matches!(
            validate_public_url("file:///etc/passwd").await,
            Err("esquema não suportado")
        ));
    }

    #[tokio::test]
    async fn rejects_internal_hostname() {
        assert!(matches!(
            validate_public_url("http://redis:6379").await,
            Err("host interno")
        ));
    }

    #[tokio::test]
    async fn rejects_literal_loopback() {
        assert!(validate_public_url("http://127.0.0.1:8080").await.is_err());
    }
}
