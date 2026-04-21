use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::collections::HashMap;

use crate::errors::AppError;

/// Bounded upper limit when scanning versioned env vars
/// (`ENCRYPTION_KEY_V1` through `ENCRYPTION_KEY_V{MAX_KEY_VERSION}`).
/// Keep this small — we don't expect to rotate more than a handful of
/// times before purging old versions, and a tight bound keeps startup
/// env scans O(1).
const MAX_KEY_VERSION: u32 = 8;

/// Holds one or more AES-256 keys indexed by version. Versioned keys
/// allow online rotation: new ciphertext is written under the current
/// version, while old ciphertext remains decryptable via its original
/// version's key until those rows are rotated.
///
/// T3.2 F1 scope: only `workspace_api_keys` opts into versioned paths
/// (via `encrypt_versioned` / `decrypt_versioned`). Other tables keep
/// calling the non-versioned `encrypt` / `decrypt` which internally use
/// `current_version` — no schema `key_version` column, so rotation of
/// those tables is out-of-scope until S0b (offline re-encrypt).
#[derive(Clone)]
pub struct KeyResolver {
    /// version → 32-byte AES-256 key
    keys: HashMap<u32, Vec<u8>>,
    /// Version used for NEW encryption operations.
    /// Equals the highest version present in `keys`.
    current_version: u32,
}

impl KeyResolver {
    /// Load keys from environment.
    ///
    /// Priority:
    ///   1. `ENCRYPTION_KEY_V1`, `ENCRYPTION_KEY_V2`, ... (up to
    ///      `MAX_KEY_VERSION`) — each must be 64 hex chars (32 bytes).
    ///   2. Fallback: if no `ENCRYPTION_KEY_V*` set, use the legacy
    ///      `ENCRYPTION_KEY` as V1. Preserves backward compatibility
    ///      with pre-T3.2 deployments.
    ///
    /// `current_version` is the highest version found (default 1 if
    /// only the legacy fallback is used).
    pub fn from_env() -> Result<Self, AppError> {
        let mut keys = HashMap::new();

        for v in 1u32..=MAX_KEY_VERSION {
            if let Ok(hex_str) = std::env::var(format!("ENCRYPTION_KEY_V{v}")) {
                if hex_str.is_empty() {
                    continue;
                }
                let bytes = hex::decode(&hex_str).map_err(|_| {
                    AppError::ConfigError(format!(
                        "ENCRYPTION_KEY_V{v} must be valid hex"
                    ))
                })?;
                if bytes.len() != 32 {
                    return Err(AppError::ConfigError(format!(
                        "ENCRYPTION_KEY_V{v} must decode to exactly 32 bytes (got {})",
                        bytes.len()
                    )));
                }
                keys.insert(v, bytes);
            }
        }

        // Fallback: legacy single-key deployment → treat as V1.
        if keys.is_empty() {
            let hex_str = std::env::var("ENCRYPTION_KEY").map_err(|_| {
                AppError::ConfigError(
                    "ENCRYPTION_KEY not set (and no ENCRYPTION_KEY_V* found)".into(),
                )
            })?;
            if hex_str.len() != 64 {
                return Err(AppError::ConfigError(
                    "ENCRYPTION_KEY must be 64 hex chars (32 bytes)".into(),
                ));
            }
            let bytes = hex::decode(&hex_str).map_err(|_| {
                AppError::ConfigError("ENCRYPTION_KEY must be valid hex".into())
            })?;
            if bytes.len() != 32 {
                return Err(AppError::ConfigError(
                    "ENCRYPTION_KEY must decode to exactly 32 bytes".into(),
                ));
            }
            keys.insert(1, bytes);
        }

        // Highest version present becomes the target for new writes.
        let current_version = *keys.keys().max().expect("keys is non-empty by construction");

        Ok(Self {
            keys,
            current_version,
        })
    }

