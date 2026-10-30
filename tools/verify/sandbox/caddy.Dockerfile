# [샌드박스 전용] caddy:2-alpine 대체(Ubuntu caddy 2.6.2) + 빌드된 웹 화면
FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends caddy ca-certificates && rm -rf /var/lib/apt/lists/*
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY frontend-dist /srv
ENV XDG_DATA_HOME=/data XDG_CONFIG_HOME=/config
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
