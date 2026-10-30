#!/usr/bin/env bash
# DB 복구: scripts/restore.sh <백업.dump> [master.key]
#   1) 녹화·작업·API 를 멈추고 2) DB 를 덮어쓴 뒤 3) 다시 시작합니다.
#   녹화 파일이 있고 DB 에 없는 구간은 recorder 가 시작 시 파일명으로 재색인합니다.
set -euo pipefail
cd "$(dirname "$0")/.."
DUMP=${1:?백업 파일(.dump)을 지정하세요}
KEY=${2:-}
read -r -p "현재 DB 를 '$DUMP' 내용으로 덮어씁니다. 계속할까요? (yes 입력) " ans
[ "$ans" = "yes" ] || { echo "취소"; exit 1; }
if [ -n "$KEY" ]; then cp "$KEY" secrets/master.key; chmod 600 secrets/master.key; echo "마스터 키 복원"; fi
docker compose stop recorder worker api caddy
docker compose up -d db
sleep 3
docker compose exec -T db pg_restore -U nvr -d nvr --clean --if-exists --no-owner < "$DUMP"
docker compose up -d
echo "복구 완료. 대시보드에서 서비스 상태와 카메라 녹화 상태를 확인하세요."
