use chrono::Utc;
use jsonwebtoken::{encode, EncodingKey, Header};
use serde::{Deserialize, Serialize};

use crate::errors::AppError;

const TOKEN_TTL_SECS: i64 = 15 * 60;

#[derive(Debug, Serialize, Deserialize)]
struct VideoGrant {
    pub room: String,
    #[serde(rename = "roomJoin")]
    pub room_join: bool,
    #[serde(rename = "canPublish")]
    pub can_publish: bool,
    #[serde(rename = "canSubscribe")]
    pub can_subscribe: bool,
    #[serde(rename = "canPublishData")]
    pub can_publish_data: bool,
    #[serde(rename = "canUpdateOwnMetadata")]
    pub can_update_own_metadata: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct LivekitClaims {
    pub iss: String,
    pub sub: String,
    pub exp: i64,
    pub nbf: i64,
    pub iat: i64,
    pub name: String,
    pub video: VideoGrant,
}

pub fn generate_token(
    api_key: &str,
    api_secret: &str,
    room: &str,
    identity: &str,
    display_name: &str,
) -> Result<String, AppError> {
    if api_key.is_empty() || api_secret.is_empty() {
        return Err(AppError::InternalError(
            "LiveKit credentials not configured".into(),
        ));
    }

    let now = Utc::now().timestamp();
    let claims = LivekitClaims {
        iss: api_key.to_string(),
        sub: identity.to_string(),
        exp: now + TOKEN_TTL_SECS,
        nbf: now - 30,
        iat: now,
        name: display_name.to_string(),
        video: VideoGrant {
            room: room.to_string(),
            room_join: true,
            can_publish: true,
            can_subscribe: true,
            can_publish_data: true,
            can_update_own_metadata: true,
        },
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(api_secret.as_bytes()),
    )
    .map_err(|e| AppError::InternalError(format!("livekit token sign: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_token_with_valid_config() {
        let token = generate_token(
            "devkey",
            "devsecret_at_least_32_chars_xxxxxx",
            "room-abc",
            "user-123",
            "Alice",
        )
        .unwrap();
        assert_eq!(token.matches('.').count(), 2);
    }

    #[test]
    fn empty_creds_return_error() {
        let err = generate_token("", "", "r", "i", "n").unwrap_err();
        assert!(matches!(err, AppError::InternalError(_)));
    }

    #[test]
    fn token_has_video_grant() {
        use base64::Engine;
        let token = generate_token(
            "k",
            "secret_at_least_32_chars_xxxxxxxxxxx",
            "room-x",
            "id",
            "Name",
        )
        .unwrap();
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(parts[1])
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&decoded).unwrap();
        assert_eq!(json["video"]["room"], "room-x");
        assert_eq!(json["video"]["roomJoin"], true);
        assert_eq!(json["name"], "Name");
    }
}
