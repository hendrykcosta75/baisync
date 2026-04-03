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

    request.extensions_mut().insert(AuthUser {
        user_id,
        email: claims.email,
    });

    Ok(next.run(request).await)
}
