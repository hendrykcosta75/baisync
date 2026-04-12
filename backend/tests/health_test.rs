mod helpers;

use helpers::spawn_app;

#[tokio::test]
async fn health_check_works() {
    let app = spawn_app().await;
    let response = app.get("/health").await;
    assert_eq!(response.status(), 200);
    let text = response.text().await.unwrap();
    assert_eq!(text, "ok");
}
