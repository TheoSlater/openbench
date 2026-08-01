//! SQLite access for connections, models, installations, and workspaces.
//!
//! Thin and explicit: `sqlx::query` with `Row::get`, matching the style already
//! used in `db::connection`. The enum columns are stored as their `as_str`
//! spellings and parsed on read; an unknown spelling is a corrupt row and is
//! reported rather than silently coerced.

use super::secrets::SecretRef;
use super::{
    AgentInstallation, Connection, ConnectionHealth, ConnectionHealthStatus, ConnectionModel,
    ConnectionSummary, DiscoverySource, PathSource, Provider, VerificationResult, Workspace,
    WorkspaceAvailability,
};
use crate::runtime::{AgentKind, RuntimeRef};
use sqlx::{Row, SqlitePool};

type Result<T> = std::result::Result<T, String>;

fn parse_json_array(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}

fn connection_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Connection> {
    let provider_raw: String = row.get("provider");
    Ok(Connection {
        id: row.get("id"),
        account_id: row.get("account_id"),
        provider: Provider::parse(&provider_raw)
            .ok_or_else(|| format!("unknown provider in connections: {provider_raw}"))?,
        display_name: row.get("display_name"),
        enabled: row.get::<i64, _>("enabled") != 0,
        base_url: row.get("base_url"),
        secret_ref: row.get::<Option<String>, _>("secret_ref").map(SecretRef),
        extra_headers: row.get("extra_headers"),
        position: row.get("position"),
    })
}

fn model_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<ConnectionModel> {
    let source_raw: String = row.get("discovery_source");
    Ok(ConnectionModel {
        connection_id: row.get("connection_id"),
        remote_id: row.get("remote_id"),
        display_name: row.get("display_name"),
        capabilities: row.get("capabilities"),
        enabled: row.get::<i64, _>("enabled") != 0,
        aliases: parse_json_array(&row.get::<String, _>("aliases")),
        metadata: row.get("metadata"),
        discovery_source: DiscoverySource::parse(&source_raw)
            .ok_or_else(|| format!("unknown discovery source: {source_raw}"))?,
        last_seen_at: row.get("last_seen_at"),
    })
}

fn installation_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<AgentInstallation> {
    let kind_raw: String = row.get("agent_kind");
    let path_source_raw: String = row.get("path_source");
    let verification_raw: String = row.get("last_verification");
    Ok(AgentInstallation {
        id: row.get("id"),
        account_id: row.get("account_id"),
        agent_kind: AgentKind::parse(&kind_raw)
            .ok_or_else(|| format!("unknown agent kind: {kind_raw}"))?,
        display_name: row.get("display_name"),
        executable_path: row.get("executable_path"),
        path_source: PathSource::parse(&path_source_raw)
            .ok_or_else(|| format!("unknown path source: {path_source_raw}"))?,
        launch_args: parse_json_array(&row.get::<String, _>("launch_args")),
        detected_versions: row.get("detected_versions"),
        last_verification: VerificationResult::parse(&verification_raw)
            .ok_or_else(|| format!("unknown verification result: {verification_raw}"))?,
        last_verification_detail: row.get("last_verification_detail"),
        last_verified_at: row.get("last_verified_at"),
    })
}

fn workspace_from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Workspace> {
    let availability_raw: String = row.get("availability");
    Ok(Workspace {
        id: row.get("id"),
        account_id: row.get("account_id"),
        path: row.get("path"),
        display_name: row.get("display_name"),
        last_validated_at: row.get("last_validated_at"),
        availability: WorkspaceAvailability::parse(&availability_raw)
            .ok_or_else(|| format!("unknown workspace availability: {availability_raw}"))?,
    })
}

