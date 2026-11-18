// 서버 시작 시 1회: DB 준비, 최고관리자·기본 수수료 생성, 주기 작업 시작
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { initDb } = await import('./server/db.ts');
  const { bootstrap } = await import('./server/auth.ts');
  const { runJobs } = await import('./server/trade.ts');
  await initDb(); await bootstrap();
  const g = globalThis as any;
  if (!g.__eumJobs && !process.env.DISABLE_JOBS) g.__eumJobs = setInterval(() => { runJobs().then((l) => l.length && console.error('[jobs]', l.join(' / '))).catch((e) => console.error('[jobs]', e)); }, 60_000);
}
