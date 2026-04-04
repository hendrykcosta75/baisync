---
name: backend-rust
description: TRIGGER when writing or modifying any Rust backend code — handlers, services, models, queries, integrations, webhooks. Enforces data isolation, Cassandra safety, security, and multi-tenancy patterns.

---

## Architecture Overview

- **Framework**: Axum + Tower middleware
- **Database**: ScyllaDB/Cassandra via `scylla` crate (`LegacySession`)
- **Auth**: JWT middleware extracts `AuthUser { user_id }` for all protected routes
- **Multi-tenancy**: All data is partitioned by `user_id` and/or `assistant_id`
- **Error handling**: `Result<Json<T>, AppError>` — uses `thiserror` derive

## Critical Rules

### 1. Multi-tenancy & Data Isolation

**Every query MUST scope by tenant.** This is the #1 source of bugs in this codebase.

```rust
// WRONG — returns data from ANY user
"SELECT * FROM table WHERE phone = ?"

// RIGHT — scoped to tenant
"SELECT * FROM table WHERE user_id = ? AND assistant_id = ? AND phone = ?"
```

**When scoping is impossible** (e.g., webhook lookups by phone/token where we don't know the user yet):
- Return ALL matches, not just the first
- Validate each result's parent entity still exists
- Filter by active status (`status != 'disconnected'`)
- Auto-clean orphans found during lookup

```rust
// WRONG — arbitrary first result
let row = result.maybe_first_row_typed::<Row>()?;

// RIGHT — validate all matches
let mut all: Vec<Entity> = Vec::new();
for row in result.rows_typed::<Row>()? { all.push(parse(row?)); }
// Then filter: skip disconnected, verify parent exists, clean orphans
```

### 2. Cassandra Column Nullability

**All non-primary-key columns in Cassandra can be NULL.** Always use `Option<T>` for non-PK fields in row tuples and model structs.

```rust
// WRONG — will panic on NULL
type Row = (Uuid, String, i64, DateTime<Utc>);

// RIGHT — only PK fields (Uuid) are non-optional
type Row = (Uuid, Option<String>, Option<i64>, Option<DateTime<Utc>>);
```

Always provide defaults when unwrapping:
```rust
fn row_to_model(r: Row) -> Model {
    Model {
        id: r.0,                              // PK — safe
        name: r.1.unwrap_or_default(),        // text → ""
        count: r.2.unwrap_or(0),              // int → 0
        created_at: r.3.unwrap_or(Utc::now()),// timestamp → now
        summary: r.4,                         // keep as Option if field is Option
    }
}
```

### 3. Cascade Deletes

Cassandra has no foreign keys. **When deleting a parent entity, explicitly delete ALL child data.**

```rust
pub async fn delete_parent(db: &DbSession, user_id: &Uuid, parent_id: &Uuid) -> Result<(), AppError> {
    // 1. Verify ownership
    get_parent(db, user_id, parent_id).await?;
    
    // 2. Delete children FIRST (order matters for nested children)
    // Delete grandchildren before children
    let children = list_children(db, parent_id).await?;
    for child in &children {
        delete_grandchildren(db, &child.id).await?;
    }
    delete_all_children(db, parent_id).await?;
    
    // 3. Delete parent LAST
    db.query_unpaged("DELETE FROM table WHERE pk = ?", (parent_id,)).await?;
    Ok(())
}
```

**Tables to cascade when deleting an assistant:**
- `assistant_integrations` (PK: assistant_id, user_id)
- `assistant_tools` (PK: assistant_id)
- `assistant_files` (PK: assistant_id, user_id)
- `conversations` + `messages` for each conversation
- `usage_stats` (PK: user_id, assistant_id)
- `access_tokens` (PK: user_id, assistant_id)
- `availability_config` (PK: assistant_id)
- `accepted_shares_by_assistant` (PK: assistant_id)

### 4. Orphan Detection & Cleanup

Any lookup that resolves a child entity (integration, tool, etc.) without knowing the parent should verify the parent exists:

```rust
let integration = find_by_external_key(db, key).await?;
// ALWAYS verify parent
match get_assistant(db, &integration.user_id, &integration.assistant_id).await {
    Ok(assistant) => { /* proceed */ }
    Err(_) => {
        tracing::warn!("Orphan detected, cleaning up");
        delete_orphan(db, &integration).await;
        return Err(AppError::NotFound("Parent no longer exists".into()));
    }
}
```

### 5. ALLOW FILTERING Queries

`ALLOW FILTERING` is expensive and scans data. Acceptable uses:
- When querying by a **secondary index** column (e.g., `config_phone_number`, `config_token`)
- When the result set is small and bounded

**Never** use `ALLOW FILTERING` on large tables without a secondary index on the filtered column.

When using `ALLOW FILTERING` for external lookups:
- The query can return rows from ANY partition — always validate ownership after
- Prefer indexed columns; check `backend/migrations/` for existing indexes

## Webhook & Integration Security

### 6. Webhook Authentication

**Every webhook endpoint MUST validate the sender's identity:**

| Provider | Validation Method |
|----------|-------------------|
| Baileys | Compare `webhookVerifyToken` from payload against `integration.config_webhook_verify_token` |
| Meta Official (GET) | Validate `hub.verify_token` matches integration's token |
| Meta Official (POST) | Validate `X-Hub-Signature-256` header with HMAC-SHA256 of body |
| Telegram | Validate bot token in URL path matches integration's `config_token` |

```rust
// Validate BEFORE processing any message
if let Some(ref expected) = integration.config_webhook_verify_token {
    if !expected.is_empty() && received_token != expected {
        tracing::warn!("Webhook token mismatch for {phone}");
        return Err(AppError::Unauthorized("Invalid webhook token".into()));
    }
}
```

### 7. Unique Constraint Enforcement

Cassandra has no UNIQUE constraints. **Enforce uniqueness in application code before INSERT:**

```rust
// Before creating integration with a phone number
if let Some(ref phone) = req.config_phone_number {
    if !phone.is_empty() {
        if let Ok(existing) = find_integration_by_phone(db, phone).await {
            if existing.assistant_id != *assistant_id || existing.user_id != *user_id {
                return Err(AppError::BadRequest("Phone number already in use".into()));
            }
        }
    }
}
```

## Error Handling

### 8. Error Patterns

```rust
// All handlers return Result<Json<T>, AppError>
pub async fn handler(...) -> Result<Json<Response>, AppError> { ... }

// Map database errors
.map_err(|e| AppError::DatabaseError(e.to_string()))?

// 500 errors are automatically logged via IntoResponse impl
// Use tracing for non-error warnings
tracing::warn!("Non-fatal issue: {details}");
```

**Non-fatal operations** (like sending via provider after saving message) should be logged but not fail the request:

```rust
match send_message_via_provider(config, &integration, &phone, &text).await {
    Ok(_) => {}
    Err(e) => {
        tracing::warn!("Provider send failed for conversation {id}: {e}");
        // Message is already saved — don't fail the whole request
    }
}
```

### 9. Handler Validation Order

Every protected handler should follow this order:

1. **Auth** — `Extension(auth_user)` (automatic via middleware)
2. **Ownership** — verify the user owns the resource (or has share access)
3. **Input validation** — check request body/params
4. **Business logic** — execute the operation
5. **Response** — return result

```rust
pub async fn handler(
    Extension(db): Extension<DbSession>,
    Extension(auth_user): Extension<AuthUser>,
    Path(assistant_id): Path<Uuid>,
) -> Result<Json<Response>, AppError> {
    // 1. Auth is automatic
    // 2. Ownership check
    let assistant = get_assistant(&db, &auth_user.user_id, &assistant_id).await?;
    // 3. Validate input...
    // 4. Business logic...
    // 5. Return
    Ok(Json(response))
}
```

## API Key & Secrets Security

### 10. Encryption at Rest

- **LLM API keys** are encrypted with AES-GCM before storage (`services/encryption.rs`)
- **Never** log or return decrypted API keys in responses
- **Never** store secrets in plaintext — use `EncryptionService::encrypt()`

### 11. Sensitive Data in Responses

Strip sensitive fields before returning to the client:

```rust
// WRONG — leaks token
Ok(Json(integration))

// RIGHT — redact sensitive fields
let mut safe = integration;
safe.config_token = safe.config_token.map(|_| "••••••••".to_string());
Ok(Json(safe))
```

## Cassandra Query Patterns

### 12. Partition Key Rules

Always include the **full partition key** in WHERE clauses:

```
-- Table: conversations (PK: (assistant_id, user_id), id)
-- WRONG: missing partition key component
WHERE assistant_id = ?

-- RIGHT: full partition key
WHERE assistant_id = ? AND user_id = ?
```

### 13. Pagination

For large result sets, use `LIMIT` in CQL and implement cursor-based pagination:

```rust
"SELECT ... FROM table WHERE pk = ? LIMIT ?"
```

Never use `query_unpaged` on tables that could return unbounded results without a `LIMIT`.

## Code Quality Checklist

Before finishing any backend change, verify:

- [ ] All Cassandra non-PK columns use `Option<T>` in Rust types
- [ ] All queries include the full partition key (or have a justified `ALLOW FILTERING`)
- [ ] Delete operations cascade to all child tables
- [ ] Webhook endpoints validate sender identity
- [ ] Lookups by external key (phone, token) validate parent entity existence
- [ ] No `maybe_first_row_typed` on queries that could return multiple rows from different tenants
- [ ] Unique constraints enforced in application code before INSERT
- [ ] Sensitive data (API keys, tokens) encrypted at rest and redacted in responses
- [ ] Error handling: 500s are logged, non-fatal operations don't fail the request
- [ ] Ownership verified before any read/write on tenant-scoped data