    /// Legacy entry point: build a resolver from a single hex key.
    /// Used by `EncryptionService::new` for the existing call sites
    /// (`main.rs`, `bin/encrypt_legacy.rs`, tests). All single-key
    /// deployments map to V1.
    pub fn from_single_hex(hex_str: &str) -> Result<Self, AppError> {
        if hex_str.len() != 64 {
            return Err(AppError::ConfigError(
                "ENCRYPTION_KEY must be 64 hex chars (32 bytes)".into(),
            ));
        }
        let bytes = hex::decode(hex_str)
            .map_err(|_| AppError::ConfigError("ENCRYPTION_KEY must be valid hex".into()))?;
        if bytes.len() != 32 {
            return Err(AppError::ConfigError(
                "ENCRYPTION_KEY must decode to exactly 32 bytes".into(),
            ));
        }
        let mut keys = HashMap::new();
        keys.insert(1, bytes);
        Ok(Self {
            keys,
            current_version: 1,
        })
    }

    /// Return `(key_bytes, version)` to use for NEW encryption operations.
    pub fn encrypt_key(&self) -> (&[u8], u32) {
        (
            self.keys
                .get(&self.current_version)
                .expect("current_version must exist in keys map")
                .as_slice(),
            self.current_version,
        )
    }

    /// Look up the key bytes for a specific version. Returns `None`
    /// if that version is not loaded (ciphertext is unreadable with
    /// the current set of env vars — operator must re-add the old key).
    pub fn decrypt_key(&self, version: u32) -> Option<&[u8]> {
        self.keys.get(&version).map(|v| v.as_slice())
    }

    /// Exposed for tracing / startup logs and tests.
    #[allow(dead_code)]
    pub fn current_version(&self) -> u32 {
        self.current_version
    }

    /// Exposed for tracing / startup logs and tests.
    #[allow(dead_code)]
    pub fn known_versions(&self) -> Vec<u32> {
        let mut versions: Vec<u32> = self.keys.keys().copied().collect();
        versions.sort_unstable();
        versions
    }
}

/// Cryptographic service wrapping a `KeyResolver`.
///
/// Two surface areas:
///
/// * **Non-versioned** — `encrypt`/`decrypt`/`try_decrypt_or_passthrough`/
///   `encrypt_opt`/`try_decrypt_opt`. These use the resolver's
///   `current_version` internally. Ciphertext produced this way is
///   indistinguishable on-disk from ciphertext produced by the old
///   single-key service. Callers that don't know about versioning
///   (assistant_integrations, legacy users columns) keep working
///   unchanged. To rotate ciphertext written this way requires the
///   offline S0b re-encrypt flow.
///
/// * **Versioned** — `encrypt_versioned`/`decrypt_versioned`. Callers
///   store `(ciphertext, version)` alongside the row and, on read,
///   pass the row's `key_version` back to `decrypt_versioned`. Enables
///   online rotation: after V2 is added as current, old rows keep
///   working because V1's key is still loaded; new rows are written
///   with V2. Only `workspace_api_keys` uses this path in T3.2 F1.
#[derive(Clone)]
pub struct EncryptionService {
    resolver: KeyResolver,
}

impl EncryptionService {
    /// Build a service from a single hex key (legacy path).
    /// Used by `main.rs` and `bin/encrypt_legacy.rs`. For deployments
    /// that want versioned keys, call `from_env` instead.
    pub fn new(hex_key: &str) -> Result<Self, AppError> {
        Ok(Self {
            resolver: KeyResolver::from_single_hex(hex_key)?,
        })
    }

    /// Build a service from the environment.
    /// Reads `ENCRYPTION_KEY_V*` or falls back to `ENCRYPTION_KEY`.
    #[allow(dead_code)]
    pub fn from_env() -> Result<Self, AppError> {
        Ok(Self {
            resolver: KeyResolver::from_env()?,
        })
    }

