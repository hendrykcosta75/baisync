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

    // ──────────────────────────────────────────────────────────────────────
    // W2.1 — Evaluator (opt-in per assistant via `config_enable_evaluator`).
    //
    // A cheap system-funded LLM reviews every primary user-turn reply
    // post-hoc (fire-and-forget, semaphore-limited) for PII leaks,
    // impossible promises, and contradictions to the assistant's system
    // prompt. The evaluator uses its own key / model / prompt — it NEVER
    // shares the user's API key or conversation session (Principle 10:
    // evaluators have their own session/prompt independent of the
    // assistant being evaluated).
    //
    // Fallback: when `evaluator_api_key` is None we reuse
    // `compaction_api_key` (same cheap model family), so operators who
    // already paid for COMPACTION_API_KEY don't need to set both. When
    // BOTH are None the evaluator is globally disabled (`is_evaluator_enabled`
    // returns false) — a WARN is logged at startup so this isn't silent.
    // ──────────────────────────────────────────────────────────────────────
    /// System-wide API key dedicated to evaluator LLM calls. `None` means
    /// the evaluator falls back to `compaction_api_key`; when both are
    /// None the feature is globally disabled.
    pub evaluator_api_key: Option<String>,
    /// Provider for the evaluator model. Default: `openai`. Must match a
    /// provider supported by `services::llm::call_llm_with_tools_ctx`.
    pub evaluator_provider: String,
    /// Default cheap model used when the assistant does not override
    /// `config_evaluator_model`. Default: `gpt-4o-mini`.
    pub evaluator_model_default: String,
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
    /// T2.3 helper — true when compaction is globally enabled (`COMPACTION_API_KEY`
    /// present and non-empty). Assistants must additionally set
    /// `config_auto_compact=true` for compaction to actually run.
    pub fn is_compaction_enabled(&self) -> bool {
        self.compaction_api_key
            .as_deref()
            .map(|k| !k.is_empty())
            .unwrap_or(false)
    }

    /// W2.1 — resolve the evaluator's API key. Returns the first non-empty
    /// value in the fallback chain:
    ///   1. `EVALUATOR_API_KEY`
    ///   2. `COMPACTION_API_KEY` (documented reuse — same cheap model)
    ///   3. `None` ⇒ evaluator disabled.
    ///
    /// Callers spawning an evaluation MUST check `is_evaluator_enabled()` or
    /// pattern-match this `Option` and skip the spawn on `None`.
    pub fn effective_evaluator_api_key(&self) -> Option<&str> {
        self.evaluator_api_key
            .as_deref()
            .filter(|k| !k.is_empty())
            .or_else(|| {
                self.compaction_api_key
                    .as_deref()
                    .filter(|k| !k.is_empty())
            })
    }

    /// W2.1 helper — true when the evaluator has a usable API key (direct or
    /// via the compaction-key fallback). Assistants must additionally set
    /// `config_enable_evaluator=true` for an evaluation to actually spawn.
    pub fn is_evaluator_enabled(&self) -> bool {
        self.effective_evaluator_api_key().is_some()
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

            // W2.1 — Evaluator config. Empty string ⇒ None so the fallback to
            // COMPACTION_API_KEY (and then "disabled") is evaluated cleanly.
            evaluator_api_key: env::var("EVALUATOR_API_KEY")
                .ok()
                .filter(|s| !s.is_empty()),
            evaluator_provider: env::var("EVALUATOR_PROVIDER")
                .unwrap_or_else(|_| "openai".into()),
            evaluator_model_default: env::var("EVALUATOR_MODEL")
                .unwrap_or_else(|_| "gpt-4o-mini".into()),
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

    /// W2.1 — emit a WARN at startup when the evaluator has no usable API
    /// key (neither `EVALUATOR_API_KEY` nor `COMPACTION_API_KEY`), so
    /// operators notice that assistants with `config_enable_evaluator=true`
    /// will silently no-op. Mirrors `log_compaction_status`.
    pub fn log_evaluator_status(&self) {
        if !self.is_evaluator_enabled() {
            tracing::warn!(
                event = "evaluator.disabled",
                "EVALUATOR_API_KEY / COMPACTION_API_KEY not set: post-turn evaluator is \
                 disabled globally. Assistants with config_enable_evaluator=true will be \
                 a no-op."
            );
        } else {
            let source = if self
                .evaluator_api_key
                .as_deref()
                .map(|k| !k.is_empty())
                .unwrap_or(false)
            {
                "EVALUATOR_API_KEY"
            } else {
                "COMPACTION_API_KEY (fallback)"
            };
            tracing::info!(
                event = "evaluator.enabled",
                source = source,
                provider = %self.evaluator_provider,
                model_default = %self.evaluator_model_default,
                max_concurrent = self.evaluator_max_concurrent,
                timeout_secs = self.evaluator_timeout_secs,
                "post-turn evaluator enabled",
            );
        }
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
