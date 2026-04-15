use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use scylla::frame::value::CqlTimestamp;
use uuid::Uuid;

use crate::db::DbSession;
use crate::errors::AppError;
use crate::models::strategy_map::{StrategyMapEdge, StrategyMapNode};
use crate::services::assistant as assistant_service;
use crate::services::okr as okr_service;
use crate::services::team as team_service;
use crate::services::channel as channel_service;
use crate::services::workspace as workspace_service;

fn ts_now() -> CqlTimestamp {
    CqlTimestamp(Utc::now().timestamp_millis())
}

// ─── Nodes ───

pub async fn create_node(
    db: &DbSession,
    workspace_id: &Uuid,
    node_type: &str,
    entity_id: Option<&Uuid>,
    label: &str,
    position_x: f32,
    position_y: f32,
    width: f32,
    height: f32,
    style_data: Option<&str>,
    bsc_perspective: Option<&str>,
) -> Result<StrategyMapNode, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.strategy_map_nodes (workspace_id, id, node_type, entity_id, label, position_x, position_y, width, height, style_data, bsc_perspective, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (workspace_id, &id, node_type, &entity_id, label, position_x, position_y, width, height, &style_data.unwrap_or(""), &bsc_perspective.unwrap_or(""), now, now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(StrategyMapNode {
        workspace_id: *workspace_id,
        id,
        node_type: node_type.to_string(),
        entity_id: entity_id.copied(),
        label: label.to_string(),
        position_x,
        position_y,
        width,
        height,
        style_data: style_data.map(String::from),
        bsc_perspective: bsc_perspective.map(String::from),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    })
}

pub async fn list_nodes(
    db: &DbSession,
    workspace_id: &Uuid,
) -> Result<Vec<StrategyMapNode>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, node_type, entity_id, label, position_x, position_y, width, height, style_data, bsc_perspective, created_at, updated_at FROM inertial_eclipse.strategy_map_nodes WHERE workspace_id = ?",
            (workspace_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    type NodeRow = (
        Uuid, Uuid, Option<String>, Option<Uuid>, Option<String>, Option<f32>, Option<f32>,
        Option<f32>, Option<f32>, Option<String>, Option<String>,
        Option<DateTime<Utc>>, Option<DateTime<Utc>>,
    );

    let rows = result.into_rows_result()?;

    let mut nodes = Vec::new();
    for row in rows.rows::<NodeRow>()?.flatten() {
        nodes.push(StrategyMapNode {
            workspace_id: row.0,
            id: row.1,
            node_type: row.2.unwrap_or_default(),
            entity_id: row.3,
            label: row.4.unwrap_or_default(),
            position_x: row.5.unwrap_or(0.0),
            position_y: row.6.unwrap_or(0.0),
            width: row.7.unwrap_or(200.0),
            height: row.8.unwrap_or(100.0),
            style_data: row.9,
            bsc_perspective: row.10,
            created_at: row.11.unwrap_or(Utc::now()),
            updated_at: row.12.unwrap_or(Utc::now()),
        });
    }

    Ok(nodes)
}

pub async fn update_node(
    db: &DbSession,
    workspace_id: &Uuid,
    node_id: &Uuid,
    label: Option<&str>,
    position_x: Option<f32>,
    position_y: Option<f32>,
    width: Option<f32>,
    height: Option<f32>,
    style_data: Option<&str>,
    bsc_perspective: Option<&str>,
) -> Result<(), AppError> {
    let now = ts_now();

    if let Some(v) = label {
        db.query_unpaged(
            "UPDATE inertial_eclipse.strategy_map_nodes SET label = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, node_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = position_x {
        db.query_unpaged(
            "UPDATE inertial_eclipse.strategy_map_nodes SET position_x = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, node_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = position_y {
        db.query_unpaged(
            "UPDATE inertial_eclipse.strategy_map_nodes SET position_y = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, node_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = width {
        db.query_unpaged(
            "UPDATE inertial_eclipse.strategy_map_nodes SET width = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, node_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = height {
        db.query_unpaged(
            "UPDATE inertial_eclipse.strategy_map_nodes SET height = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, node_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = style_data {
        db.query_unpaged(
            "UPDATE inertial_eclipse.strategy_map_nodes SET style_data = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, node_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    if let Some(v) = bsc_perspective {
        db.query_unpaged(
            "UPDATE inertial_eclipse.strategy_map_nodes SET bsc_perspective = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (v, now, workspace_id, node_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }

    Ok(())
}

pub async fn batch_update_positions(
    db: &DbSession,
    workspace_id: &Uuid,
    updates: &[(Uuid, f32, f32)],
) -> Result<(), AppError> {
    let now = ts_now();
    for (node_id, x, y) in updates {
        db.query_unpaged(
            "UPDATE inertial_eclipse.strategy_map_nodes SET position_x = ?, position_y = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (x, y, now, workspace_id, node_id),
        ).await.map_err(|e| AppError::DatabaseError(e.to_string()))?;
    }
    Ok(())
}

pub async fn delete_node(
    db: &DbSession,
    workspace_id: &Uuid,
    node_id: &Uuid,
) -> Result<(), AppError> {
    // Delete all edges connected to this node (as source or target)
    let all_edges = list_edges(db, workspace_id).await?;
    for edge in all_edges {
        if edge.source_node_id == *node_id || edge.target_node_id == *node_id {
            if let Err(e) = db.query_unpaged(
                "DELETE FROM inertial_eclipse.strategy_map_edges WHERE workspace_id = ? AND id = ?",
                (workspace_id, &edge.id),
            ).await {
                tracing::warn!("Failed to delete edge {} during node deletion: {}", edge.id, e);
            }
        }
    }

    db.query_unpaged(
        "DELETE FROM inertial_eclipse.strategy_map_nodes WHERE workspace_id = ? AND id = ?",
        (workspace_id, node_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

// ─── Edges ───

pub async fn create_edge(
    db: &DbSession,
    workspace_id: &Uuid,
    source_node_id: &Uuid,
    target_node_id: &Uuid,
    edge_type: &str,
    label: Option<&str>,
    style_data: Option<&str>,
) -> Result<StrategyMapEdge, AppError> {
    let id = Uuid::new_v4();
    let now = ts_now();

    db.query_unpaged(
        "INSERT INTO inertial_eclipse.strategy_map_edges (workspace_id, id, source_node_id, target_node_id, edge_type, label, style_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (workspace_id, &id, source_node_id, target_node_id, edge_type, &label.unwrap_or(""), &style_data.unwrap_or(""), now),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(StrategyMapEdge {
        workspace_id: *workspace_id,
        id,
        source_node_id: *source_node_id,
        target_node_id: *target_node_id,
        edge_type: edge_type.to_string(),
        label: label.map(String::from),
        style_data: style_data.map(String::from),
        created_at: Utc::now(),
    })
}

pub async fn list_edges(
    db: &DbSession,
    workspace_id: &Uuid,
) -> Result<Vec<StrategyMapEdge>, AppError> {
    let result = db
        .query_unpaged(
            "SELECT workspace_id, id, source_node_id, target_node_id, edge_type, label, style_data, created_at FROM inertial_eclipse.strategy_map_edges WHERE workspace_id = ?",
            (workspace_id,),
        )
        .await
        .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    let rows = result.into_rows_result()?;

    let mut edges = Vec::new();
    for row in rows.rows::<(Uuid, Uuid, Option<Uuid>, Option<Uuid>, Option<String>, Option<String>, Option<String>, Option<DateTime<Utc>>)>()?.flatten() {
        edges.push(StrategyMapEdge {
            workspace_id: row.0,
            id: row.1,
            source_node_id: row.2.unwrap_or(Uuid::nil()),
            target_node_id: row.3.unwrap_or(Uuid::nil()),
            edge_type: row.4.unwrap_or_else(|| "hierarchy".to_string()),
            label: row.5,
            style_data: row.6,
            created_at: row.7.unwrap_or(Utc::now()),
        });
    }

    Ok(edges)
}

pub async fn delete_edge(
    db: &DbSession,
    workspace_id: &Uuid,
    edge_id: &Uuid,
) -> Result<(), AppError> {
    db.query_unpaged(
        "DELETE FROM inertial_eclipse.strategy_map_edges WHERE workspace_id = ? AND id = ?",
        (workspace_id, edge_id),
    )
    .await
    .map_err(|e| AppError::DatabaseError(e.to_string()))?;

    Ok(())
}

// ─── Sync from OKR data ───

/// Auto-generates strategy map nodes from workspace entities and creates
/// relationship edges based on real hierarchy:
/// - Entities with a parent (team members→team, team objectives→team) connect to their parent
/// - Entities without a parent connect directly to workspace
/// Positions are auto-calculated using a tree layout.
pub async fn sync_from_okr_data(
    db: &DbSession,
    workspace_id: &Uuid,
) -> Result<(Vec<StrategyMapNode>, Vec<StrategyMapEdge>), AppError> {
    // ─── 1. Load existing state ───
    let existing_nodes = list_nodes(db, workspace_id).await?;
    let existing_entity_ids: HashSet<Uuid> = existing_nodes.iter().filter_map(|n| n.entity_id).collect();
    let mut entity_to_node: HashMap<Uuid, Uuid> = existing_nodes
        .iter()
        .filter_map(|n| n.entity_id.map(|eid| (eid, n.id)))
        .collect();

    // Delete old auto-generated edges (we rebuild them from real relationships)
    let existing_edges = list_edges(db, workspace_id).await?;
    for edge in &existing_edges {
        let _ = db.query_unpaged(
            "DELETE FROM inertial_eclipse.strategy_map_edges WHERE workspace_id = ? AND id = ?",
            (workspace_id, &edge.id),
        ).await;
    }

    let mut new_nodes: Vec<StrategyMapNode> = Vec::new();
    let mut new_edges: Vec<StrategyMapEdge> = Vec::new();

    // Helpers
    async fn refresh_node(db: &DbSession, ws: &Uuid, nid: &Uuid, label: &str, style: Option<&str>) {
        let now = CqlTimestamp(Utc::now().timestamp_millis());
        let _ = db.query_unpaged(
            "UPDATE inertial_eclipse.strategy_map_nodes SET label = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (label, now, ws, nid),
        ).await;
        if let Some(s) = style {
            let _ = db.query_unpaged(
                "UPDATE inertial_eclipse.strategy_map_nodes SET style_data = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
                (s, now, ws, nid),
            ).await;
        }
    }

    // Placeholder positions — will be recalculated at the end
    let px = 0.0_f32;
    let py = 0.0_f32;

    // Helper macro: ensure node exists (create or refresh), returns node_id
    macro_rules! ensure_node {
        ($entity_id:expr, $ntype:expr, $label:expr, $style:expr) => {{
            if existing_entity_ids.contains(&$entity_id) {
                if let Some(nid) = entity_to_node.get(&$entity_id) {
                    refresh_node(db, workspace_id, nid, $label, $style).await;
                }
                entity_to_node.get(&$entity_id).copied()
            } else if new_nodes.iter().any(|n| n.entity_id == Some($entity_id)) {
                entity_to_node.get(&$entity_id).copied()
            } else {
                let node = create_node(
                    db, workspace_id, $ntype, Some(&$entity_id), $label,
                    px, py, 220.0, 100.0, $style, None,
                ).await?;
                entity_to_node.insert($entity_id, node.id);
                let nid = node.id;
                new_nodes.push(node);
                Some(nid)
            }
        }};
    }

    // ─── 2. Workspace center node ───
    let ws_node_exists = existing_nodes.iter().any(|n| n.node_type == "workspace");
    let ws_node_id = if !ws_node_exists {
        let ws_name = workspace_service::get_workspace(db, workspace_id).await
            .map(|w| w.name).unwrap_or_else(|_| "Workspace".to_string());
        let node = create_node(db, workspace_id, "workspace", Some(workspace_id), &ws_name, 0.0, 0.0, 280.0, 100.0, None, None).await?;
        let nid = node.id;
        entity_to_node.insert(*workspace_id, nid);
        new_nodes.push(node);
        nid
    } else {
        existing_nodes.iter().find(|n| n.node_type == "workspace").map(|n| n.id).unwrap_or(Uuid::nil())
    };

    // ─── 3. Load all domain data ───
    let objectives = okr_service::list_all_objectives(db, workspace_id).await?;
    let teams = team_service::list_teams(db, workspace_id).await.unwrap_or_default();
    let channels = channel_service::list_channels(db, workspace_id).await.unwrap_or_default();
    let ws = workspace_service::get_workspace(db, workspace_id).await.ok();
    let owner_id = ws.map(|w| w.owner_id).unwrap_or(*workspace_id);
    let assistants = assistant_service::list_assistants(db, &owner_id).await.unwrap_or_default();
    let members = workspace_service::list_members(db, workspace_id).await.unwrap_or_default();

    // Build team membership map: user_id → [team_id, ...]
    let mut user_teams: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
    for team in &teams {
        if let Ok(team_members) = team_service::list_members(db, &team.id).await {
            for tm in team_members {
                user_teams.entry(tm.user_id).or_default().push(team.id);
            }
        }
    }

    // ─── 4. Create/refresh all nodes ───
    // Teams
    for team in &teams {
        let meta = serde_json::json!({ "description": team.description }).to_string();
        ensure_node!(team.id, "team", &team.name, Some(meta.as_str()));
    }
    // Channels
    for ch in &channels {
        let meta = serde_json::json!({ "channel_type": ch.channel_type }).to_string();
        ensure_node!(ch.id, "channel", &ch.name, Some(meta.as_str()));
    }
    // Assistants
    for asst in &assistants {
        ensure_node!(asst.id, "assistant", &asst.name, None);
    }
    // Members
    for member in &members {
        let name = member.user_name.as_deref().unwrap_or("Membro");
        ensure_node!(member.user_id, "member", name, None);
    }
    // Objectives + KRs
    for obj in &objectives {
        let meta = serde_json::json!({
            "progress": obj.progress, "confidence": obj.confidence,
            "status": obj.status, "objective_type": obj.objective_type,
            "cycle": obj.cycle, "description": obj.description,
        }).to_string();
        ensure_node!(obj.id, "objective", &obj.title, Some(meta.as_str()));

        let krs = okr_service::list_key_results(db, &obj.id).await.unwrap_or_default();
        for kr in &krs {
            let kr_meta = serde_json::json!({
                "current_value": kr.current_value, "target_value": kr.target_value,
                "start_value": kr.start_value, "unit": kr.unit,
                "confidence": kr.confidence, "status": kr.status, "kr_type": kr.kr_type,
            }).to_string();
            ensure_node!(kr.id, "key_result", &kr.title, Some(kr_meta.as_str()));
        }
    }

    // ─── 5. Build edges based on real relationships ───
    // Track which entities have a parent (not directly connected to workspace)
    let mut has_parent: HashSet<Uuid> = HashSet::new();
    // parent_node_id → [child_node_id, ...]  (for layout)
    let mut children_map: HashMap<Uuid, Vec<Uuid>> = HashMap::new();

    // KRs → their objective
    for obj in &objectives {
        let krs = okr_service::list_key_results(db, &obj.id).await.unwrap_or_default();
        for kr in &krs {
            if let (Some(src), Some(tgt)) = (entity_to_node.get(&obj.id), entity_to_node.get(&kr.id)) {
                let edge = create_edge(db, workspace_id, src, tgt, "hierarchy", None, None).await?;
                new_edges.push(edge);
                has_parent.insert(kr.id);
                children_map.entry(*src).or_default().push(*tgt);
            }
        }
    }

    // Objectives with team_ids → their teams
    for obj in &objectives {
        let obj_teams: Vec<Uuid> = obj.team_ids.as_ref()
            .map(|ids| ids.clone())
            .unwrap_or_else(|| obj.team_id.into_iter().collect());
        for tid in &obj_teams {
            if let (Some(src), Some(tgt)) = (entity_to_node.get(tid), entity_to_node.get(&obj.id)) {
                let edge = create_edge(db, workspace_id, src, tgt, "hierarchy", None, None).await?;
                new_edges.push(edge);
                has_parent.insert(obj.id);
                children_map.entry(*src).or_default().push(*tgt);
            }
        }
    }

    // Members → their teams (first team only for primary edge)
    for member in &members {
        if let Some(team_ids) = user_teams.get(&member.user_id) {
            for tid in team_ids {
                if let (Some(src), Some(tgt)) = (entity_to_node.get(tid), entity_to_node.get(&member.user_id)) {
                    let edge = create_edge(db, workspace_id, src, tgt, "hierarchy", None, None).await?;
                    new_edges.push(edge);
                    has_parent.insert(member.user_id);
                    children_map.entry(*src).or_default().push(*tgt);
                }
            }
        }
    }

    // Entities without a parent → workspace
    let all_entity_ids: Vec<Uuid> = entity_to_node.keys()
        .filter(|eid| **eid != *workspace_id)
        .copied()
        .collect();
    for eid in &all_entity_ids {
        if !has_parent.contains(eid) {
            if let Some(tgt) = entity_to_node.get(eid) {
                let edge = create_edge(db, workspace_id, &ws_node_id, tgt, "hierarchy", None, None).await?;
                new_edges.push(edge);
                children_map.entry(ws_node_id).or_default().push(*tgt);
            }
        }
    }

    // ─── 6. Auto-layout: tree-based positioning ───
    // Build node_id → node_type map for grouping
    let mut node_type_map: HashMap<Uuid, String> = HashMap::new();
    for n in existing_nodes.iter().chain(new_nodes.iter()) {
        node_type_map.insert(n.id, n.node_type.clone());
    }

    // Sort children of each parent by node_type so same categories are grouped
    let type_order: HashMap<&str, u8> = [
        ("team", 0), ("objective", 1), ("channel", 2), ("assistant", 3),
        ("member", 4), ("key_result", 5), ("task", 6), ("swot", 7),
    ].into_iter().collect();

    for children in children_map.values_mut() {
        children.sort_by(|a, b| {
            let ta = node_type_map.get(a).map(|t| *type_order.get(t.as_str()).unwrap_or(&99)).unwrap_or(99);
            let tb = node_type_map.get(b).map(|t| *type_order.get(t.as_str()).unwrap_or(&99)).unwrap_or(99);
            ta.cmp(&tb)
        });
    }

    let spacing_x = 300.0_f32;
    let spacing_y = 220.0_f32;

    // BFS to assign positions
    #[allow(dead_code)]
    struct LayoutInfo {
        x: f32,
        y: f32,
        width: f32, // used by layout_tree for subtree width calculation
    }

    fn layout_tree(
        node_id: Uuid,
        depth: usize,
        x_offset: f32,
        children_map: &HashMap<Uuid, Vec<Uuid>>,
        spacing_x: f32,
        spacing_y: f32,
        positions: &mut HashMap<Uuid, LayoutInfo>,
    ) -> f32 {
        let children = children_map.get(&node_id).cloned().unwrap_or_default();
        let y = depth as f32 * spacing_y;

        if children.is_empty() {
            let width = spacing_x;
            positions.insert(node_id, LayoutInfo { x: x_offset + width / 2.0, y, width });
            return width;
        }

        // Recursively layout children
        let mut total_width = 0.0_f32;
        for child in &children {
            if positions.contains_key(child) { continue; }
            let child_width = layout_tree(*child, depth + 1, x_offset + total_width, children_map, spacing_x, spacing_y, positions);
            total_width += child_width;
        }
        total_width = total_width.max(spacing_x);

        // Center this node above its children
        let center_x = x_offset + total_width / 2.0;
        positions.insert(node_id, LayoutInfo { x: center_x, y, width: total_width });
        total_width
    }

    let mut positions: HashMap<Uuid, LayoutInfo> = HashMap::new();
    layout_tree(ws_node_id, 0, 0.0, &children_map, spacing_x, spacing_y, &mut positions);

    // Apply positions to nodes (both new and existing)
    let now = ts_now();
    for (node_id, info) in &positions {
        db.query_unpaged(
            "UPDATE inertial_eclipse.strategy_map_nodes SET position_x = ?, position_y = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
            (info.x, info.y, now, workspace_id, node_id),
        ).await.ok();
    }

    // Update in-memory positions for new nodes
    for node in &mut new_nodes {
        if let Some(info) = positions.get(&node.id) {
            node.position_x = info.x;
            node.position_y = info.y;
        }
    }

    Ok((new_nodes, new_edges))
}
