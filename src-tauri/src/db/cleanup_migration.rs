use super::rework_migration::MigrationReport;
use sqlx::SqlitePool;

const DATA_MIGRATION_VERSION: i64 = 20260727000000;
const CLEANUP_VERSION: i64 = 20260728000000;

#[derive(Debug, PartialEq, Eq)]
pub enum CleanupOutcome {
    Applied,
    AlreadyApplied,
    Deferred,
}

pub async fn run(pool: &SqlitePool, report: &MigrationReport) -> Result<CleanupOutcome, String> {
    let legacy_exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM sqlite_master
         WHERE type = 'table' AND name = 'provider_configs'",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| error.to_string())?;
    if !legacy_exists {
        return Ok(CleanupOutcome::AlreadyApplied);
    }
    if report.secrets_failed > 0 || report.rows_skipped > 0 {
        return Ok(CleanupOutcome::Deferred);
    }

    let data_migration_applied: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM _sqlx_migrations
         WHERE version = ?1 AND success = 1",
    )
    .bind(DATA_MIGRATION_VERSION)
    .fetch_one(pool)
    .await
    .map_err(|error| error.to_string())?;
    if !data_migration_applied {
        return Err("runtime data migration is not recorded as applied".into());
    }

    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS runtime_cleanup_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
    )
    .execute(&mut *transaction)
    .await
    .map_err(|error| error.to_string())?;
    sqlx::query("DROP TABLE provider_configs")
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("INSERT OR IGNORE INTO runtime_cleanup_migrations (version) VALUES (?1)")
        .bind(CLEANUP_VERSION)
        .execute(&mut *transaction)
        .await
        .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())?;

    Ok(CleanupOutcome::Applied)
}
