/** 저장소 모의(mock)와 무관하게 로컬 테스트 저장소의 실제 파일을 읽는다 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const root = () => path.resolve(process.cwd(), process.env.STORAGE_ROOT ?? "./test-storage");

export async function storedSize(rel: string): Promise<number | null> {
  try {
    return (await fs.stat(path.join(root(), rel))).size;
  } catch {
    return null;
  }
}

export async function sha256Of(rel: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await fs.readFile(path.join(root(), rel))).digest("hex");
  } catch {
    return null;
  }
}
