//! One-shot data migration from `provider_configs` into the runtime rework
//! schema.
//!
//! Runs after the SQL migration on every startup and is idempotent: the second
//! run finds every connection already present and does nothing. It never
//! deletes or rewrites `provider_configs` — that table is removed in checkpoint
//! 8, once the new path is verified — so a failure here leaves the old data
//! intact and the app usable on the old path.
//!
//! Logs are deliberately free of credential material. Where a key has to be
//! mentioned at all it goes through [`secrets::redact_value`].

use crate::connections::repository;
use crate::connections::secrets::{self, Secret, SecretError, SecretRef, SecretStore};
use crate::connections::{Connection, ConnectionModel, DiscoverySource, Provider};
use crate::runtime::{RuntimeRef, UnresolvedReason};
use sqlx::{Row, SqlitePool};
use std::collections::HashMap;

/// What the migration did. Returned for logging and asserted on in tests.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct MigrationReport {
    pub connections_created: usize,
    pub connections_reused: usize,
    pub models_created: usize,
    pub secrets_moved: usize,
    /// Connections disabled because the keychain refused the credential.
    pub secrets_failed: usize,
    /// Unknown legacy rows deliberately retained for manual recovery.
    pub rows_skipped: usize,
    pub conversations_resolved: usize,
    pub conversations_unresolved: usize,
}

impl MigrationReport {
    fn touched_anything(&self) -> bool {
        self.connections_created > 0
            || self.models_created > 0
            || self.secrets_moved > 0
            || self.secrets_failed > 0
            || self.rows_skipped > 0
            || self.conversations_resolved > 0
            || self.conversations_unresolved > 0
    }
}

/// Normalize a base URL for identity comparison.
///
/// Trims whitespace and a single trailing slash, and collapses a URL that is
/// merely the provider's own default down to `None`. Without this, a row that
/// spelled out `https://api.openai.com/v1` and one that left the column empty
/// would migrate into two connections for the same endpoint.
fn normalize_base_url(provider: Provider, raw: Option<&str>) -> Option<String> {
    let trimmed = raw.map(str::trim).filter(|value| !value.is_empty())?;
    let trimmed = trimmed.strip_suffix('/').unwrap_or(trimmed);
    if trimmed.eq_ignore_ascii_case(provider.default_base_url()) {
        return None;
    }
    Some(trimmed.to_string())
}

/// Map an OpenAI-compatible row onto a concrete provider.
///
/// The base URL wins over `preset`: `preset` is unconstrained free text and can
/// disagree with the endpoint actually configured. `preset` is consulted only
/// when there is no URL to go on, and an unrecognised value falls through to
/// the generic OpenAI-compatible provider rather than dropping the row.
fn provider_for_openai_compatible(base_url: Option<&str>, preset: Option<&str>) -> Provider {
    if let Some(url) = base_url.map(str::trim).filter(|url| !url.is_empty()) {
        let lowered = url.to_ascii_lowercase();
        if lowered.contains("openrouter.ai") {
            return Provider::Openrouter;
        }
        if lowered.contains("api.openai.com") {
            return Provider::Openai;
        }
        if lowered.contains("api.anthropic.com") {
            return Provider::Anthropic;
        }
        if lowered.contains("generativelanguage.googleapis.com") {
            return Provider::Gemini;
        }
        if lowered.contains(":1234") {
            return Provider::Lmstudio;
        }
        if lowered.contains(":11434") {
            return Provider::Ollama;
        }
        return Provider::OpenaiCompatible;
    }

    match preset.map(str::trim).unwrap_or_default() {
        "openai" => Provider::Openai,
        "openrouter" => Provider::Openrouter,
        "anthropic" => Provider::Anthropic,
        "gemini" => Provider::Gemini,
        "lmstudio" => Provider::Lmstudio,
        "ollama" => Provider::Ollama,
        // groq, together, deepseek and anything unrecognised all speak the
        // OpenAI shape and have no dedicated behavior yet.
        _ => Provider::OpenaiCompatible,
    }
}

/// Translate one legacy `provider_configs` row into a provider plus endpoint.
fn legacy_row_to_provider(
    provider_type: &str,
    ollama_host: Option<&str>,
    api_base_url: Option<&str>,
    preset: Option<&str>,
) -> Option<(Provider, Option<String>)> {
    let (provider, raw_url) = match provider_type {
        "OllamaLocal" => (Provider::Ollama, ollama_host),
        "AnthropicNative" => (Provider::Anthropic, api_base_url),
        "GeminiNative" => (Provider::Gemini, api_base_url),
        "OpenAICompatible" => (
            provider_for_openai_compatible(api_base_url, preset),
            api_base_url,
        ),
        _ => return None,
    };
    Some((provider, normalize_base_url(provider, raw_url)))
}

