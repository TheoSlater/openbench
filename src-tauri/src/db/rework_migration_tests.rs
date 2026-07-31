//! Migration tests against fixture databases.
//!
//! Each fixture builds the pre-rework schema by hand, applies the rework SQL,
//! then runs the data migration — the same order as a real upgrade.

use crate::connections::repository;
use crate::connections::secrets::{InMemorySecretStore, SecretRef, SecretStore};
use crate::connections::{ConnectionHealth, ConnectionHealthStatus, Provider};
use crate::db::cleanup_migration::{self, CleanupOutcome};
use crate::db::rework_migration::{self, MigrationReport};
use crate::runtime::{RuntimeKind, RuntimeRef, UnresolvedReason};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::{Row, SqlitePool};

/// The pre-rework schema, as `db::connection` and the shipped migrations leave
/// it. Only the tables the migration reads.
async fn legacy_database() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("open in-memory database");

    sqlx::query(
        r"
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
        ",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r"
        CREATE TABLE conversations (
            id TEXT PRIMARY KEY,
            title TEXT,
            createdAt TEXT,
            updatedAt TEXT,
            isArchived INTEGER DEFAULT 0,
            userId TEXT DEFAULT '',
            folderId TEXT,
            metadata TEXT
        )
        ",
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r"
        CREATE TABLE messages (
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
        )
        ",
    )
    .execute(&pool)
    .await
    .unwrap();

    pool
}

/// Apply the rework SQL migration. Mirrors the shipped file; kept here rather
/// than read from disk so the test does not depend on the source tree being
/// present, matching how `fix_migration_checksums` already has to behave.
async fn apply_rework_schema(pool: &SqlitePool) {
    let statements = include_str!("migrations/20260727000000_runtime_rework.sql");
    for statement in split_sql(statements) {
        sqlx::query(&statement)
            .execute(pool)
            .await
            .unwrap_or_else(|error| panic!("failed to apply: {statement}\n{error}"));
    }
}

/// Split on `;` at statement level, keeping `BEGIN … END` trigger bodies whole.
fn split_sql(source: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut in_trigger = false;

    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("--") {
            continue;
        }
        current.push_str(line);
        current.push('\n');

        if trimmed.to_ascii_uppercase().starts_with("CREATE TRIGGER") {
            in_trigger = true;
        }
        if in_trigger {
            if trimmed.eq_ignore_ascii_case("END;") {
                in_trigger = false;
                statements.push(std::mem::take(&mut current));
            }
            continue;
        }
        if trimmed.ends_with(';') {
            statements.push(std::mem::take(&mut current));
        }
    }

    statements
}

#[allow(clippy::too_many_arguments)]
async fn insert_provider(
    pool: &SqlitePool,
    account_id: &str,
    provider_type: &str,
    enabled: bool,
    ollama_host: Option<&str>,
    api_key: Option<&str>,
    api_base_url: Option<&str>,
    preset: Option<&str>,
    model_suggestions: Option<&str>,
) {
    sqlx::query(
        r"
        INSERT INTO provider_configs
            (account_id, provider_type, enabled, ollama_host, api_key,
             api_base_url, preset, model_suggestions, priority)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)
        ",
    )
    .bind(account_id)
    .bind(provider_type)
    .bind(i64::from(enabled))
    .bind(ollama_host)
    .bind(api_key)
    .bind(api_base_url)
    .bind(preset)
    .bind(model_suggestions)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_conversation(pool: &SqlitePool, id: &str, account_id: &str) {
    sqlx::query(
        "INSERT INTO conversations (id, title, createdAt, updatedAt, isArchived, userId)
         VALUES (?1, 'Chat', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0, ?2)",
    )
    .bind(id)
    .bind(account_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_assistant_message(
    pool: &SqlitePool,
    id: &str,
    conversation_id: &str,
    provider: Option<&str>,
    model: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO messages (id, conversationId, role, content, createdAt, model, provider)
         VALUES (?1, ?2, 'assistant', 'hi', '2026-01-02T00:00:00Z', ?3, ?4)",
    )
    .bind(id)
    .bind(conversation_id)
    .bind(model)
    .bind(provider)
    .execute(pool)
    .await
    .unwrap();
}

async fn migrate(pool: &SqlitePool, store: &InMemorySecretStore) -> MigrationReport {
    rework_migration::run(pool, store).await.expect("migration")
}

/// The shipped migration, applied by the real sqlx migrator rather than by the
/// test-only splitter above.
///
/// `apply_rework_schema` splits statements itself, which could hide a file that
/// sqlx cannot run as one batch — the trigger body is the risk, since it
/// contains its own semicolons. This test is the one that would catch that.
#[tokio::test]
async fn the_shipped_sql_migration_applies_through_sqlx() {
    let pool = legacy_database().await;

    sqlx::migrate!("./src/db/migrations")
        .run(&pool)
        .await
        .expect("shipped migrations apply");

    let store = InMemorySecretStore::new();
    let report = rework_migration::run(&pool, &store)
        .await
        .expect("migration");

    // `20260509000000_create_provider_configs.sql` seeds a default Ollama row
    // and a default OpenAI row, so a genuinely fresh install already has two
    // provider configs to carry across. Both endpoints are the provider
    // defaults, so both collapse to a NULL base_url.
    assert_eq!(report.connections_created, 2);
    assert_eq!(report.secrets_moved, 0);
    let mut providers: Vec<Provider> = repository::list_connections(&pool, "")
        .await
        .unwrap()
        .iter()
        .inspect(|connection| assert_eq!(connection.base_url, None))
        .map(|connection| connection.provider)
        .collect();
    providers.sort_by_key(|provider| provider.as_str());
    assert_eq!(providers, vec![Provider::Ollama, Provider::Openai]);

    // The trigger survived the batch and is enforcing.
    insert_conversation(&pool, "conv", "acct").await;
    repository::set_conversation_runtime(
        &pool,
        "conv",
        &RuntimeRef::ChatModel {
            connection_id: "conn".into(),
            model_id: "gpt-5".into(),
        },
    )
    .await
    .unwrap();
    let error = sqlx::query("UPDATE conversations SET runtime_kind = 'coding-agent' WHERE id = ?1")
        .bind("conv")
        .execute(&pool)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("immutable"), "{error}");
}

