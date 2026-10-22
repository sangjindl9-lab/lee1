# SS-ERP API — 빌드 컨텍스트는 저장소 최상위 (docker compose 가 지정)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --include-workspace-root=false
COPY apps/api apps/api
RUN npm run build --workspace apps/api

FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --include-workspace-root=false --omit=dev && npm cache clean --force && mkdir -p apps/api/node_modules

FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=Asia/Seoul
RUN apt-get update && apt-get install -y --no-install-recommends tini postgresql-client && rm -rf /var/lib/apt/lists/* \
  && groupadd -r erp && useradd -r -g erp -d /app erp
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/drizzle ./apps/api/drizzle
# 발주서 PDF 한글 글꼴 (Pretendard, OFL)
COPY apps/api/assets ./apps/api/assets
COPY apps/api/scripts ./apps/api/scripts
COPY apps/api/package.json ./apps/api/
RUN mkdir -p /data/storage && chown -R erp:erp /data
USER erp
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
# 시작할 때마다 마이그레이션을 먼저 적용 (이미 적용된 것은 건너뜀)
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/main.js"]
