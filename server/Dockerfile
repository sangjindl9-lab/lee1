# 노트프로 서버 (Railway 등). 문서 변환용 LibreOffice + 한중일 글꼴 포함
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-impress libreoffice-calc fonts-noto-cjk fonts-nanum \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production PORT=8080 STORAGE_DIR=/data/storage
EXPOSE 8080
CMD ["node", "build/src/index.js"]
