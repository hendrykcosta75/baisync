use std::time::Duration;

use serde_json::json;

use crate::errors::AppError;
use crate::services::llm::retry_http_post;

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
    let body = json!({
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "output_format": output_format
    });
    let body_ref = &body;
    let url_ref = url.as_str();
    // T2.2 — retry initial POST on transient failures.
    let (resp_result, _outcome) = retry_http_post("elevenlabs_tts", timeout, || {
        client
            .post(url_ref)
            .header("xi-api-key", api_key)
            .json(body_ref)
            .send()
    })
    .await;
    let resp = resp_result.map_err(|e| match e {
        AppError::InternalError(msg) if msg.contains("timeout") => AppError::InternalError(format!(
            "A chamada ao provider elevenlabs excedeu {}s. Tente resposta mais concisa ou reduza max_tokens.",
            timeout.as_secs()
        )),
        AppError::InternalError(msg) => {
            AppError::InternalError(format!("ElevenLabs TTS request failed: {msg}"))
        }
        other => other,
    })?;

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
