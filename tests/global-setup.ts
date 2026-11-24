import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { testDatabaseUrl } from "./test-db";

/** 테스트마다 깨끗한 로컬 임시 PostgreSQL·스토리지를 준비한다. */
export default async function setup() {
  const root = process.cwd();
  execSync("npx prisma db push --force-reset --skip-generate --accept-data-loss", {
    cwd: root,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: "pipe",
  });
  fs.rmSync(path.join(root, "test-storage"), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, "test-storage"), { recursive: true });
}
