#!/bin/bash
# [검증 도구 — 샌드박스용] 작은 tmpfs 를 녹화 경로로 써서 저장공간 고갈·쓰기 실패·공간 기준 정리를 시험한다.
# 실행 중인 개발용 recorder/worker 를 잠시 멈추고, 시험 후 원래대로 되돌린다. root 필요(tmpfs 마운트).
#   사용: disk_full.sh <svc.sh 경로> <DB psql 명령>
set -u
SVC=${1:?svc.sh}
PSQL=${2:?psql command}
SMALL=/tmp/claude-0/dev/smallrec
q() { $PSQL -tAc "$1"; }
log() { echo "[$(date +%H:%M:%S)] $*"; }

$SVC stop recorder; $SVC stop worker
mkdir -p $SMALL && mount -t tmpfs -o size=24m tmpfs $SMALL
T0=$(date -u +%FT%TZ)
export NVR_RECORDINGS_DIR=$SMALL NVR_RECORDER_MIN_FREE_MB=1 NVR_MIN_FREE_PERCENT=15 NVR_MIN_FREE_GB=0.001
log "1) worker 없이 녹화 → 24MB 가 가득 차야 함"
$SVC start recorder
for i in $(seq 1 60); do
  E=$(q "select count(*) from events where started_at > '$T0' and type in ('disk_write_error','camera_offline') ")
  [ "$E" -gt 0 ] && break; sleep 3
done
df -h $SMALL | tail -1
log "쓰기 실패/녹화 중단 이벤트:"; q "select type||' | '||severity||' | '||message from events where started_at > '$T0' order by id"
q "select recorder_state||' | '||error_code||' | '||left(error_message,80) from camera_status"
log "2) worker 시작 → 공간 기준 정리 후 녹화 재개해야 함"
T1=$(date -u +%FT%TZ)
$SVC start worker
for i in $(seq 1 60); do
  N=$(q "select count(*) from recording_segments where created_at > '$T1'")
  [ "$N" -ge 2 ] && break; sleep 3
done
df -h $SMALL | tail -1
log "정리 이벤트:"; q "select type||' | '||message from events where started_at > '$T1' order by id"
log "재개 후 새 구간 수: $(q "select count(*) from recording_segments where created_at > '$T1'")"
q "select recorder_state||' | '||error_code from camera_status"
# 정리
$SVC stop recorder; $SVC stop worker
q "delete from recording_segments where rel_path in (select rel_path from recording_segments where created_at > '$T0')" >/dev/null
umount $SMALL
unset NVR_RECORDINGS_DIR NVR_RECORDER_MIN_FREE_MB NVR_MIN_FREE_PERCENT NVR_MIN_FREE_GB
$SVC start recorder; $SVC start worker
log "원래 설정으로 복귀"
