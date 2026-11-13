import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// tests/client 는 jsdom, 나머지(tests/shared, tests/server, tests/e2e)는 node 환경에서 실행합니다.
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
          exclude: ['tests/client/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['tests/client/**/*.test.ts', 'tests/client/**/*.test.tsx'],
          setupFiles: ['tests/setup.ts'],
        },
      },
    ],
  },
});