/// The old `ProviderType` name recorded on a message, mapped to a provider.
///
/// `OpenAICompatible` is intentionally absent: the name alone does not say
/// which endpoint was used, so those conversations resolve by looking at which
/// connections exist rather than by name.
fn message_provider_to_provider(name: &str) -> Option<Provider> {
    match name {
        "OllamaLocal" => Some(Provider::Ollama),
        "AnthropicNative" => Some(Provider::Anthropic),
        "GeminiNative" => Some(Provider::Gemini),
        _ => None,
    }
}

fn display_name_for(provider: Provider, base_url: Option<&str>) -> String {
    let label = match provider {
        Provider::Openai => "OpenAI",
        Provider::Anthropic => "Anthropic",
        Provider::Gemini => "Gemini",
        Provider::Openrouter => "OpenRouter",
        Provider::Ollama => "Ollama",
        Provider::Lmstudio => "LM Studio",
        Provider::OpenaiCompatible => "OpenAI-compatible",
    };
    match base_url {
        Some(url) => format!("{label} ({url})"),
        None => label.to_string(),
    }
}

/// Whether the rework tables exist yet. Guards the fixture databases used in
/// tests that deliberately skip the SQL migration.
async fn tables_present(pool: &SqlitePool) -> Result<bool, String> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'connections'",
    )
    .fetch_one(pool)
    .await
    .map(|count| count > 0)
    .map_err(|error| error.to_string())
}

async fn table_exists(pool: &SqlitePool, name: &str) -> Result<bool, String> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .map(|count| count > 0)
    .map_err(|error| error.to_string())
}

/// Run the data migration.
///
/// Idempotent. Safe to call on every startup.
pub async fn run(pool: &SqlitePool, store: &dyn SecretStore) -> Result<MigrationReport, String> {
    let mut report = MigrationReport::default();

    if !tables_present(pool).await? {
        return Err("runtime rework tables are missing; SQL migration did not run".to_string());
    }

    if table_exists(pool, "provider_configs").await? {
        migrate_provider_configs(pool, store, &mut report).await?;
    }

    migrate_conversations(pool, &mut report).await?;

    if report.touched_anything() {
        log::info!(
            "runtime rework migration: {} connections created, {} reused, {} models, \
             {} secrets moved, {} secrets failed, {} conversations resolved, {} unresolved",
            report.connections_created,
            report.connections_reused,
            report.models_created,
            report.secrets_moved,
            report.secrets_failed,
            report.conversations_resolved,
            report.conversations_unresolved,
        );
    }

    Ok(report)
}

async fn migrate_provider_configs(
    pool: &SqlitePool,
    store: &dyn SecretStore,
    report: &mut MigrationReport,
) -> Result<(), String> {
    let rows = sqlx::query(
        r"
        SELECT id, account_id, provider_type, enabled, ollama_host, ollama_api_key,
               api_key, api_base_url, preset, headers, model_suggestions, priority
        FROM provider_configs
        ORDER BY account_id ASC, priority ASC, id ASC
        ",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    for row in &rows {
        let legacy_id: i64 = row.get("id");
        let account_id: String = row.get("account_id");
        let provider_type: String = row.get("provider_type");
        let ollama_host: Option<String> = row.get("ollama_host");
        let api_base_url: Option<String> = row.get("api_base_url");
        let preset: Option<String> = row.get("preset");

        let Some((provider, base_url)) = legacy_row_to_provider(
            &provider_type,
            ollama_host.as_deref(),
            api_base_url.as_deref(),
            preset.as_deref(),
        ) else {
            // An unrecognised provider_type is left alone rather than dropped.
            // The row stays in provider_configs for a human to look at.
            log::warn!(
                "runtime rework migration: skipping provider_configs id {legacy_id} \
                 with unknown provider_type {provider_type}"
            );
            report.rows_skipped += 1;
            continue;
        };

        let existing =
            repository::find_connection_id(pool, &account_id, provider, base_url.as_deref())
                .await?;
        let is_new = existing.is_none();
        let connection_id = existing.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        if is_new {
            let connection = Connection {
                id: connection_id.clone(),
                account_id: account_id.clone(),
                provider,
                display_name: display_name_for(provider, base_url.as_deref()),
                enabled: row.get::<i64, _>("enabled") != 0,
                base_url: base_url.clone(),
                secret_ref: None,
                // Copied verbatim. Header values may hold user-pasted secrets,
                // but classifying them automatically would break working
                // connections on a false positive; the UI offers an explicit
                // move-to-keychain action instead.
                extra_headers: row.get("headers"),
                position: row.get::<i32, _>("priority"),
            };
            repository::upsert_connection(pool, &connection).await?;
            report.connections_created += 1;
        } else {
            report.connections_reused += 1;
        }

        migrate_secret(pool, store, row, provider, &connection_id, report).await?;
        report.models_created += migrate_model_suggestions(pool, row, &connection_id).await?;
    }

    Ok(())
}

