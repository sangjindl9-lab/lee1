# 데이터베이스 마이그레이션·롤백 절차

## 기기(SQLite)
- 정의: `NoteDb.MIGRATIONS` (버전 번호 → SQL 목록). **이미 배포된 버전의 SQL은 수정 금지**, 새 버전 번호로만 추가.
- 업그레이드 순서
  1. 앱 시작 시 `NoteDb.backupBeforeMigration()` 이 현재 DB 버전을 읽어, 새 버전보다 낮으면 `files/backups/notepro-v{이전}.db(-wal,-shm)` 로 복사.
  2. `onUpgrade` 가 (이전+1)…(새 버전) 순서로 SQL 실행 — SQLiteOpenHelper가 하나의 트랜잭션으로 감싸므로 중간 실패 시 전체 취소, 기존 데이터 유지.
  3. `schema_migrations` 에 적용 기록.
- 롤백
  - 자동: 업그레이드 트랜잭션 실패 → SQLite가 원상 복구.
  - 수동(심각한 버그 배포 시): 이전 앱 버전을 다시 배포하기 전에, 새 버전에 "복원 코드"를 넣어 `files/backups/notepro-v{n}.db` 를 원래 위치로 되돌린 뒤 이전 스키마로 열기. 구버전 앱이 새 DB를 만나면 `onDowngrade` 가 **데이터를 지우지 않고** 오류로 멈춘다.
- 마이그레이션 테스트: 새 버전마다 이전 버전 DB 파일을 androidTest 자원으로 넣고 업그레이드 후 획 수·무결성 검사.

## 서버(PostgreSQL, 2단계)
- 파일: `docs/db/server_NNN_*.up.sql` / `.down.sql` 짝.
- 적용: 배포 파이프라인에서 `pg_dump` 백업 → up 적용 → 상태 확인 쿼리.
- 롤백: 점검 모드 전환 → down 적용(001은 전체 삭제이므로 운영에서는 백업 복원 우선) → 이전 API 버전 재배포.
