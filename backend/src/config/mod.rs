use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_user: String,
    pub smtp_pass: String,
    pub encryption_key: String,
    pub baileys_url: String,
    pub baileys_api_key: String,
    pub app_url: String,
    pub baisync_api_key: String,
    pub baisync_rate_limit: i32,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL").unwrap_or_else(|_| "127.0.0.1:9042".into()),
            jwt_secret: env::var("JWT_SECRET").expect("JWT_SECRET must be set"),
            smtp_host: env::var("SMTP_HOST").unwrap_or_else(|_| "localhost".into()),
            smtp_port: env::var("SMTP_PORT")
                .unwrap_or_else(|_| "587".into())
                .parse()
                .expect("SMTP_PORT must be a number"),
            smtp_user: env::var("SMTP_USER").unwrap_or_default(),
            smtp_pass: env::var("SMTP_PASS").unwrap_or_default(),
            encryption_key: env::var("ENCRYPTION_KEY").expect("ENCRYPTION_KEY must be set"),
            baileys_url: env::var("BAILEYS_URL").unwrap_or_else(|_| "http://baileys:3025".into()),
            baileys_api_key: env::var("BAILEYS_API_KEY").unwrap_or_default(),
            app_url: env::var("APP_URL").unwrap_or_else(|_| "http://localhost:3000".into()),
            baisync_api_key: env::var("BAISYNC_API_KEY").unwrap_or_default(),
            baisync_rate_limit: env::var("BAISYNC_RATE_LIMIT_PER_HOUR")
                .unwrap_or_else(|_| "150".into())
                .parse()
                .unwrap_or(150),
        }
    }
}
