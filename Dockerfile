FROM node:22-bookworm-slim
ENV TZ=Asia/Seoul NODE_ENV=production DATA_DIR=/data
RUN apt-get update && apt-get install -y --no-install-recommends fonts-nanum tzdata ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
EXPOSE 8080
CMD ["node", "--no-warnings", "server/index.js"]
