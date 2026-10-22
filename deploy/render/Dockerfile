# SS-ERP 시연 서버 (Render) — API 와 화면을 한 컨테이너에서 실행
#   화면(Next.js)이 $PORT 로 외부 요청을 받고, /api/v1 은 같은 컨테이너의 API(4000)로 넘긴다.
#   회사별 설치형 운영 배포는 deploy/docker-compose.yml 을 사용한다.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY apps/api apps/api
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1 API_INTERNAL_URL=http://127.0.0.1:4000
RUN npm run build --workspace apps/api && npm run build --workspace apps/web

FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --include-workspace-root=false --omit=dev && npm cache clean --force && mkdir -p apps/api/node_modules

FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=Asia/Seoul NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
# DATABASE_URL 이 없을 때 쓰는 내장 PostgreSQL (시연용 — 재배포 시 데이터 초기화)
RUN apt-get update && apt-get install -y --no-install-recommends tini postgresql-15 && rm -rf /var/lib/apt/lists/* \
  && groupadd -r erp && useradd -r -g erp -d /app erp
WORKDIR /app
# API
COPY --from=prod-deps /app/node_modules ./api/node_modules
# 버전이 겹쳐 apps/api 아래에 따로 설치되는 패키지 (dotenv 등)
COPY --from=prod-deps /app/apps/api/node_modules ./api/apps/api/node_modules
COPY --from=build /app/apps/api/dist ./api/apps/api/dist
COPY apps/api/drizzle ./api/apps/api/drizzle
COPY apps/api/assets ./api/apps/api/assets
COPY apps/api/scripts ./api/apps/api/scripts
COPY apps/api/package.json ./api/apps/api/
# 화면
COPY --from=build /app/apps/web/.next/standalone ./web/
COPY --from=build /app/apps/web/.next/static ./web/apps/web/.next/static
COPY deploy/render/start.sh ./start.sh
RUN mkdir -p /data/storage /data/pg /tmp/pgsock && chown -R erp:erp /data /tmp/pgsock && chmod +x start.sh
USER erp
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./start.sh"]
