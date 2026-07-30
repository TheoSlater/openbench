//! Persisted record of the last successful coding-agent verification.
//!
//! Process-lifetime caches (`CodexCache`/`ClaudeCache`) reset on every
//! restart, which is exactly the bug this fixes: a previously-verified agent
//! must paint `READY` on first render, not `Set up`. This table is the
//! durable half of that — read on `*_status`, written on `*_verify`.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedVerification {
    pub adapter_path: String,
    pub authenticated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum InstallationState {
    Unknown,
    NotInstalled,
    CliMissing,
    AdapterMissing,
    AdapterOutdated,
    Available,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentVerification {
    pub agent_kind: String,
    pub cli_path: Option<String>,
    pub cli_source: Option<String>,
    pub cli_version: Option<String>,
    pub cli_checked_at: Option<String>,
    pub adapter_path: Option<String>,
    pub adapter_source: Option<String>,
    pub adapter_version: Option<String>,
    pub adapter_checked_at: Option<String>,
    pub installation: InstallationState,
    pub availability: Option<bool>,
    pub availability_error: Option<String>,
    pub availability_checked_at: Option<String>,
    pub authentication: crate::acp::probe::AuthenticationState,
    pub auth_checked_at: Option<String>,
    pub verified_at: Option<String>,
}

/// The verification recorded for this exact adapter path, if any.
///
/// Keyed by path as well as agent kind: if the resolved adapter moved (a
/// fresh install, a changed override), the old record simply does not match
/// and is never returned — invalidation is implicit rather than a separate
/// step to remember to call.
pub async fn load(
    pool: &SqlitePool,
    agent_kind: &str,
    adapter_path: &str,
) -> Result<Option<CachedVerification>, String> {
    Ok(load_snapshot(pool, agent_kind).await?.and_then(|snapshot| {
        (snapshot.adapter_path.as_deref() == Some(adapter_path)).then(|| CachedVerification {
            adapter_path: adapter_path.to_string(),
            authenticated: matches!(
                snapshot.authentication,
                crate::acp::probe::AuthenticationState::LoggedIn
            ),
        })
    }))
}

/// Record a real verification result. Only called after an actual spawn and
/// initialize — never speculatively.
pub async fn store(
    pool: &SqlitePool,
    agent_kind: &str,
    adapter_path: &str,
    authenticated: bool,
) -> Result<(), String> {
    store_snapshot(
        pool,
        &AgentVerification {
            agent_kind: agent_kind.to_string(),
            cli_path: None,
            cli_source: None,
            cli_version: None,
            cli_checked_at: None,
            adapter_path: Some(adapter_path.to_string()),
            adapter_source: None,
            adapter_version: None,
            adapter_checked_at: None,
            installation: InstallationState::Available,
            availability: Some(true),
            availability_error: None,
            availability_checked_at: Some(chrono::Utc::now().to_rfc3339()),
            authentication: if authenticated {
                crate::acp::probe::AuthenticationState::LoggedIn
            } else {
                crate::acp::probe::AuthenticationState::LoggedOut
            },
            auth_checked_at: None,
            verified_at: Some(chrono::Utc::now().to_rfc3339()),
        },
    )
    .await
}

pub async fn store_snapshot(pool: &SqlitePool, snapshot: &AgentVerification) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO agent_verification (
            agent_kind, cli_path, cli_source, cli_version, cli_checked_at,
            adapter_path, adapter_source, adapter_version, adapter_checked_at,
            installation, availability, availability_error, availability_checked_at,
            authentication, auth_checked_at, verified_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
         ON CONFLICT (agent_kind) DO UPDATE SET
            cli_path = excluded.cli_path,
            cli_source = excluded.cli_source,
            cli_version = excluded.cli_version,
            cli_checked_at = excluded.cli_checked_at,
            adapter_path = excluded.adapter_path,
            adapter_source = excluded.adapter_source,
            adapter_version = excluded.adapter_version,
            adapter_checked_at = excluded.adapter_checked_at,
            installation = excluded.installation,
            availability = excluded.availability,
            availability_error = excluded.availability_error,
            availability_checked_at = excluded.availability_checked_at,
            authentication = excluded.authentication,
            auth_checked_at = excluded.auth_checked_at,
            verified_at = excluded.verified_at",
    )
    .bind(&snapshot.agent_kind)
    .bind(&snapshot.cli_path)
    .bind(&snapshot.cli_source)
    .bind(&snapshot.cli_version)
    .bind(&snapshot.cli_checked_at)
    .bind(&snapshot.adapter_path)
    .bind(&snapshot.adapter_source)
    .bind(&snapshot.adapter_version)
    .bind(&snapshot.adapter_checked_at)
    .bind(serde_json::to_string(&snapshot.installation).map_err(|error| error.to_string())?)
    .bind(snapshot.availability)
    .bind(&snapshot.availability_error)
    .bind(&snapshot.availability_checked_at)
    .bind(serde_json::to_string(&snapshot.authentication).map_err(|error| error.to_string())?)
    .bind(&snapshot.auth_checked_at)
    .bind(&snapshot.verified_at)
    .execute(pool)
    .await
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub async fn load_snapshot(
    pool: &SqlitePool,
    agent_kind: &str,
) -> Result<Option<AgentVerification>, String> {
    type Row = (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        Option<bool>,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
    );
    let row: Option<Row> = sqlx::query_as(
        "SELECT agent_kind, cli_path, cli_source, cli_version, cli_checked_at,
                adapter_path, adapter_source, adapter_version, adapter_checked_at,
                installation, availability, availability_error, availability_checked_at,
                authentication, auth_checked_at, verified_at
         FROM agent_verification WHERE agent_kind = ?1",
    )
    .bind(agent_kind)
    .fetch_optional(pool)
    .await
    .map_err(|error| error.to_string())?;

    row.map(
        |(
            agent_kind,
            cli_path,
            cli_source,
            cli_version,
            cli_checked_at,
            adapter_path,
            adapter_source,
            adapter_version,
            adapter_checked_at,
            installation,
            availability,
            availability_error,
            availability_checked_at,
            authentication,
            auth_checked_at,
            verified_at,
        )| {
            Ok(AgentVerification {
                agent_kind,
                cli_path,
                cli_source,
                cli_version,
                cli_checked_at,
                adapter_path,
                adapter_source,
                adapter_version,
                adapter_checked_at,
                installation: serde_json::from_str(&installation)
                    .map_err(|error| error.to_string())?,
                availability,
                availability_error,
                availability_checked_at,
                authentication: serde_json::from_str(&authentication)
                    .map_err(|error| error.to_string())?,
                auth_checked_at,
                verified_at,
            })
        },
    )
    .transpose()
}

pub async fn invalidate(pool: &SqlitePool, agent_kind: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM agent_verification WHERE agent_kind = ?1")
        .bind(agent_kind)
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::probe::AuthenticationState;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE agent_verification (
                agent_kind TEXT PRIMARY KEY,
                cli_path TEXT,
                cli_source TEXT,
                cli_version TEXT,
                cli_checked_at TEXT,
                adapter_path TEXT,
                adapter_source TEXT,
                adapter_version TEXT,
                adapter_checked_at TEXT,
                installation TEXT NOT NULL,
                availability INTEGER,
                availability_error TEXT,
                availability_checked_at TEXT,
                authentication TEXT NOT NULL,
                auth_checked_at TEXT,
                verified_at TEXT
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn a_stored_verification_survives_a_reload_at_the_same_path() {
        let pool = pool().await;
        store(&pool, "codex", "/bin/codex-acp", true).await.unwrap();

        let record = load(&pool, "codex", "/bin/codex-acp")
            .await
            .unwrap()
            .expect("a record");
        assert!(record.authenticated);
    }

    #[tokio::test]
    async fn a_record_at_a_different_path_is_not_returned() {
        let pool = pool().await;
        store(&pool, "codex", "/bin/codex-acp", true).await.unwrap();

        // A fresh install landed somewhere else — the stale record for the
        // old path must not silently apply to the new one.
        let record = load(&pool, "codex", "/opt/new/codex-acp").await.unwrap();
        assert!(record.is_none());
    }

    #[tokio::test]
    async fn storing_again_replaces_rather_than_duplicates() {
        let pool = pool().await;
        store(&pool, "codex", "/bin/codex-acp", false)
            .await
            .unwrap();
        store(&pool, "codex", "/bin/codex-acp", true).await.unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM agent_verification")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);

        let record = load(&pool, "codex", "/bin/codex-acp")
            .await
            .unwrap()
            .unwrap();
        assert!(record.authenticated);
    }

    #[tokio::test]
    async fn codex_and_claude_records_do_not_collide() {
        let pool = pool().await;
        store(&pool, "codex", "/bin/codex-acp", true).await.unwrap();
        store(&pool, "claude-code", "/bin/claude-agent-acp", false)
            .await
            .unwrap();

        assert!(
            load(&pool, "codex", "/bin/codex-acp")
                .await
                .unwrap()
                .unwrap()
                .authenticated
        );
        assert!(
            !load(&pool, "claude-code", "/bin/claude-agent-acp")
                .await
                .unwrap()
                .unwrap()
                .authenticated
        );
    }

    #[tokio::test]
    async fn complete_snapshot_round_trips_every_axis_and_timestamp() {
        let pool = pool().await;
        let snapshot = AgentVerification {
            agent_kind: "codex".into(),
            cli_path: Some("/bin/codex".into()),
            cli_source: Some("path-lookup".into()),
            cli_version: Some("1.2.3".into()),
            cli_checked_at: Some("2026-07-28T10:00:00Z".into()),
            adapter_path: Some("/bin/codex-acp".into()),
            adapter_source: Some("path-lookup".into()),
            adapter_version: Some("1.1.7".into()),
            adapter_checked_at: Some("2026-07-28T10:00:00Z".into()),
            installation: InstallationState::Available,
            availability: Some(true),
            availability_error: None,
            availability_checked_at: Some("2026-07-28T10:00:01Z".into()),
            authentication: AuthenticationState::LoggedIn,
            auth_checked_at: Some("2026-07-28T10:00:01Z".into()),
            verified_at: Some("2026-07-28T10:00:02Z".into()),
        };

        store_snapshot(&pool, &snapshot).await.unwrap();
        assert_eq!(load_snapshot(&pool, "codex").await.unwrap(), Some(snapshot));
    }

    #[tokio::test]
    async fn explicit_invalidation_makes_the_availability_cache_cold() {
        let pool = pool().await;
        store(&pool, "codex", "/bin/codex-acp", true).await.unwrap();

        invalidate(&pool, "codex").await.unwrap();

        assert!(load_snapshot(&pool, "codex").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn forward_migration_preserves_an_existing_ready_record() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE agent_verification (
                agent_kind TEXT PRIMARY KEY,
                adapter_path TEXT NOT NULL,
                authenticated INTEGER NOT NULL,
                verified_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO agent_verification VALUES (
                'codex', '/bin/codex-acp', 1, '2026-07-28T10:00:00Z'
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::raw_sql(include_str!(
            "../db/migrations/20260728001000_agent_verification_snapshot.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();

        let record = load_snapshot(&pool, "codex").await.unwrap().unwrap();
        assert_eq!(record.availability, Some(true));
        assert_eq!(record.authentication, AuthenticationState::LoggedIn);
    }
}