#[tokio::test]
async fn cleanup_drops_legacy_provider_table_after_original_schema_upgrade() {
    let pool = legacy_database().await;
    sqlx::migrate!("./src/db/migrations")
        .run(&pool)
        .await
        .expect("shipped migrations apply");
    let store = InMemorySecretStore::new();
    let report = migrate(&pool, &store).await;

    assert_eq!(
        cleanup_migration::run(&pool, &report).await.unwrap(),
        CleanupOutcome::Applied
    );
    let legacy_exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM sqlite_master
         WHERE type = 'table' AND name = 'provider_configs'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!legacy_exists);
    assert_eq!(
        cleanup_migration::run(&pool, &MigrationReport::default())
            .await
            .unwrap(),
        CleanupOutcome::AlreadyApplied
    );
    assert!(!repository::list_connections(&pool, "")
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn cleanup_defers_when_a_legacy_row_was_not_migrated() {
    let pool = legacy_database().await;
    sqlx::migrate!("./src/db/migrations")
        .run(&pool)
        .await
        .unwrap();
    insert_provider(
        &pool,
        "acct",
        "PolyAgent",
        true,
        None,
        None,
        None,
        None,
        None,
    )
    .await;
    let store = InMemorySecretStore::new();
    let report = migrate(&pool, &store).await;
    assert_eq!(report.rows_skipped, 1);
    assert_eq!(
        cleanup_migration::run(&pool, &report).await.unwrap(),
        CleanupOutcome::Deferred
    );
}

/// Running the shipped migrator twice must not fail on the unguarded
/// `ALTER TABLE` statements — `_sqlx_migrations` is what makes them safe.
#[tokio::test]
async fn the_shipped_sql_migration_is_not_reapplied() {
    let pool = legacy_database().await;
    let migrator = sqlx::migrate!("./src/db/migrations");

    migrator.run(&pool).await.expect("first run");
    migrator.run(&pool).await.expect("second run is a no-op");
}

#[tokio::test]
async fn connection_health_persists_and_connection_delete_cascades_models() {
    let pool = legacy_database().await;
    sqlx::migrate!("./src/db/migrations")
        .run(&pool)
        .await
        .unwrap();
    let store = InMemorySecretStore::new();
    migrate(&pool, &store).await;
    let connection = repository::list_connections(&pool, "")
        .await
        .unwrap()
        .into_iter()
        .next()
        .unwrap();

    repository::record_connection_health(
        &pool,
        &connection.id,
        ConnectionHealthStatus::Ready,
        "Connected.",
        "2026-07-27T12:00:00Z",
    )
    .await
    .unwrap();
    assert_eq!(
        repository::get_connection_health(&pool, &connection.id)
            .await
            .unwrap(),
        ConnectionHealth {
            status: ConnectionHealthStatus::Ready,
            detail: Some("Connected.".into()),
            last_validated_at: Some("2026-07-27T12:00:00Z".into()),
        }
    );

    repository::delete_connection(&pool, &connection.id)
        .await
        .unwrap();
    assert!(repository::get_connection(&pool, &connection.id)
        .await
        .unwrap()
        .is_none());
    assert!(repository::list_models(&pool, &connection.id)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn recent_runtimes_are_unique_and_ordered_by_conversation_activity() {
    let pool = legacy_database().await;
    sqlx::migrate!("./src/db/migrations")
        .run(&pool)
        .await
        .unwrap();
    for (id, updated_at, model) in [
        ("old", "2026-07-27T10:00:00Z", "gpt-5"),
        ("new", "2026-07-27T12:00:00Z", "claude-sonnet"),
        ("duplicate", "2026-07-27T11:00:00Z", "gpt-5"),
    ] {
        insert_conversation(&pool, id, "acct").await;
        sqlx::query("UPDATE conversations SET updatedAt = ?1 WHERE id = ?2")
            .bind(updated_at)
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        repository::set_conversation_runtime(
            &pool,
            id,
            &RuntimeRef::ChatModel {
                connection_id: "conn".into(),
                model_id: model.into(),
            },
        )
        .await
        .unwrap();
    }

    let recent = repository::list_recent_runtimes(&pool, "acct", 10)
        .await
        .unwrap();
    assert_eq!(recent.len(), 2);
    assert!(matches!(
        &recent[0],
        RuntimeRef::ChatModel { model_id, .. } if model_id == "claude-sonnet"
    ));
    assert!(matches!(
        &recent[1],
        RuntimeRef::ChatModel { model_id, .. } if model_id == "gpt-5"
    ));
}

#[tokio::test]
async fn empty_install_migrates_to_nothing() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    let report = migrate(&pool, &store).await;

    assert_eq!(report, MigrationReport::default());
    assert!(repository::list_connections(&pool, "")
        .await
        .unwrap()
        .is_empty());
    assert!(store.is_empty());
}

#[tokio::test]
async fn single_provider_becomes_one_connection_with_a_keychain_reference() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    insert_provider(
        &pool,
        "acct",
        "AnthropicNative",
        true,
        None,
        Some("sk-ant-secret"),
        Some("https://api.anthropic.com/v1"),
        None,
        None,
    )
    .await;

    let report = migrate(&pool, &store).await;
    assert_eq!(report.connections_created, 1);
    assert_eq!(report.secrets_moved, 1);
    assert_eq!(report.secrets_failed, 0);

    let connections = repository::list_connections(&pool, "acct").await.unwrap();
    assert_eq!(connections.len(), 1);
    let connection = &connections[0];
    assert_eq!(connection.provider, Provider::Anthropic);
    // The endpoint was the provider default, so it collapses to None.
    assert_eq!(connection.base_url, None);
    assert!(connection.enabled);

    let reference = connection.secret_ref.clone().expect("secret reference");
    assert_eq!(store.get(&reference).unwrap().expose(), "sk-ant-secret");

    // The credential is gone from the row that the frontend can read.
    let stored_ref: Option<String> =
        sqlx::query_scalar("SELECT secret_ref FROM connections WHERE id = ?1")
            .bind(&connection.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_ref.as_deref(), Some(reference.as_str()));
    assert!(!stored_ref.unwrap().contains("sk-ant"));
}

#[tokio::test]
async fn multiple_providers_each_become_their_own_connection() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    insert_provider(
        &pool,
        "acct",
        "OllamaLocal",
        true,
        Some("http://127.0.0.1:11434"),
        None,
        None,
        None,
        None,
    )
    .await;
    insert_provider(
        &pool,
        "acct",
        "AnthropicNative",
        false,
        None,
        Some("sk-a"),
        None,
        None,
        None,
    )
    .await;
    insert_provider(
        &pool,
        "acct",
        "GeminiNative",
        true,
        None,
        Some("sk-g"),
        None,
        None,
        None,
    )
    .await;
    insert_provider(
        &pool,
        "acct",
        "OpenAICompatible",
        true,
        None,
        Some("sk-or"),
        Some("https://openrouter.ai/api/v1"),
        Some("openrouter"),
        None,
    )
    .await;

    let report = migrate(&pool, &store).await;
    assert_eq!(report.connections_created, 4);
    // Ollama has no key; the other three do.
    assert_eq!(report.secrets_moved, 3);

    let mut providers: Vec<Provider> = repository::list_connections(&pool, "acct")
        .await
        .unwrap()
        .iter()
        .map(|connection| connection.provider)
        .collect();
    providers.sort_by_key(|provider| provider.as_str());
    assert_eq!(
        providers,
        vec![
            Provider::Anthropic,
            Provider::Gemini,
            Provider::Ollama,
            Provider::Openrouter,
        ]
    );

    // The disabled provider stays disabled.
    let anthropic = repository::list_connections(&pool, "acct")
        .await
        .unwrap()
        .into_iter()
        .find(|connection| connection.provider == Provider::Anthropic)
        .unwrap();
    assert!(!anthropic.enabled);
}

