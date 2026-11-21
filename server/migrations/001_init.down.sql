-- 마이그레이션 001 롤백(DOWN). 운영 DB에서는 실행 전 반드시 전체 백업(pg_dump) 후, 점검 모드에서만 실행.
BEGIN;
DROP TABLE IF EXISTS app_errors, audit_logs, purchases, subscriptions, ai_requests, recordings, note_tags, tags, templates,
  backup_jobs, sync_conflicts, sync_operations, document_versions, pen_strokes, page_elements, pages, attachments,
  notebooks, notebook_folders, user_settings, user_devices, users CASCADE;
COMMIT;
