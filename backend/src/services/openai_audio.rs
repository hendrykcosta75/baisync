use std::time::Duration;

use crate::errors::AppError;

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
    let send_fut = client
        .post("https://api.openai.com/v1/audio/speech")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "tts-1",
            "input": text,
            "voice": voice_id
        }))
        .send();
    let resp = tokio::time::timeout(timeout, send_fut)
        .await
        .map_err(|_| {
            AppError::InternalError(format!(
                "A chamada ao provider openai excedeu {}s. Tente resposta mais concisa ou reduza max_tokens.",
                timeout.as_secs()
            ))
        })?
        .map_err(|e| AppError::InternalError(format!("OpenAI TTS request failed: {e}")))?;

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
