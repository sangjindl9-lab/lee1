import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 운영 빌드는 서버가 web/dist를 사이트 루트(/)에서 정적 파일로 제공한다. SPA 경로(/smartboxes/:id)에서도 자산이 깨지지 않도록 base는 '/'.
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
