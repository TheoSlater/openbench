use crate::startup_log;
use sqlx::{sqlite::SqliteConnectOptions, sqlite::SqlitePoolOptions, Row, SqlitePool};
use std::time::Duration;
use tauri::{AppHandle, Manager, Runtime};

/// Opens local SQLite file, builds shared pool, runs bundled migrations.
pub async fn init_db<R: Runtime>(app: &AppHandle<R>) -> Result<SqlitePool, String> {
    startup_log::log_phase("database app data lookup");
    let app_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    startup_log::log_phase(format!("database app data dir: {}", app_dir.display()));
    std::fs::create_dir_all(&app_dir).map_err(|e| {
        format!(
            "failed to create app data directory {}: {e}",
            app_dir.display()
        )
    })?;

    let db_path = app_dir.join("chat.db");
    startup_log::log_phase(format!("database path: {}", db_path.display()));

    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .busy_timeout(Duration::from_secs(10))
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .map_err(|e| format!("failed to open SQLite database {}: {e}", db_path.display()))?;

    startup_log::log_phase("database core schema");
    ensure_conversations_schema(&pool).await?;
    ensure_folders_schema(&pool).await?;
    startup_log::log_phase("database migrations");
    run_migrations(&pool).await?;
    startup_log::log_phase("database migrations complete");

    // Remove stale rows from earlier provider types.
    sqlx::query("DELETE FROM provider_configs WHERE provider_type NOT IN ('OllamaLocal', 'OpenAICompatible', 'AnthropicNative', 'GeminiNative')")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    ensure_default_provider_configs(&pool, "").await?;

    Ok(pool)
}

