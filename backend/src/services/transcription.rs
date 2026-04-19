use base64::Engine as _;

use crate::errors::AppError;

/// Default MIME mapping used by OpenAI/ElevenLabs/Grok STT endpoints
/// (they all accept the same container set).
fn mime_from_filename(filename: &str) -> &'static str {
    let lower = filename.to_lowercase();
    if lower.ends_with(".ogg") || lower.ends_with(".opus") {
        "audio/ogg"
    } else if lower.ends_with(".mp4") || lower.ends_with(".m4a") {
        "audio/mp4"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".webm") {
        "audio/webm"
    } else if lower.ends_with(".flac") {
        "audio/flac"
    } else {
        "audio/mpeg"
    }
}

/// Transcribes audio bytes using OpenAI Whisper API.
/// `audio_bytes`: raw audio data (ogg, mp3, mp4, wav, webm, etc.)
/// `filename`: hint for the MIME type (e.g. "audio.ogg", "audio.mp3")
pub async fn transcribe_openai(
    openai_key: &str,
    audio_bytes: Vec<u8>,
    filename: &str,
) -> Result<String, AppError> {
    let client = reqwest::Client::new();

    let mime = mime_from_filename(filename);

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

    let mime = mime_from_filename(filename);

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

/// Transcribes audio bytes using xAI Grok STT (`POST /v1/stt`, multipart).
pub async fn transcribe_grok(
    api_key: &str,
    audio_bytes: Vec<u8>,
    filename: &str,
) -> Result<String, AppError> {
    let client = reqwest::Client::new();

    let mime = mime_from_filename(filename);

    let file_part = reqwest::multipart::Part::bytes(audio_bytes)
        .file_name(filename.to_string())
        .mime_str(mime)
        .map_err(|e| AppError::InternalError(format!("MIME error: {e}")))?;

    let form = reqwest::multipart::Form::new().part("file", file_part);

    let resp = client
        .post("https://api.x.ai/v1/stt")
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Grok STT request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::InternalError(format!(
            "Grok STT error {status}: {body}"
        )));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Grok STT parse error: {e}")))?;

    let text = data["text"]
        .as_str()
        .ok_or_else(|| AppError::InternalError("No text in Grok STT response".into()))?
        .trim()
        .to_string();

    Ok(text)
}

/// Transcribes audio bytes using Gemini (generateContent with inline audio).
/// Gemini only accepts MP3/WAV/AIFF/AAC/FLAC — anything else (notably OGG/Opus
/// from WhatsApp voice notes and M4A/WEBM) is rejected with BadRequest so the
/// assistant can fall back to `transcription_failure_message`.
pub async fn transcribe_gemini(
    api_key: &str,
    audio_bytes: Vec<u8>,
    filename: &str,
) -> Result<String, AppError> {
    let lower = filename.to_lowercase();
    let mime = if lower.ends_with(".mp3") {
        "audio/mp3"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".aiff") {
        "audio/aiff"
    } else if lower.ends_with(".aac") {
        "audio/aac"
    } else if lower.ends_with(".flac") {
        "audio/flac"
    } else {
        return Err(AppError::BadRequest(
            "Gemini só aceita áudio MP3, WAV, AIFF, AAC ou FLAC. Use outro provedor para notas de voz em OGG/Opus (WhatsApp).".into(),
        ));
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&audio_bytes);

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    );

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "contents": [{
                "parts": [
                    {"inline_data": {"mime_type": mime, "data": b64}},
                    {"text": "Transcreva este áudio literalmente. Retorne apenas a transcrição, sem comentários."}
                ]
            }],
            "generationConfig": { "responseMimeType": "text/plain" }
        }))
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Gemini STT request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::InternalError(format!(
            "Gemini STT error {status}: {body}"
        )));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Gemini STT parse error: {e}")))?;

    let text = data["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or_else(|| AppError::InternalError("No text in Gemini STT response".into()))?
        .trim()
        .to_string();

    Ok(text)
}

/// Routes transcription to the correct provider.
/// `provider`: "elevenlabs", "openai", "grok", or "gemini".
pub async fn transcribe_by_provider(
    provider: &str,
    api_key: &str,
    audio_bytes: Vec<u8>,
    filename: &str,
) -> Result<String, AppError> {
    match provider {
        "elevenlabs" => transcribe_elevenlabs(api_key, audio_bytes, filename).await,
        "grok" => transcribe_grok(api_key, audio_bytes, filename).await,
        "gemini" => transcribe_gemini(api_key, audio_bytes, filename).await,
        _ => transcribe_openai(api_key, audio_bytes, filename).await,
    }
}
