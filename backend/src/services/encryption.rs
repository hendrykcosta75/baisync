use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use aes_gcm::aead::rand_core::RngCore;

use crate::errors::AppError;

#[derive(Clone)]
pub struct EncryptionService {
    key: Vec<u8>,
}

impl EncryptionService {
    pub fn new(hex_key: &str) -> Result<Self, AppError> {
        if hex_key.len() != 64 {
            return Err(AppError::ConfigError(
                "ENCRYPTION_KEY must be 64 hex chars (32 bytes)".into(),
            ));
        }
        let key = hex::decode(hex_key).map_err(|_| {
            AppError::ConfigError("ENCRYPTION_KEY must be valid hex".into())
        })?;
        if key.len() != 32 {
            return Err(AppError::ConfigError(
                "ENCRYPTION_KEY must decode to exactly 32 bytes".into(),
            ));
        }
        Ok(Self { key })
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<String, AppError> {
        let cipher = Aes256Gcm::new_from_slice(&self.key)
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

    pub fn decrypt(&self, encrypted: &str) -> Result<String, AppError> {
        let combined = BASE64
            .decode(encrypted)
            .map_err(|e| AppError::EncryptionError(e.to_string()))?;

        if combined.len() < 12 {
            return Err(AppError::EncryptionError("Invalid ciphertext".into()));
        }

        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|e| AppError::EncryptionError(e.to_string()))?;

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| AppError::EncryptionError(e.to_string()))?;

        String::from_utf8(plaintext).map_err(|e| AppError::EncryptionError(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
