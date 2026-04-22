use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_user: String,
    pub smtp_pass: String,
    /// DEPRECATED: legacy single-key path. `main.rs` now loads keys via
    /// `EncryptionService::from_env`, which reads `ENCRYPTION_KEY_V*` and
    /// falls back to `ENCRYPTION_KEY`. This field remains so the env-vars
    /// consistency test still sees `ENCRYPTION_KEY` consumed in `from_env`,
    /// and so old test helpers that read `config.encryption_key` don't
    /// regress.
    #[allow(dead_code)]
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
    // The compaction LLM call is paid for by the USER using their workspace
    // API key for the assistant's own provider (decrypted via
    // `workspace::get_decrypted_api_key`). Platform-subsidized LLM calls per
    // user turn are economically infeasible at scale — user opts in, user
    // pays. The only platform-level knobs that remain are the heuristic
    // thresholds (threshold_pct, min_messages, keep_recent).
    // ──────────────────────────────────────────────────────────────────────
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

    // ──────────────────────────────────────────────────────────────────────
    // W2.1 — Evaluator (opt-in per assistant via `config_enable_evaluator`).
    //
    // Like compaction above, the evaluator LLM call is paid for by the USER
    // using their workspace API key for the assistant's own provider. The
    // evaluator still has its OWN session / prompt / independent message
    // array (Principle 10: evaluators run independently of the assistant
    // being evaluated) — it simply borrows the user's credential rather
    // than a platform credential. Cheap model per-provider is resolved at
    // call time via `services::evaluator::cheap_eval_model_for`; an
    // assistant-level override is honoured via `config_evaluator_model`.
    // ──────────────────────────────────────────────────────────────────────
    /// Maximum number of evaluator tasks running concurrently across the
    /// process. When saturated, new evaluations are DROPPED (logged at
    /// WARN) — we never queue, because a stale verdict helps no one and
    /// the user response is long gone. Default: 20.
    pub evaluator_max_concurrent: usize,
    /// Hard wall-clock timeout (in seconds) applied to the single
    /// evaluator LLM call. Default: 15. Shorter than the primary-turn
    /// timeout on purpose — evaluator must be fast or give up.
    pub evaluator_timeout_secs: u64,

    // ──────────────────────────────────────────────────────────────────────
    // T3.3 — Background curation agent (nightly).
    //
    // Scans `llm_call_logs` last 7d per assistant, computes per-assistant
    // error_rate, and emits a `curation_suggestion` notification when the
    // assistant crosses the 5% threshold. Idempotent: won't re-emit within
    // 24h for the same assistant.
    //
    // Default `false` in prod so operators opt in — prevents surprise
    // notifications the moment the feature ships. The 5% threshold + 10-call
    // floor already filters noise; this flag is the operator-visible kill
    // switch.
    // ──────────────────────────────────────────────────────────────────────
    /// When `false`, `spawn_curation_poller` is a no-op (a WARN is logged at
    /// startup so operators notice the feature is inert). When `true`, the
    /// poller runs a pass once every 24h.
    pub curation_enabled: bool,
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
            // Token budget per user per hour (migration 107). Legacy default
            // was 150 messages/h; the unit is now tokens, default 1000/h.
            baisync_rate_limit: env::var("BAISYNC_RATE_LIMIT_PER_HOUR")
                .unwrap_or_else(|_| "1000".into())
                .parse()
                .unwrap_or(1000),
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

            // T2.3 — Auto-compaction heuristic thresholds. Compaction itself
            // is user-funded (opt-in via `config_auto_compact` + the user's
            // decrypted workspace key) — no platform API key env var exists.
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

            // W2.1 — Evaluator runtime knobs. The evaluator is user-funded
            // (opt-in via `config_enable_evaluator` + the user's decrypted
            // workspace key) — no platform API key / provider / model env
            // var exists. Cheap model is resolved per-provider at call time.
            evaluator_max_concurrent: env::var("EVALUATOR_MAX_CONCURRENT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(20_usize),
            evaluator_timeout_secs: env::var("EVALUATOR_TIMEOUT_SECS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(15_u64),

            // T3.3 — Curation poller is opt-in. Any of `true`/`1`/`yes` (case
            // insensitive) enables it; anything else (including the default
            // absent case) leaves it disabled. Matches the documented
            // contract in `.env.example`.
            curation_enabled: env::var("CURATION_ENABLED")
                .ok()
                .map(|s| {
                    let v = s.trim().to_lowercase();
                    v == "true" || v == "1" || v == "yes"
                })
                .unwrap_or(false),
        }
    }

    /// W2.1 — log that the post-turn evaluator is wired to USER workspace
    /// credentials (the economically viable path). There is no platform-wide
    /// gate any more: an assistant with `config_enable_evaluator=true` will
    /// fire an evaluation whenever the user has a valid workspace API key
    /// for the assistant's provider. Missing workspace key → WARN at call
    /// site (not here), then skip.
    pub fn log_evaluator_status(&self) {
        tracing::info!(
            event = "evaluator.config",
            max_concurrent = self.evaluator_max_concurrent,
            timeout_secs = self.evaluator_timeout_secs,
            "post-turn evaluator enabled per-assistant via config_enable_evaluator; \
             uses the user's workspace API key (no platform-wide gate).",
        );
    }

    /// T3.3 — emit a startup log describing whether the background curation
    /// poller will run this process. Defaults to disabled (WARN) so operators
    /// see why `notifications` of type `curation_suggestion` aren't appearing.
    pub fn log_curation_status(&self) {
        if self.curation_enabled {
            tracing::info!(
                event = "curation.enabled",
                "T3.3 curation poller enabled: once-per-24h scan of llm_call_logs \
                 (7d window, >5% error-rate threshold, 10-call minimum, 24h per-assistant dedup).",
            );
        } else {
            tracing::warn!(
                event = "curation.disabled",
                "CURATION_ENABLED is not true: background curation agent is disabled. \
                 Set CURATION_ENABLED=true to let the poller emit curation_suggestion notifications.",
            );
        }
    }

    /// T2.3 — log compaction wiring. There is no platform-wide gate any more;
    /// assistants opt in per-assistant via `config_auto_compact=true` and the
    /// user's workspace API key for the assistant's provider pays for the
    /// compaction LLM call. This log simply surfaces the heuristic thresholds
    /// for operational visibility.
    pub fn log_compaction_status(&self) {
        tracing::info!(
            event = "compaction.config",
            threshold_pct = self.compaction_threshold_pct,
            min_messages = self.compaction_min_messages,
            keep_recent = self.compaction_keep_recent,
            rate_limit_secs = self.compaction_rate_limit_secs,
            "auto-compaction enabled per-assistant via config_auto_compact; \
             uses the user's workspace API key (no platform-wide gate).",
        );
    }
}
