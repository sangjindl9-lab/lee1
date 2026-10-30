# [샌드박스 전용] Docker Hub 차단 환경에서 postgres:16-alpine 대체
FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql-16 && rm -rf /var/lib/apt/lists/*
COPY pg-entry.sh /pg-entry.sh
RUN chmod +x /pg-entry.sh
ENV PATH=/usr/lib/postgresql/16/bin:$PATH PGDATA=/var/lib/postgresql/data
CMD ["/pg-entry.sh"]
