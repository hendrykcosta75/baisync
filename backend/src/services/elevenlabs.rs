use std::time::Duration;

use serde_json::json;

use crate::errors::AppError;

/// See `openai_audio::llm_global_timeout` for rationale.
fn llm_global_timeout() -> Duration {
    let secs = std::env::var("LLM_GLOBAL_TIMEOUT_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(60);
    Duration::from_secs(secs)
}

/// Calls ElevenLabs TTS and returns raw audio bytes.
/// `output_format` examples: "mp3_44100_128", "opus_48000_192"
pub async fn text_to_speech(
    api_key: &str,
    voice_id: &str,
    text: &str,
    output_format: &str,
) -> Result<Vec<u8>, AppError> {
    let client = reqwest::Client::new();
    let url = format!("https://api.elevenlabs.io/v1/text-to-speech/{voice_id}");

    let timeout = llm_global_timeout();
    let send_fut = client
        .post(&url)
        .header("xi-api-key", api_key)
        .json(&json!({
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "output_format": output_format
        }))
        .send();
    let resp = tokio::time::timeout(timeout, send_fut)
        .await
        .map_err(|_| {
            AppError::InternalError(format!(
                "A chamada ao provider elevenlabs excedeu {}s. Tente resposta mais concisa ou reduza max_tokens.",
                timeout.as_secs()
            ))
        })?
        .map_err(|e| AppError::InternalError(format!("ElevenLabs TTS request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::InternalError(format!(
            "ElevenLabs TTS error {status}: {body}"
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to read TTS audio: {e}")))?;

    Ok(bytes.to_vec())
}
