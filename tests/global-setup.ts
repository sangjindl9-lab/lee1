import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** 테스트마다 깨끗한 SQLite DB·스토리지를 준비한다. */
export default async function setup() {
  const root = process.cwd();
  const databaseUrl = "file:./test.db";
  execSync("npx prisma db push --force-reset --skip-generate", {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });
  for (const rel of ["test-storage", "prisma/test.db-journal"]) {
    fs.rmSync(path.join(root, rel), { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(root, "test-storage"), { recursive: true });
}
