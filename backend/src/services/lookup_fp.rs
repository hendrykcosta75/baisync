//! Deterministic fingerprints for indexed lookups on encrypted columns.
//!
//! `assistant_integrations.config_phone_number` and `config_token` are stored
//! AES-GCM-encrypted with a random nonce, so equality lookups against the
//! ciphertext column never match. We solve this by storing a parallel
//! HMAC-SHA256 fingerprint of the plaintext and indexing on it.
//!
//! The HMAC key is derived once from the lowest-loaded encryption key version
//! (typically V1) plus a fixed domain-separator string, so:
//!   * fingerprints are stable across encryption-key rotations that ADD new
//!     versions (V2, V3, …) without removing V1;
//!   * the FP key is cryptographically separated from the AES-GCM key, so a
//!     fingerprint leak does not weaken AES-GCM and vice-versa.
//!
//! If V1 is ever rotated out, every fingerprint must be re-derived — run
//! `bin/backfill_integration_fp.rs` again as part of that operation.

use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::services::encryption::EncryptionService;

type HmacSha256 = Hmac<Sha256>;

const FP_DOMAIN: &[u8] = b"inertial-eclipse:lookup_fp:v1";

fn derive_fp_key(encryption: &EncryptionService) -> [u8; 32] {
    let resolver = encryption.resolver();
    let versions = resolver.known_versions();
    let lowest = *versions
        .first()
        .expect("EncryptionService must have at least one key version loaded");
    let key_bytes = resolver
        .decrypt_key(lowest)
        .expect("lowest known version must resolve to a key");
    let mut mac = HmacSha256::new_from_slice(key_bytes)
        .expect("HMAC-SHA256 accepts any byte length; 32 bytes is valid");
    mac.update(FP_DOMAIN);
    let result = mac.finalize().into_bytes();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

fn normalize_phone(phone: &str) -> String {
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        String::new()
    } else {
        format!("+{digits}")
    }
}

fn normalize_token(token: &str) -> String {
    token.trim().to_string()
}

fn hmac_value(fp_key: &[u8; 32], value: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(fp_key)
        .expect("HMAC-SHA256 accepts any key length");
    mac.update(value);
    mac.finalize().into_bytes().to_vec()
}

/// Compute the lookup fingerprint for a phone number. Returns `None` for
/// empty / digit-less input — matching the write-side contract that empty
/// phone strings stay NULL in the column.
pub fn phone_fp(encryption: &EncryptionService, phone: &str) -> Option<Vec<u8>> {
    let normalized = normalize_phone(phone);
    if normalized.is_empty() {
        return None;
    }
    let key = derive_fp_key(encryption);
    Some(hmac_value(&key, normalized.as_bytes()))
}

/// Compute the lookup fingerprint for a webhook token (Telegram bot token,
/// etc). Returns `None` for empty / whitespace-only input.
pub fn token_fp(encryption: &EncryptionService, token: &str) -> Option<Vec<u8>> {
    let normalized = normalize_token(token);
    if normalized.is_empty() {
        return None;
    }
    let key = derive_fp_key(encryption);
    Some(hmac_value(&key, normalized.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn svc() -> EncryptionService {
        EncryptionService::new(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        )
        .unwrap()
    }

    #[test]
    fn phone_fp_is_deterministic() {
        let s = svc();
        let a = phone_fp(&s, "+5511987654321").unwrap();
        let b = phone_fp(&s, "+5511987654321").unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
    }

    #[test]
    fn phone_fp_normalizes_formatting() {
        let s = svc();
        let a = phone_fp(&s, "+55 11 98765-4321").unwrap();
        let b = phone_fp(&s, "5511987654321").unwrap();
        let c = phone_fp(&s, " +55 (11) 98765-4321 ").unwrap();
        assert_eq!(a, b);
        assert_eq!(a, c);
    }

    #[test]
    fn phone_fp_distinguishes_different_numbers() {
        let s = svc();
        let a = phone_fp(&s, "+5511987654321").unwrap();
        let b = phone_fp(&s, "+5511987654322").unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn phone_fp_empty_returns_none() {
        let s = svc();
        assert!(phone_fp(&s, "").is_none());
        assert!(phone_fp(&s, "   ").is_none());
        assert!(phone_fp(&s, "++").is_none());
    }

    #[test]
    fn token_fp_is_deterministic_and_trims() {
        let s = svc();
        let a = token_fp(&s, "1234:abc").unwrap();
        let b = token_fp(&s, "  1234:abc  ").unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
    }

    #[test]
    fn token_fp_empty_returns_none() {
        let s = svc();
        assert!(token_fp(&s, "").is_none());
        assert!(token_fp(&s, "   ").is_none());
    }

    #[test]
    fn fp_differs_per_encryption_key() {
        let s1 = EncryptionService::new(
            "0000000000000000000000000000000000000000000000000000000000000000",
        )
        .unwrap();
        let s2 = EncryptionService::new(
            "1111111111111111111111111111111111111111111111111111111111111111",
        )
        .unwrap();
        let a = phone_fp(&s1, "+5511987654321").unwrap();
        let b = phone_fp(&s2, "+5511987654321").unwrap();
        assert_ne!(a, b, "different encryption keys must yield different fingerprints");
    }

    #[test]
    fn fp_is_domain_separated_from_aes_key() {
        // Same encryption key, but the FP key is HMAC-derived, so it must
        // not equal the raw encryption key bytes.
        let s = svc();
        let key = derive_fp_key(&s);
        let raw = s.resolver().decrypt_key(1).unwrap();
        assert_ne!(&key[..], raw);
    }
}