#[tokio::test]
async fn custom_base_url_is_preserved_and_keeps_its_own_connection() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    insert_provider(
        &pool,
        "acct",
        "OpenAICompatible",
        true,
        None,
        Some("sk-1"),
        Some("https://api.openai.com/v1"),
        Some("openai"),
        None,
    )
    .await;
    insert_provider(
        &pool,
        "acct",
        "OpenAICompatible",
        true,
        None,
        Some("sk-2"),
        Some("https://llm.internal.test/v1"),
        Some("custom"),
        None,
    )
    .await;

    let report = migrate(&pool, &store).await;
    assert_eq!(report.connections_created, 2);

    let connections = repository::list_connections(&pool, "acct").await.unwrap();
    let custom = connections
        .iter()
        .find(|connection| connection.provider == Provider::OpenaiCompatible)
        .expect("custom endpoint connection");
    assert_eq!(
        custom.base_url.as_deref(),
        Some("https://llm.internal.test/v1")
    );
    assert_eq!(custom.effective_base_url(), "https://llm.internal.test/v1");

    let openai = connections
        .iter()
        .find(|connection| connection.provider == Provider::Openai)
        .expect("openai connection");
    assert_eq!(openai.base_url, None);
    assert_eq!(openai.effective_base_url(), "https://api.openai.com/v1");
}

