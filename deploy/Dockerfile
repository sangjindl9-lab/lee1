# EUM SMART VMS PRO — 관제서버 이미지 (웹 화면 포함)
# 빌드: docker build -f deploy/Dockerfile -t eum-smart-vms:0.1.0 .
FROM node:22-bookworm-slim AS web
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server
WORKDIR /src/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx tsc -p . && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data WEB_DIST=/app/web/dist PORT=3000
WORKDIR /app/server
COPY --from=server /src/server/dist ./dist
COPY --from=server /src/server/node_modules ./node_modules
COPY --from=server /src/server/migrations ./migrations
COPY --from=server /src/server/package.json ./
COPY --from=web /src/web/dist /app/web/dist
RUN useradd -r -u 10001 eum && mkdir -p /data && chown eum /data
USER eum
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>r.json()).then(j=>process.exit(j.db?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
