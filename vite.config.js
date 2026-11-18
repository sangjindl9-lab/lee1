import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 일반 빌드: 서버(/ws)와 통신.  demo 빌드: 서버 없이 한 파일로 동작하는 체험판.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [viteSingleFile()] : [])],
  server: { proxy: { '/ws': { target: 'ws://localhost:3000', ws: true } } },
}));