#[tokio::test]
async fn conversation_referencing_a_deleted_model_is_marked_unresolved() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    // The connection knows about gpt-4o only.
    insert_provider(
        &pool,
        "acct",
        "OpenAICompatible",
        true,
        None,
        Some("sk-1"),
        Some("https://api.openai.com/v1"),
        Some("openai"),
        Some(r#"["gpt-4o"]"#),
    )
    .await;

    insert_conversation(&pool, "conv-live", "acct").await;
    insert_assistant_message(
        &pool,
        "m1",
        "conv-live",
        Some("OpenAICompatible"),
        Some("gpt-4o"),
    )
    .await;

    insert_conversation(&pool, "conv-dead", "acct").await;
    insert_assistant_message(
        &pool,
        "m2",
        "conv-dead",
        Some("OpenAICompatible"),
        Some("gpt-4-turbo"),
    )
    .await;

    let report = migrate(&pool, &store).await;
    assert_eq!(report.models_created, 1);
    assert_eq!(report.conversations_resolved, 1);
    assert_eq!(report.conversations_unresolved, 1);

    let live = repository::get_conversation_runtime(&pool, "conv-live")
        .await
        .unwrap()
        .expect("runtime");
    assert!(matches!(
        live,
        RuntimeRef::ChatModel { ref model_id, .. } if model_id == "gpt-4o"
    ));

    let dead = repository::get_conversation_runtime(&pool, "conv-dead")
        .await
        .unwrap()
        .expect("runtime");
    match dead {
        RuntimeRef::Unresolved {
            reason,
            legacy_provider,
            legacy_model,
        } => {
            assert_eq!(reason, UnresolvedReason::NoModel);
            assert_eq!(legacy_provider.as_deref(), Some("OpenAICompatible"));
            assert_eq!(legacy_model.as_deref(), Some("gpt-4-turbo"));
        }
        other => panic!("expected unresolved, got {other:?}"),
    }
}

#[tokio::test]
async fn conversations_without_a_usable_history_are_marked_not_defaulted() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    insert_provider(
        &pool,
        "acct",
        "OllamaLocal",
        true,
        None,
        None,
        None,
        None,
        None,
    )
    .await;

    insert_conversation(&pool, "conv-empty", "acct").await;

    insert_conversation(&pool, "conv-no-provider", "acct").await;
    insert_assistant_message(&pool, "m1", "conv-no-provider", None, Some("mystery")).await;

    insert_conversation(&pool, "conv-no-connection", "acct").await;
    insert_assistant_message(
        &pool,
        "m2",
        "conv-no-connection",
        Some("AnthropicNative"),
        Some("claude"),
    )
    .await;

    let report = migrate(&pool, &store).await;
    assert_eq!(report.conversations_resolved, 0);
    assert_eq!(report.conversations_unresolved, 3);

    for (id, expected) in [
        ("conv-empty", UnresolvedReason::NoHistory),
        ("conv-no-provider", UnresolvedReason::NoProviderRecorded),
        ("conv-no-connection", UnresolvedReason::NoConnection),
    ] {
        let runtime = repository::get_conversation_runtime(&pool, id)
            .await
            .unwrap()
            .expect("runtime");
        assert_eq!(runtime.kind(), RuntimeKind::Unresolved);
        match runtime {
            RuntimeRef::Unresolved { reason, .. } => assert_eq!(reason, expected, "{id}"),
            other => panic!("expected unresolved for {id}, got {other:?}"),
        }
    }
}

