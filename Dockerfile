# EUM 3D STUDIO PRO — 단일 이미지 (웹 + API + 변환/렌더 워커)
# 빌드: docker build -t eum3d-studio .
# 1) LibreDWG (dwg2dxf, GPLv3 — 별도 실행 프로그램으로 호출) : DWG → DXF
FROM node:22-bookworm-slim AS libredwg
RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl xz-utils ca-certificates && rm -rf /var/lib/apt/lists/*
ARG LIBREDWG_VERSION=0.13.3
RUN curl -fsSL -o /tmp/l.tar.xz https://github.com/LibreDWG/libredwg/releases/download/${LIBREDWG_VERSION}/libredwg-${LIBREDWG_VERSION}.tar.xz \
 && tar xf /tmp/l.tar.xz -C /tmp && cd /tmp/libredwg-${LIBREDWG_VERSION} \
 && ./configure --prefix=/opt/libredwg --disable-bindings --disable-python --disable-docs && make -j"$(nproc)" && make install

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
# FFmpeg(H.264 인코딩), Poppler(PDF 도면 분석), 한글 폰트(영상 자막), 헤드리스 Chromium(렌더 워커)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg poppler-utils fonts-noto-cjk ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=libredwg /opt/libredwg /opt/libredwg
ENV LD_LIBRARY_PATH=/opt/libredwg/lib DWG2DXF_PATH=/opt/libredwg/bin/dwg2dxf
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
