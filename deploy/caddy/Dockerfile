# 웹 화면 빌드 + Caddy(HTTPS·리버스 프록시). 빌드 컨텍스트: 저장소 루트
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# 운영 시 검증한 버전 태그로 고정하세요(예: caddy:2.x.y-alpine)
FROM caddy:2-alpine
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /web/dist /srv