#[tokio::test]
async fn running_twice_changes_nothing_the_second_time() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    insert_provider(
        &pool,
        "acct",
        "OllamaLocal",
        true,
        Some("http://127.0.0.1:11434"),
        None,
        None,
        None,
        Some(r#"["llama3.2:3b"]"#),
    )
    .await;
    insert_provider(
        &pool,
        "acct",
        "AnthropicNative",
        true,
        None,
        Some("sk-ant"),
        None,
        None,
        None,
    )
    .await;
    insert_conversation(&pool, "conv-1", "acct").await;
    insert_assistant_message(
        &pool,
        "m1",
        "conv-1",
        Some("OllamaLocal"),
        Some("llama3.2:3b"),
    )
    .await;

    let first = migrate(&pool, &store).await;
    assert_eq!(first.connections_created, 2);
    assert_eq!(first.models_created, 1);
    assert_eq!(first.secrets_moved, 1);
    assert_eq!(first.conversations_resolved, 1);

    let before = repository::list_connections(&pool, "acct").await.unwrap();

    let second = migrate(&pool, &store).await;
    assert_eq!(second.connections_created, 0);
    assert_eq!(second.models_created, 0);
    assert_eq!(second.secrets_moved, 0);
    assert_eq!(second.conversations_resolved, 0);
    assert_eq!(second.conversations_unresolved, 0);
    assert_eq!(second.connections_reused, 2);

    let after = repository::list_connections(&pool, "acct").await.unwrap();
    assert_eq!(before, after);
    assert_eq!(store.len(), 1);
}

#[tokio::test]
async fn a_rerun_does_not_clobber_a_credential_the_user_has_since_changed() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    insert_provider(
        &pool,
        "acct",
        "AnthropicNative",
        true,
        None,
        Some("sk-old"),
        None,
        None,
        None,
    )
    .await;
    migrate(&pool, &store).await;

    let connection = repository::list_connections(&pool, "acct")
        .await
        .unwrap()
        .remove(0);
    let reference = connection.secret_ref.clone().unwrap();
    store
        .set(
            &reference,
            &crate::connections::secrets::Secret::new("sk-new"),
        )
        .unwrap();

    migrate(&pool, &store).await;

    assert_eq!(store.get(&reference).unwrap().expose(), "sk-new");
}

#[tokio::test]
async fn an_unavailable_keychain_disables_the_connection_rather_than_storing_plaintext() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::unavailable();

    insert_provider(
        &pool,
        "acct",
        "AnthropicNative",
        true,
        None,
        Some("sk-ant-secret"),
        None,
        None,
        None,
    )
    .await;

    let report = migrate(&pool, &store).await;
    assert_eq!(report.connections_created, 1);
    assert_eq!(report.secrets_moved, 0);
    assert_eq!(report.secrets_failed, 1);

    let connection = repository::list_connections(&pool, "acct")
        .await
        .unwrap()
        .remove(0);
    assert!(!connection.enabled, "connection must be disabled");
    assert_eq!(connection.secret_ref, None);

    // Nothing anywhere in the new schema holds the credential.
    let dump = dump_new_tables(&pool).await;
    assert!(!dump.contains("sk-ant-secret"), "{dump}");
}

#[tokio::test]
async fn empty_and_null_keys_are_treated_identically_as_no_credential() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    insert_provider(
        &pool,
        "a",
        "AnthropicNative",
        true,
        None,
        Some("   "),
        None,
        None,
        None,
    )
    .await;
    insert_provider(
        &pool,
        "b",
        "AnthropicNative",
        true,
        None,
        None,
        None,
        None,
        None,
    )
    .await;

    let report = migrate(&pool, &store).await;
    assert_eq!(report.secrets_moved, 0);
    assert!(store.is_empty());

    for account in ["a", "b"] {
        let connection = repository::list_connections(&pool, account)
            .await
            .unwrap()
            .remove(0);
        assert_eq!(connection.secret_ref, None);
        // No credential is not a failure, so the connection stays enabled.
        assert!(connection.enabled);
    }
}

