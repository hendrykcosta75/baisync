use axum::body::Body;
use axum::extract::{Extension, Multipart, Path};
use axum::http::header;
use axum::response::Response;
use axum::Json;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::models::user::{
    AuthResponse, ChangePasswordRequest, DeleteAccountRequest, ForgotPasswordRequest, LoginRequest,
    RegisterRequest, ResetPasswordRequest, UpdateNotificationPrefsRequest, UpdateProfileRequest,
    UserPublic, Verify2FARequest,
};
use crate::services::{auth as auth_service, email as email_service};

pub async fn register(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let response = auth_service::register_user(
        &db,
        &req.email,
        &req.password,
        &req.name,
        &config.jwt_secret,
    )
    .await?;
    Ok(Json(response))
}

pub async fn login(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, AppError> {
    let response =
        auth_service::login_user(&db, &req.email, &req.password, &config.jwt_secret).await?;
    Ok(Json(response))
}

pub async fn forgot_password(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Json(req): Json<ForgotPasswordRequest>,
) -> Result<Json<Value>, AppError> {
    // Find user by email
    let result = db
        .query_unpaged(
            "SELECT id FROM inertial_eclipse.users WHERE email = ?",
            (&req.email,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    if let Some((user_id,)) = result
        .into_rows_result()?
        .maybe_first_row::<(uuid::Uuid,)>()?
    {
        let row = (user_id,);
        let token = auth_service::generate_reset_token();
        auth_service::save_reset_token(&db, &row.0, &token).await?;
        email_service::send_reset_email(&config, &req.email, &token).await?;
    }

    // Always return success to prevent email enumeration
    Ok(Json(
        json!({"message": "If an account with that email exists, a reset link has been sent"}),
    ))
}

pub async fn reset_password(
    Extension(db): Extension<DbSession>,
    Json(req): Json<ResetPasswordRequest>,
) -> Result<Json<Value>, AppError> {
    auth_service::reset_password(&db, &req.token, &req.new_password).await?;
    Ok(Json(json!({"message": "Password has been reset"})))
}

pub async fn enable_2fa(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Value>, AppError> {
    let code = auth_service::enable_2fa(&db, &auth_user.user_id).await?;
    email_service::send_2fa_code(&config, &auth_user.email, &code).await?;
    Ok(Json(
        json!({"message": "Verification code sent to your email", "secret": code}),
    ))
}

pub async fn verify_2fa(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<Verify2FARequest>,
) -> Result<Json<Value>, AppError> {
    auth_service::verify_2fa(&db, &auth_user.user_id, &req.code).await?;
    Ok(Json(json!({"message": "2FA has been enabled"})))
}

pub async fn me(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Value>, AppError> {
    let public = auth_service::get_user_public_with_avatar(&db, &auth_user.user_id).await?;
    Ok(Json(json!({
        "id": public.id,
        "email": public.email,
        "name": public.name,
        "two_factor_enabled": public.two_factor_enabled,
        "has_avatar": public.has_avatar,
        "notify_email": public.notify_email,
        "notify_system": public.notify_system,
        "created_at": public.created_at,
        "workspace_id": auth_user.workspace_id,
    })))
}

pub async fn update_profile(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<UpdateProfileRequest>,
) -> Result<Json<UserPublic>, AppError> {
    let user = auth_service::update_profile(&db, &auth_user.user_id, &req.name).await?;
    Ok(Json(user))
}

pub async fn update_notification_prefs(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<UpdateNotificationPrefsRequest>,
) -> Result<Json<UserPublic>, AppError> {
    let user = auth_service::update_notification_prefs(
        &db,
        &auth_user.user_id,
        req.notify_email,
        req.notify_system,
    )
    .await?;
    Ok(Json(user))
}

pub async fn change_password(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<Json<Value>, AppError> {
    auth_service::change_password(
        &db,
        &auth_user.user_id,
        &req.current_password,
        &req.new_password,
    )
    .await?;
    Ok(Json(json!({"message": "Senha alterada com sucesso"})))
}

pub async fn delete_account(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Json(req): Json<DeleteAccountRequest>,
) -> Result<Json<Value>, AppError> {
    auth_service::delete_account(&db, &auth_user.user_id, &req.password).await?;
    Ok(Json(json!({"message": "Conta removida com sucesso"})))
}

pub async fn upload_avatar(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let mut file_bytes = Vec::new();
    let mut mime_type = "image/png".to_string();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Multipart error: {e}")))?
    {
        if field.name() == Some("file") {
            mime_type = field.content_type().unwrap_or("image/png").to_string();
            file_bytes = field
                .bytes()
                .await
                .map_err(|e| AppError::BadRequest(format!("Failed to read file: {e}")))?
                .to_vec();
        }
    }

    if file_bytes.is_empty() {
        return Err(AppError::BadRequest("No file uploaded".into()));
    }

    // 2 MB limit for avatars
    if file_bytes.len() > 2 * 1024 * 1024 {
        return Err(AppError::BadRequest("Avatar too large (max 2MB)".into()));
    }

    auth_service::upload_avatar(&db, &auth_user.user_id, &file_bytes, &mime_type).await?;

    Ok(Json(json!({ "success": true, "has_avatar": true })))
}

pub async fn delete_avatar(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
) -> Result<Json<Value>, AppError> {
    auth_service::delete_avatar(&db, &auth_user.user_id).await?;
    Ok(Json(json!({ "success": true })))
}

pub async fn get_avatar(
    Extension(db): Extension<DbSession>,
    Path(user_id): Path<Uuid>,
) -> Result<Response, AppError> {
    let (mime_type, data) = auth_service::get_avatar(&db, &user_id).await?;

    let response = Response::builder()
        .header(header::CONTENT_TYPE, mime_type)
        .header(header::CACHE_CONTROL, "public, max-age=3600")
        .body(Body::from(data))
        .map_err(|e| AppError::InternalError(e.to_string()))?;

    Ok(response)
}