/// Move one row's credential into the keychain.
///
/// Empty string and NULL are treated identically as "no credential" — the old
/// schema could not distinguish them and neither can we.
///
/// A keychain that refuses the write leaves `secret_ref` NULL and disables the
/// connection, so the user is asked to re-enter the key. It never falls back to
/// storing the credential in SQLite. This is the headless-Linux path, where no
/// Secret Service is running.
async fn migrate_secret(
    pool: &SqlitePool,
    store: &dyn SecretStore,
    row: &sqlx::sqlite::SqliteRow,
    provider: Provider,
    connection_id: &str,
    report: &mut MigrationReport,
) -> Result<(), String> {
    // Already migrated: leave the keychain alone so a re-run cannot clobber a
    // credential the user has since changed.
    let existing: Option<String> =
        sqlx::query_scalar("SELECT secret_ref FROM connections WHERE id = ?1")
            .bind(connection_id)
            .fetch_optional(pool)
            .await
            .map_err(|error| error.to_string())?
            .flatten();
    if existing.is_some() {
        return Ok(());
    }

    let raw_key: Option<String> = match provider {
        Provider::Ollama => row.get("ollama_api_key"),
        _ => row.get("api_key"),
    };
    let Some(key) = raw_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };

    let reference = SecretRef::for_connection(connection_id);
    match store.set(&reference, &Secret::new(key)) {
        Ok(()) => {
            repository::set_connection_secret_ref(pool, connection_id, Some(&reference)).await?;
            report.secrets_moved += 1;
        }
        Err(SecretError::NotFound) => unreachable!("set never reports NotFound"),
        Err(SecretError::Unavailable(detail)) => {
            repository::set_connection_enabled(pool, connection_id, false).await?;
            report.secrets_failed += 1;
            log::warn!(
                "runtime rework migration: could not store the credential for connection \
                 {connection_id} ({}); the connection has been disabled and the key must be \
                 re-entered. Store reported: {detail}",
                secrets::redact_value(key)
            );
        }
    }

    Ok(())
}

/// Carry the old `model_suggestions` list across as enabled models.
async fn migrate_model_suggestions(
    pool: &SqlitePool,
    row: &sqlx::sqlite::SqliteRow,
    connection_id: &str,
) -> Result<usize, String> {
    let raw: Option<String> = row.get("model_suggestions");
    let Some(raw) = raw.as_deref().filter(|value| !value.trim().is_empty()) else {
        return Ok(0);
    };
    let Ok(names) = serde_json::from_str::<Vec<String>>(raw) else {
        log::warn!(
            "runtime rework migration: connection {connection_id} had unreadable \
             model_suggestions; leaving model discovery to run instead"
        );
        return Ok(0);
    };

    let mut created = 0;
    for name in names {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        if repository::model_exists(pool, connection_id, name).await? {
            continue;
        }
        repository::upsert_model(
            pool,
            &ConnectionModel {
                connection_id: connection_id.to_string(),
                remote_id: name.to_string(),
                display_name: None,
                capabilities: None,
                enabled: true,
                aliases: Vec::new(),
                metadata: None,
                discovery_source: DiscoverySource::Migrated,
                last_seen_at: None,
            },
        )
        .await?;
        created += 1;
    }

    Ok(created)
}