pub async fn ensure_default_provider_configs(
    pool: &SqlitePool,
    account_id: &str,
) -> Result<(), String> {
    let account_id = normalize_provider_account_id(account_id);

    sqlx::query(
        r#"
        INSERT INTO provider_configs (account_id, provider_type, enabled, ollama_host, priority)
        SELECT ?1, 'OllamaLocal', 1, 'http://127.0.0.1:11434', 0
        WHERE NOT EXISTS (
            SELECT 1 FROM provider_configs
            WHERE account_id = ?1 AND provider_type = 'OllamaLocal'
        )
        "#,
    )
    .bind(&account_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        INSERT INTO provider_configs (account_id, provider_type, enabled, api_base_url, priority)
        SELECT ?1, 'OpenAICompatible', 0, 'https://api.openai.com/v1', 1
        WHERE NOT EXISTS (
            SELECT 1 FROM provider_configs
            WHERE account_id = ?1
              AND provider_type = 'OpenAICompatible'
              AND api_base_url = 'https://api.openai.com/v1'
        )
        "#,
    )
    .bind(&account_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        INSERT INTO provider_configs (account_id, provider_type, enabled, api_base_url, priority)
        SELECT ?1, 'AnthropicNative', 0, 'https://api.anthropic.com/v1', 2
        WHERE NOT EXISTS (
            SELECT 1 FROM provider_configs
            WHERE account_id = ?1
              AND provider_type = 'AnthropicNative'
              AND api_base_url = 'https://api.anthropic.com/v1'
        )
        "#,
    )
    .bind(&account_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        INSERT INTO provider_configs (account_id, provider_type, enabled, api_base_url, priority)
        SELECT ?1, 'GeminiNative', 0, 'https://generativelanguage.googleapis.com/v1beta', 3
        WHERE NOT EXISTS (
            SELECT 1 FROM provider_configs
            WHERE account_id = ?1
              AND provider_type = 'GeminiNative'
              AND api_base_url = 'https://generativelanguage.googleapis.com/v1beta'
        )
        "#,
    )
    .bind(&account_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

pub fn normalize_provider_account_id(account_id: &str) -> String {
    account_id.trim().to_string()
}

async fn ensure_conversations_schema(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT,
            createdAt TEXT,
            updatedAt TEXT,
            isArchived INTEGER DEFAULT 0,
            userId TEXT DEFAULT '',
            folderId TEXT,
            metadata TEXT
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let has_folder_id = sqlx::query(
        "SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name = 'folderId'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?
    .get::<i64, _>(0)
        > 0;

    if !has_folder_id {
        sqlx::query("ALTER TABLE conversations ADD COLUMN folderId TEXT")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    let has_metadata = sqlx::query(
        "SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name = 'metadata'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?
    .get::<i64, _>(0)
        > 0;

    if !has_metadata {
        sqlx::query("ALTER TABLE conversations ADD COLUMN metadata TEXT")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversationId TEXT,
            role TEXT,
            content TEXT,
            createdAt TEXT,
            attachments TEXT,
            model TEXT,
            provider TEXT,
            thinking TEXT,
            thinkingDuration REAL,
            webSearch TEXT,
            status TEXT,
            errorMessage TEXT,
            memoryUpdates TEXT
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let has_websearch =
        sqlx::query("SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'webSearch'")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?
            .get::<i64, _>(0)
            > 0;

    if !has_websearch {
        sqlx::query("ALTER TABLE messages ADD COLUMN webSearch TEXT")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    let has_provider =
        sqlx::query("SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'provider'")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?
            .get::<i64, _>(0)
            > 0;

    if !has_provider {
        sqlx::query("ALTER TABLE messages ADD COLUMN provider TEXT")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    let has_status =
        sqlx::query("SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'status'")
            .fetch_one(pool)
            .await
            .map_err(|e| e.to_string())?
            .get::<i64, _>(0)
            > 0;

    if !has_status {
        sqlx::query("ALTER TABLE messages ADD COLUMN status TEXT")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    let has_error_message = sqlx::query(
        "SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'errorMessage'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?
    .get::<i64, _>(0)
        > 0;

    if !has_error_message {
        sqlx::query("ALTER TABLE messages ADD COLUMN errorMessage TEXT")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    let has_memory_updates = sqlx::query(
        "SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name = 'memoryUpdates'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?
    .get::<i64, _>(0)
        > 0;

    if !has_memory_updates {
        // JSON array of memory summaries shown in the "Memory updated" chip
        sqlx::query("ALTER TABLE messages ADD COLUMN memoryUpdates TEXT")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversationId)")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(createdAt)")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updatedAt)")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(isArchived)",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(userId)")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn ensure_folders_schema(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parentId TEXT,
            backgroundImage TEXT,
            systemPrompt TEXT,
            contextFiles TEXT,
            userId TEXT DEFAULT '',
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    for column in [
        "parentId TEXT",
        "backgroundImage TEXT",
        "systemPrompt TEXT",
        "contextFiles TEXT",
        "userId TEXT DEFAULT ''",
    ] {
        let name = column
            .split_whitespace()
            .next()
            .ok_or_else(|| format!("invalid folders schema column definition: {column}"))?;
        let exists =
            sqlx::query("SELECT COUNT(*) FROM pragma_table_info('folders') WHERE name = ?")
                .bind(name)
                .fetch_one(pool)
                .await
                .map_err(|e| e.to_string())?
                .get::<i64, _>(0)
                > 0;

        if !exists {
            sqlx::query(&format!("ALTER TABLE folders ADD COLUMN {column}"))
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(userId)")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    fix_migration_checksums(pool).await?;
    startup_log::log_phase("database embedded migrations");
    let migrator = sqlx::migrate!("./src/db/migrations");
    migrator.run(pool).await.map_err(|e| e.to_string())
}

/// Before running sqlx migrations, reconcile checksums in `_sqlx_migrations`
/// against the actual migration files on disk. This prevents panics when a
/// migration file is modified after being applied (common during development).
async fn fix_migration_checksums(pool: &SqlitePool) -> Result<(), String> {
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let migrations_dir = manifest_dir.join("src/db/migrations");
    fix_migration_checksums_from_dir(pool, &migrations_dir).await
}

async fn fix_migration_checksums_from_dir(
    pool: &SqlitePool,
    migrations_dir: &std::path::Path,
) -> Result<(), String> {
    let has_table: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE name = '_sqlx_migrations' AND type = 'table'",
    )
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    if !has_table {
        return Ok(());
    }

    if !migrations_dir.is_dir() {
        startup_log::log_phase(format!(
            "migration checksum repair skipped: source dir missing: {}",
            migrations_dir.display()
        ));
        return Ok(());
    }

    let rows = sqlx::query("SELECT version, checksum FROM _sqlx_migrations ORDER BY version")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let applied: Vec<(i64, Vec<u8>)> = rows
        .iter()
        .map(|row| (row.get::<i64, _>(0), row.get::<Vec<u8>, _>(1)))
        .collect();

    let mut read_dir = std::fs::read_dir(migrations_dir).map_err(|e| e.to_string())?;

    while let Some(entry) = read_dir.next().transpose().map_err(|e| e.to_string())? {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("sql") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("Invalid migration filename")?;
        let version_str = stem.split('_').next().ok_or("Missing version prefix")?;
        let version: i64 = version_str
            .parse()
            .map_err(|e| format!("Bad version: {e}"))?;

        if let Some((_, stored_checksum)) = applied.iter().find(|(v, _)| *v == version) {
            let content = std::fs::read(&path).map_err(|e| e.to_string())?;
            use sha2::Digest;
            let computed = sha2::Sha384::digest(&content).to_vec();
            if computed != *stored_checksum {
                sqlx::query("UPDATE _sqlx_migrations SET checksum = ?1 WHERE version = ?2")
                    .bind(&computed)
                    .bind(version)
                    .execute(pool)
                    .await
                    .map_err(|e| e.to_string())?;
                log::info!("Fixed checksum for migration v{version}");
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn default_provider_configs_seed_per_account() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query(
            r#"
            CREATE TABLE provider_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL DEFAULT '',
                provider_type TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                ollama_host TEXT,
                ollama_api_key TEXT,
                ollama_api_base_url TEXT,
                api_key TEXT,
                api_base_url TEXT,
                preset TEXT,
                headers TEXT,
                model_suggestions TEXT,
                priority INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();

        ensure_default_provider_configs(&pool, "account-a")
            .await
            .unwrap();
        ensure_default_provider_configs(&pool, "account-a")
            .await
            .unwrap();

        let account_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM provider_configs WHERE account_id = 'account-a'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(account_count, 4);
    }

    #[tokio::test]
    async fn checksum_repair_skips_missing_source_migration_dir() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();

        sqlx::query(
            r#"
            CREATE TABLE _sqlx_migrations (
                version INTEGER PRIMARY KEY,
                checksum BLOB NOT NULL
            )
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO _sqlx_migrations (version, checksum) VALUES (1, ?1)")
            .bind(vec![1_u8, 2, 3])
            .execute(&pool)
            .await
            .unwrap();

        let missing_dir = std::env::temp_dir().join(format!(
            "polyui-missing-migrations-{}",
            uuid::Uuid::new_v4()
        ));
        assert!(!missing_dir.exists());

        fix_migration_checksums_from_dir(&pool, &missing_dir)
            .await
            .unwrap();
    }
}
