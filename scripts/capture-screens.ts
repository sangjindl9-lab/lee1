/**
 * 최종 데이터 기준 화면 캡처(읽기 전용).
 * 서버를 띄우고 주요 화면을 렌더링해 docs/screenshots 에 저장하며 콘솔 오류를 확인합니다.
 * 실행: node scripts/capture-screens.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type ConsoleMessage, type Page } from 'playwright-core';
import { createServer } from '../src/server.ts';

const PORT = Number(process.env.CAPTURE_PORT ?? 3212);
const outDir = path.resolve(import.meta.dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });
const executablePath =
  process.env.CHROMIUM_PATH ?? '/workspace/.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell';

const consoleErrors: string[] = [];
const pageErrors: string[] = [];

async function shot(page: Page, name: string) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  · ${path.relative(process.cwd(), file)}`);
}

const created = createServer({ dataDir: path.resolve(process.cwd(), 'data'), enableScheduler: false, seedDemoData: true });
const server = created.app.listen(PORT, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', () => resolve()));
const base = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const page = await context.newPage();
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('#dashboard-apps .app-row', { timeout: 20_000 });
  await page.waitForSelector('#dashboard-ranks table', { timeout: 20_000 });
  console.log(`대시보드: 앱 ${await page.locator('#dashboard-apps .app-row').count()}개 · 순위 행 ${await page.locator('#dashboard-ranks tbody tr').count()}개`);
  await shot(page, '01-dashboard');

  await page.click('.nav-item[data-view="apps"]');
  await page.waitForSelector('.app-card', { timeout: 20_000 });
  console.log(`앱·키워드: 카드 ${await page.locator('.app-card').count()}개`);
  await shot(page, '02-apps');

  await page.click('.nav-item[data-view="aso"]');
  await page.waitForFunction(() => document.querySelectorAll('#aso-app option').length > 0, undefined, { timeout: 20_000 });
  await page.click('#aso-run');
  await page.waitForFunction(
    () => (document.getElementById('aso-result')?.textContent ?? '').includes('빠진 키워드'),
    undefined,
    { timeout: 120_000 },
  );
  await page.waitForSelector('#aso-saved .panel', { timeout: 20_000 });
  console.log('경쟁 분석·ASO: 저장된 ASO 개편안 패널 포함 렌더링');
  await shot(page, '04-aso');

  await page.click('.nav-item[data-view="library"]');
  await page.waitForSelector('.draft-row', { timeout: 20_000 });
  console.log(`보관함: 초안 ${await page.locator('.draft-row').count()}건`);
  await shot(page, '07-library');

  console.log(`콘솔 오류 ${consoleErrors.length}건 · 페이지 예외 ${pageErrors.length}건`);
  if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await created.close();
}
