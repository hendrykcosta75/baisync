use std::time::Duration;

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

pub const GROK_VOICES: &[(&str, &str)] = &[
    ("eve", "Eve"),
    ("ara", "Ara"),
    ("rex", "Rex"),
    ("sal", "Sal"),
    ("leo", "Leo"),
];

/// Accepted `output_format` values for [`text_to_speech`].
pub const GROK_FORMAT_MP3: &str = "mp3_24000_128";
pub const GROK_FORMAT_OPUS: &str = "opus_48000_192";

/// Grok TTS — POST https://api.x.ai/v1/tts.
///
/// `output_format` follows the ElevenLabs-style `{codec}_{sample_rate}_{bitrate_kbps}`
/// string. Use [`GROK_FORMAT_MP3`] or [`GROK_FORMAT_OPUS`].
pub async fn text_to_speech(
    api_key: &str,
    voice_id: &str,
    text: &str,
    output_format: &str,
) -> Result<Vec<u8>, AppError> {
    let mut parts = output_format.split('_');
    let codec = parts.next().unwrap_or("mp3");
    let sample_rate: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(24000);
    let bit_rate_kbps: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(128);
    let bit_rate = bit_rate_kbps * 1000;

    let client = reqwest::Client::new();
    let timeout = llm_global_timeout();
    let body = serde_json::json!({
        "voice_id": voice_id,
        "text": text,
        "output_format": {
            "codec": codec,
            "sample_rate": sample_rate,
            "bit_rate": bit_rate,
        }
    });
    let body_ref = &body;
    // T2.2 — retry initial POST on transient failures.
    let (resp_result, _outcome) = retry_http_post("grok_tts", timeout, || {
        client
            .post("https://api.x.ai/v1/tts")
            .bearer_auth(api_key)
            .json(body_ref)
            .send()
    })
    .await;
    let resp = resp_result.map_err(|e| match e {
        AppError::InternalError(msg) if msg.contains("timeout") => AppError::InternalError(format!(
            "A chamada ao provider grok excedeu {}s. Tente resposta mais concisa ou reduza max_tokens.",
            timeout.as_secs()
        )),
        AppError::InternalError(msg) => {
            AppError::InternalError(format!("Grok TTS request failed: {msg}"))
        }
        other => other,
    })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::InternalError(format!(
            "Grok TTS error {status}: {body}"
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to read Grok TTS bytes: {e}")))?;

    Ok(bytes.to_vec())
}
