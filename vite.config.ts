import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 중에는 Vite(5173)가 화면을 제공하고 /api 요청은 API 서버로 넘깁니다.
const apiPort = process.env.PORT ?? '3000';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
