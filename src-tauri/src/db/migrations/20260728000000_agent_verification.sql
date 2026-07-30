-- Persists the last successful coding-agent verification, so a restart does
-- not drop a previously-working Codex/Claude setup back to "Set up". Keyed by
-- agent kind; one row per agent, replaced wholesale on each new verification.
CREATE TABLE agent_verification (
    agent_kind TEXT PRIMARY KEY,
    adapter_path TEXT NOT NULL,
    authenticated INTEGER NOT NULL,
    verified_at TEXT NOT NULL
);
