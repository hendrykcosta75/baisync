use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

use crate::config::Config;
use crate::errors::AppError;

fn wrap_email_html(title: &str, content: &str) -> String {
    format!(
        r##"<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{title}</title>
<style>
  @media (prefers-color-scheme: dark) {{
    .email-body {{ background-color: #111 !important; }}
    .email-card {{ background-color: #1a1a1a !important; border-color: #2a2a2a !important; }}
    .email-heading {{ color: #f0f0f0 !important; }}
    .email-text {{ color: #c0c0c0 !important; }}
    .email-muted {{ color: #888 !important; }}
    .email-divider {{ background: #2a2a2a !important; }}
    .email-data-card {{ background-color: #252525 !important; border-color: #333 !important; }}
    .email-data-label {{ color: #888 !important; }}
    .email-data-value {{ color: #f0f0f0 !important; }}
  }}
</style>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-body" style="background-color:#f5f5f5;">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
      <!-- Logo -->
      <tr>
        <td style="padding:0 0 24px 0;">
          <span class="email-heading" style="color:#111;font-size:16px;font-weight:700;letter-spacing:-0.3px;">Baisync</span>
        </td>
      </tr>
      <!-- Card -->
      <tr>
        <td class="email-card" style="background-color:#ffffff;border:1px solid #e5e5e5;border-radius:12px;padding:32px;">
          {content}
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="padding:24px 0 0 0;text-align:center;">
          <span class="email-muted" style="color:#999;font-size:12px;">Baisync</span>
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
  <td class="email-muted" style="padding:6px 16px 6px 0;color:#888;font-size:13px;white-space:nowrap;vertical-align:top;">{label}</td>
  <td class="email-heading" style="padding:6px 0;color:#111;font-size:13px;font-weight:600;">{value}</td>
</tr>"#
    )
}

fn styled_button(url: &str, label: &str) -> String {
    format!(
        r#"<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0 0;">
  <tr>
    <td style="border-radius:8px;background:#ff6b2c;">
      <a href="{url}" target="_blank" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">{label}</a>
    </td>
  </tr>
</table>"#
    )
}

fn styled_data_table(rows: &str) -> String {
    format!(
        r#"<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-data-card" style="background-color:#f9f9f9;border:1px solid #e5e5e5;border-radius:8px;margin:16px 0;">
  <tr><td style="padding:12px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      {rows}
    </table>
  </td></tr>
</table>"#
    )
}

pub fn wrap_invite_email(workspace_name: &str, role: &str, invite_url: &str) -> String {
    let content = format!(
        r#"<p class="email-heading" style="margin:0 0 6px 0;color:#111;font-size:18px;font-weight:700;">Convite para Workspace</p>
<p class="email-text" style="margin:0 0 20px 0;color:#555;font-size:14px;line-height:1.6;">Você foi convidado para o workspace <strong class="email-heading" style="color:#111;">{workspace_name}</strong> com a função de <strong class="email-heading" style="color:#111;">{role}</strong>.</p>
{button}
<p class="email-muted" style="margin:16px 0 0 0;color:#999;font-size:12px;">Este convite expira em 7 dias.</p>"#,
        button = styled_button(invite_url, "Aceitar Convite")
    );
    wrap_email_html("Convite para Workspace", &content)
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
    let subject = "Código de verificação - Baisync";
    let content = format!(
        r#"<p class="email-heading" style="margin:0 0 6px 0;color:#111;font-size:18px;font-weight:700;">Código de verificação</p>
<p class="email-text" style="margin:0 0 20px 0;color:#555;font-size:14px;line-height:1.6;">Use o código abaixo para verificar sua identidade.</p>
<div class="email-data-card" style="background:#f9f9f9;border:1px solid #e5e5e5;border-radius:8px;padding:16px 0;text-align:center;margin:0 0 16px 0;">
  <span class="email-heading" style="font-size:32px;font-weight:800;letter-spacing:8px;color:#111;">{code}</span>
</div>
<p class="email-muted" style="margin:0;color:#999;font-size:12px;">Expira em 10 minutos.</p>"#
    );
    let body = wrap_email_html("Código de Verificação", &content);
    send_email(config, to, subject, &body).await
}

pub async fn send_reset_email(config: &Config, to: &str, token: &str) -> Result<(), AppError> {
    let subject = "Redefinição de senha - Baisync";
    let reset_url = format!("{}/reset-password?token={token}", config.app_url);
    let content = format!(
        r#"<p class="email-heading" style="margin:0 0 6px 0;color:#111;font-size:18px;font-weight:700;">Redefinição de senha</p>
<p class="email-text" style="margin:0 0 20px 0;color:#555;font-size:14px;line-height:1.6;">Recebemos uma solicitação para redefinir sua senha.</p>
<div class="email-data-card" style="background:#f9f9f9;border:1px solid #e5e5e5;border-radius:8px;padding:12px 0;text-align:center;margin:0 0 4px 0;">
  <span class="email-heading" style="font-size:20px;font-weight:800;letter-spacing:4px;color:#111;">{token}</span>
</div>
{button}
<p class="email-muted" style="margin:16px 0 0 0;color:#999;font-size:12px;">Expira em 1 hora. Se você não solicitou, ignore este email.</p>"#,
        button = styled_button(&reset_url, "Redefinir Senha")
    );
    let body = wrap_email_html("Redefinição de Senha", &content);
    send_email(config, to, subject, &body).await
}

pub async fn send_connection_lost_email(
    config: &Config,
    to: &str,
    assistant_name: &str,
    channel: &str,
    provider: &str,
) -> Result<(), AppError> {
    let subject = format!("Conexão perdida - {assistant_name} | Baisync");
    let dashboard_url = format!("{}/dashboard/assistants", config.app_url);
    let rows = format!(
        "{}{}",
        styled_table_row("Canal", channel),
        styled_table_row("Provedor", provider),
    );
    let content = format!(
        r#"<p class="email-heading" style="margin:0 0 6px 0;color:#111;font-size:18px;font-weight:700;">Conexão perdida</p>
<p class="email-text" style="margin:0 0 4px 0;color:#555;font-size:14px;line-height:1.6;">A integração do assistente <strong class="email-heading" style="color:#111;">{assistant_name}</strong> perdeu a conexão.</p>
{table}
{button}"#,
        table = styled_data_table(&rows),
        button = styled_button(&dashboard_url, "Reconectar"),
    );
    let body = wrap_email_html("Conexão Perdida", &content);
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
    rows.push_str(&styled_table_row("Duração", &format!("{duration_minutes} min")));
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
        r#"<p class="email-heading" style="margin:0 0 6px 0;color:#111;font-size:18px;font-weight:700;">{action_label}</p>
<p class="email-text" style="margin:0 0 4px 0;color:#555;font-size:14px;line-height:1.6;">O assistente <strong class="email-heading" style="color:#111;">{assistant_name}</strong> registrou uma atualização.</p>
{table}
{button}"#,
        table = styled_data_table(&rows),
        button = styled_button(&calendar_url, "Ver Agenda"),
    );
    let body = wrap_email_html(action_label, &content);
    send_email(config, to, &subject, &body).await
}

pub async fn send_human_agent_email(
    config: &Config,
    to: &str,
    assistant_name: &str,
    contact_phone: &str,
    reason: &str,
) -> Result<(), AppError> {
    let subject = format!("Agente Humano - {assistant_name} | Baisync");
    let dashboard_url = format!("{}/dashboard/assistants", config.app_url);
    let rows = format!(
        "{}{}",
        styled_table_row("Contato", contact_phone),
        styled_table_row("Motivo", reason),
    );
    let content = format!(
        r#"<p class="email-heading" style="margin:0 0 6px 0;color:#111;font-size:18px;font-weight:700;">Solicitação de Agente Humano</p>
<p class="email-text" style="margin:0 0 4px 0;color:#555;font-size:14px;line-height:1.6;">O assistente <strong class="email-heading" style="color:#111;">{assistant_name}</strong> solicitou intervenção humana.</p>
{table}
{button}"#,
        table = styled_data_table(&rows),
        button = styled_button(&dashboard_url, "Atender Conversa"),
    );
    let body = wrap_email_html("Solicitação de Agente Humano", &content);
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
        r#"<p class="email-heading" style="margin:0 0 6px 0;color:#111;font-size:18px;font-weight:700;">Pagamento PIX Confirmado</p>
<p class="email-text" style="margin:0 0 4px 0;color:#555;font-size:14px;line-height:1.6;">O assistente <strong class="email-heading" style="color:#111;">{assistant_name}</strong> recebeu um pagamento.</p>
{table}
{button}"#,
        table = styled_data_table(&rows),
        button = styled_button(&dashboard_url, "Ver Financeiro"),
    );
    let body = wrap_email_html("Pagamento PIX Confirmado", &content);
    send_email(config, to, &subject, &body).await
}
