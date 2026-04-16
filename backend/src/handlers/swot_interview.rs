use axum::body::Body;
use axum::extract::{Extension, Multipart, Path};
use axum::http::header;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::Response;
use axum::Json;
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::errors::AppError;
use crate::middleware::auth::AuthUser;
use crate::services::workspace as ws_service;

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct InterviewChatRequest {
    pub message: String,
    #[serde(default)]
    pub history: Vec<InterviewMessage>,
    #[allow(dead_code)]
    pub analysis_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct InterviewMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct TtsRequest {
    pub text: String,
}

// ─── System Prompt ──────────────────────────────────────────────────────────

fn build_system_prompt(workspace_name: &str) -> String {
    let hour = chrono::Utc::now()
        .with_timezone(&chrono::FixedOffset::west_opt(3 * 3600).unwrap())
        .hour();
    let greeting = match hour {
        6..=11 => "Bom dia",
        12..=17 => "Boa tarde",
        _ => "Boa noite",
    };

    format!(
        r#"Você é um entrevistador de IA especializado em criar análises SWOT para negócios. Seu nome é Axel. Você conduz entrevistas estratégicas para mapear forças, fraquezas, oportunidades e ameaças de empresas.

## Saudação
Use "{greeting}" como saudação inicial.

## Workspace
O workspace atual se chama "{workspace_name}".

## Fluxo da Entrevista

### Fase 1 - Abertura
Na sua PRIMEIRA mensagem:
1. Cumprimente com "{greeting}! Sou o Axel, seu assistente de inteligência artificial."
2. Diga "Vamos iniciar agora uma entrevista para analisar estrategicamente a sua empresa. Me confirma quando estiver pronto para começar!"
3. PARE e aguarde confirmação.

### Fase 2 - Entendimento do Negócio
Após confirmação, use <swot-questions> para perguntas estruturadas. Faça UMA pergunta por vez.

Perguntas iniciais:
1. Qual o nome e setor da empresa?
   Opções: Tecnologia, Saúde, Alimentação, Varejo/E-commerce, Serviços/Consultoria, Educação, Imobiliário, Indústria, Outro

2. Quais os principais produtos ou serviços oferecidos?

3. Qual o porte da empresa?
   Opções: MEI/Autônomo, Microempresa (até 10 func.), Pequena empresa (10-50), Média empresa (50-250), Grande empresa (250+)

4. Quem é o público-alvo principal?

### Fase 3 - Análise SWOT Aprofundada
Faça perguntas exploratórias para cada quadrante:

**Forças (Strengths):**
- Quais diferenciais competitivos da empresa?
- Que recursos ou capacidades únicas a empresa tem?
- O que os clientes mais elogiam?

**Fraquezas (Weaknesses):**
- Quais áreas precisam de melhoria?
- Que limitações internas existem?
- Onde a empresa perde para concorrentes?

**Oportunidades (Opportunities):**
- Que tendências de mercado podem ser aproveitadas?
- Existem nichos ou segmentos inexplorados?
- Que parcerias ou tecnologias podem gerar crescimento?

**Ameaças (Threats):**
- Quais concorrentes preocupam mais?
- Que mudanças regulatórias ou econômicas podem impactar?
- Quais riscos externos mais relevantes?

### Fase 4 - Perguntas Complementares
Faça 2-3 perguntas adicionais baseadas nas respostas para aprofundar a análise.

### Fase 5 - Geração do SWOT
Quando tiver informações suficientes (mínimo ~8 trocas de mensagens), gere o SWOT:
1. Informe que vai criar a análise
2. Emita a tag <swot-create> com os itens

## Formato de Question Box
Para perguntas com opções, use:
<swot-questions>{{"question": "Sua pergunta aqui", "options": ["Opção 1", "Opção 2", "Opção 3"]}}</swot-questions>

Use question_box para TODAS as perguntas que tenham opções previsíveis. Para perguntas abertas, use texto normal.

## Formato de Criação SWOT
Quando pronto para criar o SWOT:
<swot-create>{{"title": "SWOT - [Nome da Empresa]", "items": [{{"quadrant": "strengths", "content": "Descrição do item"}}, {{"quadrant": "weaknesses", "content": "..."}}  , {{"quadrant": "opportunities", "content": "..."}}, {{"quadrant": "threats", "content": "..."}}]}}</swot-create>

Gere pelo menos 3 itens por quadrante (12+ no total).

## Regras
- Responda SEMPRE em português brasileiro com acentuação correta
- Faça UMA pergunta por vez, nunca liste todas
- Seja consultivo: explique brevemente por que cada informação importa
- Use linguagem profissional mas acessível
- Quando usar <swot-questions>, a resposta do usuário será a opção selecionada
- Mantenha respostas curtas e diretas (máximo 3 parágrafos)
- NÃO use emojis
- Ao gerar o SWOT, seja específico e baseado nas respostas coletadas
- Cada item do SWOT deve ser uma frase completa e acionável"#,
        greeting = greeting,
        workspace_name = workspace_name,
    )
}

use chrono::Timelike;

// ─── Interview Chat (SSE) ───────────────────────────────────────────────────

pub async fn interview_chat(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
    Json(req): Json<InterviewChatRequest>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    let api_key = config.baisync_api_key.clone();
    if api_key.is_empty() {
        return Err(AppError::InternalError(
            "BAISYNC_API_KEY not configured".into(),
        ));
    }

    let workspace = ws_service::get_workspace(&db, &workspace_id).await.ok();
    let ws_name = workspace
        .as_ref()
        .map(|w| w.name.as_str())
        .unwrap_or("Minha Empresa");

    let system_prompt = build_system_prompt(ws_name);

    // Build Gemini contents
    let mut contents: Vec<serde_json::Value> = Vec::new();

    for msg in &req.history {
        let role = if msg.role == "assistant" { "model" } else { "user" };
        contents.push(serde_json::json!({
            "role": role,
            "parts": [{"text": msg.content}],
        }));
    }

    contents.push(serde_json::json!({
        "role": "user",
        "parts": [{"text": req.message}],
    }));

    // Coalesce consecutive same-role messages (Gemini requirement)
    contents = coalesce_contents(contents);

    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(128);

    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let body = serde_json::json!({
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": contents,
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": 2048,
            },
        });

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse&key={}",
            api_key
        );

        let resp = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await;

        match resp {
            Ok(response) => {
                if !response.status().is_success() {
                    let error_text = response.text().await.unwrap_or_default();
                    tracing::error!("Gemini API error for SWOT interview: {}", error_text);
                    let _ = tx
                        .send(Ok(Event::default().event("error").data(
                            serde_json::json!({"error": "Nao foi possivel processar. Tente novamente."}).to_string(),
                        )))
                        .await;
                    let _ = tx.send(Ok(Event::default().event("done").data("{}"))).await;
                    return;
                }

                let mut stream = response.bytes_stream();
                let mut buffer = String::new();
                let mut full_content = String::new();

                use futures::StreamExt;
                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(bytes) => {
                            buffer.push_str(&String::from_utf8_lossy(&bytes));

                            while let Some(pos) = buffer.find('\n') {
                                let line = buffer[..pos].trim().to_string();
                                buffer = buffer[pos + 1..].to_string();

                                if line.is_empty() {
                                    continue;
                                }

                                if let Some(data) = line.strip_prefix("data: ") {
                                    if let Ok(parsed) =
                                        serde_json::from_str::<serde_json::Value>(data)
                                    {
                                        // Gemini streaming: extract text from candidates
                                        if let Some(text) = parsed["candidates"][0]["content"]["parts"][0]["text"].as_str() {
                                            full_content.push_str(text);
                                            let _ = tx
                                                .send(Ok(Event::default().event("token").data(
                                                    serde_json::json!({"text": text})
                                                        .to_string(),
                                                )))
                                                .await;
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            tracing::error!("SWOT interview stream error: {}", e);
                            break;
                        }
                    }
                }

                // Parse special tags from full content and send as structured events
                if full_content.contains("<swot-questions>") {
                    if let Some(start) = full_content.find("<swot-questions>") {
                        if let Some(end) = full_content.find("</swot-questions>") {
                            let json_str =
                                &full_content[start + "<swot-questions>".len()..end];
                            if let Ok(parsed) =
                                serde_json::from_str::<serde_json::Value>(json_str)
                            {
                                let _ = tx
                                    .send(Ok(Event::default()
                                        .event("questions")
                                        .data(parsed.to_string())))
                                    .await;
                            }
                        }
                    }
                }

                if full_content.contains("<swot-create>") {
                    if let Some(start) = full_content.find("<swot-create>") {
                        if let Some(end) = full_content.find("</swot-create>") {
                            let json_str =
                                &full_content[start + "<swot-create>".len()..end];
                            if let Ok(parsed) =
                                serde_json::from_str::<serde_json::Value>(json_str)
                            {
                                let _ = tx
                                    .send(Ok(Event::default()
                                        .event("swot_create")
                                        .data(parsed.to_string())))
                                    .await;
                            }
                        }
                    }
                }

                let _ = tx
                    .send(Ok(Event::default().event("done").data(
                        serde_json::json!({"content_length": full_content.len()}).to_string(),
                    )))
                    .await;
            }
            Err(e) => {
                tracing::error!("SWOT interview request failed: {}", e);
                let _ = tx
                    .send(Ok(Event::default().event("error").data(
                        serde_json::json!({"error": "Erro de conexao. Tente novamente."})
                            .to_string(),
                    )))
                    .await;
                let _ = tx.send(Ok(Event::default().event("done").data("{}"))).await;
            }
        }
    });

    let stream = ReceiverStream::new(rx);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

