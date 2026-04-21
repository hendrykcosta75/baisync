use std::time::Duration;

use crate::errors::AppError;
use crate::services::llm::retry_http_post;

/// Read `LLM_GLOBAL_TIMEOUT_SECS` (T1.3) directly from env. Fallback `60` on
/// any parse error. We use `env::var` here instead of `&Config` because these
/// TTS services are invoked from handlers that don't thread `Config` through.
fn llm_global_timeout() -> Duration {
    let secs = std::env::var("LLM_GLOBAL_TIMEOUT_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(60);
    Duration::from_secs(secs)
}

/// OpenAI TTS — returns raw MP3 bytes.
pub async fn text_to_speech(
    api_key: &str,
    voice_id: &str,
    text: &str,
) -> Result<Vec<u8>, AppError> {
    let client = reqwest::Client::new();
    let timeout = llm_global_timeout();
    let body = serde_json::json!({
        "model": "tts-1",
        "input": text,
        "voice": voice_id
    });
    let body_ref = &body;
    // T2.2 — retry initial POST on transient failures.
    let (resp_result, _outcome) = retry_http_post("openai_tts", timeout, || {
        client
            .post("https://api.openai.com/v1/audio/speech")
            .bearer_auth(api_key)
            .json(body_ref)
            .send()
    })
    .await;
    let resp = resp_result.map_err(|e| match e {
        AppError::InternalError(msg) if msg.contains("timeout") => AppError::InternalError(format!(
            "A chamada ao provider openai excedeu {}s. Tente resposta mais concisa ou reduza max_tokens.",
            timeout.as_secs()
        )),
        AppError::InternalError(msg) => {
            AppError::InternalError(format!("OpenAI TTS request failed: {msg}"))
        }
        other => other,
    })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::InternalError(format!(
            "OpenAI TTS error {status}: {body}"
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to read OpenAI TTS bytes: {e}")))?;

    Ok(bytes.to_vec())
}
