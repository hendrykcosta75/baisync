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
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>{title}</title>
</head>
<body style="margin:0;padding:0;background-color:#080C19;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#080C19;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;border:1px solid #242E5A;">
      <!-- Header with gradient bar -->
      <tr>
        <td style="background:linear-gradient(135deg,#8B5CF6,#D946EF);padding:4px 0;"></td>
      </tr>
      <tr>
        <td style="background-color:#0E1329;padding:24px 32px 16px 32px;">
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding-right:12px;vertical-align:middle;">
                <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#8B5CF6,#D946EF);text-align:center;line-height:32px;">
                  <span style="color:#ffffff;font-size:16px;font-weight:bold;">&#9679;</span>
                </div>
              </td>
              <td style="vertical-align:middle;">
                <span style="color:#EDF0F7;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Inertial Eclipse</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <!-- Content card -->
      <tr>
        <td style="background-color:#0E1329;padding:0 32px 24px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#161C38;border:1px solid #242E5A;border-radius:10px;">
            <tr>
              <td style="padding:28px 28px;">
                {content}
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <!-- Footer -->
      <tr>
        <td style="background-color:#0E1329;padding:0 32px 24px 32px;text-align:center;">
          <p style="margin:0;color:#8892B0;font-size:12px;line-height:1.5;">
            Inertial Eclipse &mdash; Plataforma de Agentes de IA
          </p>
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
  <td style="padding:8px 16px 8px 0;color:#8892B0;font-size:14px;white-space:nowrap;vertical-align:top;">{label}</td>
  <td style="padding:8px 0;color:#EDF0F7;font-size:14px;font-weight:600;">{value}</td>
</tr>"#
    )
}

fn styled_button(url: &str, label: &str) -> String {
    format!(
        r#"<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 4px 0;">
  <tr>
    <td style="border-radius:8px;background:linear-gradient(135deg,#8B5CF6,#D946EF);">
      <a href="{url}" target="_blank" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">{label}</a>
    </td>
  </tr>
</table>"#
    )
}

fn styled_data_table(rows: &str) -> String {
    format!(
        r#"<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1A2142;border:1px solid #242E5A;border-radius:8px;margin:16px 0;">
  <tr><td style="padding:12px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      {rows}
    </table>
  </td></tr>
</table>"#
    )
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
    let subject = "Your verification code - Inertial Eclipse";
    let content = format!(
        r#"<h2 style="margin:0 0 8px 0;color:#EDF0F7;font-size:20px;font-weight:700;">Código de verificação</h2>
<p style="margin:0 0 20px 0;color:#C4CCDF;font-size:14px;line-height:1.6;">Use o código abaixo para verificar sua identidade:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center" style="padding:20px 0;">
      <div style="display:inline-block;background-color:#1A2142;border:1px solid #242E5A;border-radius:10px;padding:16px 40px;">
        <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#EDF0F7;">{code}</span>
      </div>
    </td>
  </tr>
</table>
<p style="margin:16px 0 0 0;color:#8892B0;font-size:13px;">Este código expira em 10 minutos.</p>"#
    );
    let body = wrap_email_html("Código de Verificação", &content);
    send_email(config, to, subject, &body).await
}

pub async fn send_reset_email(config: &Config, to: &str, token: &str) -> Result<(), AppError> {
    let subject = "Password Reset - Inertial Eclipse";
    let reset_url = format!("{}/reset-password?token={token}", config.app_url);
    let content = format!(
        r#"<h2 style="margin:0 0 8px 0;color:#EDF0F7;font-size:20px;font-weight:700;">Redefinição de senha</h2>
<p style="margin:0 0 20px 0;color:#C4CCDF;font-size:14px;line-height:1.6;">Recebemos uma solicitação para redefinir sua senha. Use o botão abaixo ou copie o token:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center" style="padding:16px 0;">
      <div style="display:inline-block;background-color:#1A2142;border:1px solid #242E5A;border-radius:10px;padding:12px 32px;">
        <span style="font-size:24px;font-weight:800;letter-spacing:4px;color:#EDF0F7;">{token}</span>
      </div>
    </td>
  </tr>
</table>
{button}
<p style="margin:16px 0 0 0;color:#8892B0;font-size:13px;">Este token expira em 1 hora. Se você não solicitou a redefinição, ignore este email.</p>"#,
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
    let subject = format!("Conexão perdida - {assistant_name} | Inertial Eclipse");
    let dashboard_url = format!("{}/dashboard/assistants", config.app_url);
    let rows = format!(
        "{}{}",
        styled_table_row("Canal", channel),
        styled_table_row("Provedor", provider),
    );
    let content = format!(
        r#"<h2 style="margin:0 0 8px 0;color:#EDF0F7;font-size:20px;font-weight:700;">Conexão perdida</h2>
<p style="margin:0 0 4px 0;color:#C4CCDF;font-size:14px;line-height:1.6;">A integração do seu assistente <strong style="color:#EDF0F7;">{assistant_name}</strong> perdeu a conexão.</p>
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
    let subject = format!("{action_label} - {assistant_name} | Inertial Eclipse");
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
        r#"<h2 style="margin:0 0 8px 0;color:#EDF0F7;font-size:20px;font-weight:700;">{action_label}</h2>
<p style="margin:0 0 4px 0;color:#C4CCDF;font-size:14px;line-height:1.6;">O assistente <strong style="color:#EDF0F7;">{assistant_name}</strong> registrou uma atualização de agendamento.</p>
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
    let subject = format!("Solicitação de Agente Humano - {assistant_name} | Inertial Eclipse");
    let dashboard_url = format!("{}/dashboard/assistants", config.app_url);
    let rows = format!(
        "{}{}",
        styled_table_row("Contato", contact_phone),
        styled_table_row("Motivo", reason),
    );
    let content = format!(
        r#"<h2 style="margin:0 0 8px 0;color:#EDF0F7;font-size:20px;font-weight:700;">Solicitação de Agente Humano</h2>
<p style="margin:0 0 4px 0;color:#C4CCDF;font-size:14px;line-height:1.6;">O assistente <strong style="color:#EDF0F7;">{assistant_name}</strong> solicitou a intervenção de um agente humano.</p>
{table}
{button}"#,
        table = styled_data_table(&rows),
        button = styled_button(&dashboard_url, "Atender Conversa"),
    );
    let body = wrap_email_html("Solicitação de Agente Humano", &content);
    send_email(config, to, &subject, &body).await
}
