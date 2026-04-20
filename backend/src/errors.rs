use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use scylla::transport::query_result::{
    IntoRowsResultError, MaybeFirstRowError, RowsError, SingleRowError,
};
use serde_json::json;
use tracing::error;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Internal error: {0}")]
    InternalError(String),

    #[error("Database error: {0}")]
    DatabaseError(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[allow(dead_code)]
    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    #[error("Encryption error: {0}")]
    EncryptionError(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg.clone()),
            AppError::InternalError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            AppError::DatabaseError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            AppError::RateLimitExceeded => {
                (StatusCode::TOO_MANY_REQUESTS, "Rate limit exceeded".into())
            }
            AppError::EncryptionError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            AppError::ConfigError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
        };

        if status == StatusCode::INTERNAL_SERVER_ERROR {
            error!(error = %self, "internal server error");
        }

        let body = json!({ "error": message });
        (status, axum::Json(body)).into_response()
    }
}

impl From<IntoRowsResultError> for AppError {
    fn from(e: IntoRowsResultError) -> Self {
        AppError::DatabaseError(e.to_string())
    }
}

impl From<RowsError> for AppError {
    fn from(e: RowsError) -> Self {
        AppError::DatabaseError(e.to_string())
    }
}

impl From<MaybeFirstRowError> for AppError {
    fn from(e: MaybeFirstRowError) -> Self {
        AppError::DatabaseError(e.to_string())
    }
}

impl From<SingleRowError> for AppError {
    fn from(e: SingleRowError) -> Self {
        AppError::DatabaseError(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    #[test]
    fn test_not_found_returns_404() {
        let err = AppError::NotFound("x".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_unauthorized_returns_401() {
        let err = AppError::Unauthorized("x".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn test_bad_request_returns_400() {
        let err = AppError::BadRequest("x".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_forbidden_returns_403() {
        let err = AppError::Forbidden("x".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_rate_limit_returns_429() {
        let err = AppError::RateLimitExceeded;
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn test_internal_error_returns_500() {
        let err = AppError::InternalError("x".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_database_error_returns_500() {
        let err = AppError::DatabaseError("x".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_encryption_error_returns_500() {
        let err = AppError::EncryptionError("x".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_config_error_returns_500() {
        let err = AppError::ConfigError("x".into());
        let response = err.into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
