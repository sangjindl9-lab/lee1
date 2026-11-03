FROM node:22-bookworm-slim
ENV TZ=Asia/Seoul NODE_ENV=production DATA_DIR=/data
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates curl tzdata \
 && ARCH=$(dpkg --print-architecture) \
 && curl -fsSL -o /usr/local/bin/go2rtc https://github.com/AlexxIT/go2rtc/releases/download/v1.9.9/go2rtc_linux_${ARCH} \
 && chmod +x /usr/local/bin/go2rtc \
 && apt-get purge -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
EXPOSE 8080
CMD ["node", "--no-warnings", "server/index.js"]
