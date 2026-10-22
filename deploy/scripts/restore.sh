#!/bin/sh
# 복구: docker compose run --rm -v <백업폴더>:/restore backup sh /scripts/restore.sh
# ※ 현재 데이터베이스 내용을 백업 시점으로 덮어씁니다. 실행 전 api 서비스를 멈추세요: docker compose stop api web
set -eu
[ -f /restore/erp.dump ] || { echo "/restore/erp.dump 가 없습니다"; exit 1; }
( cd /restore && sha256sum -c SHA256SUMS ) || { echo "체크섬 불일치 — 백업 파일이 손상되었습니다"; exit 1; }
printf "데이터베이스를 백업 시점으로 덮어씁니다. 계속하려면 RESTORE 를 입력하세요: "
read ans
[ "$ans" = "RESTORE" ] || { echo "취소했습니다"; exit 1; }
pg_restore --clean --if-exists --no-owner --dbname="$PGDATABASE" /restore/erp.dump
echo "DB 복구 완료. 첨부파일은 storage.tar.gz 를 file-storage 볼륨에 풀어 주세요."
