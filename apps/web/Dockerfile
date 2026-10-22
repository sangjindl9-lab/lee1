# SS-ERP 화면 — Next.js standalone 빌드
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/web --include-workspace-root=false
COPY apps/web apps/web
# 개발 편의를 위한 /api 경유 경로 (운영에서는 Caddy 가 /api 를 바로 api 로 보냄)
ARG API_INTERNAL_URL=http://api:4000
ENV NEXT_TELEMETRY_DISABLED=1 API_INTERNAL_URL=$API_INTERNAL_URL
RUN npm run build --workspace apps/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 TZ=Asia/Seoul
RUN groupadd -r erp && useradd -r -g erp erp
WORKDIR /app
COPY --from=build --chown=erp:erp /app/apps/web/.next/standalone ./
COPY --from=build --chown=erp:erp /app/apps/web/.next/static ./apps/web/.next/static
USER erp
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
