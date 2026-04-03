use crate::errors::AppError;

/// Transcribes audio bytes using OpenAI Whisper API.
/// `audio_bytes`: raw audio data (ogg, mp3, mp4, wav, webm, etc.)
/// `filename`: hint for the MIME type (e.g. "audio.ogg", "audio.mp3")
pub async fn transcribe_openai(
    openai_key: &str,
    audio_bytes: Vec<u8>,
    filename: &str,
) -> Result<String, AppError> {
    let client = reqwest::Client::new();

    let mime = if filename.ends_with(".ogg") {
        "audio/ogg"
    } else if filename.ends_with(".mp4") || filename.ends_with(".m4a") {
        "audio/mp4"
    } else if filename.ends_with(".wav") {
        "audio/wav"
    } else if filename.ends_with(".webm") {
        "audio/webm"
    } else {
        "audio/mpeg"
    };

    let file_part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(filename.to_string())
        .mime_str(mime)
        .map_err(|e| AppError::InternalError(format!("MIME error: {e}")))?;

    let form = reqwest::multipart::Form::new()
        .text("model", "whisper-1")
        .part("file", file_part);

    let resp = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(openai_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Whisper request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::InternalError(format!(
            "Whisper API error {status}: {body}"
        )));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Whisper parse error: {e}")))?;

    let text = data["text"]
        .as_str()
        .ok_or_else(|| AppError::InternalError("No text in Whisper response".into()))?
        .trim()
        .to_string();

    Ok(text)
}

/// Transcribes audio bytes using ElevenLabs Scribe API.
pub async fn transcribe_elevenlabs(
    api_key: &str,
    audio_bytes: Vec<u8>,
    filename: &str,
) -> Result<String, AppError> {
    let client = reqwest::Client::new();

    let mime = if filename.ends_with(".ogg") {
        "audio/ogg"
    } else if filename.ends_with(".mp4") || filename.ends_with(".m4a") {
        "audio/mp4"
    } else if filename.ends_with(".wav") {
        "audio/wav"
    } else if filename.ends_with(".webm") {
        "audio/webm"
    } else {
        "audio/mpeg"
    };

    let file_part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(filename.to_string())
        .mime_str(mime)
        .map_err(|e| AppError::InternalError(format!("MIME error: {e}")))?;

    let form = reqwest::multipart::Form::new()
        .text("model_id", "scribe_v1")
        .part("file", file_part);

    let resp = client
        .post("https://api.elevenlabs.io/v1/speech-to-text")
        .header("xi-api-key", api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("ElevenLabs STT request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::InternalError(format!(
            "ElevenLabs STT error {status}: {body}"
        )));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("ElevenLabs STT parse error: {e}")))?;

    let text = data["text"]
        .as_str()
        .ok_or_else(|| AppError::InternalError("No text in ElevenLabs STT response".into()))?
        .trim()
        .to_string();

    Ok(text)
}

/// Routes transcription to the correct provider.
/// `provider`: "elevenlabs" or "openai" (default)
pub async fn transcribe_by_provider(
    provider: &str,
    api_key: &str,
    audio_bytes: Vec<u8>,
    filename: &str,
) -> Result<String, AppError> {
    match provider {
        "elevenlabs" => transcribe_elevenlabs(api_key, audio_bytes, filename).await,
        _ => transcribe_openai(api_key, audio_bytes, filename).await,
    }
}

