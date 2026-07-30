-- Forward migration for profiles that already applied the first verification
-- table. Rebuilding is the only SQLite-safe way to replace its shape while
-- preserving the cached READY result.
ALTER TABLE agent_verification RENAME TO agent_verification_legacy;

CREATE TABLE agent_verification (
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
);

INSERT INTO agent_verification (
    agent_kind,
    adapter_path,
    installation,
    availability,
    availability_checked_at,
    authentication,
    verified_at
)
SELECT
    agent_kind,
    adapter_path,
    '"available"',
    1,
    verified_at,
    CASE authenticated
        WHEN 1 THEN '{"state":"logged-in"}'
        ELSE '{"state":"logged-out"}'
    END,
    verified_at
FROM agent_verification_legacy;

DROP TABLE agent_verification_legacy;
