#!/bin/sh
# 매일 BACKUP_HOUR 시에 백업 실행
set -eu
echo "백업 대기 중: 매일 ${BACKUP_HOUR}시, 보관 ${BACKUP_KEEP_DAYS}일"
while true; do
  now_h=$(date +%H | sed 's/^0//')
  if [ "${now_h:-0}" = "${BACKUP_HOUR}" ]; then
    /bin/sh /scripts/backup.sh || echo "백업 실패 $(date)"
    sleep 3700
  fi
  sleep 300
done