#[tokio::test]
async fn duplicate_endpoints_collapse_into_one_connection() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    // Same endpoint spelled three ways: explicit, trailing slash, and implied.
    insert_provider(
        &pool,
        "acct",
        "OpenAICompatible",
        true,
        None,
        Some("sk-1"),
        Some("https://api.openai.com/v1"),
        Some("openai"),
        None,
    )
    .await;
    insert_provider(
        &pool,
        "acct",
        "OpenAICompatible",
        true,
        None,
        Some("sk-2"),
        Some("https://api.openai.com/v1/"),
        Some("openai"),
        None,
    )
    .await;
    insert_provider(
        &pool,
        "acct",
        "OpenAICompatible",
        true,
        None,
        Some("sk-3"),
        None,
        Some("openai"),
        None,
    )
    .await;

    let report = migrate(&pool, &store).await;
    assert_eq!(report.connections_created, 1);
    assert_eq!(report.connections_reused, 2);
    assert_eq!(
        repository::list_connections(&pool, "acct")
            .await
            .unwrap()
            .len(),
        1
    );
    // Only the first row's credential is taken; later rows see a secret_ref
    // already set and leave it alone.
    assert_eq!(store.len(), 1);
}

#[tokio::test]
async fn an_unknown_legacy_provider_type_is_skipped_not_dropped() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    insert_provider(
        &pool,
        "acct",
        "PolyAgent",
        true,
        None,
        Some("sk-x"),
        None,
        None,
        None,
    )
    .await;

    let report = migrate(&pool, &store).await;
    assert_eq!(report.connections_created, 0);

    // The legacy row is still there for a human to look at.
    let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM provider_configs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 1);
}

#[tokio::test]
async fn migration_requires_the_sql_migration_to_have_run() {
    let pool = legacy_database().await;
    let store = InMemorySecretStore::new();

    let error = rework_migration::run(&pool, &store).await.unwrap_err();
    assert!(error.contains("SQL migration did not run"), "{error}");

    // The old data is untouched, so the app still works on the old path.
    let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM provider_configs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 0);
}

#[tokio::test]
async fn runtime_family_cannot_change_in_place() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    insert_conversation(&pool, "conv", "acct").await;

    let chat = RuntimeRef::ChatModel {
        connection_id: "conn".into(),
        model_id: "gpt-5".into(),
    };
    repository::set_conversation_runtime(&pool, "conv", &chat)
        .await
        .unwrap();

    let agent = RuntimeRef::CodingAgent {
        installation_id: "inst".into(),
        agent_kind: crate::runtime::AgentKind::Codex,
        workspace_id: "ws".into(),
        agent_session_id: None,
    };
    let error = repository::set_conversation_runtime(&pool, "conv", &agent)
        .await
        .unwrap_err();
    assert!(error.contains("fork instead"), "{error}");

    // Unchanged.
    assert_eq!(
        repository::get_conversation_runtime(&pool, "conv")
            .await
            .unwrap(),
        Some(chat)
    );
}

#[tokio::test]
async fn the_database_trigger_blocks_a_family_change_that_bypasses_rust() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    insert_conversation(&pool, "conv", "acct").await;

    repository::set_conversation_runtime(
        &pool,
        "conv",
        &RuntimeRef::ChatModel {
            connection_id: "conn".into(),
            model_id: "gpt-5".into(),
        },
    )
    .await
    .unwrap();

    // The frontend writes conversations through tauri-plugin-sql directly, so
    // the rule has to hold at the database.
    let error = sqlx::query("UPDATE conversations SET runtime_kind = 'coding-agent' WHERE id = ?1")
        .bind("conv")
        .execute(&pool)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("immutable"), "{error}");
}

#[tokio::test]
async fn an_unresolved_conversation_can_be_answered() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    insert_conversation(&pool, "conv", "acct").await;

    repository::set_conversation_runtime(
        &pool,
        "conv",
        &RuntimeRef::Unresolved {
            reason: UnresolvedReason::NoConnection,
            legacy_provider: None,
            legacy_model: None,
        },
    )
    .await
    .unwrap();

    let answered = RuntimeRef::CodingAgent {
        installation_id: "inst".into(),
        agent_kind: crate::runtime::AgentKind::ClaudeCode,
        workspace_id: "ws".into(),
        agent_session_id: Some("s-1".into()),
    };
    repository::set_conversation_runtime(&pool, "conv", &answered)
        .await
        .unwrap();

    assert_eq!(
        repository::get_conversation_runtime(&pool, "conv")
            .await
            .unwrap(),
        Some(answered)
    );
}

