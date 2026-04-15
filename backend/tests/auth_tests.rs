mod helpers;

use helpers::spawn_app;
use uuid::Uuid;

#[tokio::test]
async fn register_new_user() {
    let app = spawn_app().await;
    let email = format!("test-{}@example.com", Uuid::new_v4());
    let body = serde_json::json!({
        "name": "Test User",
        "email": email,
        "password": "Password123!"
    });

    let response = app.post("/api/auth/register", &body).await;
    assert_eq!(response.status(), 200);

    let json: serde_json::Value = response.json().await.unwrap();
    assert!(json.get("token").is_some());
    assert_eq!(json["user"]["email"], email);
}

#[tokio::test]
async fn register_duplicate_email_returns_400() {
    let app = spawn_app().await;
    let email = format!("dup-{}@example.com", Uuid::new_v4());
    let body = serde_json::json!({
        "name": "User",
        "email": email,
        "password": "Password123!"
    });

    app.post("/api/auth/register", &body).await;
    let response = app.post("/api/auth/register", &body).await;
    assert_eq!(response.status(), 400);
}

#[tokio::test]
async fn login_valid_credentials() {
    let app = spawn_app().await;
    let email = format!("login-{}@example.com", Uuid::new_v4());
    let body = serde_json::json!({
        "name": "User",
        "email": email,
        "password": "Password123!"
    });
    app.post("/api/auth/register", &body).await;

    let login_body = serde_json::json!({
        "email": email,
        "password": "Password123!"
    });
    let response = app.post("/api/auth/login", &login_body).await;
    assert_eq!(response.status(), 200);

    let json: serde_json::Value = response.json().await.unwrap();
    assert!(json.get("token").is_some());
}

#[tokio::test]
async fn login_invalid_password_returns_401() {
    let app = spawn_app().await;
    let email = format!("bad-{}@example.com", Uuid::new_v4());
    let body = serde_json::json!({
        "name": "User",
        "email": email,
        "password": "Password123!"
    });
    app.post("/api/auth/register", &body).await;

    let login_body = serde_json::json!({
        "email": email,
        "password": "WrongPassword!"
    });
    let response = app.post("/api/auth/login", &login_body).await;
    assert_eq!(response.status(), 401);
}

#[tokio::test]
async fn me_endpoint_returns_user() {
    let app = spawn_app().await;
    let email = format!("me-{}@example.com", Uuid::new_v4());
    let token = app.register_user("Me User", &email, "Password123!").await;

    let response = app.get_authenticated("/api/auth/me", &token).await;
    assert_eq!(response.status(), 200);

    let json: serde_json::Value = response.json().await.unwrap();
    assert_eq!(json["email"], email);
}

#[tokio::test]
async fn me_without_token_returns_401() {
    let app = spawn_app().await;
    let response = app.get("/api/auth/me").await;
    assert_eq!(response.status(), 401);
}

#[tokio::test]
async fn update_profile() {
    let app = spawn_app().await;
    let email = format!("profile-{}@example.com", Uuid::new_v4());
    let token = app.register_user("Old Name", &email, "Password123!").await;

    let body = serde_json::json!({ "name": "New Name" });
    let response = app
        .put_authenticated("/api/user/profile", &body, &token)
        .await;
    assert_eq!(response.status(), 200);

    let json: serde_json::Value = response.json().await.unwrap();
    assert_eq!(json["name"], "New Name");
}
