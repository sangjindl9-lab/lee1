#!/usr/bin/env bash
# DB(설정·녹화 색인·감사로그) 백업. 녹화 영상 파일은 용량이 커서 별도 정책(rsync 등)으로 백업합니다.
#   사용: scripts/backup.sh [백업폴더=./backups]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-./backups}
TS=$(date +%Y%m%d_%H%M%S)
mkdir -p "$OUT"
umask 077
docker compose exec -T db pg_dump -U nvr -d nvr -Fc > "$OUT/nvr_db_$TS.dump"
# 마스터 키가 없으면 카메라 비밀번호를 복호화할 수 없으므로 함께 보관(백업 매체 접근 통제 필수)
cp secrets/master.key "$OUT/master_$TS.key"
cp .env "$OUT/env_$TS.txt"
echo "백업 완료: $OUT/nvr_db_$TS.dump, $OUT/master_$TS.key, $OUT/env_$TS.txt"
echo "녹화 파일 백업 예: rsync -a --exclude .incoming \"\${NVR_RECORDINGS_HOST_PATH:-./data/recordings}/\" /백업디스크/recordings/"
