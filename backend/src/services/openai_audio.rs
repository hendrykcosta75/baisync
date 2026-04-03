use crate::errors::AppError;

/// OpenAI TTS — returns raw MP3 bytes.
pub async fn text_to_speech(api_key: &str, voice_id: &str, text: &str) -> Result<Vec<u8>, AppError> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.openai.com/v1/audio/speech")
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "tts-1",
            "input": text,
            "voice": voice_id
        }))
        .send()
        .await
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