/// Insert a connection, or return the id of the existing one with the same
/// identity. Makes migration and seeding re-runnable without duplicates.
pub async fn upsert_connection(pool: &SqlitePool, connection: &Connection) -> Result<String> {
    if let Some(existing) = find_connection_id(
        pool,
        &connection.account_id,
        connection.provider,
        connection.base_url.as_deref(),
    )
    .await?
    {
        return Ok(existing);
    }

    sqlx::query(
        r"
        INSERT INTO connections
            (id, account_id, provider, display_name, enabled, base_url,
             secret_ref, extra_headers, position, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'), datetime('now'))
        ",
    )
    .bind(&connection.id)
    .bind(&connection.account_id)
    .bind(connection.provider.as_str())
    .bind(&connection.display_name)
    .bind(i64::from(connection.enabled))
    .bind(&connection.base_url)
    .bind(connection.secret_ref.as_ref().map(SecretRef::as_str))
    .bind(&connection.extra_headers)
    .bind(connection.position)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(connection.id.clone())
}

/// Save a user-edited connection by id. Unlike `upsert_connection` (the
/// idempotent migration helper), this updates mutable fields.
pub async fn save_connection(pool: &SqlitePool, connection: &Connection) -> Result<()> {
    sqlx::query(
        r"
        INSERT INTO connections
            (id, account_id, provider, display_name, enabled, base_url,
             secret_ref, extra_headers, position, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'), datetime('now'))
        ON CONFLICT (id) DO UPDATE SET
            display_name  = excluded.display_name,
            enabled       = excluded.enabled,
            base_url      = excluded.base_url,
            secret_ref    = excluded.secret_ref,
            extra_headers = excluded.extra_headers,
            position      = excluded.position,
            updated_at    = datetime('now')
        ",
    )
    .bind(&connection.id)
    .bind(&connection.account_id)
    .bind(connection.provider.as_str())
    .bind(&connection.display_name)
    .bind(i64::from(connection.enabled))
    .bind(&connection.base_url)
    .bind(connection.secret_ref.as_ref().map(SecretRef::as_str))
    .bind(&connection.extra_headers)
    .bind(connection.position)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| error.to_string())
}

/// Look up a connection by its identity tuple.
pub async fn find_connection_id(
    pool: &SqlitePool,
    account_id: &str,
    provider: Provider,
    base_url: Option<&str>,
) -> Result<Option<String>> {
    sqlx::query_scalar::<_, String>(
        r"
        SELECT id FROM connections
        WHERE account_id = ?1 AND provider = ?2 AND COALESCE(base_url, '') = ?3
        ",
    )
    .bind(account_id)
    .bind(provider.as_str())
    .bind(base_url.unwrap_or(""))
    .fetch_optional(pool)
    .await
    .map_err(|error| error.to_string())
}

pub async fn list_connections(pool: &SqlitePool, account_id: &str) -> Result<Vec<Connection>> {
    let rows = sqlx::query(
        "SELECT * FROM connections WHERE account_id = ?1 ORDER BY position ASC, id ASC",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    rows.iter().map(connection_from_row).collect()
}

pub async fn list_connection_summaries(
    pool: &SqlitePool,
    account_id: &str,
) -> Result<Vec<ConnectionSummary>> {
    let connections = list_connections(pool, account_id).await?;
    let mut summaries = Vec::with_capacity(connections.len());
    for connection in connections {
        let (available, enabled): (i64, i64) = sqlx::query_as(
            "SELECT COUNT(*), COALESCE(SUM(enabled), 0) FROM connection_models
             WHERE connection_id = ?1",
        )
        .bind(&connection.id)
        .fetch_one(pool)
        .await
        .map_err(|error| error.to_string())?;
        summaries.push(ConnectionSummary {
            health: get_connection_health(pool, &connection.id).await?,
            available_model_count: i32::try_from(available).unwrap_or(i32::MAX),
            enabled_model_count: i32::try_from(enabled).unwrap_or(i32::MAX),
            connection,
        });
    }
    Ok(summaries)
}

pub async fn list_enabled_connections(pool: &SqlitePool) -> Result<Vec<Connection>> {
    let rows =
        sqlx::query("SELECT * FROM connections WHERE enabled = 1 ORDER BY position ASC, id ASC")
            .fetch_all(pool)
            .await
            .map_err(|error| error.to_string())?;
    rows.iter().map(connection_from_row).collect()
}

pub async fn get_connection(pool: &SqlitePool, id: &str) -> Result<Option<Connection>> {
    let row = sqlx::query("SELECT * FROM connections WHERE id = ?1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|error| error.to_string())?;

    row.as_ref().map(connection_from_row).transpose()
}

pub async fn record_connection_health(
    pool: &SqlitePool,
    connection_id: &str,
    status: ConnectionHealthStatus,
    detail: &str,
    validated_at: &str,
) -> Result<()> {
    sqlx::query(
        "UPDATE connections
         SET validation_status = ?1, validation_detail = ?2,
             last_validated_at = ?3, updated_at = datetime('now')
         WHERE id = ?4",
    )
    .bind(status.as_str())
    .bind(detail)
    .bind(validated_at)
    .bind(connection_id)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| error.to_string())
}

pub async fn get_connection_health(
    pool: &SqlitePool,
    connection_id: &str,
) -> Result<ConnectionHealth> {
    let row = sqlx::query(
        "SELECT validation_status, validation_detail, last_validated_at
         FROM connections WHERE id = ?1",
    )
    .bind(connection_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| error.to_string())?;
    let Some(row) = row else {
        return Err(format!("connection {connection_id} was not found"));
    };
    let raw: String = row.get("validation_status");
    Ok(ConnectionHealth {
        status: ConnectionHealthStatus::parse(&raw)
            .ok_or_else(|| format!("unknown connection health status: {raw}"))?,
        detail: row.get("validation_detail"),
        last_validated_at: row.get("last_validated_at"),
    })
}

pub async fn delete_connection(pool: &SqlitePool, connection_id: &str) -> Result<()> {
    sqlx::query("DELETE FROM connections WHERE id = ?1")
        .bind(connection_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Point a connection at a keychain handle, or clear it.
pub async fn set_connection_secret_ref(
    pool: &SqlitePool,
    connection_id: &str,
    secret_ref: Option<&SecretRef>,
) -> Result<()> {
    sqlx::query(
        "UPDATE connections SET secret_ref = ?1, updated_at = datetime('now') WHERE id = ?2",
    )
    .bind(secret_ref.map(SecretRef::as_str))
    .bind(connection_id)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| error.to_string())
}

pub async fn set_connection_enabled(
    pool: &SqlitePool,
    connection_id: &str,
    enabled: bool,
) -> Result<()> {
    sqlx::query("UPDATE connections SET enabled = ?1, updated_at = datetime('now') WHERE id = ?2")
        .bind(i64::from(enabled))
        .bind(connection_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub async fn upsert_model(pool: &SqlitePool, model: &ConnectionModel) -> Result<()> {
    sqlx::query(
        r"
        INSERT INTO connection_models
            (connection_id, remote_id, display_name, capabilities, enabled,
             aliases, metadata, discovery_source, last_seen_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT (connection_id, remote_id) DO UPDATE SET
            display_name     = excluded.display_name,
            capabilities     = excluded.capabilities,
            enabled          = excluded.enabled,
            aliases          = excluded.aliases,
            metadata         = excluded.metadata,
            discovery_source = excluded.discovery_source,
            last_seen_at     = excluded.last_seen_at
        WHERE connection_models.discovery_source <> 'manual'
        ",
    )
    .bind(&model.connection_id)
    .bind(&model.remote_id)
    .bind(&model.display_name)
    .bind(&model.capabilities)
    .bind(i64::from(model.enabled))
    .bind(serde_json::to_string(&model.aliases).unwrap_or_else(|_| "[]".into()))
    .bind(&model.metadata)
    .bind(model.discovery_source.as_str())
    .bind(&model.last_seen_at)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| error.to_string())
}

/// Replace the remotely discovered portion of a connection's catalog.
///
/// Manual rows win on id collisions. Remote rows absent from the new response
/// remain as disabled history, so aliases and user selections do not vanish.
pub async fn refresh_discovered_models(
    pool: &SqlitePool,
    connection_id: &str,
    models: &[ConnectionModel],
) -> Result<()> {
    if models
        .iter()
        .any(|model| model.connection_id != connection_id)
    {
        return Err("model refresh contained a different connection id".into());
    }

    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    sqlx::query(
        "UPDATE connection_models SET enabled = 0
         WHERE connection_id = ?1 AND discovery_source = 'remote'",
    )
    .bind(connection_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| error.to_string())?;

    for model in models {
        sqlx::query(
            r"
            INSERT INTO connection_models
                (connection_id, remote_id, display_name, capabilities, enabled,
                 aliases, metadata, discovery_source, last_seen_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'remote', ?8)
            ON CONFLICT (connection_id, remote_id) DO UPDATE SET
                display_name     = excluded.display_name,
                capabilities     = excluded.capabilities,
                enabled          = excluded.enabled,
                metadata         = excluded.metadata,
                discovery_source = 'remote',
                last_seen_at     = excluded.last_seen_at
            WHERE connection_models.discovery_source <> 'manual'
            ",
        )
        .bind(connection_id)
        .bind(&model.remote_id)
        .bind(&model.display_name)
        .bind(&model.capabilities)
        .bind(1_i64)
        .bind(serde_json::to_string(&model.aliases).unwrap_or_else(|_| "[]".into()))
        .bind(&model.metadata)
        .bind(&model.last_seen_at)
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    }

    tx.commit().await.map_err(|error| error.to_string())
}

pub async fn list_models(pool: &SqlitePool, connection_id: &str) -> Result<Vec<ConnectionModel>> {
    let rows = sqlx::query(
        "SELECT * FROM connection_models WHERE connection_id = ?1 ORDER BY remote_id ASC",
    )
    .bind(connection_id)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    rows.iter().map(model_from_row).collect()
}

/// Whether a connection offers a model under its remote id or any alias.
pub async fn model_exists(pool: &SqlitePool, connection_id: &str, model_id: &str) -> Result<bool> {
    let direct: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM connection_models WHERE connection_id = ?1 AND remote_id = ?2",
    )
    .bind(connection_id)
    .bind(model_id)
    .fetch_one(pool)
    .await
    .map_err(|error| error.to_string())?;

    if direct > 0 {
        return Ok(true);
    }

    Ok(list_models(pool, connection_id)
        .await?
        .iter()
        .any(|model| model.aliases.iter().any(|alias| alias == model_id)))
}

pub async fn upsert_installation(
    pool: &SqlitePool,
    installation: &AgentInstallation,
) -> Result<()> {
    sqlx::query(
        r"
        INSERT INTO agent_installations
            (id, account_id, agent_kind, display_name, executable_path, path_source,
             launch_args, detected_versions, last_verification,
             last_verification_detail, last_verified_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                datetime('now'), datetime('now'))
        ON CONFLICT (id) DO UPDATE SET
            display_name             = excluded.display_name,
            executable_path          = excluded.executable_path,
            path_source              = excluded.path_source,
            launch_args              = excluded.launch_args,
            detected_versions        = excluded.detected_versions,
            last_verification        = excluded.last_verification,
            last_verification_detail = excluded.last_verification_detail,
            last_verified_at         = excluded.last_verified_at,
            updated_at               = datetime('now')
        ",
    )
    .bind(&installation.id)
    .bind(&installation.account_id)
    .bind(installation.agent_kind.as_str())
    .bind(&installation.display_name)
    .bind(&installation.executable_path)
    .bind(installation.path_source.as_str())
    .bind(serde_json::to_string(&installation.launch_args).unwrap_or_else(|_| "[]".into()))
    .bind(&installation.detected_versions)
    .bind(installation.last_verification.as_str())
    .bind(&installation.last_verification_detail)
    .bind(&installation.last_verified_at)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| error.to_string())
}

pub async fn list_installations(
    pool: &SqlitePool,
    account_id: &str,
) -> Result<Vec<AgentInstallation>> {
    let rows = sqlx::query(
        "SELECT * FROM agent_installations WHERE account_id = ?1 ORDER BY agent_kind ASC, id ASC",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    rows.iter().map(installation_from_row).collect()
}

pub async fn upsert_workspace(pool: &SqlitePool, workspace: &Workspace) -> Result<String> {
    if let Some(existing) = sqlx::query_scalar::<_, String>(
        "SELECT id FROM workspaces WHERE account_id = ?1 AND path = ?2",
    )
    .bind(&workspace.account_id)
    .bind(&workspace.path)
    .fetch_optional(pool)
    .await
    .map_err(|error| error.to_string())?
    {
        return Ok(existing);
    }

    sqlx::query(
        r"
        INSERT INTO workspaces
            (id, account_id, path, display_name, last_validated_at, availability, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
        ",
    )
    .bind(&workspace.id)
    .bind(&workspace.account_id)
    .bind(&workspace.path)
    .bind(&workspace.display_name)
    .bind(&workspace.last_validated_at)
    .bind(workspace.availability.as_str())
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(workspace.id.clone())
}

pub async fn list_workspaces(pool: &SqlitePool, account_id: &str) -> Result<Vec<Workspace>> {
    let rows = sqlx::query("SELECT * FROM workspaces WHERE account_id = ?1 ORDER BY path ASC")
        .bind(account_id)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    rows.iter().map(workspace_from_row).collect()
}

pub async fn get_workspace(pool: &SqlitePool, workspace_id: &str) -> Result<Option<Workspace>> {
    let row = sqlx::query("SELECT * FROM workspaces WHERE id = ?1")
        .bind(workspace_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| error.to_string())?;
    row.as_ref().map(workspace_from_row).transpose()
}

/// Read a conversation's runtime reference.
///
/// `Ok(None)` means the conversation exists but predates the rework and has
/// not been assigned one.
pub async fn get_conversation_runtime(
    pool: &SqlitePool,
    conversation_id: &str,
) -> Result<Option<RuntimeRef>> {
    let row = sqlx::query("SELECT runtime_kind, runtime_ref FROM conversations WHERE id = ?1")
        .bind(conversation_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| error.to_string())?;

    let Some(row) = row else { return Ok(None) };
    let kind: Option<String> = row.get("runtime_kind");
    let payload: Option<String> = row.get("runtime_ref");

    match (kind, payload) {
        (Some(kind), Some(payload)) => RuntimeRef::from_columns(&kind, &payload).map(Some),
        _ => Ok(None),
    }
}

/// Write a conversation's runtime reference.
///
/// A conversation may move between runtime families freely; switching the
/// header model selector rebinds the active conversation in place.
pub async fn set_conversation_runtime(
    pool: &SqlitePool,
    conversation_id: &str,
    runtime: &RuntimeRef,
) -> Result<()> {
    let payload = runtime
        .to_column()
        .map_err(|error| format!("failed to encode runtime ref: {error}"))?;

    sqlx::query("UPDATE conversations SET runtime_kind = ?1, runtime_ref = ?2 WHERE id = ?3")
        .bind(runtime.kind().as_str())
        .bind(payload)
        .bind(conversation_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub async fn list_recent_runtimes(
    pool: &SqlitePool,
    account_id: &str,
    limit: u32,
) -> Result<Vec<RuntimeRef>> {
    let rows = sqlx::query(
        "SELECT runtime_kind, runtime_ref
         FROM conversations
         WHERE userId = ?1 AND runtime_kind IS NOT NULL AND runtime_ref IS NOT NULL
         ORDER BY updatedAt DESC",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;
    let mut recent = Vec::new();
    for row in rows {
        let runtime = RuntimeRef::from_columns(
            &row.get::<String, _>("runtime_kind"),
            &row.get::<String, _>("runtime_ref"),
        )?;
        if !recent.contains(&runtime) {
            recent.push(runtime);
            if recent.len() >= limit as usize {
                break;
            }
        }
    }
    Ok(recent)
}

#[cfg(test)]
mod provider_refresh_tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn model_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE connection_models (
                connection_id TEXT NOT NULL,
                remote_id TEXT NOT NULL,
                display_name TEXT,
                capabilities TEXT,
                enabled INTEGER NOT NULL,
                aliases TEXT NOT NULL,
                metadata TEXT,
                discovery_source TEXT NOT NULL,
                last_seen_at TEXT,
                PRIMARY KEY (connection_id, remote_id)
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    fn model(id: &str, source: DiscoverySource) -> ConnectionModel {
        ConnectionModel {
            connection_id: "connection-1".into(),
            remote_id: id.into(),
            display_name: Some(id.into()),
            capabilities: None,
            enabled: true,
            aliases: vec![],
            metadata: None,
            discovery_source: source,
            last_seen_at: None,
        }
    }

    #[tokio::test]
    async fn refresh_preserves_manual_rows_and_disables_stale_remote_rows() {
        let pool = model_pool().await;
        let mut manual = model("same", DiscoverySource::Manual);
        manual.aliases = vec!["mine".into()];
        manual.metadata = Some(r#"{"owner":"user"}"#.into());
        upsert_model(&pool, &manual).await.unwrap();
        upsert_model(&pool, &model("stale", DiscoverySource::Remote))
            .await
            .unwrap();

        refresh_discovered_models(
            &pool,
            "connection-1",
            &[
                model("same", DiscoverySource::Remote),
                model("fresh", DiscoverySource::Remote),
            ],
        )
        .await
        .unwrap();

        let rows = list_models(&pool, "connection-1").await.unwrap();
        let manual_after = rows.iter().find(|row| row.remote_id == "same").unwrap();
        assert_eq!(manual_after.discovery_source, DiscoverySource::Manual);
        assert_eq!(manual_after.aliases, vec!["mine"]);
        assert_eq!(
            manual_after.metadata.as_deref(),
            Some(r#"{"owner":"user"}"#)
        );
        assert!(
            !rows
                .iter()
                .find(|row| row.remote_id == "stale")
                .unwrap()
                .enabled
        );
        assert!(
            rows.iter()
                .find(|row| row.remote_id == "fresh")
                .unwrap()
                .enabled
        );
    }

    #[tokio::test]
    async fn discovery_enables_every_current_model() {
        let pool = model_pool().await;
        let models: Vec<_> = (0..20)
            .map(|index| model(&format!("model-{index:02}"), DiscoverySource::Remote))
            .collect();

        refresh_discovered_models(&pool, "connection-1", &models)
            .await
            .unwrap();

        let rows = list_models(&pool, "connection-1").await.unwrap();
        assert_eq!(rows.len(), 20);
        assert_eq!(rows.iter().filter(|model| model.enabled).count(), 20);
    }
}
