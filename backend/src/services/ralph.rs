// Ralph Loop — autonomous multi-step task execution for Sophie.
//
// When a user message is classified as a complex multi-step request, Sophie
// breaks it into independent tasks and executes each one sequentially with a
// **fresh context window** (no conversation history). Between tasks, the
// accumulated result summaries are fed back as "progress notes" so each new
// task knows what was already accomplished — without carrying the full chat
// history that would bias the model.
//
// SSE events emitted by execute_ralph_loop:
//   ralph_plan         — task list delivered to the browser (starts the UI)
//   ralph_task_start   — a specific task is now executing
//   ralph_task_done    — task finished; full response text included
//   ralph_complete     — all tasks done; stream can be closed
//   done               — sentinel that closes the SSE reader loop

use std::convert::Infallible;

use axum::response::sse::Event;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::config::Config;
use crate::db::DbSession;
use crate::services::encryption::EncryptionService;
use crate::services::evaluator::cheap_eval_model_for;
use crate::services::llm::{self, LlmMessage, LlmTool, ToolContext};
use crate::services::session::{append_event, SessionEventType, SessionId};

// ─── Config ──────────────────────────────────────────────────────────────────

const RALPH_MAX_TASKS: usize = 6;
const CLASSIFIER_MAX_TOKENS: i32 = 600;
const TASK_MAX_TOKENS: i32 = 1_800;
const TASK_MAX_TOOL_ROUNDS: i32 = 3;

// ─── Data types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RalphTask {
    pub id: String,
    pub title: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RalphPlan {
    pub overall_goal: String,
    pub tasks: Vec<RalphTask>,
}

// ─── Classifier ──────────────────────────────────────────────────────────────

fn build_classifier_prompt(user_message: &str) -> String {
    format!(
        "Você é um classificador de complexidade de tarefas para a assistente Sophie.\n\
         \n\
         Analise a mensagem do usuário abaixo e determine se ela descreve uma tarefa \
         COMPLEXA com múltiplas etapas executáveis distintas que se beneficiaria de \
         execução sequencial e isolamento de contexto (Ralph Loop).\n\
         \n\
         Uma tarefa É complexa quando:\n\
         - Requer 2 ou mais passos executáveis independentes (ex.: criar um assistente, \
           depois configurar integração WhatsApp, depois habilitar base de conhecimento)\n\
         - Cada passo tem uma ordem natural e depende do anterior\n\
         \n\
         Uma tarefa NÃO é complexa quando:\n\
         - É uma pergunta ou consulta de informação\n\
         - É um único passo\n\
         - É conversa casual / greeting\n\
         - Tem menos de 80 caracteres (provavelmente simples)\n\
         \n\
         Retorne APENAS JSON válido sem markdown:\n\
         Se complexa:\n\
         {{\"is_complex\":true,\"overall_goal\":\"<objetivo geral conciso>\",\"tasks\":[\
         {{\"id\":\"1\",\"title\":\"<título curto>\",\"description\":\"<instrução clara para Sophie executar esta etapa>\"}}\
         ]}}\n\
         \n\
         Se simples:\n\
         {{\"is_complex\":false}}\n\
         \n\
         Máximo {max} tarefas. Mensagem do usuário:\n\
         {msg}",
        max = RALPH_MAX_TASKS,
        msg = user_message,
    )
}

fn parse_ralph_plan(raw: &str) -> Option<RalphPlan> {
    let cleaned = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let start = cleaned.find('{')?;
    let json_str = &cleaned[start..];

    #[derive(Deserialize)]
    struct ClassifierOutput {
        is_complex: bool,
        #[serde(default)]
        overall_goal: String,
        #[serde(default)]
        tasks: Vec<RalphTask>,
    }

    let out: ClassifierOutput = serde_json::from_str(json_str).ok()?;
    if !out.is_complex || out.tasks.len() < 2 {
        return None;
    }

    let mut tasks = out.tasks;
    tasks.truncate(RALPH_MAX_TASKS);

    Some(RalphPlan {
        overall_goal: out.overall_goal,
        tasks,
    })
}

/// Calls a cheap Gemini model to decide if the user message is complex enough
/// for Ralph Loop. Returns `None` when not complex or on any error.
pub async fn classify_and_plan(
    api_key: &str,
    user_id: Uuid,
    user_message: &str,
) -> Option<RalphPlan> {
    if api_key.is_empty() {
        return None;
    }

    let prompt = build_classifier_prompt(user_message);
    let messages = vec![LlmMessage {
        role: "user".into(),
        content: prompt,
        media_base64: None,
        media_mime_type: None,
    }];

    let ctx = ToolContext {
        db: None,
        assistant_id: Some(Uuid::nil()),
        user_id: Some(user_id),
        conversation_id: Some(Uuid::nil()),
        config: None,
        encryption: None,
        max_tool_rounds: None,
        max_duration_ms: None,
        call_kind: Some("ralph_classifier"),
    };

    let model = cheap_eval_model_for("gemini").to_string();

    match llm::call_llm_with_tools_ctx(
        "gemini",
        &model,
        api_key,
        messages,
        0.0,
        CLASSIFIER_MAX_TOKENS,
        &[],
        &ctx,
    )
    .await
    {
        Ok(r) => {
            let plan = parse_ralph_plan(&r.content);
            if plan.is_none() {
                tracing::debug!(
                    event = "ralph.classifier.not_complex",
                    raw = %r.content.chars().take(200).collect::<String>(),
                );
            }
            plan
        }
        Err(e) => {
            tracing::warn!(event = "ralph.classifier.error", error = %e);
            None
        }
    }
}

// ─── Task execution ──────────────────────────────────────────────────────────

