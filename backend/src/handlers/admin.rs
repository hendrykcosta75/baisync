use axum::extract::Path;
use axum::{Extension, Json};
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::admin::{
    AdminBlockRequest, AdminCreateUserRequest, AdminDashboardStats, AdminIntegrationsResponse,
    AdminLoginRequest, AdminLoginResponse, AdminUsageResponse, AdminUserDetail,
    AdminUserDetailEnriched, AdminUserInfo,
};
use crate::services::admin;

pub async fn admin_login(
    Extension(config): Extension<Config>,
    Extension(jwt_secret): Extension<String>,
    Json(req): Json<AdminLoginRequest>,
) -> Result<Json<AdminLoginResponse>, AppError> {
    let response = admin::admin_login(&config, &req.username, &req.password, &jwt_secret)?;
    Ok(Json(response))
}

pub async fn dashboard_stats(
    Extension(db): Extension<DbSession>,
) -> Result<Json<AdminDashboardStats>, AppError> {
    let stats = admin::get_dashboard_stats(&db).await?;
    Ok(Json(stats))
}

pub async fn list_users(
    Extension(db): Extension<DbSession>,
) -> Result<Json<Vec<AdminUserInfo>>, AppError> {
    let users = admin::list_all_users(&db).await?;
    Ok(Json(users))
}

pub async fn get_user(
    Extension(db): Extension<DbSession>,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminUserDetail>, AppError> {
    let detail = admin::get_user_detail(&db, &id).await?;
    Ok(Json(detail))
}

pub async fn create_user(
    Extension(db): Extension<DbSession>,
    Json(req): Json<AdminCreateUserRequest>,
) -> Result<Json<AdminUserInfo>, AppError> {
    let user = admin::create_user(&db, &req).await?;
    Ok(Json(user))
}

pub async fn block_user(
    Extension(db): Extension<DbSession>,
    Path(id): Path<Uuid>,
    Json(req): Json<AdminBlockRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    admin::block_user(&db, &id, req.blocked).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn delete_user(
    Extension(db): Extension<DbSession>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    admin::delete_user(&db, &id).await?;
    Ok(Json(serde_json::json!({ "success": true })))
}

pub async fn list_integrations(
    Extension(db): Extension<DbSession>,
) -> Result<Json<AdminIntegrationsResponse>, AppError> {
    let data = admin::list_all_integrations(&db).await?;
    Ok(Json(data))
}

pub async fn platform_usage(
    Extension(db): Extension<DbSession>,
) -> Result<Json<AdminUsageResponse>, AppError> {
    let data = admin::get_platform_usage(&db).await?;
    Ok(Json(data))
}

pub async fn get_user_enriched(
    Extension(db): Extension<DbSession>,
    Path(id): Path<Uuid>,
) -> Result<Json<AdminUserDetailEnriched>, AppError> {
    let detail = admin::get_user_detail_enriched(&db, &id).await?;
    Ok(Json(detail))
}
