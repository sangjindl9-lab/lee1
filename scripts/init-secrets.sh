#!/usr/bin/env bash
# 최초 설치 시 1회 실행: 비밀 파일과 데이터 폴더를 만든다. 기존 파일은 덮어쓰지 않는다.
#   마스터 키를 잃어버리면 저장된 카메라 비밀번호를 복호화할 수 없습니다 → 백업 필수.
set -euo pipefail
cd "$(dirname "$0")/.."
UID_NVR=10001
mkdir -p secrets
umask 077
if [ ! -f secrets/master.key ]; then
  head -c 32 /dev/urandom | base64 > secrets/master.key
  echo "생성: secrets/master.key"
else
  echo "유지: secrets/master.key (이미 있음)"
fi
if [ ! -f secrets/db_password ]; then
  head -c 24 /dev/urandom | base64 | tr -d '/+=\n' > secrets/db_password
  echo "생성: secrets/db_password"
else
  echo "유지: secrets/db_password (이미 있음)"
fi
[ -f .env ] || { cp .env.example .env; echo "생성: .env (값을 확인·수정하세요)"; }

# shellcheck disable=SC1091
set -a; . ./.env; set +a
REC=${NVR_RECORDINGS_HOST_PATH:-./data/recordings}
EXP=${NVR_EXPORTS_HOST_PATH:-./data/exports}
mkdir -p "$REC" "$EXP"
if [ "$(id -u)" = "0" ]; then
  chown "$UID_NVR:$UID_NVR" "$REC" "$EXP" secrets/master.key secrets/db_password
  # postgres 컨테이너도 db_password 를 읽어야 하므로 그룹/기타 읽기 허용은 하지 않고 소유자만 10001 로 둔다.
  # postgres 공식 이미지는 *_FILE 을 root 로 읽은 뒤 권한을 낮추므로 동작한다.
  chmod 600 secrets/master.key secrets/db_password
  echo "권한: 녹화·내보내기 폴더와 secret 파일 소유자를 UID $UID_NVR 로 설정"
else
  echo "주의: root 가 아니어서 소유자를 바꾸지 못했습니다. 다음을 실행하세요:"
  echo "  sudo chown $UID_NVR:$UID_NVR '$REC' '$EXP' secrets/master.key secrets/db_password"
fi
echo "완료. 다음: docker compose up -d --build"
