use serde_json::json;

use crate::errors::AppError;

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

    let resp = client
        .post(&url)
        .header("xi-api-key", api_key)
        .json(&json!({
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "output_format": output_format
        }))
        .send()
        .await
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