#[tokio::test]
async fn legacy_default_model_resolves_for_every_provider_name() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    insert_provider(
        &pool,
        "acct",
        "AnthropicNative",
        true,
        None,
        Some("sk-a"),
        None,
        None,
        None,
    )
    .await;
    insert_provider(
        &pool,
        "acct",
        "OllamaLocal",
        true,
        None,
        None,
        None,
        None,
        None,
    )
    .await;
    migrate(&pool, &store).await;

    // The frontend parser rejects AnthropicNative outright, which is why this
    // default never applied before the rework.
    let resolved = rework_migration::resolve_legacy_model_choice(
        &pool,
        "acct",
        "AnthropicNative:claude-opus-5",
    )
    .await
    .unwrap()
    .expect("resolved");
    match resolved {
        RuntimeRef::ChatModel { model_id, .. } => assert_eq!(model_id, "claude-opus-5"),
        other => panic!("expected chat model, got {other:?}"),
    }

    // `Provider:configId:model`, with the model percent-encoded.
    let with_config_id =
        rework_migration::resolve_legacy_model_choice(&pool, "acct", "OllamaLocal:7:llama3.2%3A3b")
            .await
            .unwrap()
            .expect("resolved");
    match with_config_id {
        RuntimeRef::ChatModel { model_id, .. } => assert_eq!(model_id, "llama3.2:3b"),
        other => panic!("expected chat model, got {other:?}"),
    }
}

#[tokio::test]
async fn an_unresolvable_legacy_default_returns_none_rather_than_a_guess() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;

    for stored in ["", "   ", "no-separator", "GeminiNative:gemini-3-pro"] {
        assert_eq!(
            rework_migration::resolve_legacy_model_choice(&pool, "acct", stored)
                .await
                .unwrap(),
            None,
            "{stored}"
        );
    }
}

/// Everything the new schema holds, as one string. Used to assert that no
/// credential material landed anywhere.
async fn dump_new_tables(pool: &SqlitePool) -> String {
    let mut dump = String::new();
    for table in [
        "connections",
        "connection_models",
        "agent_installations",
        "workspaces",
    ] {
        let rows = sqlx::query(&format!("SELECT * FROM {table}"))
            .fetch_all(pool)
            .await
            .unwrap();
        for row in &rows {
            for index in 0..row.len() {
                if let Ok(Some(value)) = row.try_get::<Option<String>, _>(index) {
                    dump.push_str(&value);
                    dump.push('\n');
                }
            }
        }
    }
    dump
}

#[tokio::test]
async fn no_serialization_path_of_a_connection_contains_secret_material() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    let store = InMemorySecretStore::new();

    const SECRET: &str = "sk-live-must-never-appear";
    const HEADER_SECRET: &str = "Bearer sk-header-must-never-appear";

    sqlx::query(
        r"
        INSERT INTO provider_configs
            (account_id, provider_type, enabled, api_key, api_base_url, preset, headers, priority)
        VALUES ('acct', 'OpenAICompatible', 1, ?1, 'https://llm.test/v1', 'custom', ?2, 0)
        ",
    )
    .bind(SECRET)
    .bind(format!(
        r#"{{"Authorization":"{HEADER_SECRET}","X-Trace":"abc"}}"#
    ))
    .execute(&pool)
    .await
    .unwrap();

    migrate(&pool, &store).await;

    let connection = repository::list_connections(&pool, "acct")
        .await
        .unwrap()
        .remove(0);

    // 1. The struct itself carries no credential.
    let debug = format!("{connection:?}");
    assert!(!debug.contains(SECRET), "Debug leaked the api key: {debug}");

    // 2. serde, which is what crosses the Tauri boundary.
    let json = serde_json::to_string(&connection).unwrap();
    assert!(
        !json.contains(SECRET),
        "serialization leaked the api key: {json}"
    );

    // 3. The redacted form, which is what logs and exports use.
    let redacted = connection.redacted();
    let redacted_json = serde_json::to_string(&redacted).unwrap();
    for form in [
        format!("{redacted:?}"),
        redacted_json,
        serde_json::to_string(&repository::list_connections(&pool, "acct").await.unwrap()).unwrap(),
    ] {
        assert!(!form.contains(SECRET), "leaked the api key: {form}");
    }

    // Header values survive migration verbatim by design, so only the redacted
    // form is safe to log — and it must keep the header names.
    let redacted_headers = redacted.extra_headers.clone().unwrap();
    assert!(!redacted_headers.contains("sk-header-must-never-appear"));
    assert!(!redacted_headers.contains("abc"));
    assert!(redacted_headers.contains("Authorization"));
    assert!(redacted_headers.contains("X-Trace"));

    // The keychain has the credential and the database has only a handle.
    let reference: SecretRef = connection.secret_ref.clone().unwrap();
    assert_eq!(store.get(&reference).unwrap().expose(), SECRET);
    let dump = dump_new_tables(&pool).await;
    assert!(!dump.contains(SECRET), "{dump}");
}