    /// Access the underlying resolver (for telemetry / key-version logs).
    #[allow(dead_code)]
    pub fn resolver(&self) -> &KeyResolver {
        &self.resolver
    }

    /// Low-level AES-256-GCM encrypt with a specific key. Returns the
    /// base64-encoded `nonce || ciphertext` blob.
    fn encrypt_with_key(key: &[u8], plaintext: &str) -> Result<String, AppError> {
        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| AppError::EncryptionError(e.to_string()))?;

        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|e| AppError::EncryptionError(e.to_string()))?;

        let mut combined = nonce_bytes.to_vec();
        combined.extend_from_slice(&ciphertext);
        Ok(BASE64.encode(&combined))
    }

    /// Low-level AES-256-GCM decrypt with a specific key.
    fn decrypt_with_key(key: &[u8], encrypted: &str) -> Result<String, AppError> {
        let combined = BASE64
            .decode(encrypted)
            .map_err(|e| AppError::EncryptionError(e.to_string()))?;

        if combined.len() < 12 {
            return Err(AppError::EncryptionError("Invalid ciphertext".into()));
        }

        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        let cipher = Aes256Gcm::new_from_slice(key)
            .map_err(|e| AppError::EncryptionError(e.to_string()))?;

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| AppError::EncryptionError(e.to_string()))?;

        String::from_utf8(plaintext).map_err(|e| AppError::EncryptionError(e.to_string()))
    }

    // ─── Non-versioned API (legacy shape, unchanged behavior) ───

    pub fn encrypt(&self, plaintext: &str) -> Result<String, AppError> {
        let (key, _version) = self.resolver.encrypt_key();
        Self::encrypt_with_key(key, plaintext)
    }

    pub fn decrypt(&self, encrypted: &str) -> Result<String, AppError> {
        let (key, _version) = self.resolver.encrypt_key();
        Self::decrypt_with_key(key, encrypted)
    }

    /// Try to decrypt the value. If decryption fails (e.g. the value is still
    /// legacy plaintext because the backfill migration hasn't run yet), return
    /// the value as-is. This allows deploys to roll out the encryption code
    /// BEFORE the data backfill, with zero-downtime safety.
    ///
    /// After the backfill has been executed in production, every value in the
    /// column should be ciphertext and the passthrough branch becomes defensive
    /// only (e.g. a row inserted by a very old replica during the deploy
    /// window).
    ///
    /// Never logs the value (plaintext or ciphertext) per invariant #4.
    pub fn try_decrypt_or_passthrough(&self, value: &str) -> String {
        match self.decrypt(value) {
            Ok(plaintext) => plaintext,
            Err(_) => value.to_string(),
        }
    }

    /// Optional variant of `try_decrypt_or_passthrough` that preserves `None`.
    pub fn try_decrypt_opt(&self, value: Option<String>) -> Option<String> {
        value.map(|v| self.try_decrypt_or_passthrough(&v))
    }

    /// Encrypt an optional value. `None` and empty strings pass through
    /// unchanged so we don't materialize empty ciphertexts. Returns error
    /// only on AES init failure.
    pub fn encrypt_opt(&self, value: Option<String>) -> Result<Option<String>, AppError> {
        match value {
            None => Ok(None),
            Some(v) if v.is_empty() => Ok(Some(v)),
            Some(v) => self.encrypt(&v).map(Some),
        }
    }

    // ─── Versioned API (T3.2 F1 — workspace_api_keys only) ───

    /// Encrypt `plaintext` using the resolver's `current_version`.
    /// Returns `(ciphertext, version)` — caller MUST persist the version
    /// alongside the ciphertext so `decrypt_versioned` can recover it.
    pub fn encrypt_versioned(
        &self,
        plaintext: &str,
    ) -> Result<(String, u32), AppError> {
        let (key, version) = self.resolver.encrypt_key();
        let ciphertext = Self::encrypt_with_key(key, plaintext)?;
        Ok((ciphertext, version))
    }

    /// Decrypt `ciphertext` that was written under `version`.
    /// Returns an error — never silent wrong plaintext — when:
    ///   * `version` is not currently loaded (operator must re-add
    ///     `ENCRYPTION_KEY_V{version}`)
    ///   * the ciphertext is malformed or AES-GCM auth tag fails (tamper
    ///     or wrong-key)
    pub fn decrypt_versioned(
        &self,
        ciphertext: &str,
        version: u32,
    ) -> Result<String, AppError> {
        let key = self.resolver.decrypt_key(version).ok_or_else(|| {
            AppError::EncryptionError(format!(
                "Unknown encryption key version {version}: not loaded from env"
            ))
        })?;
        Self::decrypt_with_key(key, ciphertext)
    }

    /// Encrypt an optional versioned value. `None` → `Ok(None)`.
    /// Empty string → `Ok(Some(("", current_version)))` (keeps parity
    /// with non-versioned `encrypt_opt`: don't materialize ciphertext
    /// for empty strings).
    #[allow(dead_code)]
    pub fn encrypt_versioned_opt(
        &self,
        value: Option<String>,
    ) -> Result<Option<(String, u32)>, AppError> {
        match value {
            None => Ok(None),
            Some(v) if v.is_empty() => {
                let (_, version) = self.resolver.encrypt_key();
                Ok(Some((v, version)))
            }
            Some(v) => self.encrypt_versioned(&v).map(Some),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Legacy single-key tests (regression — non-versioned path) ───

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key).unwrap();
        let plaintext = "my secret api key";
        let encrypted = service.encrypt(plaintext).unwrap();
        let decrypted = service.decrypt(&encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_produces_different_ciphertext() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key).unwrap();
        let plaintext = "test";
        let enc1 = service.encrypt(plaintext).unwrap();
        let enc2 = service.encrypt(plaintext).unwrap();
        assert_ne!(enc1, enc2); // Different nonces
    }

    #[test]
    fn test_decrypt_invalid_base64() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key).unwrap();
        let result = service.decrypt("not-valid-base64!!!");
        assert!(result.is_err());
    }

    #[test]
    fn test_decrypt_too_short() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key).unwrap();
        let short = BASE64.encode(&[0u8; 5]);
        let result = service.decrypt(&short);
        assert!(result.is_err());
    }

    #[test]
    fn test_new_with_valid_hex_key() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key);
        assert!(service.is_ok());
    }

    #[test]
    fn test_new_with_non_hex_key_fails() {
        // 64-char non-hex string — length passes, hex decode fails.
        let key = "this-is-not-hex-but-has-exactly-64-characters-aaaaaaaaaaaaaaaaaa";
        assert_eq!(key.len(), 64);
        let result = EncryptionService::new(key);
        assert!(result.is_err());
        assert!(matches!(result, Err(AppError::ConfigError(_))));
    }

    #[test]
    fn test_new_with_short_key_fails() {
        let key = "dev";
        let result = EncryptionService::new(key);
        assert!(result.is_err());
        assert!(matches!(result, Err(AppError::ConfigError(_))));
    }

    #[test]
    fn test_new_with_short_hex_key_fails() {
        // 32 hex chars = 16 bytes, not 32.
        let key = "0123456789abcdef0123456789abcdef";
        let result = EncryptionService::new(key);
        assert!(result.is_err());
        assert!(matches!(result, Err(AppError::ConfigError(_))));
    }

    #[test]
    fn test_try_decrypt_or_passthrough_returns_plaintext_on_valid_ciphertext() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key).unwrap();
        let plaintext = "my secret";
        let encrypted = service.encrypt(plaintext).unwrap();
        assert_eq!(service.try_decrypt_or_passthrough(&encrypted), plaintext);
    }

    #[test]
    fn test_try_decrypt_or_passthrough_passes_legacy_plaintext_through() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key).unwrap();
        // Simulate legacy plaintext that was never encrypted.
        let legacy = "+5511987654321";
        // Not valid base64 AES-GCM ciphertext — must fall back to passthrough.
        assert_eq!(service.try_decrypt_or_passthrough(legacy), legacy);
    }

    #[test]
    fn test_try_decrypt_or_passthrough_with_random_valid_base64() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key).unwrap();
        // Valid base64 but too short to be real ciphertext → Err → passthrough.
        let garbage = BASE64.encode(&[0u8; 5]);
        assert_eq!(service.try_decrypt_or_passthrough(&garbage), garbage);
    }

    #[test]
    fn test_try_decrypt_opt_preserves_none() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key).unwrap();
        assert!(service.try_decrypt_opt(None).is_none());
    }

    #[test]
    fn test_try_decrypt_opt_decrypts_some() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key).unwrap();
        let plaintext = "hello";
        let enc = service.encrypt(plaintext).unwrap();
        assert_eq!(service.try_decrypt_opt(Some(enc)), Some(plaintext.into()));
    }

    #[test]
    fn test_encrypt_opt_encrypts_non_empty() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key).unwrap();
        let enc = service.encrypt_opt(Some("secret".into())).unwrap();
        assert!(enc.is_some());
        let enc_val = enc.unwrap();
        assert_ne!(enc_val, "secret");
        assert_eq!(service.decrypt(&enc_val).unwrap(), "secret");
    }

    #[test]
    fn test_encrypt_opt_preserves_none() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key).unwrap();
        assert!(service.encrypt_opt(None).unwrap().is_none());
    }

    #[test]
    fn test_encrypt_opt_preserves_empty_string() {
        let key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let service = EncryptionService::new(key).unwrap();
        // Empty strings are passed through to avoid materializing useless ciphertext.
        assert_eq!(
            service.encrypt_opt(Some("".into())).unwrap(),
            Some("".into())
        );
    }

    // ─── T3.2 F1 — KeyResolver & versioned API tests ───

    fn resolver_with(versions: &[(u32, [u8; 32])], current: u32) -> KeyResolver {
        let mut keys = HashMap::new();
        for (v, k) in versions {
            keys.insert(*v, k.to_vec());
        }
        KeyResolver {
            keys,
            current_version: current,
        }
    }

    fn service_with(resolver: KeyResolver) -> EncryptionService {
        EncryptionService { resolver }
    }

    /// GATE TEST (T3.2 F1): ciphertext written under V1 must remain
    /// decryptable after V2 has been added and is the current version.
    /// If this fails, do NOT deploy.
    #[test]
    fn test_old_ciphertext_readable_after_adding_v2() {
        // 1. Resolver with only V1.
        let resolver_v1 = resolver_with(&[(1, [0u8; 32])], 1);
        let svc_v1 = service_with(resolver_v1);

        // 2. Encrypt some plaintext. Capture (c1, v=1).
        let (c1, v1) = svc_v1.encrypt_versioned("secret-api-key").unwrap();
        assert_eq!(v1, 1);

        // 3. Resolver with both V1 and V2; current_version = 2.
        let resolver_v1_v2 =
            resolver_with(&[(1, [0u8; 32]), (2, [1u8; 32])], 2);
        let svc_v1_v2 = service_with(resolver_v1_v2);

        // 4. Decrypt c1 via svc_v1_v2 using version=1 — MUST succeed.
        let plaintext_back = svc_v1_v2.decrypt_versioned(&c1, 1).unwrap();
        assert_eq!(plaintext_back, "secret-api-key");

        // 5. New encryption — MUST use V2 (current_version).
        let (_c2, v2) = svc_v1_v2.encrypt_versioned("new-key").unwrap();
        assert_eq!(v2, 2);
    }

    #[test]
    fn test_encrypt_versioned_returns_current_version() {
        let resolver = resolver_with(&[(1, [0u8; 32]), (2, [1u8; 32]), (3, [2u8; 32])], 3);
        let svc = service_with(resolver);
        let (_c, v) = svc.encrypt_versioned("x").unwrap();
        assert_eq!(v, 3, "encrypt_versioned must use current_version");
    }

    #[test]
    fn test_decrypt_versioned_unknown_version() {
        let resolver = resolver_with(&[(1, [0u8; 32])], 1);
        let svc = service_with(resolver);

        // Encrypt under V1.
        let (c1, _) = svc.encrypt_versioned("hello").unwrap();

        // Attempt to decrypt claiming version=99 — MUST error (not
        // silently return wrong plaintext).
        let res = svc.decrypt_versioned(&c1, 99);
        assert!(res.is_err());
        match res {
            Err(AppError::EncryptionError(msg)) => {
                assert!(msg.contains("99"));
                assert!(msg.to_lowercase().contains("unknown"));
            }
            other => panic!("expected EncryptionError for unknown version, got {other:?}"),
        }
    }

    #[test]
    fn test_decrypt_versioned_wrong_key_fails_authentication() {
        // Safety: using the *wrong loaded* version must fail AES-GCM
        // auth and return an error — never produce garbage plaintext.
        let resolver = resolver_with(&[(1, [0u8; 32]), (2, [1u8; 32])], 2);
        let svc = service_with(resolver);

        // Encrypt under V1.
        let (c1, v) = {
            let resolver_only_v1 = resolver_with(&[(1, [0u8; 32])], 1);
            let s1 = service_with(resolver_only_v1);
            s1.encrypt_versioned("hello").unwrap()
        };
        assert_eq!(v, 1);

        // Decrypt claiming V2 — AES-GCM auth tag check must fail.
        let res = svc.decrypt_versioned(&c1, 2);
        assert!(res.is_err());
    }

    #[test]
    fn test_from_env_uses_versioned_keys() {
        // Capture + restore env around the test. Use a unique prefix
        // so parallel tests don't stomp on our vars (each test sets a
        // distinct pair before calling from_env).
        let v1_hex =
            "0000000000000000000000000000000000000000000000000000000000000000";
        let v2_hex =
            "1111111111111111111111111111111111111111111111111111111111111111";

        // Serialize env manipulation by holding a mutex across all env-touching tests.
        let _guard = env_mutex().lock().unwrap();
        let prior_v1 = std::env::var("ENCRYPTION_KEY_V1").ok();
        let prior_v2 = std::env::var("ENCRYPTION_KEY_V2").ok();
        let prior_v3 = std::env::var("ENCRYPTION_KEY_V3").ok();
        let prior_base = std::env::var("ENCRYPTION_KEY").ok();

        // SAFETY: std::env::set_var is unsafe in recent Rust; we hold
        // a mutex over all env-using tests so this is effectively
        // single-threaded.
        std::env::set_var("ENCRYPTION_KEY_V1", v1_hex);
        std::env::set_var("ENCRYPTION_KEY_V2", v2_hex);
        std::env::remove_var("ENCRYPTION_KEY_V3");
        std::env::remove_var("ENCRYPTION_KEY");

        let resolver = KeyResolver::from_env().unwrap();
        assert_eq!(resolver.current_version(), 2);
        assert_eq!(resolver.known_versions(), vec![1, 2]);
        assert_eq!(resolver.decrypt_key(1).unwrap().len(), 32);
        assert_eq!(resolver.decrypt_key(2).unwrap().len(), 32);
        assert!(resolver.decrypt_key(3).is_none());

        // Restore env.
        restore_env("ENCRYPTION_KEY_V1", prior_v1);
        restore_env("ENCRYPTION_KEY_V2", prior_v2);
        restore_env("ENCRYPTION_KEY_V3", prior_v3);
        restore_env("ENCRYPTION_KEY", prior_base);
    }

    #[test]
    fn test_from_env_fallback_legacy_key() {
        let legacy =
            "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

        let _guard = env_mutex().lock().unwrap();
        let prior_v1 = std::env::var("ENCRYPTION_KEY_V1").ok();
        let prior_v2 = std::env::var("ENCRYPTION_KEY_V2").ok();
        let prior_base = std::env::var("ENCRYPTION_KEY").ok();

        std::env::remove_var("ENCRYPTION_KEY_V1");
        std::env::remove_var("ENCRYPTION_KEY_V2");
        std::env::set_var("ENCRYPTION_KEY", legacy);

        let resolver = KeyResolver::from_env().unwrap();
        assert_eq!(resolver.current_version(), 1);
        assert_eq!(resolver.known_versions(), vec![1]);
        assert_eq!(resolver.decrypt_key(1).unwrap().len(), 32);

        restore_env("ENCRYPTION_KEY_V1", prior_v1);
        restore_env("ENCRYPTION_KEY_V2", prior_v2);
        restore_env("ENCRYPTION_KEY", prior_base);
    }

    #[test]
    fn test_from_env_no_keys_errors() {
        let _guard = env_mutex().lock().unwrap();
        let prior_v1 = std::env::var("ENCRYPTION_KEY_V1").ok();
        let prior_base = std::env::var("ENCRYPTION_KEY").ok();

        std::env::remove_var("ENCRYPTION_KEY_V1");
        std::env::remove_var("ENCRYPTION_KEY_V2");
        std::env::remove_var("ENCRYPTION_KEY");

        let res = KeyResolver::from_env();
        assert!(res.is_err());

        restore_env("ENCRYPTION_KEY_V1", prior_v1);
        restore_env("ENCRYPTION_KEY", prior_base);
    }

    #[test]
    fn test_legacy_ciphertext_still_decryptable_after_resolver_refactor() {
        // Ensure the non-versioned `encrypt`/`decrypt` API still
        // round-trips after the KeyResolver refactor. This is the
        // regression gate for S0 tables (assistant_integrations,
        // legacy users columns) which do NOT use versioned paths.
        let hex_key =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let svc = EncryptionService::new(hex_key).unwrap();
        let plaintext = "s0-legacy-token";
        let enc = svc.encrypt(plaintext).unwrap();
        let dec = svc.decrypt(&enc).unwrap();
        assert_eq!(dec, plaintext);
    }

    #[test]
    fn test_encrypt_versioned_opt_none() {
        let resolver = resolver_with(&[(1, [0u8; 32])], 1);
        let svc = service_with(resolver);
        assert!(svc.encrypt_versioned_opt(None).unwrap().is_none());
    }

    #[test]
    fn test_encrypt_versioned_opt_empty_preserves_with_version() {
        let resolver = resolver_with(&[(1, [0u8; 32]), (2, [1u8; 32])], 2);
        let svc = service_with(resolver);
        let out = svc.encrypt_versioned_opt(Some("".into())).unwrap();
        assert_eq!(out, Some(("".into(), 2)));
    }

    #[test]
    fn test_encrypt_versioned_opt_some_encrypts_and_returns_current_version() {
        let resolver = resolver_with(&[(1, [0u8; 32]), (2, [7u8; 32])], 2);
        let svc = service_with(resolver);
        let (ct, v) = svc
            .encrypt_versioned_opt(Some("hi".into()))
            .unwrap()
            .unwrap();
        assert_eq!(v, 2);
        assert_ne!(ct, "hi");
        assert_eq!(svc.decrypt_versioned(&ct, 2).unwrap(), "hi");
    }

    // ─── helpers for env-mutating tests ───

    fn env_mutex() -> &'static std::sync::Mutex<()> {
        use std::sync::OnceLock;
        static M: OnceLock<std::sync::Mutex<()>> = OnceLock::new();
        M.get_or_init(|| std::sync::Mutex::new(()))
    }

    fn restore_env(key: &str, prior: Option<String>) {
        match prior {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }
}
