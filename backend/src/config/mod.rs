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
    pub allowed_origins: Vec<String>,
    pub baisync_api_key: String,
    pub baisync_rate_limit: i32,
    pub admin_user: String,
    pub admin_password: String,
    pub meta_app_secret: String,
    pub livekit_url: String,
    pub livekit_api_key: String,
    pub livekit_api_secret: String,
    /// Timeout global em segundos para HTTP POST a providers LLM
    /// (openai, claude, gemini, grok, deepseek e transcription providers).
    /// Não afeta o loop de tool execution (mantém semântica de "LLM decide quando parar").
    pub llm_global_timeout_secs: u64,

    // ──────────────────────────────────────────────────────────────────────
    // T2.3 — Auto-compaction (opt-in per assistant via `config_auto_compact`).
    //
    // Uses a system-provided cheap LLM key (COMPACTION_API_KEY) — NEVER the
    // user's own key. When `compaction_api_key` is None, compaction is
    // globally disabled (a WARN is logged at startup) even for assistants
    // that have `config_auto_compact=true`.
    // ──────────────────────────────────────────────────────────────────────
    /// System-wide API key used to pay for compaction LLM calls. `None`
    /// disables the feature globally; `is_compaction_enabled()` returns false.
    pub compaction_api_key: Option<String>,
    /// Cheap model used to summarize the conversation prefix. Default:
    /// `gpt-4o-mini`. Ignored when `compaction_api_key` is None.
    pub compaction_model: String,
    /// Provider for the compaction model. Default: `openai`. Must match a
    /// provider supported by `services::llm::call_llm`.
    pub compaction_provider: String,
    /// Fraction of `assistant.max_tokens` that must be exceeded before
    /// compaction fires. Default: 0.80.
    pub compaction_threshold_pct: f32,
    /// Minimum conversation length (in messages) before compaction is
    /// considered. Default: 15.
    pub compaction_min_messages: usize,
    /// How many of the most-recent messages to keep untouched (compaction
    /// only replaces the prefix). Default: 5.
    pub compaction_keep_recent: usize,
    /// Rate limit: one compaction per `(user_id, conversation_id)` per this
    /// many seconds. Default: 3600. **Must** stay in sync with migration
    /// 098's `default_time_to_live` on `compaction_rate_limits` — if this
    /// value diverges, the LWT window and the TTL window will disagree.
    ///
    /// `#[allow(dead_code)]`: the real rate-limit window is enforced by the
    /// table TTL (Cassandra-side). This field is read at startup for the
    /// `compaction.enabled` tracing line and by tests; a future dynamic
    /// per-assistant rate-limit would consume it directly.
    #[allow(dead_code)]
    pub compaction_rate_limit_secs: u64,
}

impl Config {
    /// T2.3 helper — true when compaction is globally enabled (`COMPACTION_API_KEY`
    /// present and non-empty). Assistants must additionally set
    /// `config_auto_compact=true` for compaction to actually run.
    pub fn is_compaction_enabled(&self) -> bool {
        self.compaction_api_key
            .as_deref()
            .map(|k| !k.is_empty())
            .unwrap_or(false)
    }
}

impl Config {
    pub fn from_env() -> Self {
        let app_url = env::var("APP_URL").unwrap_or_else(|_| "http://localhost:3000".into());
        let allowed_origins = env::var("ALLOWED_ORIGINS")
            .unwrap_or_else(|_| app_url.clone())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();

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
            app_url,
            allowed_origins,
            baisync_api_key: env::var("BAISYNC_API_KEY").unwrap_or_default(),
            baisync_rate_limit: env::var("BAISYNC_RATE_LIMIT_PER_HOUR")
                .unwrap_or_else(|_| "150".into())
                .parse()
                .unwrap_or(150),
            admin_user: env::var("ADMIN_USER").unwrap_or_default(),
            admin_password: env::var("ADMIN_PASSWORD").unwrap_or_default(),
            meta_app_secret: env::var("META_APP_SECRET").unwrap_or_default(),
            livekit_url: env::var("LIVEKIT_URL").unwrap_or_else(|_| "ws://livekit:7880".into()),
            livekit_api_key: env::var("LIVEKIT_API_KEY").unwrap_or_default(),
            livekit_api_secret: env::var("LIVEKIT_API_SECRET").unwrap_or_default(),
            llm_global_timeout_secs: env::var("LLM_GLOBAL_TIMEOUT_SECS")
                .unwrap_or_else(|_| "60".into())
                .parse()
                .unwrap_or(60),

            // T2.3 — Auto-compaction config. Empty string ⇒ None so
            // `is_compaction_enabled()` reports false.
            compaction_api_key: env::var("COMPACTION_API_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            compaction_model: env::var("COMPACTION_MODEL")
                .unwrap_or_else(|_| "gpt-4o-mini".into()),
            compaction_provider: env::var("COMPACTION_PROVIDER")
                .unwrap_or_else(|_| "openai".into()),
            compaction_threshold_pct: env::var("COMPACTION_THRESHOLD_PCT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.80_f32),
            compaction_min_messages: env::var("COMPACTION_MIN_MESSAGES")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(15_usize),
            compaction_keep_recent: env::var("COMPACTION_KEEP_RECENT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(5_usize),
            compaction_rate_limit_secs: env::var("COMPACTION_RATE_LIMIT_SECS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(3600_u64),
        }
    }

    /// Emit a WARN when compaction is configured-but-disabled. Call once at
    /// startup from `main.rs` so operators notice the feature is inert.
    pub fn log_compaction_status(&self) {
        if !self.is_compaction_enabled() {
            tracing::warn!(
                event = "compaction.disabled",
                "COMPACTION_API_KEY not set: auto-compaction is disabled globally. \
                 Assistants with config_auto_compact=true will fall back to the raw \
                 recent-history path."
            );
        } else {
            tracing::info!(
                event = "compaction.enabled",
                model = %self.compaction_model,
                provider = %self.compaction_provider,
                threshold_pct = self.compaction_threshold_pct,
                min_messages = self.compaction_min_messages,
                keep_recent = self.compaction_keep_recent,
                rate_limit_secs = self.compaction_rate_limit_secs,
                "auto-compaction enabled",
            );
        }
    }
}