/// Give every pre-rework conversation a runtime reference.
///
/// A conversation's runtime is inferred from its most recent assistant turn,
/// which is the only record of what it was talking to. Where the inference
/// fails the conversation gets an explicit [`RuntimeRef::Unresolved`] carrying
/// the reason and what the old row said — never a silent default.
async fn migrate_conversations(
    pool: &SqlitePool,
    report: &mut MigrationReport,
) -> Result<(), String> {
    let pending: Vec<String> =
        sqlx::query_scalar("SELECT id FROM conversations WHERE runtime_kind IS NULL")
            .fetch_all(pool)
            .await
            .map_err(|error| error.to_string())?;

    if pending.is_empty() {
        return Ok(());
    }

    // Connections are few; the per-conversation lookup would otherwise re-read
    // them once per row.
    let mut by_account: HashMap<String, Vec<Connection>> = HashMap::new();
    let accounts: Vec<String> = sqlx::query_scalar("SELECT DISTINCT account_id FROM connections")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;
    for account in accounts {
        let connections = repository::list_connections(pool, &account).await?;
        by_account.insert(account, connections);
    }

    for conversation_id in pending {
        let runtime = infer_runtime(pool, &conversation_id, &by_account).await?;
        match runtime.kind() {
            crate::runtime::RuntimeKind::Unresolved => report.conversations_unresolved += 1,
            _ => report.conversations_resolved += 1,
        }
        repository::set_conversation_runtime(pool, &conversation_id, &runtime).await?;
    }

    Ok(())
}

async fn infer_runtime(
    pool: &SqlitePool,
    conversation_id: &str,
    by_account: &HashMap<String, Vec<Connection>>,
) -> Result<RuntimeRef, String> {
    let account_id: String = sqlx::query_scalar("SELECT userId FROM conversations WHERE id = ?1")
        .bind(conversation_id)
        .fetch_optional(pool)
        .await
        .map_err(|error| error.to_string())?
        .flatten()
        .unwrap_or_default();

    let last_turn = sqlx::query(
        r"
        SELECT provider, model FROM messages
        WHERE conversationId = ?1 AND role = 'assistant'
          AND model IS NOT NULL AND model <> ''
        ORDER BY createdAt DESC
        LIMIT 1
        ",
    )
    .bind(conversation_id)
    .fetch_optional(pool)
    .await
    .map_err(|error| error.to_string())?;

    let Some(turn) = last_turn else {
        return Ok(RuntimeRef::Unresolved {
            reason: UnresolvedReason::NoHistory,
            legacy_provider: None,
            legacy_model: None,
        });
    };

    let legacy_provider: Option<String> = turn.get("provider");
    let model: String = turn.get("model");
    let legacy_provider = legacy_provider.filter(|value| !value.trim().is_empty());

    let Some(provider_name) = legacy_provider.clone() else {
        return Ok(RuntimeRef::Unresolved {
            reason: UnresolvedReason::NoProviderRecorded,
            legacy_provider: None,
            legacy_model: Some(model),
        });
    };

    let empty = Vec::new();
    let candidates = by_account.get(&account_id).unwrap_or(&empty);

    // A named provider maps to exactly one provider. `OpenAICompatible` does
    // not, so those conversations fall back to whichever OpenAI-shaped
    // connection offers the model, and to the lowest-position one otherwise.
    let matched = match message_provider_to_provider(&provider_name) {
        Some(provider) => candidates
            .iter()
            .find(|connection| connection.provider == provider),
        None => {
            let mut openai_shaped = candidates.iter().filter(|connection| {
                matches!(
                    connection.provider,
                    Provider::Openai
                        | Provider::Openrouter
                        | Provider::Lmstudio
                        | Provider::OpenaiCompatible
                )
            });
            let mut chosen = None;
            for connection in openai_shaped.by_ref() {
                if repository::model_exists(pool, &connection.id, &model).await? {
                    chosen = Some(connection);
                    break;
                }
            }
            chosen.or_else(|| {
                candidates.iter().find(|connection| {
                    matches!(
                        connection.provider,
                        Provider::Openai
                            | Provider::Openrouter
                            | Provider::Lmstudio
                            | Provider::OpenaiCompatible
                    )
                })
            })
        }
    };

    let Some(connection) = matched else {
        return Ok(RuntimeRef::Unresolved {
            reason: UnresolvedReason::NoConnection,
            legacy_provider,
            legacy_model: Some(model),
        });
    };

    // The model catalogue is only as complete as the old `model_suggestions`
    // list, which was a shortlist rather than a catalogue. Treat a model as
    // missing only when the connection has a list and the model is not on it —
    // otherwise discovery has simply not run yet and the id is validated at
    // send time.
    let known = repository::list_models(pool, &connection.id).await?;
    if !known.is_empty() && !repository::model_exists(pool, &connection.id, &model).await? {
        return Ok(RuntimeRef::Unresolved {
            reason: UnresolvedReason::NoModel,
            legacy_provider,
            legacy_model: Some(model),
        });
    }

    Ok(RuntimeRef::ChatModel {
        connection_id: connection.id.clone(),
        model_id: model,
    })
}

