import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 시: /api → 로컬 API, /rtc·/hls → mediamtx (운영에서는 caddy 가 같은 역할)
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 900 },
  preview: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/rtc": { target: "http://127.0.0.1:8889", rewrite: (p) => p.replace(/^\/rtc/, "") },
      "/hls": { target: "http://127.0.0.1:8888", rewrite: (p) => p.replace(/^\/hls/, "") },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/rtc": { target: "http://127.0.0.1:8889", rewrite: (p) => p.replace(/^\/rtc/, "") },
      "/hls": { target: "http://127.0.0.1:8888", rewrite: (p) => p.replace(/^\/hls/, "") },
    },
  },
});
