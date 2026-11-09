#!/usr/bin/env bash
# 인터넷이 되는 PC에서 실행 → 폐쇄망 서버로 옮길 설치 묶음(tar) 생성
set -euo pipefail
cd "$(dirname "$0")/.."
VER=0.1.0
docker build -f deploy/Dockerfile -t eum-smart-vms:$VER .
docker pull timescale/timescaledb:latest-pg16
docker pull eclipse-mosquitto:2
mkdir -p dist-offline
docker save eum-smart-vms:$VER timescale/timescaledb:latest-pg16 eclipse-mosquitto:2 | gzip > dist-offline/eum-images-$VER.tar.gz
tar czf dist-offline/eum-deploy-$VER.tgz deploy docs
sha256sum dist-offline/* > dist-offline/SHA256SUMS
echo "폐쇄망 서버에서: docker load < eum-images-$VER.tar.gz && tar xzf eum-deploy-$VER.tgz"