// ─── TTS Streaming (ElevenLabs with OpenAI fallback) ────────────────────────

pub async fn interview_tts(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
    Json(req): Json<TtsRequest>,
) -> Result<Response, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    let text = req.text.trim();
    if text.is_empty() {
        return Err(AppError::BadRequest("Text is required".into()));
    }

    // Strip XML tags from text before TTS
    let clean_text = strip_xml_tags(text);
    if clean_text.is_empty() {
        return Err(AppError::BadRequest("No speakable text".into()));
    }

    // Try ElevenLabs first
    if !config.elevenlabs_api_key.is_empty() {
        let client = reqwest::Client::new();
        let url = format!(
            "https://api.elevenlabs.io/v1/text-to-speech/{}/stream?output_format=mp3_44100_128&optimize_streaming_latency=3",
            config.elevenlabs_voice_id
        );

        let resp = client
            .post(&url)
            .header("xi-api-key", &config.elevenlabs_api_key)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "text": clean_text,
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {
                    "stability": 0.5,
                    "similarity_boost": 0.75,
                    "style": 0.0,
                    "use_speaker_boost": true
                }
            }))
            .send()
            .await;

        if let Ok(response) = resp {
            if response.status().is_success() {
                let stream = response.bytes_stream();
                let body = Body::from_stream(stream);

                return Ok(Response::builder()
                    .header(header::CONTENT_TYPE, "audio/mpeg")
                    .header(header::TRANSFER_ENCODING, "chunked")
                    .header(header::CACHE_CONTROL, "no-cache")
                    .body(body)
                    .unwrap());
            } else {
                let status = response.status();
                let err = response.text().await.unwrap_or_default();
                tracing::warn!("ElevenLabs TTS failed ({status}): {err}, falling back to OpenAI");
            }
        } else {
            tracing::warn!("ElevenLabs TTS request failed, falling back to OpenAI");
        }
    }

    // No fallback — ElevenLabs is required for TTS
    Err(AppError::InternalError(
        "TTS nao disponivel. Configure a chave da ElevenLabs.".into(),
    ))
}

