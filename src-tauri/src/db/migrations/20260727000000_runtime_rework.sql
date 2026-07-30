-- Runtime rework: connections, models, coding-agent installations, workspaces,
-- and the per-conversation runtime reference.
--
-- Purely additive. `provider_configs` is left in place and untouched; it is
-- removed in checkpoint 8 once the new path is verified. Every statement is
-- guarded so re-running is a no-op.

-- One set of credentials and endpoint configuration for a provider. Several
-- connections per provider are supported: identity is (account, provider,
-- base_url), not provider alone.
CREATE TABLE IF NOT EXISTS connections (
    id            TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL DEFAULT '',
    provider      TEXT NOT NULL,
    display_name  TEXT NOT NULL DEFAULT '',
    enabled       INTEGER NOT NULL DEFAULT 1,
    -- NULL means "use the provider's default endpoint".
    base_url      TEXT,
    -- Opaque handle into the OS keychain. Never credential material.
    secret_ref    TEXT,
    -- JSON object of extra request headers. May contain user-pasted values
    -- inherited from provider_configs.headers, so every formatting path runs
    -- it through connections::secrets::redact_headers.
    extra_headers TEXT,
    position      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Prevents duplicate connections on re-migration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_identity
    ON connections (account_id, provider, COALESCE(base_url, ''));

CREATE INDEX IF NOT EXISTS idx_connections_account
    ON connections (account_id, position);

-- A model offered by one connection.
CREATE TABLE IF NOT EXISTS connection_models (
    connection_id    TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    -- The provider's own id, verbatim. Goes on the wire unchanged.
    remote_id        TEXT NOT NULL,
    display_name     TEXT,
    capabilities     TEXT,
    enabled          INTEGER NOT NULL DEFAULT 1,
    -- JSON array of alternate ids that resolve to this model.
    aliases          TEXT NOT NULL DEFAULT '[]',
    metadata         TEXT,
    discovery_source TEXT NOT NULL DEFAULT 'manual',
    last_seen_at     TEXT,
    PRIMARY KEY (connection_id, remote_id)
);

CREATE INDEX IF NOT EXISTS idx_connection_models_enabled
    ON connection_models (connection_id, enabled);

-- A detected or user-configured coding-agent install. Detection logic lands in
-- checkpoint 3; this is storage only.
CREATE TABLE IF NOT EXISTS agent_installations (
    id                       TEXT PRIMARY KEY,
    account_id               TEXT NOT NULL DEFAULT '',
    agent_kind               TEXT NOT NULL,
    display_name             TEXT NOT NULL DEFAULT '',
    executable_path          TEXT,
    path_source              TEXT NOT NULL DEFAULT 'unresolved',
    -- JSON array. Never a shell string: processes are launched with a
    -- structured executable path and an argument array.
    launch_args              TEXT NOT NULL DEFAULT '[]',
    -- JSON map of component name to version, e.g. {"adapter":"…","node":"…"}.
    detected_versions        TEXT,
    last_verification        TEXT NOT NULL DEFAULT 'never',
    last_verification_detail TEXT,
    last_verified_at         TEXT,
    created_at               TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_installations_account
    ON agent_installations (account_id, agent_kind);

-- A directory a coding agent may work in. Only coding-agent conversations
-- reference one.
CREATE TABLE IF NOT EXISTS workspaces (
    id                TEXT PRIMARY KEY,
    account_id        TEXT NOT NULL DEFAULT '',
    path              TEXT NOT NULL,
    display_name      TEXT NOT NULL DEFAULT '',
    last_validated_at TEXT,
    availability      TEXT NOT NULL DEFAULT 'unknown',
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_path
    ON workspaces (account_id, path);

-- The per-conversation runtime reference: an explicit discriminant column plus
-- a JSON payload. The discriminant is authoritative; the payload is only read
-- after it has been checked against it.
--
-- sqlx has no conditional DDL, and SQLite has no ADD COLUMN IF NOT EXISTS, so
-- these two statements are the one place this migration is not self-guarded.
-- `conversations` is created by db::connection::ensure_conversations_schema
-- before the migrator runs, and neither column exists in any shipped build, so
-- a first run always succeeds. Re-runs are prevented by _sqlx_migrations.
ALTER TABLE conversations ADD COLUMN runtime_kind TEXT;
ALTER TABLE conversations ADD COLUMN runtime_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_runtime_kind
    ON conversations (runtime_kind);

-- A conversation's runtime family is set at creation and does not change in
-- place: switching family is a new conversation or an explicit fork. Enforced
-- here rather than only in Rust so it holds for the frontend's direct SQL
-- writes through tauri-plugin-sql too.
--
-- Resolving an 'unresolved' conversation is allowed — that is the user
-- answering the question the migration asked.
CREATE TRIGGER IF NOT EXISTS conversations_runtime_kind_immutable
BEFORE UPDATE OF runtime_kind ON conversations
FOR EACH ROW
WHEN OLD.runtime_kind IS NOT NULL
 AND OLD.runtime_kind <> 'unresolved'
 AND NEW.runtime_kind IS NOT OLD.runtime_kind
BEGIN
    SELECT RAISE(ABORT, 'conversation runtime family is immutable; fork instead');
END;