/// Resolve a legacy `default_model` id against the migrated schema.
///
/// The stored id is `Provider:model` or `Provider:configId:model`, with the
/// model percent-encoded. Unlike the frontend parser this accepts all four
/// legacy provider names — the frontend one rejects `AnthropicNative` and
/// `GeminiNative`, which is why those defaults never applied.
///
/// Returns `None` when the value cannot be resolved; the caller clears the key
/// rather than retrying it forever.
pub async fn resolve_legacy_model_choice(
    pool: &SqlitePool,
    account_id: &str,
    stored: &str,
) -> Result<Option<RuntimeRef>, String> {
    let stored = stored.trim();
    if stored.is_empty() {
        return Ok(None);
    }

    let Some((provider_name, rest)) = stored.split_once(':') else {
        return Ok(None);
    };
    // `Provider:configId:model` — the middle segment is a legacy row id we no
    // longer have, so it is parsed only to be stepped over.
    let model_part = match rest.split_once(':') {
        Some((maybe_id, tail)) if maybe_id.parse::<i64>().is_ok() => tail,
        _ => rest,
    };
    let model = percent_decode(model_part);

    let connections = repository::list_connections(pool, account_id).await?;
    let matched = match message_provider_to_provider(provider_name) {
        Some(provider) => connections
            .iter()
            .find(|connection| connection.provider == provider),
        None if provider_name == "OpenAICompatible" => connections.iter().find(|connection| {
            matches!(
                connection.provider,
                Provider::Openai
                    | Provider::Openrouter
                    | Provider::Lmstudio
                    | Provider::OpenaiCompatible
            )
        }),
        None => None,
    };

    Ok(matched.map(|connection| RuntimeRef::ChatModel {
        connection_id: connection.id.clone(),
        model_id: model,
    }))
}

/// Minimal `decodeURIComponent` inverse for the legacy model-choice id.
fn percent_decode(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(std::borrow::Cow::into_owned)
        .unwrap_or_else(|_| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_normalization_collapses_provider_defaults() {
        assert_eq!(
            normalize_base_url(Provider::Openai, Some("https://api.openai.com/v1")),
            None
        );
        assert_eq!(
            normalize_base_url(Provider::Openai, Some("https://api.openai.com/v1/")),
            None
        );
        assert_eq!(normalize_base_url(Provider::Openai, Some("  ")), None);
        assert_eq!(normalize_base_url(Provider::Openai, None), None);
        assert_eq!(
            normalize_base_url(Provider::Openai, Some("https://proxy.test/v1/")),
            Some("https://proxy.test/v1".to_string())
        );
    }

    #[test]
    fn base_url_beats_a_disagreeing_preset() {
        assert_eq!(
            provider_for_openai_compatible(Some("https://openrouter.ai/api/v1"), Some("openai")),
            Provider::Openrouter
        );
        assert_eq!(
            provider_for_openai_compatible(Some("https://api.openai.com/v1"), Some("openrouter")),
            Provider::Openai
        );
    }

    #[test]
    fn preset_is_used_only_without_a_base_url() {
        assert_eq!(
            provider_for_openai_compatible(None, Some("openrouter")),
            Provider::Openrouter
        );
        assert_eq!(
            provider_for_openai_compatible(None, Some("lmstudio")),
            Provider::Lmstudio
        );
    }

    #[test]
    fn unknown_preset_falls_through_rather_than_dropping() {
        assert_eq!(
            provider_for_openai_compatible(None, Some("groq")),
            Provider::OpenaiCompatible
        );
        assert_eq!(
            provider_for_openai_compatible(None, None),
            Provider::OpenaiCompatible
        );
        assert_eq!(
            provider_for_openai_compatible(Some("https://llm.internal/v1"), None),
            Provider::OpenaiCompatible
        );
    }

    #[test]
    fn legacy_rows_map_to_providers() {
        assert_eq!(
            legacy_row_to_provider("OllamaLocal", Some("http://127.0.0.1:11434"), None, None),
            Some((Provider::Ollama, None))
        );
        assert_eq!(
            legacy_row_to_provider(
                "AnthropicNative",
                None,
                Some("https://api.anthropic.com/v1"),
                None
            ),
            Some((Provider::Anthropic, None))
        );
        assert_eq!(legacy_row_to_provider("PolyAgent", None, None, None), None);
    }

    #[test]
    fn percent_decoding_matches_the_frontend_encoding() {
        assert_eq!(percent_decode("gpt-4o"), "gpt-4o");
        assert_eq!(percent_decode("llama3.2%3A3b"), "llama3.2:3b");
    }
}