#[tokio::test]
async fn runtime_reference_round_trips_through_the_database() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;

    let cases = [
        RuntimeRef::ChatModel {
            connection_id: "conn-1".into(),
            model_id: "llama3.2:3b".into(),
        },
        RuntimeRef::CodingAgent {
            installation_id: "inst-1".into(),
            agent_kind: crate::runtime::AgentKind::Codex,
            workspace_id: "ws-1".into(),
            agent_session_id: Some("sess-1".into()),
        },
        RuntimeRef::Unresolved {
            reason: UnresolvedReason::NoModel,
            legacy_provider: Some("OpenAICompatible".into()),
            legacy_model: Some("gpt-4-turbo".into()),
        },
    ];

    for (index, runtime) in cases.iter().enumerate() {
        let id = format!("conv-{index}");
        insert_conversation(&pool, &id, "acct").await;
        repository::set_conversation_runtime(&pool, &id, runtime)
            .await
            .unwrap();

        assert_eq!(
            repository::get_conversation_runtime(&pool, &id)
                .await
                .unwrap()
                .as_ref(),
            Some(runtime)
        );

        // The discriminant is a real column, not something inferred from the
        // payload.
        let kind: Option<String> =
            sqlx::query_scalar("SELECT runtime_kind FROM conversations WHERE id = ?1")
                .bind(&id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(kind.as_deref(), Some(runtime.kind().as_str()));
    }
}

#[tokio::test]
async fn a_conversation_with_no_runtime_reads_as_none() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;
    insert_conversation(&pool, "conv", "acct").await;

    assert_eq!(
        repository::get_conversation_runtime(&pool, "conv")
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        repository::get_conversation_runtime(&pool, "missing")
            .await
            .unwrap(),
        None
    );
}

#[tokio::test]
async fn installations_and_workspaces_round_trip() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;

    let installation = crate::connections::AgentInstallation {
        id: "inst-1".into(),
        account_id: "acct".into(),
        agent_kind: crate::runtime::AgentKind::ClaudeCode,
        display_name: "Claude Code".into(),
        executable_path: Some("/usr/local/bin/claude".into()),
        path_source: crate::connections::PathSource::PathLookup,
        launch_args: vec!["--cli".into()],
        detected_versions: Some(r#"{"adapter":"0.63.0","node":"22.14.0"}"#.into()),
        last_verification: crate::connections::VerificationResult::Ok,
        last_verification_detail: None,
        last_verified_at: Some("2026-07-27T00:00:00Z".into()),
    };
    repository::upsert_installation(&pool, &installation)
        .await
        .unwrap();
    repository::upsert_installation(&pool, &installation)
        .await
        .unwrap();

    let stored = repository::list_installations(&pool, "acct").await.unwrap();
    assert_eq!(stored, vec![installation]);

    let workspace = crate::connections::Workspace {
        id: "ws-1".into(),
        account_id: "acct".into(),
        path: "/home/theo/code/poly-ui".into(),
        display_name: "poly-ui".into(),
        last_validated_at: None,
        availability: crate::connections::WorkspaceAvailability::Available,
    };
    let first = repository::upsert_workspace(&pool, &workspace)
        .await
        .unwrap();
    let second = repository::upsert_workspace(
        &pool,
        &crate::connections::Workspace {
            id: "ws-2".into(),
            ..workspace.clone()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        first, second,
        "same path must not create a second workspace"
    );
    assert_eq!(
        repository::list_workspaces(&pool, "acct").await.unwrap(),
        vec![workspace]
    );
}

#[tokio::test]
async fn model_aliases_resolve() {
    let pool = legacy_database().await;
    apply_rework_schema(&pool).await;

    repository::upsert_connection(
        &pool,
        &crate::connections::Connection {
            id: "conn-1".into(),
            account_id: "acct".into(),
            provider: Provider::Openai,
            display_name: "OpenAI".into(),
            enabled: true,
            base_url: None,
            secret_ref: None,
            extra_headers: None,
            position: 0,
        },
    )
    .await
    .unwrap();

    repository::upsert_model(
        &pool,
        &crate::connections::ConnectionModel {
            connection_id: "conn-1".into(),
            remote_id: "gpt-5".into(),
            display_name: Some("GPT-5".into()),
            capabilities: Some(r#"{"vision":true}"#.into()),
            enabled: true,
            aliases: vec!["gpt-5-latest".into()],
            metadata: None,
            discovery_source: crate::connections::DiscoverySource::Remote,
            last_seen_at: Some("2026-07-27T00:00:00Z".into()),
        },
    )
    .await
    .unwrap();

    assert!(repository::model_exists(&pool, "conn-1", "gpt-5")
        .await
        .unwrap());
    assert!(repository::model_exists(&pool, "conn-1", "gpt-5-latest")
        .await
        .unwrap());
    assert!(!repository::model_exists(&pool, "conn-1", "gpt-4")
        .await
        .unwrap());

    let models = repository::list_models(&pool, "conn-1").await.unwrap();
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].aliases, vec!["gpt-5-latest".to_string()]);
}
