# EUM 3D STUDIO PRO — 단일 이미지 (웹 + API + 변환/렌더 워커)
# 빌드: docker build -t eum3d-studio .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DATA_DIR=/data \
    PORT=8080
# FFmpeg(H.264 인코딩), 한글 폰트(영상 자막), 헤드리스 Chromium(렌더 워커)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
RUN npx playwright-core install --with-deps --only-shell chromium && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/web/dist ./web/dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY samples ./samples
EXPOSE 8080
CMD ["node", "server/index.js"]
