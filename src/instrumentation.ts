/** 서버가 뜰 때 한 번: 작업 처리 루프 시작 + 저장소 CORS 설정 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.WORKER_MODE === "off") return;
  const { startWorker } = await import("./lib/jobs");
  startWorker();
  const { ensureBucketCors } = await import("./lib/storage");
  const origins = (process.env.CORS_ORIGINS ?? process.env.NEXT_PUBLIC_APP_URL ?? "*").split(",").map((s) => s.trim());
  void ensureBucketCors(origins);
}
