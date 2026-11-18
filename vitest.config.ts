import { defineConfig, loadEnv } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const testUrl = env.TEST_DATABASE_URL || env.DATABASE_URL;

  return {
    server: { host: "127.0.0.1", hmr: { host: "127.0.0.1" } },
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
      testTimeout: 30000,
      hookTimeout: 60000,
      env: {
        DATABASE_URL: testUrl,
        APP_SECRET: env.APP_SECRET || "test-secret",
        VAULT_MASTER_KEY: env.VAULT_MASTER_KEY || "test-vault-key-0123456789abcdef",
        VAULT_DIR: "./.vault-test",
        MOCKPG_WEBHOOK_SECRET: env.MOCKPG_WEBHOOK_SECRET || "test-webhook-secret",
        NODE_ENV: "test",
      },
    },
  };
});
