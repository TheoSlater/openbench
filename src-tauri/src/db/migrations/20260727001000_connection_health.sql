ALTER TABLE connections ADD COLUMN validation_status TEXT NOT NULL DEFAULT 'never';
ALTER TABLE connections ADD COLUMN validation_detail TEXT;
ALTER TABLE connections ADD COLUMN last_validated_at TEXT;

-- Multiple credentials may target the same provider endpoint. Migration code
-- already de-duplicates legacy rows before this index is removed.
DROP INDEX IF EXISTS idx_connections_identity;
