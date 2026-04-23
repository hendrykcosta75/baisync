use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

use crate::config::Config;
use crate::errors::AppError;

fn wrap_email_html(title: &str, content: &str, logo_url: &str) -> String {
    format!(
        r##"<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{title}</title>
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;background-color:#121212;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#121212;">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
      <!-- Logo -->
      <tr>
        <td align="center" style="padding:0 0 32px 0;">
          <img src="{logo_url}" alt="Baisync" width="56" height="56" style="border-radius:16px;display:block;" />
        </td>
      </tr>
      <!-- Card -->
      <tr>
        <td style="background-color:#1E1E1E;border-radius:16px;padding:36px 32px;box-shadow:4px 4px 12px rgba(0,0,0,0.5),-2px -2px 8px rgba(255,255,255,0.03);">
          {content}
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td align="center" style="padding:28px 0 0 0;">
          <span style="color:rgba(255,255,255,0.2);font-size:11px;font-family:monospace;letter-spacing:0.1em;">BAISYNC</span>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>"##
    )
}

fn styled_table_row(label: &str, value: &str) -> String {
    format!(
        r#"<tr>
  <td style="padding:8px 16px 8px 0;color:rgba(255,255,255,0.35);font-size:12px;font-family:monospace;letter-spacing:0.05em;text-transform:uppercase;white-space:nowrap;vertical-align:top;">{label}</td>
  <td style="padding:8px 0;color:#f0f0f0;font-size:13px;font-weight:500;">{value}</td>
</tr>"#
    )
}

fn styled_button(url: &str, label: &str) -> String {
    format!(
        r#"<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0 0;">
  <tr>
    <td style="border-radius:12px;background:#1E1E1E;box-shadow:4px 4px 10px rgba(0,0,0,0.5),-2px -2px 8px rgba(255,255,255,0.04);">
      <a href="{url}" target="_blank" style="display:inline-block;padding:13px 30px;color:#D4835A;font-size:14px;font-weight:500;text-decoration:none;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">{label}</a>
    </td>
  </tr>
</table>"#
    )
}

fn styled_data_table(rows: &str) -> String {
    format!(
        r#"<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1A1A1A;border:1px solid rgba(255,255,255,0.06);border-radius:10px;margin:16px 0;">
  <tr><td style="padding:14px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      {rows}
    </table>
  </td></tr>
</table>"#
    )
}

fn get_logo_url(config: &Config) -> String {
    format!("{}/Logo%20(7).png", config.app_url)
}

pub fn wrap_invite_email(
    config: &Config,
    workspace_name: &str,
    role: &str,
    invite_url: &str,
) -> String {
    let logo_url = get_logo_url(config);
    let content = format!(
        r#"<p style="margin:0 0 8px 0;color:#f0f0f0;font-size:18px;font-weight:700;">Convite para Workspace</p>
<p style="margin:0 0 20px 0;color:rgba(255,255,255,0.5);font-size:14px;line-height:1.6;">Você foi convidado para o workspace <strong style="color:#D4835A;">{workspace_name}</strong> com a função de <strong style="color:#D4835A;">{role}</strong>.</p>
{button}
<p style="margin:20px 0 0 0;color:rgba(255,255,255,0.2);font-size:11px;font-family:monospace;">Expira em 7 dias.</p>"#,
        button = styled_button(invite_url, "Aceitar Convite")
    );
    wrap_email_html("Convite para Workspace", &content, &logo_url)
}

