# syntax=docker/dockerfile:1
# 이음 앱 홍보·ASO 자동화 센터 (EUM Promo & ASO Studio)

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3100 \
    DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
RUN mkdir -p /data
# Railway 볼륨은 root 소유로 마운트되어 node 사용자로는 SQLite 파일을 열 수 없습니다.
# 내부 사내 도구이므로 root 로 실행해 /data 쓰기 권한 문제를 없앱니다.
EXPOSE 3100
# Railway 호스팅: 볼륨은 대시보드에서 /data 로 마운트합니다. (Dockerfile VOLUME 지시자는 제거)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server.js"]
