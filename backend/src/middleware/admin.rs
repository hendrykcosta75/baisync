use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;

use crate::services::auth::decode_jwt;

#[derive(Clone, Debug)]
pub struct AdminUser;

pub async fn admin_middleware(mut request: Request, next: Next) -> Result<Response, StatusCode> {
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

    if claims.role.as_deref() != Some("admin") {
        return Err(StatusCode::FORBIDDEN);
    }

    request.extensions_mut().insert(AdminUser);

    Ok(next.run(request).await)
}
