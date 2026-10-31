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
# 사람 검출 모델: YOLOX-s (OpenCV Zoo 배포본, Apache-2.0). 해시가 다르면 빌드 실패.
ARG YOLOX_URL=https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/object_detection_yolox/object_detection_yolox_2022nov.onnx
ARG YOLOX_SHA256=c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063
RUN mkdir -p /app/models \
 && curl -fsSL -o /app/models/yolox_s.onnx "$YOLOX_URL" \
 && echo "$YOLOX_SHA256  /app/models/yolox_s.onnx" | sha256sum -c -
# 분석 시연용 합성 장면 + OpenCV 공개 샘플 보행자 영상(vtest.avi)
ARG VTEST_URL=https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/vtest.avi
ARG VTEST_SHA256=45cddc9490be69345cbdab64ca583be65987e864ca408038e648db99e10516cf
COPY tools/test-camera/make_scenes.py /app/tools/test-camera/make_scenes.py
RUN curl -fsSL -o /tmp/vtest.avi "$VTEST_URL" && echo "$VTEST_SHA256  /tmp/vtest.avi" | sha256sum -c - \
 && /opt/venv/bin/python /app/tools/test-camera/make_scenes.py --out /opt/scenes --vtest /tmp/vtest.avi && rm /tmp/vtest.avi
COPY backend/ /app/backend/
COPY deploy/ /app/deploy/
COPY tools/test-camera/ /app/tools/test-camera/
COPY --from=web /web/dist /srv
RUN chmod +x /app/deploy/demo/start.sh
ENV PATH=/opt/venv/bin:$PATH
CMD ["/app/deploy/demo/start.sh"]