fn build_task_system_prompt(
    base_system: &str,
    overall_goal: &str,
    task_num: usize,
    total: usize,
    task: &RalphTask,
    progress_notes: &str,
) -> String {
    let progress_section = if progress_notes.is_empty() {
        "Nenhuma etapa concluída ainda.".to_string()
    } else {
        progress_notes.to_string()
    };

    format!(
        "{base}\n\n\
         ## Ralph Loop — Execução de Tarefa\n\
         Você está executando uma etapa de um plano maior. \
         Execute APENAS a tarefa descrita abaixo. Seja direto e objetivo.\n\n\
         **Objetivo geral**: {goal}\n\
         **Etapa atual**: {num} de {total} — {title}\n\n\
         **Progresso das etapas anteriores**:\n\
         {progress}\n\n\
         **Sua tarefa agora**:\n\
         {desc}\n\n\
         Execute esta etapa. Se envolver criar/configurar/listar algo, \
         use as baisync-actions disponíveis.",
        base = base_system,
        goal = overall_goal,
        num = task_num,
        total = total,
        title = task.title,
        progress = progress_section,
        desc = task.description,
    )
}

fn sse(name: &str, data: serde_json::Value) -> Result<Event, Infallible> {
    Ok(Event::default().event(name).data(data.to_string()))
}

/// Executes the Ralph Loop inside the already-spawned SSE task. Sends SSE
/// events through `tx`; the caller is responsible for closing the stream once
/// this function returns (by sending the `done` sentinel).
pub async fn execute_ralph_loop(
    db: DbSession,
    config: Config,
    encryption: EncryptionService,
    user_id: Uuid,
    plan: RalphPlan,
    base_system_prompt: String,
    api_key: String,
    tx: mpsc::Sender<Result<Event, Infallible>>,
    session_id: Option<SessionId>,
) {
    let total = plan.tasks.len();

    // 1. Announce the plan
    let _ = tx
        .send(sse(
            "ralph_plan",
            json!({
                "overall_goal": plan.overall_goal,
                "tasks": plan.tasks.iter().map(|t| json!({
                    "id": t.id,
                    "title": t.title,
                })).collect::<Vec<_>>(),
            }),
        ))
        .await;

    let mut progress_notes = String::new();

    for (i, task) in plan.tasks.iter().enumerate() {
        let task_num = i + 1;

        // 2. Signal task start
        let _ = tx
            .send(sse(
                "ralph_task_start",
                json!({
                    "task_id": task.id,
                    "title": task.title,
                    "index": task_num,
                }),
            ))
            .await;

        // 3. Build fresh system prompt — no history
        let task_system = build_task_system_prompt(
            &base_system_prompt,
            &plan.overall_goal,
            task_num,
            total,
            task,
            &progress_notes,
        );

        let messages = vec![LlmMessage {
            role: "user".into(),
            content: format!("Execute: {}", task.description),
            media_base64: None,
            media_mime_type: None,
        }];

        let ctx = ToolContext {
            db: Some(&db),
            assistant_id: Some(Uuid::nil()),
            user_id: Some(user_id),
            conversation_id: Some(Uuid::nil()),
            config: Some(&config),
            encryption: Some(&encryption),
            max_tool_rounds: Some(TASK_MAX_TOOL_ROUNDS),
            max_duration_ms: None,
            call_kind: Some("ralph_task"),
        };

        // Use a capable model for task execution (same cheap model is fine;
        // the focused context compensates for model size)
        let model = cheap_eval_model_for("gemini").to_string();

        // Override system prompt via a synthetic first message so we don't
        // carry any prior conversation turns
        let all_messages = {
            let mut v = vec![LlmMessage {
                role: "user".into(),
                content: format!("[SYSTEM]\n{task_system}"),
                media_base64: None,
                media_mime_type: None,
            }];
            // Dummy model ack keeps Gemini's strict role alternation happy
            v.push(LlmMessage {
                role: "assistant".into(),
                content: "Entendido. Vou executar a tarefa agora.".into(),
                media_base64: None,
                media_mime_type: None,
            });
            v.extend(messages);
            v
        };

        let response_text = match llm::call_llm_with_tools_ctx(
            "gemini",
            &model,
            &api_key,
            all_messages,
            0.3,
            TASK_MAX_TOKENS,
            &[] as &[LlmTool],
            &ctx,
        )
        .await
        {
            Ok(r) => r.content,
            Err(e) => {
                tracing::warn!(event = "ralph.task.error", task_id = %task.id, error = %e);
                format!("Erro ao executar tarefa: {e}")
            }
        };

        // 4. Signal task done with full response
        let _ = tx
            .send(sse(
                "ralph_task_done",
                json!({
                    "task_id": task.id,
                    "index": task_num,
                    "response": response_text,
                }),
            ))
            .await;

        // 5. Accumulate progress for the next task
        let summary: String = response_text.chars().take(400).collect();
        progress_notes.push_str(&format!(
            "Etapa {task_num} — {title}: {summary}\n",
            task_num = task_num,
            title = task.title,
            summary = summary,
        ));

        // 6. Persist as llm_msg in session_events so hydration shows it
        if let Some(sid) = session_id {
            append_event(
                user_id,
                sid,
                SessionEventType::LlmMsg,
                json!({
                    "content": format!(
                        "**[{num}/{total}] {title}**\n\n{response}",
                        num = task_num,
                        total = total,
                        title = task.title,
                        response = response_text
                    )
                })
                .to_string(),
            );
        }
    }

    // 7. Completion event
    let _ = tx
        .send(sse(
            "ralph_complete",
            json!({ "total_tasks": total }),
        ))
        .await;

    // 8. SSE sentinel
    let _ = tx
        .send(Ok(Event::default().event("done").data("{}")))
        .await;
}
