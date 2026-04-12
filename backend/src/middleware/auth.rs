use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use uuid::Uuid;

use crate::services::auth::decode_jwt;

#[derive(Clone, Debug)]
pub struct AuthUser {
    pub user_id: Uuid,
    pub email: String,
    pub workspace_id: Uuid,
}

pub async fn auth_middleware(mut request: Request, next: Next) -> Result<Response, StatusCode> {
    let jwt_secret = request
        .extensions()
        .get::<String>()
        .cloned()
        .unwrap_or_default();

    let auth_header = request
        .headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let claims = decode_jwt(auth_header, &jwt_secret).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let user_id = claims
        .sub
        .parse::<Uuid>()
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Extract workspace_id from JWT, fallback to user_id for backward compatibility
    let workspace_id = claims
        .workspace_id
        .as_ref()
        .and_then(|w| w.parse::<Uuid>().ok())
        .unwrap_or(user_id);

    request.extensions_mut().insert(AuthUser {
        user_id,
        email: claims.email,
        workspace_id,
    });

    Ok(next.run(request).await)
}
