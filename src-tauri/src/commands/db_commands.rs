use crate::connections::secrets::SecretRef;
use crate::AppState;
use serde::Serialize;
use sqlx::query;
use tauri::State;

const RESET_TABLES: &[&str] = &[
    "memory_record_sources",
    "memory_outbox",
    "memory_processing_queue",
    "memory_records",
    "memory_settings",
    "connection_models",
    "connections",
    "agent_verification_legacy",
    "agent_verification",
    "mobile_push_tokens",
    "agent_installations",
    "workspaces",
    "messages",
    "conversations",
    "folders",
    "sessions",
    "users",
    "provider_configs",
];

const WEB_SEARCH_PROVIDERS: &[&str] = &["exa", "ollama", "tavily"];

/// Remove all PolyUI-owned data while leaving SQLite migration metadata intact.
/// Credentials are deleted through the OS secret store before their database
/// references are removed, so a failed database reset can be retried safely.
#[tauri::command]
pub async fn reset_local_data(state: State<'_, AppState>) -> Result<(), String> {
    let connection_refs: Vec<String> =
        sqlx::query_scalar("SELECT secret_ref FROM connections WHERE secret_ref IS NOT NULL")
            .fetch_all(&state.db)
            .await
            .map_err(|error| format!("Could not read saved provider credentials: {error}"))?;

    for reference in connection_refs {
        state
            .secret_store
            .delete(&SecretRef(reference))
            .map_err(|error| format!("Could not remove a saved provider credential: {error}"))?;
    }
    for provider in WEB_SEARCH_PROVIDERS {
        state
            .secret_store
            .delete(&SecretRef::for_web_search(provider))
            .map_err(|error| format!("Could not remove saved web search credentials: {error}"))?;
    }

    // Resetting local data should not leave active sandbox workspaces behind.
    // Cleanup is best-effort; the reaper will handle an unavailable runtime.
    let _ = state.sandboxes.destroy_all();

    let mut transaction = state
        .db
        .begin()
        .await
        .map_err(|error| format!("Could not start the local data reset: {error}"))?;

    for table in RESET_TABLES {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        )
        .bind(table)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| format!("Could not inspect local data: {error}"))?;
        if !exists {
            continue;
        }

        if *table == "memory_records" {
            query("UPDATE memory_records SET supersedes_id = NULL")
                .execute(&mut *transaction)
                .await
                .map_err(|error| format!("Could not reset local memories: {error}"))?;
        }

        let statement = format!("DELETE FROM \"{}\"", table.replace('"', "\"\""));
        query(&statement)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("Could not clear local {table} data: {error}"))?;
    }

    transaction
        .commit()
        .await
        .map_err(|error| format!("Could not finish the local data reset: {error}"))
}

#[derive(Serialize)]
pub struct SqlResult {
    pub success: bool,
    pub message: String,
    pub rows_affected: Option<u64>,
}

#[cfg(feature = "dev-sql-console")]
#[tauri::command]
pub async fn clear_database(state: State<'_, AppState>) -> Result<SqlResult, String> {
    let pool = &state.db;
    for table in &["messages", "conversations", "sessions", "users"] {
        let sql = format!("DELETE FROM {}", table);
        sqlx::raw_sql(&sql)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to clear table '{}': {}", table, e))?;
    }
    Ok(SqlResult {
        success: true,
        message: "All user data cleared (messages, conversations, sessions, users).".into(),
        rows_affected: None,
    })
}

#[cfg(feature = "dev-sql-console")]
#[tauri::command]
pub async fn execute_sql(state: State<'_, AppState>, sql: String) -> Result<SqlResult, String> {
    let pool = &state.db;
    let trimmed = sql.trim().to_uppercase();

    if trimmed.starts_with("SELECT")
        || trimmed.starts_with("PRAGMA")
        || trimmed.starts_with("EXPLAIN")
    {
        let rows = sqlx::query(&sql)
            .fetch_all(pool)
            .await
            .map_err(|e| format!("Query error: {e}"))?;

        if rows.is_empty() {
            return Ok(SqlResult {
                success: true,
                message: "Query returned 0 rows.".into(),
                rows_affected: None,
            });
        }

        Ok(SqlResult {
            success: true,
            message: format!("Query returned {} rows.", rows.len()),
            rows_affected: None,
        })
    } else {
        let result = sqlx::raw_sql(&sql)
            .execute(pool)
            .await
            .map_err(|e| format!("Execute error: {e}"))?;

        Ok(SqlResult {
            success: true,
            message: "Query executed successfully.".into(),
            rows_affected: Some(result.rows_affected()),
        })
    }
}

#[cfg(not(feature = "dev-sql-console"))]
#[tauri::command]
pub async fn execute_sql(_state: State<'_, AppState>, _sql: String) -> Result<SqlResult, String> {
    Err("SQL console is disabled in this build.".to_string())
}
