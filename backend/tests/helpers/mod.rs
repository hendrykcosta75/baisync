use reqwest::{Client, Response};

pub struct TestApp {
    pub address: String,
    pub client: Client,
}

impl TestApp {
    pub async fn get(&self, path: &str) -> Response {
        self.client
            .get(format!("{}{}", self.address, path))
            .send()
            .await
            .expect("Failed to execute request")
    }

    pub async fn post(&self, path: &str, body: &serde_json::Value) -> Response {
        self.client
            .post(format!("{}{}", self.address, path))
            .json(body)
            .send()
            .await
            .expect("Failed to execute request")
    }

    pub async fn put(&self, path: &str, body: &serde_json::Value) -> Response {
        self.client
            .put(format!("{}{}", self.address, path))
            .json(body)
            .send()
            .await
            .expect("Failed to execute request")
    }

    pub async fn delete(&self, path: &str) -> Response {
        self.client
            .delete(format!("{}{}", self.address, path))
            .send()
            .await
            .expect("Failed to execute request")
    }

    pub async fn get_authenticated(&self, path: &str, token: &str) -> Response {
        self.client
            .get(format!("{}{}", self.address, path))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .expect("Failed to execute request")
    }

    pub async fn post_authenticated(
        &self,
        path: &str,
        body: &serde_json::Value,
        token: &str,
    ) -> Response {
        self.client
            .post(format!("{}{}", self.address, path))
            .header("Authorization", format!("Bearer {}", token))
            .json(body)
            .send()
            .await
            .expect("Failed to execute request")
    }

    pub async fn put_authenticated(
        &self,
        path: &str,
        body: &serde_json::Value,
        token: &str,
    ) -> Response {
        self.client
            .put(format!("{}{}", self.address, path))
            .header("Authorization", format!("Bearer {}", token))
            .json(body)
            .send()
            .await
            .expect("Failed to execute request")
    }

    pub async fn delete_authenticated(&self, path: &str, token: &str) -> Response {
        self.client
            .delete(format!("{}{}", self.address, path))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .expect("Failed to execute request")
    }

    /// Register a user and return the auth token
    pub async fn register_user(&self, name: &str, email: &str, password: &str) -> String {
        let body = serde_json::json!({
            "name": name,
            "email": email,
            "password": password
        });
        let response = self.post("/api/auth/register", &body).await;
        assert_eq!(response.status(), 200, "Registration failed");
        let json: serde_json::Value = response.json().await.unwrap();
        json["token"].as_str().unwrap().to_string()
    }
}

/// Spawn the application on a random port (requires Cassandra running)
pub async fn spawn_app() -> TestApp {
    dotenvy::from_filename("../.env.test").ok();
    dotenvy::dotenv().ok();

    // If CASSANDRA_KEYSPACE is set to an isolated test keyspace, bind the
    // session directly to it (assuming `cargo run --bin setup_test_keyspace`
    // has already applied migrations there). This avoids polluting the
    // production keyspace when running integration tests locally or in CI.
    // When unset, fall back to the default behavior of `db::connect` which
    // runs migrations and binds to `inertial_eclipse`.
    let test_keyspace = std::env::var("CASSANDRA_KEYSPACE")
        .ok()
        .filter(|s| !s.is_empty() && s != "inertial_eclipse");

    let config = backend::config::Config::from_env();
    let db = if let Some(ref ks) = test_keyspace {
        let session = scylla::SessionBuilder::new()
            .known_node(&config.database_url)
            .use_keyspace(ks, false)
            .build()
            .await
            .expect("Failed to connect to Cassandra with test keyspace");
        std::sync::Arc::new(session)
    } else {
        backend::db::connect(&config.database_url).await
    };
    let encryption = backend::services::encryption::EncryptionService::new(&config.encryption_key)
        .expect("Failed to initialize encryption");
    let conn_store = backend::services::connection_state::ConnectionStateStore::new();
    let event_bus = backend::services::events::EventBus::new();
    backend::services::events::init_global(event_bus.clone());

    let app = backend::app::build_router(db, config, encryption, event_bus, conn_store);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Failed to bind random port");
    let port = listener.local_addr().unwrap().port();
    let address = format!("http://127.0.0.1:{}", port);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    TestApp {
        address,
        client: Client::new(),
    }
}
