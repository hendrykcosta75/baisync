use crate::errors::AppError;

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
    let resp = client
        .post("https://api.x.ai/v1/tts")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "voice_id": voice_id,
            "text": text,
            "output_format": {
                "codec": codec,
                "sample_rate": sample_rate,
                "bit_rate": bit_rate,
            }
        }))
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Grok TTS request failed: {e}")))?;

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
