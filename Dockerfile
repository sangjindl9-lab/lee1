# CCTV 공사 설계 프로그램 – 독립 서버 설치용 이미지
# 1단계: LibreDWG(dwg2dxf, GPLv3) 빌드 – DWG 변환을 쓰지 않으면 이 단계를 지워도 됩니다.
FROM node:22-bookworm-slim AS libredwg
RUN apt-get update && apt-get install -y --no-install-recommends build-essential curl xz-utils ca-certificates && rm -rf /var/lib/apt/lists/*
ARG LIBREDWG_VERSION=0.13.3
RUN curl -fsSL -o /tmp/l.tar.xz https://github.com/LibreDWG/libredwg/releases/download/${LIBREDWG_VERSION}/libredwg-${LIBREDWG_VERSION}.tar.xz \
 && tar xf /tmp/l.tar.xz -C /tmp && cd /tmp/libredwg-${LIBREDWG_VERSION} \
 && ./configure --prefix=/opt/libredwg --disable-bindings --disable-python --disable-docs && make -j"$(nproc)" && make install

# 2단계: Node 의존성 (better-sqlite3 네이티브 모듈 빌드 도구 포함)
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 3단계: 실행 이미지
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=libredwg /opt/libredwg /opt/libredwg
ENV LD_LIBRARY_PATH=/opt/libredwg/lib
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
COPY shared ./shared
COPY public ./public
COPY fonts ./fonts
COPY scripts ./scripts
COPY samples/input ./samples/input
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data DWG_ENGINE_TYPE=libredwg DWG_ENGINE_PATH=/opt/libredwg/bin/dwg2dxf
# 데이터 볼륨: docker run -v ./data:/data (Railway는 서비스 볼륨을 /data에 연결)
EXPOSE 3000
CMD ["node", "server/index.js"]
