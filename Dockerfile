# [클라우드 데모 전용 이미지] Railway 등에서 한 서비스로 실행해 웹에서 둘러보기 위한 이미지입니다.
# 실제 현장 운영은 docker-compose.yml(현장 서버 설치)을 사용하세요. 클라우드에서는 현장 사설망 카메라에 접근할 수 없습니다.
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM ubuntu:24.04
ARG MEDIAMTX_VERSION=v1.21.2
ENV DEBIAN_FRONTEND=noninteractive PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 LANG=C.UTF-8 TZ=UTC
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3.12 python3.12-venv python3-gi gir1.2-gst-rtsp-server-1.0 \
      gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-ugly gstreamer1.0-plugins-bad \
      gstreamer1.0-libav gstreamer1.0-x fonts-dejavu-core fonts-noto-cjk \
      ffmpeg caddy ca-certificates curl tzdata \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://github.com/bluenviron/mediamtx/releases/download/${MEDIAMTX_VERSION}/mediamtx_${MEDIAMTX_VERSION}_linux_amd64.tar.gz" \
      | tar -xz -C /usr/local/bin mediamtx \
 && /usr/local/bin/mediamtx --version
RUN python3.12 -m venv /opt/venv
COPY backend/requirements.txt /app/backend/requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend/ /app/backend/
COPY deploy/ /app/deploy/
COPY tools/test-camera/ /app/tools/test-camera/
COPY --from=web /web/dist /srv
RUN chmod +x /app/deploy/demo/start.sh
ENV PATH=/opt/venv/bin:$PATH
CMD ["/app/deploy/demo/start.sh"]
