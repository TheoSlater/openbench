CREATE TABLE IF NOT EXISTS mobile_push_tokens (
    token TEXT PRIMARY KEY,
    environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
