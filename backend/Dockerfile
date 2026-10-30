# api / recorder / worker 공용 이미지.
# 검증 환경과 같은 Ubuntu 24.04 패키지(Python 3.12, FFmpeg 6.1.1)를 사용한다.
# 빌드 컨텍스트: 저장소 루트 (docker compose 가 지정)
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LANG=C.UTF-8 \
    TZ=UTC

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3.12 python3.12-venv ffmpeg fonts-dejavu-core ca-certificates tzdata curl \
 && rm -rf /var/lib/apt/lists/*

RUN python3.12 -m venv /opt/venv
COPY backend/requirements.txt /app/backend/requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend/ /app/backend/
COPY deploy/mediamtx/mediamtx.base.yml /app/deploy/mediamtx/mediamtx.base.yml

# 비루트 실행. 녹화·내보내기 폴더와 secret 파일은 이 UID(10001)가 읽고 쓸 수 있어야 한다(scripts/init-secrets.sh 참조).
RUN useradd --system --uid 10001 --home /app --shell /usr/sbin/nologin nvr \
 && mkdir -p /mediamtx-config /recordings /exports \
 && chown 10001:10001 /mediamtx-config /recordings /exports \
 && chmod +x /app/backend/docker/*.sh
USER 10001
WORKDIR /app/backend
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/app/backend

CMD ["/app/backend/docker/api-entrypoint.sh"]
