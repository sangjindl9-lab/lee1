BEGIN;
DROP TABLE IF EXISTS stored_files, file_chunks, email_tokens, refresh_tokens;
ALTER TABLE sync_conflicts DROP COLUMN IF EXISTS detail;
ALTER TABLE user_devices DROP COLUMN IF EXISTS name;
COMMIT;
