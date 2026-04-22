//! MCP (Model Context Protocol) integration.
//!
//! - `server` — CRUD for user-registered MCP servers (workspace-scoped).
//! - `client` — JSON-RPC ops (initialize / tools/list / tools/call).
//! - `transport` — HTTP streamable transport (SSE is a TODO).
//! - `cache` — 10-minute `tools/list` cache per server row.

pub mod cache;
pub mod client;
pub mod server;
pub mod transport;