pub async fn send_email(
    config: &Config,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<(), AppError> {
    let email = Message::builder()
        .from(
            config
                .smtp_user
                .parse()
                .map_err(|e| AppError::InternalError(format!("Invalid from address: {e}")))?,
        )
        .to(to
            .parse()
            .map_err(|e| AppError::InternalError(format!("Invalid to address: {e}")))?)
        .subject(subject)
        .header(ContentType::TEXT_HTML)
        .body(body.to_string())
        .map_err(|e| AppError::InternalError(format!("Failed to build email: {e}")))?;

    let creds = Credentials::new(config.smtp_user.clone(), config.smtp_pass.clone());

    let mailer = AsyncSmtpTransport::<Tokio1Executor>::relay(&config.smtp_host)
        .map_err(|e| AppError::InternalError(format!("Failed to create mailer: {e}")))?
        .port(config.smtp_port)
        .credentials(creds)
        .build();

    mailer
        .send(email)
        .await
        .map_err(|e| AppError::InternalError(format!("Failed to send email: {e}")))?;

    Ok(())
}

pub async fn send_2fa_code(config: &Config, to: &str, code: &str) -> Result<(), AppError> {
    let logo_url = get_logo_url(config);
    let subject = "Código de verificação - Baisync";
    let content = format!(
        r#"<p style="margin:0 0 8px 0;color:#f0f0f0;font-size:18px;font-weight:700;">Código de verificação</p>
<p style="margin:0 0 24px 0;color:rgba(255,255,255,0.5);font-size:14px;line-height:1.6;">Use o código abaixo para verificar sua identidade.</p>
<div style="background:#1A1A1A;border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:20px 0;text-align:center;margin:0 0 16px 0;">
  <span style="font-size:32px;font-weight:800;letter-spacing:8px;color:#D4835A;font-family:monospace;">{code}</span>
</div>
<p style="margin:0;color:rgba(255,255,255,0.2);font-size:11px;font-family:monospace;">Expira em 10 minutos.</p>"#
    );
    let body = wrap_email_html("Código de Verificação", &content, &logo_url);
    send_email(config, to, subject, &body).await
}

pub async fn send_reset_email(config: &Config, to: &str, token: &str) -> Result<(), AppError> {
    let logo_url = get_logo_url(config);
    let subject = "Redefinição de senha - Baisync";
    let reset_url = format!("{}/reset-password?token={token}", config.app_url);
    let content = format!(
        r#"<p style="margin:0 0 8px 0;color:#f0f0f0;font-size:18px;font-weight:700;">Redefinição de senha</p>
<p style="margin:0 0 24px 0;color:rgba(255,255,255,0.5);font-size:14px;line-height:1.6;">Recebemos uma solicitação para redefinir sua senha.</p>
<div style="background:#1A1A1A;border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:16px 0;text-align:center;margin:0 0 4px 0;">
  <span style="font-size:20px;font-weight:800;letter-spacing:4px;color:#D4835A;font-family:monospace;">{token}</span>
</div>
{button}
<p style="margin:20px 0 0 0;color:rgba(255,255,255,0.2);font-size:11px;font-family:monospace;">Expira em 1 hora. Se você não solicitou, ignore este email.</p>"#,
        button = styled_button(&reset_url, "Redefinir Senha")
    );
    let body = wrap_email_html("Redefinição de Senha", &content, &logo_url);
    send_email(config, to, subject, &body).await
}

pub async fn send_connection_lost_email(
    config: &Config,
    to: &str,
    assistant_name: &str,
    channel: &str,
    provider: &str,
) -> Result<(), AppError> {
    let logo_url = get_logo_url(config);
    let subject = format!("Conexão perdida - {assistant_name} | Baisync");
    let dashboard_url = format!("{}/dashboard/assistants", config.app_url);
    let rows = format!(
        "{}{}",
        styled_table_row("Canal", channel),
        styled_table_row("Provedor", provider),
    );
    let content = format!(
        r#"<p style="margin:0 0 8px 0;color:#f0f0f0;font-size:18px;font-weight:700;">Conexão perdida</p>
<p style="margin:0 0 4px 0;color:rgba(255,255,255,0.5);font-size:14px;line-height:1.6;">A integração do assistente <strong style="color:#D4835A;">{assistant_name}</strong> perdeu a conexão.</p>
{table}
{button}"#,
        table = styled_data_table(&rows),
        button = styled_button(&dashboard_url, "Reconectar"),
    );
    let body = wrap_email_html("Conexão Perdida", &content, &logo_url);
    send_email(config, to, &subject, &body).await
}

pub async fn send_appointment_email(
    config: &Config,
    to: &str,
    assistant_name: &str,
    action: &str,
    client_name: &str,
    client_email: &str,
    client_phone: &str,
    date_time: &str,
    duration_minutes: i32,
    appointment_type: &str,
    notes: &str,
    origin_channel: &str,
) -> Result<(), AppError> {
    let logo_url = get_logo_url(config);
    let action_label = match action {
        "created" => "Novo Agendamento",
        "cancelled" => "Agendamento Cancelado",
        "rescheduled" => "Agendamento Reagendado",
        _ => "Atualização de Agendamento",
    };
    let subject = format!("{action_label} - {assistant_name} | Baisync");
    let calendar_url = format!("{}/dashboard/calendar", config.app_url);

    let mut rows = String::new();
    rows.push_str(&styled_table_row("Cliente", client_name));
    if !client_email.is_empty() {
        rows.push_str(&styled_table_row("Email", client_email));
    }
    rows.push_str(&styled_table_row("Telefone", client_phone));
    rows.push_str(&styled_table_row("Data/Hora", date_time));
    rows.push_str(&styled_table_row(
        "Duração",
        &format!("{duration_minutes} min"),
    ));
    if !appointment_type.is_empty() {
        rows.push_str(&styled_table_row("Tipo", appointment_type));
    }
    if !origin_channel.is_empty() {
        rows.push_str(&styled_table_row("Canal", origin_channel));
    }
    if !notes.is_empty() {
        rows.push_str(&styled_table_row("Observações", notes));
    }

    let content = format!(
        r#"<p style="margin:0 0 8px 0;color:#f0f0f0;font-size:18px;font-weight:700;">{action_label}</p>
<p style="margin:0 0 4px 0;color:rgba(255,255,255,0.5);font-size:14px;line-height:1.6;">O assistente <strong style="color:#D4835A;">{assistant_name}</strong> registrou uma atualização.</p>
{table}
{button}"#,
        table = styled_data_table(&rows),
        button = styled_button(&calendar_url, "Ver Agenda"),
    );
    let body = wrap_email_html(action_label, &content, &logo_url);
    send_email(config, to, &subject, &body).await
}

pub async fn send_human_agent_email(
    config: &Config,
    to: &str,
    assistant_name: &str,
    contact_phone: &str,
    reason: &str,
) -> Result<(), AppError> {
    let logo_url = get_logo_url(config);
    let subject = format!("Agente Humano - {assistant_name} | Baisync");
    let dashboard_url = format!("{}/dashboard/assistants", config.app_url);
    let rows = format!(
        "{}{}",
        styled_table_row("Contato", contact_phone),
        styled_table_row("Motivo", reason),
    );
    let content = format!(
        r#"<p style="margin:0 0 8px 0;color:#f0f0f0;font-size:18px;font-weight:700;">Solicitação de Agente Humano</p>
<p style="margin:0 0 4px 0;color:rgba(255,255,255,0.5);font-size:14px;line-height:1.6;">O assistente <strong style="color:#D4835A;">{assistant_name}</strong> solicitou intervenção humana.</p>
{table}
{button}"#,
        table = styled_data_table(&rows),
        button = styled_button(&dashboard_url, "Atender Conversa"),
    );
    let body = wrap_email_html("Solicitação de Agente Humano", &content, &logo_url);
    send_email(config, to, &subject, &body).await
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub async fn send_mention_email(
    config: &Config,
    to: &str,
    mentioner_name: &str,
    channel_name: &str,
    channel_id: &uuid::Uuid,
    raw_content: &str,
    member_name_lookup: &std::collections::HashMap<String, String>,
) -> Result<(), AppError> {
    let logo_url = get_logo_url(config);
    let subject = format!(
        "{mentioner_name} mencionou você em #{channel_name} | Baisync"
    );
    let channel_url = format!("{}/dashboard/chat?channel={channel_id}", config.app_url);

    let rendered = crate::services::mentions::render_for_display(raw_content, member_name_lookup);
    let preview_source: String = rendered.chars().take(400).collect();
    let preview_html = html_escape(&preview_source).replace('\n', "<br>");

    let content = format!(
        r#"<p style="margin:0 0 8px 0;color:#f0f0f0;font-size:18px;font-weight:700;">Você foi mencionado em #{channel_name}</p>
<p style="margin:0 0 16px 0;color:rgba(255,255,255,0.5);font-size:14px;line-height:1.6;"><strong style="color:#D4835A;">{mentioner_name}</strong> te marcou numa mensagem.</p>
<div style="background:#1A1A1A;border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:14px 18px;color:#f0f0f0;font-size:14px;line-height:1.55;margin:0 0 4px 0;">{preview_html}</div>
{button}"#,
        button = styled_button(&channel_url, "Abrir canal"),
    );
    let body = wrap_email_html("Você foi mencionado", &content, &logo_url);
    send_email(config, to, &subject, &body).await
}

pub async fn send_pix_payment_confirmed_email(
    config: &Config,
    to: &str,
    assistant_name: &str,
    amount: f64,
    description: &str,
    customer_name: &str,
    customer_cpf: &str,
    contact_phone: &str,
) -> Result<(), AppError> {
    let logo_url = get_logo_url(config);
    let subject = format!("PIX R$ {:.2} - {assistant_name} | Baisync", amount);
    let dashboard_url = format!("{}/dashboard/financeiro", config.app_url);
    let rows = format!(
        "{}{}{}{}{}",
        styled_table_row("Valor", &format!("R$ {:.2}", amount)),
        styled_table_row("Descrição", description),
        styled_table_row("Cliente", customer_name),
        styled_table_row("CPF", customer_cpf),
        styled_table_row("Contato", contact_phone),
    );
    let content = format!(
        r#"<p style="margin:0 0 8px 0;color:#f0f0f0;font-size:18px;font-weight:700;">Pagamento PIX Confirmado</p>
<p style="margin:0 0 4px 0;color:rgba(255,255,255,0.5);font-size:14px;line-height:1.6;">O assistente <strong style="color:#D4835A;">{assistant_name}</strong> recebeu um pagamento.</p>
{table}
{button}"#,
        table = styled_data_table(&rows),
        button = styled_button(&dashboard_url, "Ver Financeiro"),
    );
    let body = wrap_email_html("Pagamento PIX Confirmado", &content, &logo_url);
    send_email(config, to, &subject, &body).await
}
