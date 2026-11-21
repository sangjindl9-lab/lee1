-- 004: 디스크 볼륨이 없는 환경용 — 파일 내용을 DB에 보관(STORAGE=db)
BEGIN;
CREATE TABLE file_blobs (
  user_id UUID NOT NULL REFERENCES users(id), sha256 CHAR(64) NOT NULL, data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, sha256)
);
COMMIT;
