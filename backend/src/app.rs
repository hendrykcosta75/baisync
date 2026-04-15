use axum::extract::DefaultBodyLimit;
use axum::middleware as axum_mw;
use axum::routing::{delete, get, patch, post, put};
use axum::{Extension, Router};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::config::Config;
use crate::db::DbSession;
use crate::handlers;
use crate::middleware;
use crate::services::connection_state::ConnectionStateStore;
use crate::services::encryption::EncryptionService;
use crate::services::events::EventBus;

pub fn build_router(
    db: DbSession,
    config: Config,
    encryption: EncryptionService,
    event_bus: EventBus,
    conn_store: ConnectionStateStore,
) -> Router {
    let jwt_secret = config.jwt_secret.clone();

    // Public routes (no auth)
    let public_routes = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/api/auth/register", post(handlers::auth::register))
        .route("/api/auth/login", post(handlers::auth::login))
        .route(
            "/api/auth/forgot-password",
            post(handlers::auth::forgot_password),
        )
        .route(
            "/api/auth/reset-password",
            post(handlers::auth::reset_password),
        )
        .route(
            "/api/users/{user_id}/avatar",
            get(handlers::auth::get_avatar),
        )
        .route(
            "/api/webhooks/baileys/{phone}",
            post(handlers::messages::webhook_baileys),
        )
        .route(
            "/api/webhooks/meta",
            get(handlers::messages::webhook_meta_verify)
                .post(handlers::messages::webhook_meta),
        )
        .route(
            "/api/webhooks/telegram/{token}",
            post(handlers::messages::webhook_telegram),
        )
        .route(
            "/api/webhooks/mercadopago",
            post(handlers::pix::webhook_mercadopago),
        )
        .route("/api/admin/login", post(handlers::admin::admin_login))
        .route(
            "/api/pay/{charge_id}",
            get(handlers::card_payment::get_charge_info),
        )
        .route(
            "/api/pay/{charge_id}/process",
            post(handlers::card_payment::process_mp_card_payment),
        )
        .route(
            "/api/webhooks/stripe",
            post(handlers::card_payment::webhook_stripe),
        )
        .route(
            "/api/webhooks/mercadopago/card",
            post(handlers::card_payment::webhook_mercadopago_card),
        );

    // Protected routes (require auth)
    let protected_routes = Router::new()
        .route("/api/auth/me", get(handlers::auth::me))
        .route("/api/auth/enable-2fa", post(handlers::auth::enable_2fa))
        .route("/api/auth/verify-2fa", post(handlers::auth::verify_2fa))
        // Assistants
        .route(
            "/api/assistants",
            get(handlers::assistants::list).post(handlers::assistants::create),
        )
        .route(
            "/api/assistants/{id}",
            get(handlers::assistants::get)
                .put(handlers::assistants::update)
                .delete(handlers::assistants::delete),
        )
        // Tools
        .route(
            "/api/tools/test-url",
            post(handlers::tools::test_url),
        )
        .route(
            "/api/assistants/{id}/tools",
            get(handlers::tools::list).post(handlers::tools::create),
        )
        .route(
            "/api/assistants/{id}/tools/{tool_id}",
            put(handlers::tools::update).delete(handlers::tools::delete),
        )
        .route(
            "/api/assistants/{id}/tools/{tool_id}/calls",
            get(handlers::tools::list_calls),
        )
        // Files (Knowledge Base)
        .route(
            "/api/assistants/{id}/files",
            get(handlers::files::list)
                .post(handlers::files::upload)
                .layer(DefaultBodyLimit::max(11 * 1024 * 1024)),
        )
        .route(
            "/api/assistants/{id}/files/{file_id}",
            delete(handlers::files::delete),
        )
        // Integrations
        .route(
            "/api/assistants/{id}/integrations",
            get(handlers::integrations::list).post(handlers::integrations::create),
        )
        .route(
            "/api/assistants/{id}/integrations/{int_id}",
            put(handlers::integrations::update).delete(handlers::integrations::delete),
        )
        .route(
            "/api/assistants/{id}/integrations/{int_id}/connect",
            post(handlers::integrations::connect),
        )
        .route(
            "/api/assistants/{id}/integrations/{int_id}/status",
            get(handlers::integrations::status),
        )
        .route(
            "/api/assistants/{id}/integrations/{int_id}/disconnect",
            post(handlers::integrations::disconnect),
        )
        // Messaging config
        .route(
            "/api/config/messaging",
            get(handlers::integrations::messaging_config),
        )
        // Models
        .route(
            "/api/models/{provider}",
            get(handlers::models::list_models),
        )
        // User profile
        .route(
            "/api/user/profile",
            put(handlers::auth::update_profile),
        )
        .route(
            "/api/user/avatar",
            post(handlers::auth::upload_avatar)
                .delete(handlers::auth::delete_avatar),
        )
        .route(
            "/api/user/change-password",
            post(handlers::auth::change_password),
        )
        .route(
            "/api/user/account",
            delete(handlers::auth::delete_account),
        )
        // API Keys
        .route(
            "/api/user/api-keys",
            get(handlers::api_keys::get_keys).put(handlers::api_keys::update_keys),
        )
        .route(
            "/api/user/stripe/check-pix",
            get(handlers::api_keys::check_stripe_pix),
        )
        // ElevenLabs
        .route(
            "/api/elevenlabs/voices",
            get(handlers::elevenlabs::list_voices),
        )
        .route(
            "/api/elevenlabs/preview",
            post(handlers::elevenlabs::preview_voice),
        )
        // OpenAI Audio
        .route(
            "/api/openai/voices",
            get(handlers::openai_audio::list_voices),
        )
        .route(
            "/api/openai/preview",
            post(handlers::openai_audio::preview_voice),
        )
        // Usage & Activity stats
        .route("/api/user/usage", get(handlers::stats::user_usage))
        .route("/api/user/activity", get(handlers::stats::user_activity))
        .route(
            "/api/assistants/{id}/stats",
            get(handlers::stats::assistant_stats),
        )
        .route(
            "/api/assistants/{id}/logs",
            get(handlers::stats::assistant_logs),
        )
        // Sharing / access control
        .route(
            "/api/assistants/{id}/share-token",
            get(handlers::sharing::get_share_token)
                .post(handlers::sharing::create_share_token)
                .delete(handlers::sharing::revoke_share_token),
        )
        .route(
            "/api/shared/{token}",
            get(handlers::sharing::get_shared_assistant),
        )
        // Accepted shares
        .route(
            "/api/shares/accept",
            post(handlers::sharing::accept_share),
        )
        .route(
            "/api/shares/accepted",
            get(handlers::sharing::list_accepted_shares),
        )
        .route(
            "/api/shares/accepted/{assistant_id}",
            delete(handlers::sharing::remove_accepted_share),
        )
        // Access control tokens
        .route(
            "/api/assistants/{id}/token-users",
            get(handlers::access_tokens::token_users),
        )
        .route(
            "/api/assistants/{id}/access-tokens",
            get(handlers::access_tokens::list_tokens)
                .post(handlers::access_tokens::create_token),
        )
        .route(
            "/api/assistants/{id}/access-tokens/{token_id}",
            delete(handlers::access_tokens::delete_token),
        )
        .route(
            "/api/assistants/{id}/access-tokens/{token_id}/revoke",
            patch(handlers::access_tokens::revoke_token),
        )
        // SSE Events
        .route("/api/events", get(handlers::events::sse_stream))
        // Notifications
        .route(
            "/api/notifications",
            get(handlers::notifications::list).delete(handlers::notifications::delete_all),
        )
        .route(
            "/api/notifications/read-all",
            post(handlers::notifications::mark_all_read),
        )
        .route(
            "/api/notifications/{id}/read",
            post(handlers::notifications::mark_read),
        )
        .route(
            "/api/notifications/{id}",
            delete(handlers::notifications::delete),
        )
        // Appointments / Calendar
        .route(
            "/api/appointments",
            get(handlers::appointments::list).post(handlers::appointments::create),
        )
        .route(
            "/api/appointments/{id}",
            get(handlers::appointments::get)
                .put(handlers::appointments::update)
                .delete(handlers::appointments::delete),
        )
        .route(
            "/api/assistants/{id}/availability",
            get(handlers::appointments::get_availability)
                .put(handlers::appointments::upsert_availability),
        )
        .route(
            "/api/assistants/{id}/availability/slots",
            get(handlers::appointments::available_slots),
        )
        // Financeiro (PIX charges)
        .route(
            "/api/user/financeiro/overview",
            get(handlers::financeiro::overview),
        )
        .route(
            "/api/assistants/{id}/financeiro/summary",
            get(handlers::financeiro::summary),
        )
        .route(
            "/api/assistants/{id}/financeiro/charges",
            get(handlers::financeiro::charges),
        )
        .route(
            "/api/assistants/{id}/financeiro/charges/{charge_id}/status",
            put(handlers::financeiro::update_charge_status_handler),
        )
        // Baisync Agent
        .route("/api/baisync/chat", post(handlers::baisync::chat)
            .layer(DefaultBodyLimit::max(21 * 1024 * 1024)))
        .route("/api/baisync/rate-limit", get(handlers::baisync::rate_limit))
        // Test Agent
        .route(
            "/api/test-agent/chat",
            post(handlers::test_agent::chat),
        )
        .route(
            "/api/test-agent/generate-prompt",
            post(handlers::test_agent::generate_prompt),
        )
        .route(
            "/api/test-agent/evaluate",
            post(handlers::test_agent::evaluate),
        )
        // Workspaces
        .route(
            "/api/workspaces",
            get(handlers::workspaces::list).post(handlers::workspaces::create),
        )
        .route(
            "/api/workspaces/{id}",
            get(handlers::workspaces::get).put(handlers::workspaces::update).delete(handlers::workspaces::delete),
        )
        .route(
            "/api/workspaces/{id}/switch",
            post(handlers::workspaces::switch),
        )
        .route(
            "/api/workspaces/{id}/members",
            get(handlers::workspaces::list_members),
        )
        .route(
            "/api/workspaces/{id}/invite",
            post(handlers::workspaces::invite_member),
        )
        .route(
            "/api/workspaces/{id}/members/{user_id}",
            put(handlers::workspaces::update_member_role)
                .delete(handlers::workspaces::remove_member),
        )
        .route(
            "/api/workspaces/{id}/api-keys",
            get(handlers::workspaces::get_api_keys)
                .put(handlers::workspaces::update_api_keys),
        )
        .route(
            "/api/workspace-invites/{token}/accept",
            post(handlers::workspaces::accept_invite),
        )
        // Channels
        .route(
            "/api/workspaces/{id}/channels",
            get(handlers::channels::list_channels)
                .post(handlers::channels::create_channel),
        )
        .route(
            "/api/channels/{id}",
            get(handlers::channels::get_channel)
                .put(handlers::channels::update_channel)
                .delete(handlers::channels::delete_channel),
        )
        .route(
            "/api/channels/{id}/members",
            get(handlers::channels::list_channel_members)
                .post(handlers::channels::add_channel_member),
        )
        .route(
            "/api/channels/{id}/members/{user_id}",
            delete(handlers::channels::remove_channel_member),
        )
        .route(
            "/api/channels/{id}/messages",
            get(handlers::channels::list_messages)
                .post(handlers::channels::send_message),
        )
        .route(
            "/api/channels/{channel_id}/messages/{message_id}",
            put(handlers::channels::edit_message)
                .delete(handlers::channels::delete_message),
        )
        .route(
            "/api/channels/{id}/read",
            post(handlers::channels::mark_read),
        )
        // Channel Notes
        .route(
            "/api/channels/{id}/notes",
            get(handlers::channels::list_notes)
                .post(handlers::channels::create_note),
        )
        .route(
            "/api/channels/{channel_id}/notes/{note_id}",
            get(handlers::channels::get_note)
                .put(handlers::channels::update_note)
                .delete(handlers::channels::delete_note),
        )
        // Channel Canvases
        .route(
            "/api/channels/{id}/canvases",
            get(handlers::channels::list_canvases)
                .post(handlers::channels::create_canvas),
        )
        .route(
            "/api/channels/{channel_id}/canvases/{canvas_id}",
            get(handlers::channels::get_canvas)
                .put(handlers::channels::update_canvas)
                .delete(handlers::channels::delete_canvas),
        )
        .route(
            "/api/workspaces/{id}/dms",
            get(handlers::channels::list_dms)
                .post(handlers::channels::create_dm),
        )
        // Teams
        .route(
            "/api/workspaces/{id}/teams",
            get(handlers::teams::list).post(handlers::teams::create),
        )
        .route(
            "/api/teams/{id}",
            get(handlers::teams::get)
                .put(handlers::teams::update)
                .delete(handlers::teams::delete),
        )
        .route(
            "/api/teams/{id}/members",
            get(handlers::teams::list_members)
                .post(handlers::teams::add_member),
        )
        .route(
            "/api/teams/{id}/members/{user_id}",
            delete(handlers::teams::remove_member),
        )
        .route(
            "/api/teams/{id}/tasks",
            get(handlers::teams::list_tasks)
                .post(handlers::teams::create_task),
        )
        .route(
            "/api/teams/{id}/tasks/{task_id}",
            get(handlers::teams::get_task)
                .put(handlers::teams::update_task)
                .delete(handlers::teams::delete_task),
        )
        .route(
            "/api/teams/{id}/tasks/{task_id}/move",
            patch(handlers::teams::move_task),
        )
        .route(
            "/api/teams/{id}/tasks/{task_id}/attachments",
            get(handlers::teams::list_task_attachments)
                .post(handlers::teams::upload_task_attachment),
        )
        .route(
            "/api/teams/{id}/tasks/{task_id}/attachments/{attachment_id}",
            get(handlers::teams::download_task_attachment)
                .delete(handlers::teams::delete_task_attachment),
        )
        .route(
            "/api/tasks/{id}/comments",
            get(handlers::teams::list_comments)
                .post(handlers::teams::create_comment),
        )
        .route(
            "/api/teams/{id}/activity",
            get(handlers::teams::list_activity),
        )
        // OKRs
        .route(
            "/api/workspaces/{id}/okrs",
            get(handlers::okrs::list_objectives)
                .post(handlers::okrs::create_objective),
        )
        .route(
            "/api/okrs/{id}",
            get(handlers::okrs::get_objective)
                .put(handlers::okrs::update_objective)
                .delete(handlers::okrs::delete_objective),
        )
        .route(
            "/api/okrs/{id}/children",
            get(handlers::okrs::list_children),
        )
        .route(
            "/api/okrs/{id}/key-results",
            get(handlers::okrs::list_key_results)
                .post(handlers::okrs::create_key_result),
        )
        .route(
            "/api/okrs/{id}/key-results/{kr_id}",
            put(handlers::okrs::update_key_result)
                .delete(handlers::okrs::delete_key_result),
        )
        .route(
            "/api/key-results/{id}/check-ins",
            get(handlers::okrs::list_check_ins)
                .post(handlers::okrs::create_check_in),
        )
        // OKR Attachments
        .route(
            "/api/okr-attachments/upload/{entity_type}/{entity_id}",
            get(handlers::okrs::list_attachments)
                .post(handlers::okrs::upload_attachment),
        )
        .route(
            "/api/okr-attachments/file/{entity_id}/{attachment_id}",
            get(handlers::okrs::download_attachment)
                .delete(handlers::okrs::delete_attachment),
        )
        // Strategy Map
        .route(
            "/api/workspaces/{id}/strategy-map",
            get(handlers::strategy_map::get_map),
        )
        .route(
            "/api/workspaces/{id}/strategy-map/sync",
            post(handlers::strategy_map::sync_map),
        )
        .route(
            "/api/workspaces/{id}/strategy-map/nodes",
            post(handlers::strategy_map::create_node),
        )
        .route(
            "/api/workspaces/{id}/strategy-map/nodes/{node_id}",
            put(handlers::strategy_map::update_node)
                .delete(handlers::strategy_map::delete_node),
        )
        .route(
            "/api/workspaces/{id}/strategy-map/nodes/batch-positions",
            patch(handlers::strategy_map::batch_update_positions),
        )
        .route(
            "/api/workspaces/{id}/strategy-map/edges",
            post(handlers::strategy_map::create_edge),
        )
        .route(
            "/api/workspaces/{id}/strategy-map/edges/{edge_id}",
            delete(handlers::strategy_map::delete_edge),
        )
        // SWOT
        .route(
            "/api/workspaces/{id}/swot",
            get(handlers::swot::list_analyses)
                .post(handlers::swot::create_analysis),
        )
        .route(
            "/api/workspaces/{id}/swot/{analysis_id}",
            get(handlers::swot::get_analysis)
                .put(handlers::swot::update_analysis)
                .delete(handlers::swot::delete_analysis),
        )
        .route(
            "/api/swot/{id}/items",
            post(handlers::swot::create_item),
        )
        .route(
            "/api/swot/{id}/items/{item_id}",
            put(handlers::swot::update_item)
                .delete(handlers::swot::delete_item),
        )

        // Playground chat
        .route(
            "/api/assistants/{id}/chat",
            post(handlers::messages::playground_chat),
        )
        // Conversations & Messages
        .route(
            "/api/assistants/{id}/conversations",
            get(handlers::messages::list_conversations),
        )
        .route(
            "/api/assistants/{id}/conversations/{conv_id}",
            delete(handlers::messages::delete_conversation)
                .patch(handlers::messages::toggle_ai),
        )
        .route(
            "/api/assistants/{id}/conversations/{conv_id}/messages",
            get(handlers::messages::list_messages).post(handlers::messages::send_message),
        )
        .route(
            "/api/assistants/{id}/conversations/{conv_id}/summary",
            post(handlers::messages::summarize_conversation),
        )
        .layer(axum_mw::from_fn(middleware::auth::auth_middleware));

    // Admin protected routes
    let admin_routes = Router::new()
        .route("/api/admin/stats", get(handlers::admin::dashboard_stats))
        .route(
            "/api/admin/users",
            get(handlers::admin::list_users).post(handlers::admin::create_user),
        )
        .route(
            "/api/admin/users/{id}",
            get(handlers::admin::get_user).delete(handlers::admin::delete_user),
        )
        .route(
            "/api/admin/users/{id}/block",
            put(handlers::admin::block_user),
        )
        .route(
            "/api/admin/users/{id}/detail",
            get(handlers::admin::get_user_enriched),
        )
        .route(
            "/api/admin/integrations",
            get(handlers::admin::list_integrations),
        )
        .route(
            "/api/admin/usage",
            get(handlers::admin::platform_usage),
        )
        .layer(axum_mw::from_fn(middleware::admin::admin_middleware));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .merge(admin_routes)
        .layer(Extension(db))
        .layer(Extension(config))
        .layer(Extension(encryption))
        .layer(Extension(event_bus))
        .layer(Extension(conn_store))
        .layer(Extension(jwt_secret))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}
