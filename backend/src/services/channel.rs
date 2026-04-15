use chrono::{DateTime, Utc};
use scylla::frame::value::{CqlTimestamp, CqlTimeuuid};
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::channel::{Channel, ChannelCanvas, ChannelMember, ChannelMessage, ChannelNote, UserChannel};

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

// ─── Channel CRUD ───

pub async fn create_channel(
    db: &DbSession,
    workspace_id: &Uuid,
    name: &str,
    description: Option<&str>,
    channel_type: &str,
    created_by: &Uuid,
) -> Result<Channel, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();
    let desc = description.unwrap_or("");

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.channels (workspace_id, id, name, description, type, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (workspace_id, &id, name, desc, channel_type, created_by, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Add creator as member
    add_member(db, &id, created_by, workspace_id, "owner").await?;

    // For public channels, add all workspace members
    if channel_type == "public" {
        let members = crate::services::workspace::list_members(db, workspace_id).await?;
        for m in &members {
            if m.user_id != *created_by {
                let _ = add_member(db, &id, &m.user_id, workspace_id, "member").await;
            }
        }
    }

    Ok(Channel {
        workspace_id: *workspace_id,
        id,
        name: name.to_string(),
        description: description.map(String::from),
        channel_type: channel_type.to_string(),
        created_by: *created_by,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

pub async fn list_channels(
    db: &DbSession,
    workspace_id: &Uuid,
) -> Result<Vec<Channel>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, name, description, type, created_by, created_at, updated_at FROM inertial_eclipse.channels WHERE workspace_id = ?",
            (workspace_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut channels = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, String, Option<String>, String, Uuid, DateTime<Utc>, DateTime<Utc>)>()?.flatten() {
        channels.push(Channel {
            workspace_id: row.0,
            id: row.1,
            name: row.2,
            description: row.3,
            channel_type: row.4,
            created_by: row.5,
            created_at: row.6,
            updated_at: row.7,
        });
    }

    Ok(channels)
}

pub async fn get_channel(
    db: &DbSession,
    workspace_id: &Uuid,
    channel_id: &Uuid,
) -> Result<Channel, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, name, description, type, created_by, created_at, updated_at FROM inertial_eclipse.channels WHERE workspace_id = ? AND id = ?",
            (workspace_id, channel_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .into_rows_result()?
        .single_row::<(Uuid, Uuid, String, Option<String>, String, Uuid, DateTime<Utc>, DateTime<Utc>)>()?;

    Ok(Channel {
        workspace_id: row.0,
        id: row.1,
        name: row.2,
        description: row.3,
        channel_type: row.4,
        created_by: row.5,
        created_at: row.6,
        updated_at: row.7,
    })
}

pub async fn update_channel(
    db: &DbSession,
    workspace_id: &Uuid,
    channel_id: &Uuid,
    name: Option<&str>,
    description: Option<&str>,
) -> Result<(), AppError> {
    let now = ts_now();
    if let Some(n) = name {
        db.query_unpaged(
            "UPDATE inertial_eclipse.channels SET name = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (n, now, workspace_id, channel_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(d) = description {
        db.query_unpaged(
            "UPDATE inertial_eclipse.channels SET description = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (d, now, workspace_id, channel_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    Ok(())
}

pub async fn delete_channel(
    db: &DbSession,
    workspace_id: &Uuid,
    channel_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.channels WHERE workspace_id = ? AND id = ?",
        (workspace_id, channel_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Note: messages and members should be cleaned up too, but left for eventual consistency
    Ok(())
}

// ─── Members ───

pub async fn add_member(
    db: &DbSession,
    channel_id: &Uuid,
    user_id: &Uuid,
    workspace_id: &Uuid,
    role: &str,
) -> Result<(), AppError> {
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.channel_members (channel_id, user_id, workspace_id, role, last_read_at, joined_at) VALUES (?, ?, ?, ?, ?, ?)",
        (channel_id, user_id, workspace_id, role, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Denormalized user_channels
    let ch = db
        .query_unpaged(
            "SELECT name, type FROM inertial_eclipse.channels WHERE workspace_id = ? AND id = ?",
            (workspace_id, channel_id),
        )
        .await
        .ok()
        .and_then(|r| r.into_rows_result().ok())
        .and_then(|r| r.maybe_first_row::<(String, String)>().ok().flatten());

    if let Some((ch_name, ch_type)) = ch {
        db.query_unpaged(
            "INSERT INTO inertial_eclipse.user_channels (user_id, workspace_id, channel_id, channel_name, channel_type, unread_count, last_message_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
            (user_id, workspace_id, channel_id, &ch_name as &str, &ch_type as &str, now),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    Ok(())
}

pub async fn remove_member(
    db: &DbSession,
    channel_id: &Uuid,
    user_id: &Uuid,
    workspace_id: &Uuid,
) -> Result<(), AppError> {
    // Clean up the denormalized user_channels entry
    delete_user_channel(db, user_id, workspace_id, channel_id).await;

    // Then remove from channel_members
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.channel_members WHERE channel_id = ? AND user_id = ?",
        (channel_id, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

/// Finds and deletes a user_channels row by scanning the (user_id, workspace_id) partition.
/// Handles both NULL and non-NULL last_message_at values.
async fn delete_user_channel(
    db: &DbSession,
    user_id: &Uuid,
    workspace_id: &Uuid,
    channel_id: &Uuid,
) {
    let rows = db
        .query_unpaged(
            "SELECT channel_id, last_message_at FROM inertial_eclipse.user_channels WHERE user_id = ? AND workspace_id = ?",
            (user_id, workspace_id),
        )
        .await
        .ok();

    if let Some(result) = rows {
        if let Ok(typed) = result.into_rows_result() {
            for row in typed.rows::<(Uuid, Option<DateTime<Utc>>)>().into_iter().flatten().flatten() {
                if row.0 == *channel_id {
                    if let Some(ts) = row.1 {
                        let ts_cql = CqlTimestamp(ts.timestamp_millis());
                        let _ = db.query_unpaged(
                            "DELETE FROM inertial_eclipse.user_channels WHERE user_id = ? AND workspace_id = ? AND last_message_at = ? AND channel_id = ?",
                            (user_id, workspace_id, ts_cql, channel_id),
                        ).await;
                    }
                }
            }
        }
    }
}

pub async fn list_members(
    db: &DbSession,
    channel_id: &Uuid,
) -> Result<Vec<ChannelMember>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT channel_id, user_id, workspace_id, role, last_read_at, joined_at FROM inertial_eclipse.channel_members WHERE channel_id = ?",
            (channel_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut members = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, Uuid, String, Option<DateTime<Utc>>, DateTime<Utc>)>()?.flatten() {
        let user_info = db
            .query_unpaged(
                "SELECT name, email FROM inertial_eclipse.users WHERE id = ?",
                (&row.1,),
            )
            .await
            .ok()
            .and_then(|r| r.into_rows_result().ok())
            .and_then(|r| r.maybe_first_row::<(String, String)>().ok().flatten());

        let (user_name, user_email) = match user_info {
            Some((n, e)) => (Some(n), Some(e)),
            None => (None, None),
        };

        members.push(ChannelMember {
            channel_id: row.0,
            user_id: row.1,
            workspace_id: row.2,
            role: row.3,
            last_read_at: row.4,
            joined_at: row.5,
            user_name,
            user_email,
        });
    }

    Ok(members)
}

pub async fn is_member(
    db: &DbSession,
    channel_id: &Uuid,
    user_id: &Uuid,
) -> Result<bool, AppError> {
    let result = db
        .query_unpaged(
            "SELECT user_id FROM inertial_eclipse.channel_members WHERE channel_id = ? AND user_id = ?",
            (channel_id, user_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(result.into_rows_result()?.maybe_first_row::<(Uuid,)>()?.is_some())
}

// ─── Messages ───

pub async fn send_message(
    db: &DbSession,
    channel_id: &Uuid,
    sender_id: &Uuid,
    sender_name: &str,
    content: &str,
    message_type: &str,
) -> Result<ChannelMessage, AppError> {
    let now = ts_now();
    let ts = uuid::timestamp::Timestamp::now(uuid::NoContext);
    let id = Uuid::new_v1(ts, &[0x01, 0x23, 0x45, 0x67, 0x89, 0xab]);
    let timeuuid = CqlTimeuuid::from(id);

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.channel_messages (channel_id, id, sender_id, sender_name, content, message_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (&channel_id, &timeuuid, sender_id, sender_name, content, message_type, now),
    )
    .await
    .map_err(|e: scylla::transport::errors::QueryError| AppError::DatabaseError(e.to_string()))?;

    // Increment unread for all other members
    let members = list_members(db, channel_id).await?;
    for m in &members {
        if m.user_id != *sender_id {
            let current = db
                .query_unpaged(
                    "SELECT unread_count, channel_name, channel_type, last_message_at FROM inertial_eclipse.user_channels WHERE user_id = ? AND workspace_id = ? AND channel_id = ? ALLOW FILTERING",
                    (&m.user_id, &m.workspace_id, channel_id),
                )
                .await
                .ok()
                .and_then(|r| r.into_rows_result().ok())
                .and_then(|r| r.maybe_first_row::<(Option<i32>, Option<String>, Option<String>, Option<DateTime<Utc>>)>().ok().flatten());

            if let Some((count, ch_name, ch_type, old_ts)) = current {
                let new_count = count.unwrap_or(0) + 1;
                let ch_name_str = ch_name.unwrap_or_default();
                let ch_type_str = ch_type.unwrap_or_default();
                if let Some(old) = old_ts {
                    let old_cql = CqlTimestamp(old.timestamp_millis());
                    let _ = db.query_unpaged(
                        "DELETE FROM inertial_eclipse.user_channels WHERE user_id = ? AND workspace_id = ? AND last_message_at = ? AND channel_id = ?",
                        (&m.user_id, &m.workspace_id, old_cql, channel_id),
                    ).await;
                }
                let _ = db.query_unpaged(
                    "INSERT INTO inertial_eclipse.user_channels (user_id, workspace_id, channel_id, channel_name, channel_type, unread_count, last_message_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (&m.user_id, &m.workspace_id, channel_id, &ch_name_str as &str, &ch_type_str as &str, new_count, now),
                ).await;
            }
        }
    }

    Ok(ChannelMessage {
        channel_id: *channel_id,
        id,
        sender_id: *sender_id,
        sender_name: sender_name.to_string(),
        content: content.to_string(),
        message_type: message_type.to_string(),
        edited_at: None,
        created_at: Utc::now(),
    })
}

pub async fn list_messages(
    db: &DbSession,
    channel_id: &Uuid,
    page_size: i32,
    cursor: Option<&str>,
) -> Result<(Vec<ChannelMessage>, Option<String>), AppError> {
    let (result, next_cursor) = crate::db::query_paged(
        db,
        "SELECT channel_id, id, sender_id, sender_name, content, message_type, edited_at, created_at FROM inertial_eclipse.channel_messages WHERE channel_id = ?",
        (channel_id,),
        page_size,
        cursor,
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut messages = Vec::new();
    for row in rows.rows::<(Uuid, CqlTimeuuid, Uuid, String, String, String, Option<DateTime<Utc>>, DateTime<Utc>)>()?.flatten() {
        messages.push(ChannelMessage {
            channel_id: row.0,
            id: row.1.into(),
            sender_id: row.2,
            sender_name: row.3,
            content: row.4,
            message_type: row.5,
            edited_at: row.6,
            created_at: row.7,
        });
    }

    Ok((messages, next_cursor))
}

pub async fn edit_message(
    db: &DbSession,
    channel_id: &Uuid,
    message_id: &Uuid,
    content: &str,
) -> Result<(), AppError> {
    let now = ts_now();
    let timeuuid = CqlTimeuuid::from(*message_id);
    db.query_unpaged(
        "UPDATE inertial_eclipse.channel_messages SET content = ?, edited_at = ? WHERE channel_id = ? AND id = ?",
        (content, now, channel_id, &timeuuid),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn delete_message(
    db: &DbSession,
    channel_id: &Uuid,
    message_id: &Uuid,
) -> Result<(), AppError> {
    let timeuuid = CqlTimeuuid::from(*message_id);
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.channel_messages WHERE channel_id = ? AND id = ?",
        (channel_id, &timeuuid),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

pub async fn mark_read(
    db: &DbSession,
    channel_id: &Uuid,
    user_id: &Uuid,
) -> Result<(), AppError> {
    let now = ts_now();

    // Update last_read_at in channel_members
    db.query_unpaged(
        "UPDATE inertial_eclipse.channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?",
        (now, channel_id, user_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    // Get workspace_id from channel_members
    let member_row = db
        .query_unpaged(
            "SELECT workspace_id FROM inertial_eclipse.channel_members WHERE channel_id = ? AND user_id = ?",
            (channel_id, user_id),
        )
        .await
        .ok()
        .and_then(|r| r.into_rows_result().ok())
        .and_then(|r| r.maybe_first_row::<(Uuid,)>().ok().flatten());

    if let Some((workspace_id,)) = member_row {
        // Get channel info before deleting
        let ch_info = db
            .query_unpaged(
                "SELECT name, type FROM inertial_eclipse.channels WHERE workspace_id = ? AND id = ?",
                (&workspace_id, channel_id),
            )
            .await
            .ok()
            .and_then(|r| r.into_rows_result().ok())
            .and_then(|r| r.maybe_first_row::<(Option<String>, Option<String>)>().ok().flatten());

        // Delete existing user_channels entry (handles NULL last_message_at)
        delete_user_channel(db, user_id, &workspace_id, channel_id).await;

        // Re-insert with unread_count = 0
        let (ch_name, ch_type) = ch_info.unwrap_or((None, None));
        let ch_name_str = ch_name.unwrap_or_default();
        let ch_type_str = ch_type.unwrap_or_default();
        let _ = db.query_unpaged(
            "INSERT INTO inertial_eclipse.user_channels (user_id, workspace_id, channel_id, channel_name, channel_type, unread_count, last_message_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
            (user_id, &workspace_id, channel_id, &ch_name_str as &str, &ch_type_str as &str, now),
        ).await;
    }

    Ok(())
}

// ─── DMs ───

pub async fn find_or_create_dm(
    db: &DbSession,
    workspace_id: &Uuid,
    user_a: &Uuid,
    user_b: &Uuid,
    user_a_name: &str,
    user_b_name: &str,
) -> Result<Channel, AppError> {
    // Look for existing DM between these two users
    let channels = list_channels(db, workspace_id).await?;
    for ch in &channels {
        if ch.channel_type == "dm" {
            let members = list_members(db, &ch.id).await?;
            let member_ids: Vec<Uuid> = members.iter().map(|m| m.user_id).collect();
            if member_ids.len() == 2 && member_ids.contains(user_a) && member_ids.contains(user_b) {
                return Ok(ch.clone());
            }
        }
    }

    // Create new DM
    let dm_name = format!("{} & {}", user_a_name, user_b_name);
    let id = Uuid::new_v4();
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.channels (workspace_id, id, name, description, type, created_by, created_at, updated_at) VALUES (?, ?, ?, '', 'dm', ?, ?, ?)",
        (workspace_id, &id, &dm_name as &str, user_a, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    add_member(db, &id, user_a, workspace_id, "member").await?;
    add_member(db, &id, user_b, workspace_id, "member").await?;

    Ok(Channel {
        workspace_id: *workspace_id,
        id,
        name: dm_name,
        description: None,
        channel_type: "dm".to_string(),
        created_by: *user_a,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

pub async fn list_user_channels(
    db: &DbSession,
    user_id: &Uuid,
    workspace_id: &Uuid,
) -> Result<Vec<UserChannel>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT user_id, workspace_id, channel_id, channel_name, channel_type, unread_count, last_message_at FROM inertial_eclipse.user_channels WHERE user_id = ? AND workspace_id = ?",
            (user_id, workspace_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut channels = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, Uuid, String, String, Option<i32>, Option<DateTime<Utc>>)>()?.flatten() {
        channels.push(UserChannel {
            user_id: row.0,
            workspace_id: row.1,
            channel_id: row.2,
            channel_name: row.3,
            channel_type: row.4,
            unread_count: row.5.unwrap_or(0),
            last_message_at: row.6,
        });
    }

    Ok(channels)
}

// ─── Notes ───

pub async fn create_note(
    db: &DbSession,
    channel_id: &Uuid,
    title: &str,
    created_by: &Uuid,
) -> Result<ChannelNote, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.channel_notes (channel_id, id, title, content, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?, ?)",
        (channel_id, &id, title, created_by, created_by, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(ChannelNote {
        channel_id: *channel_id,
        id,
        title: title.to_string(),
        content: String::new(),
        created_by: *created_by,
        updated_by: *created_by,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

pub async fn list_notes(
    db: &DbSession,
    channel_id: &Uuid,
) -> Result<Vec<ChannelNote>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT channel_id, id, title, content, created_by, updated_by, created_at, updated_at FROM inertial_eclipse.channel_notes WHERE channel_id = ?",
            (channel_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut notes = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, String, String, Uuid, Uuid, DateTime<Utc>, DateTime<Utc>)>()?.flatten() {
        notes.push(ChannelNote {
            channel_id: row.0,
            id: row.1,
            title: row.2,
            content: row.3,
            created_by: row.4,
            updated_by: row.5,
            created_at: row.6,
            updated_at: row.7,
        });
    }

    Ok(notes)
}

pub async fn get_note(
    db: &DbSession,
    channel_id: &Uuid,
    note_id: &Uuid,
) -> Result<ChannelNote, AppError> {
    let result = db
        .query_unpaged(
            "SELECT channel_id, id, title, content, created_by, updated_by, created_at, updated_at FROM inertial_eclipse.channel_notes WHERE channel_id = ? AND id = ?",
            (channel_id, note_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .into_rows_result()?
        .single_row::<(Uuid, Uuid, String, String, Uuid, Uuid, DateTime<Utc>, DateTime<Utc>)>()?;

    Ok(ChannelNote {
        channel_id: row.0,
        id: row.1,
        title: row.2,
        content: row.3,
        created_by: row.4,
        updated_by: row.5,
        created_at: row.6,
        updated_at: row.7,
    })
}

pub async fn update_note(
    db: &DbSession,
    channel_id: &Uuid,
    note_id: &Uuid,
    title: Option<&str>,
    content: Option<&str>,
    updated_by: &Uuid,
) -> Result<(), AppError> {
    let now = ts_now();
    if let Some(t) = title {
        db.query_unpaged(
            "UPDATE inertial_eclipse.channel_notes SET title = ?, updated_by = ?, updated_at = ? WHERE channel_id = ? AND id = ?",
            (t, updated_by, now, channel_id, note_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(c) = content {
        db.query_unpaged(
            "UPDATE inertial_eclipse.channel_notes SET content = ?, updated_by = ?, updated_at = ? WHERE channel_id = ? AND id = ?",
            (c, updated_by, now, channel_id, note_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    Ok(())
}

pub async fn delete_note(
    db: &DbSession,
    channel_id: &Uuid,
    note_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.channel_notes WHERE channel_id = ? AND id = ?",
        (channel_id, note_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}

// ─── Canvases ───

pub async fn create_canvas(
    db: &DbSession,
    channel_id: &Uuid,
    title: &str,
    created_by: &Uuid,
) -> Result<ChannelCanvas, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.channel_canvases (channel_id, id, title, canvas_data, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (channel_id, &id, title, "", created_by, created_by, now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(ChannelCanvas {
        channel_id: *channel_id,
        id,
        title: title.to_string(),
        canvas_data: String::new(),
        created_by: *created_by,
        updated_by: *created_by,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

pub async fn list_canvases(
    db: &DbSession,
    channel_id: &Uuid,
) -> Result<Vec<ChannelCanvas>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT channel_id, id, title, created_by, updated_by, created_at, updated_at FROM inertial_eclipse.channel_canvases WHERE channel_id = ?",
            (channel_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut canvases = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, Option<String>, Option<Uuid>, Option<Uuid>, Option<DateTime<Utc>>, Option<DateTime<Utc>>)>()?.flatten() {
        canvases.push(ChannelCanvas {
            channel_id: row.0,
            id: row.1,
            title: row.2.unwrap_or_default(),
            canvas_data: String::new(),
            created_by: row.3.unwrap_or(Uuid::nil()),
            updated_by: row.4.unwrap_or(Uuid::nil()),
            created_at: row.5.unwrap_or(Utc::now()),
            updated_at: row.6.unwrap_or(Utc::now()),
        });
    }

    Ok(canvases)
}

pub async fn get_canvas(
    db: &DbSession,
    channel_id: &Uuid,
    canvas_id: &Uuid,
) -> Result<ChannelCanvas, AppError> {
    let result = db
        .query_unpaged(
            "SELECT channel_id, id, title, canvas_data, created_by, updated_by, created_at, updated_at FROM inertial_eclipse.channel_canvases WHERE channel_id = ? AND id = ?",
            (channel_id, canvas_id),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let row = result
        .into_rows_result()?
        .single_row::<(Uuid, Uuid, Option<String>, Option<String>, Option<Uuid>, Option<Uuid>, Option<DateTime<Utc>>, Option<DateTime<Utc>>)>()?;

    Ok(ChannelCanvas {
        channel_id: row.0,
        id: row.1,
        title: row.2.unwrap_or_default(),
        canvas_data: row.3.unwrap_or_default(),
        created_by: row.4.unwrap_or(Uuid::nil()),
        updated_by: row.5.unwrap_or(Uuid::nil()),
        created_at: row.6.unwrap_or(Utc::now()),
        updated_at: row.7.unwrap_or(Utc::now()),
    })
}

pub async fn update_canvas(
    db: &DbSession,
    channel_id: &Uuid,
    canvas_id: &Uuid,
    title: Option<&str>,
    canvas_data: Option<&str>,
    updated_by: &Uuid,
) -> Result<ChannelCanvas, AppError> {
    let now = ts_now();

    if let Some(t) = title {
        db.query_unpaged(
            "UPDATE inertial_eclipse.channel_canvases SET title = ?, updated_by = ?, updated_at = ? WHERE channel_id = ? AND id = ?",
            (t, updated_by, now, channel_id, canvas_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(data) = canvas_data {
        db.query_unpaged(
            "UPDATE inertial_eclipse.channel_canvases SET canvas_data = ?, updated_by = ?, updated_at = ? WHERE channel_id = ? AND id = ?",
            (data, updated_by, now, channel_id, canvas_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    get_canvas(db, channel_id, canvas_id).await
}

pub async fn delete_canvas(
    db: &DbSession,
    channel_id: &Uuid,
    canvas_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.channel_canvases WHERE channel_id = ? AND id = ?",
        (channel_id, canvas_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;
    Ok(())
}
