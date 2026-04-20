use std::time::Duration;

use base64::{engine::general_purpose, Engine as _};

use crate::errors::AppError;

/// See `openai_audio::llm_global_timeout` for rationale — env var read direct
/// because these services aren't wired through `Config`.
fn llm_global_timeout() -> Duration {
    let secs = std::env::var("LLM_GLOBAL_TIMEOUT_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(60);
    Duration::from_secs(secs)
}

pub const GEMINI_TTS_MODEL: &str = "gemini-2.5-flash-preview-tts";
pub const GEMINI_TTS_SAMPLE_RATE: u32 = 24000;

pub const GEMINI_VOICES: &[(&str, &str)] = &[
    ("Zephyr", "Zephyr (Bright)"),
    ("Puck", "Puck (Upbeat)"),
    ("Charon", "Charon (Informative)"),
    ("Kore", "Kore (Firm)"),
    ("Fenrir", "Fenrir (Excitable)"),
    ("Leda", "Leda (Youthful)"),
    ("Orus", "Orus (Firm)"),
    ("Aoede", "Aoede (Breezy)"),
    ("Callirrhoe", "Callirrhoe (Easy-going)"),
    ("Autonoe", "Autonoe (Bright)"),
    ("Enceladus", "Enceladus (Breathy)"),
    ("Iapetus", "Iapetus (Clear)"),
    ("Umbriel", "Umbriel (Easy-going)"),
    ("Algieba", "Algieba (Smooth)"),
    ("Despina", "Despina (Smooth)"),
    ("Erinome", "Erinome (Clear)"),
    ("Algenib", "Algenib (Gravelly)"),
    ("Rasalgethi", "Rasalgethi (Informative)"),
    ("Laomedeia", "Laomedeia (Upbeat)"),
    ("Achernar", "Achernar (Soft)"),
    ("Alnilam", "Alnilam (Firm)"),
    ("Schedar", "Schedar (Even)"),
    ("Gacrux", "Gacrux (Mature)"),
    ("Pulcherrima", "Pulcherrima (Forward)"),
    ("Achird", "Achird (Friendly)"),
    ("Zubenelgenubi", "Zubenelgenubi (Casual)"),
    ("Vindemiatrix", "Vindemiatrix (Gentle)"),
    ("Sadachbia", "Sadachbia (Lively)"),
    ("Sadaltager", "Sadaltager (Knowledgeable)"),
    ("Sulafat", "Sulafat (Warm)"),
];

/// Gemini TTS — POST generateContent with responseModalities=["AUDIO"].
/// Returns a WAV container wrapping raw 16-bit mono 24 kHz PCM.
pub async fn text_to_speech(
    api_key: &str,
    voice_name: &str,
    text: &str,
) -> Result<Vec<u8>, AppError> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_TTS_MODEL}:generateContent?key={api_key}"
    );

    let client = reqwest::Client::new();
    let timeout = llm_global_timeout();
    let send_fut = client
        .post(&url)
        .json(&serde_json::json!({
            "contents": [{"parts": [{"text": text}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": { "voiceName": voice_name }
                    }
                }
            }
        }))
        .send();
    let resp = tokio::time::timeout(timeout, send_fut)
        .await
        .map_err(|_| {
            AppError::InternalError(format!(
                "A chamada ao provider gemini excedeu {}s. Tente resposta mais concisa ou reduza max_tokens.",
                timeout.as_secs()
            ))
        })?
        .map_err(|e| AppError::InternalError(format!("Gemini TTS request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::InternalError(format!(
            "Gemini TTS error {status}: {body}"
        )));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Gemini TTS parse failed: {e}")))?;

    let b64 = data["candidates"][0]["content"]["parts"][0]["inline_data"]["data"]
        .as_str()
        .or_else(|| data["candidates"][0]["content"]["parts"][0]["inlineData"]["data"].as_str())
        .ok_or_else(|| AppError::InternalError("Gemini TTS: no audio data in response".into()))?;

    let pcm = general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| AppError::InternalError(format!("Gemini TTS: base64 decode failed: {e}")))?;

    Ok(pcm16_mono_to_wav(&pcm, GEMINI_TTS_SAMPLE_RATE))
}

/// Wrap raw 16-bit mono PCM into a minimal 44-byte RIFF/WAVE header.
fn pcm16_mono_to_wav(pcm: &[u8], sample_rate: u32) -> Vec<u8> {
    let byte_rate: u32 = sample_rate * 2;
    let data_len: u32 = pcm.len() as u32;
    let riff_len: u32 = 36 + data_len;

    let mut out = Vec::with_capacity(44 + pcm.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_len.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend_from_slice(pcm);
    out
}