// ─── STT (Speech to Text via Gemini) ────────────────────────────────────────

pub async fn interview_stt(
    Extension(db): Extension<DbSession>,
    Extension(config): Extension<Config>,
    Extension(auth_user): Extension<AuthUser>,
    Path(workspace_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    let _ = ws_service::get_member_role(&db, &workspace_id, &auth_user.user_id).await?;

    let api_key = &config.baisync_api_key;
    if api_key.is_empty() {
        return Err(AppError::InternalError("API key not configured".into()));
    }

    let mut audio_bytes: Option<Vec<u8>> = None;
    let mut mime = "audio/webm".to_string();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name == "audio" {
            if let Some(ct) = field.content_type() {
                mime = ct.to_string();
            }
            if let Ok(data) = field.bytes().await {
                audio_bytes = Some(data.to_vec());
            }
        }
    }

    let audio_data =
        audio_bytes.ok_or_else(|| AppError::BadRequest("No audio file provided".into()))?;

    if audio_data.is_empty() {
        return Err(AppError::BadRequest("Audio file is empty".into()));
    }

    tracing::info!("SWOT STT: received {} bytes, mime={}", audio_data.len(), mime);

    // Encode audio as base64 and send to Gemini for transcription
    use base64::Engine;
    let audio_b64 = base64::engine::general_purpose::STANDARD.encode(&audio_data);

    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "contents": [{
            "role": "user",
            "parts": [
                {"text": "Transcreva o audio a seguir em portugues brasileiro. Retorne APENAS o texto transcrito, sem explicacoes, aspas ou formatacao."},
                {"inline_data": {"mime_type": mime, "data": audio_b64}}
            ]
        }],
        "generationConfig": {
            "temperature": 0.0,
            "maxOutputTokens": 1024,
        }
    });

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key={}",
        api_key
    );

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::InternalError(format!("Gemini STT request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err = resp.text().await.unwrap_or_default();
        return Err(AppError::InternalError(format!(
            "Gemini STT error {status}: {err}"
        )));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to parse Gemini STT response: {e}")))?;

    let text = data["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_string();

    Ok(Json(serde_json::json!({ "text": text })))
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Merge consecutive same-role Gemini contents into one entry.
fn coalesce_contents(contents: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    if contents.is_empty() {
        return contents;
    }

    let mut coalesced: Vec<serde_json::Value> = Vec::new();
    for msg in contents {
        let role = msg["role"].as_str().unwrap_or("user");
        if let Some(last) = coalesced.last_mut() {
            if last["role"].as_str().unwrap_or("") == role {
                if let (Some(existing), Some(new)) = (
                    last.get_mut("parts").and_then(|p| p.as_array_mut()),
                    msg["parts"].as_array(),
                ) {
                    existing.extend(new.iter().cloned());
                }
                continue;
            }
        }
        coalesced.push(msg);
    }

    coalesced
}

fn strip_xml_tags(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut inside_tag = false;

    for ch in input.chars() {
        match ch {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => result.push(ch),
            _ => {}
        }
    }

    result.trim().to_string()
}
