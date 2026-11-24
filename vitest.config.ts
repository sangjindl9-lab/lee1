import { defineConfig } from "vitest/config";
import path from "node:path";
import { testDatabaseUrl } from "./tests/test-db";

const DATABASE_URL = testDatabaseUrl();

export default defineConfig({
  server: { host: "127.0.0.1" },
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 180000,
    hookTimeout: 180000,
    env: {
      DATABASE_URL,
      APP_SECRET: "test-secret",
      NODE_ENV: "test",
      STORAGE_ROOT: "./test-storage",
      WORKER_MODE: "off",
      // 실제 Google·저장소에 닿지 않도록 비운다 (Mock 만 사용)
      GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: "",
      S3_ENDPOINT: "",
      S3_BUCKET: "",
      PLAY_PACKAGE_NAME: "kr.eumsoft.familyalbum",
    },
  },
});
