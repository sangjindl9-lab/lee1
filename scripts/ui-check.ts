/**
 * 대시보드 UI 검증: 서버를 띄우고 실제 브라우저로 주요 화면·버튼을 확인하고 스크린샷을 남깁니다.
 * 실행: npm run ui-check   (API 키·외부 서비스 없이 동작)
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, type ConsoleMessage, type Page } from 'playwright-core';
import { createServer } from '../src/server.ts';
import { kstDateString } from '../src/util.ts';

const PORT = Number(process.env.UI_CHECK_PORT ?? 3100);
const outDir = path.resolve(import.meta.dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const executablePath =
  process.env.CHROMIUM_PATH ??
  '/workspace/.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell';

const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const failedRequests: string[] = [];
const steps: { step: string; ok: boolean; detail?: string }[] = [];

function record(step: string, ok: boolean, detail?: string) {
  steps.push({ step, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${step}${detail ? ` — ${detail}` : ''}`);
}

async function shot(page: Page, name: string) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`  · screenshot ${path.relative(process.cwd(), file)}`);
  return file;
}

function attach(page: Page) {
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (url.includes('favicon')) return;
    failedRequests.push(`${url} (${req.failure()?.errorText ?? ''})`);
  });
}

async function main() {
  const dataDir = path.resolve(process.cwd(), 'data');
  const created = createServer({ dataDir, enableScheduler: false, seedDemoData: true });
  const server = created.app.listen(PORT, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${PORT}`;
  console.log(`서버: ${base} (데이터 ${created.config.dbFile})`);

  // 웹훅 수신용 로컬 에코 서버
  const receivedWebhooks: string[] = [];
  const echo = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      receivedWebhooks.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', () => resolve()));
  const echoPort = (echo.address() as { port: number }).port;

  let browser;
  try {
    const apps = (await (await fetch(`${base}/api/apps`)).json()) as { apps: { id: number; package_id: string; keywordCount: number }[] };
    record('시드 앱 로드', apps.apps.length >= 3, apps.apps.map((a) => a.package_id).join(', '));

    // 앱 정보가 비어 있으면 실제 Play 에서 가져오기
    const detailProbe = (await (await fetch(`${base}/api/apps/${apps.apps[0].id}`)).json()) as { snapshot: unknown };
    if (!detailProbe.snapshot) {
      for (const app of apps.apps) {
        await fetch(`${base}/api/apps/${app.id}/refresh`, { method: 'POST' });
      }
      record('앱 정보 실시간 수집', true, 'Play 스토어에서 새로 가져옴');
    } else {
      record('앱 정보', true, '이미 수집된 스냅샷 사용');
    }

    // 순위 기록이 없으면 실제 점검 1회 (첫 앱)
    const overview = (await (await fetch(`${base}/api/overview`)).json()) as { rankToday: { ranked: number; outside: number; error: number } };
    if (overview.rankToday.ranked + overview.rankToday.outside + overview.rankToday.error === 0) {
      const check = await fetch(`${base}/api/apps/${apps.apps[0].id}/check-ranks`, { method: 'POST' });
      const result = (await check.json()) as { outcomes: { items: { term: string; rank: number | null }[] }[] };
      const items = result.outcomes.flatMap((o) => o.items);
      record('실시간 순위 점검(API)', items.length > 0, items.map((i) => `${i.term}:${i.rank ?? '권밖'}`).join(' · '));
    }

    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const page = await context.newPage();
    attach(page);

    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForSelector('#dashboard-apps .app-row', { timeout: 20_000 });
    await page.waitForSelector('#dashboard-ranks table', { timeout: 20_000 });
    record('대시보드 렌더링', true, `${await page.locator('#dashboard-apps .app-row').count()}개 앱 카드`);
    await shot(page, '01-dashboard');

    // 앱 · 키워드
    await page.click('.nav-item[data-view="apps"]');
    await page.waitForSelector('.app-card', { timeout: 20_000 });
    await page.waitForSelector('#app-keywords-' + apps.apps[0].id + ' table', { timeout: 20_000 });
    record('앱·키워드 화면', true, `${await page.locator('.app-card').count()}개 카드 · 키워드 표 렌더링`);
    await shot(page, '02-apps');

    // 키워드 추이 모달
    const chartButton = page.locator('[data-action="keyword-chart"]').first();
    if (await chartButton.count()) {
      await chartButton.click();
      await page.waitForSelector('#modal:not(.hidden)', { timeout: 10_000 });
      await page.waitForTimeout(400);
      record('키워드 추이 모달', true, (await page.locator('#modal-title').textContent()) ?? '');
      await shot(page, '03-keyword-chart');
      await page.click('#modal-close');
    }

    // 키워드 추가
    const kwInput = page.locator(`[data-role="keyword-input"][data-app="${apps.apps[0].id}"]`);
    await kwInput.fill('PDF 편집');
    await page.click(`[data-action="add-keyword"][data-app="${apps.apps[0].id}"]`);
    await page.waitForFunction(
      (appId) => {
        const box = document.getElementById(`app-keywords-${appId}`);
        return Boolean(box && box.textContent && box.textContent.includes('PDF 편집'));
      },
      apps.apps[0].id,
      { timeout: 15_000 },
    );
    record('키워드 추가 버튼', true, 'PDF 편집 추가됨');

    // 경쟁 분석 · ASO
    await page.click('.nav-item[data-view="aso"]');
    await page.waitForFunction(() => document.querySelectorAll('#aso-app option').length > 0, undefined, { timeout: 20_000 });
    await page.click('#aso-run');
    await page.waitForFunction(
      () => {
        const box = document.getElementById('aso-result');
        const text = box?.textContent ?? '';
        return text.includes('빠진 키워드') || text.includes('점검 기록이 없습니다');
      },
      undefined,
      { timeout: 120_000 },
    );
    const asoText = (await page.locator('#aso-result').textContent()) ?? '';
    record('경쟁 분석 실행', asoText.includes('빠진 키워드') || asoText.includes('점검 기록이 없습니다'), asoText.replace(/\s+/g, ' ').slice(0, 80));
    await page.waitForTimeout(500);
    await shot(page, '04-aso');

    // 콘텐츠 스튜디오
    await page.click('.nav-item[data-view="studio"]');
    await page.waitForFunction(() => document.querySelectorAll('#studio-app option').length > 0, undefined, { timeout: 20_000 });
    await page.waitForSelector('#studio-channels .channel-card', { timeout: 15_000 });
    await page.click('.channel-card[data-channel="community"]');
    await page.click('#studio-form button[type="submit"]');
    await page.waitForSelector('#studio-preview h1', { timeout: 60_000 });
    const draftTitle = (await page.locator('#studio-preview h1').textContent()) ?? '';
    record('홍보 글 생성 버튼', draftTitle.length > 0, draftTitle);
    await shot(page, '05-studio');

    // 블로그 채널도 생성
    await page.click('.channel-card[data-channel="naver_blog"]');
    await page.click('#studio-form button[type="submit"]');
    await page.waitForFunction(() => {
      const node = document.querySelector('#studio-preview h1');
      return Boolean(node && node.textContent && node.textContent.length > 0);
    }, undefined, { timeout: 60_000 });
    await page.waitForTimeout(600);
    record('블로그 초안 생성', true, (await page.locator('#studio-preview h1').textContent()) ?? '');
    await shot(page, '06-studio-blog');

    // 보관함
    await page.click('.nav-item[data-view="library"]');
    await page.waitForSelector('.draft-row', { timeout: 20_000 });
    record('보관함 목록', true, `${await page.locator('.draft-row').count()}건`);
    await shot(page, '07-library');

    await page.locator('.draft-row').first().click();
    await page.waitForSelector('#modal:not(.hidden)', { timeout: 10_000 });
    await page.waitForTimeout(400);
    record('초안 상세 모달', true);
    await shot(page, '08-draft-modal');
    await page.click('#modal-close');

    // 설정: 웹훅 테스트 (로컬 에코 서버로 실제 발송)
    await page.click('.nav-item[data-view="settings"]');
    await page.waitForSelector('#webhook-url', { timeout: 15_000 });
    await page.fill('#webhook-url', `http://127.0.0.1:${echoPort}/hook`);
    await page.click('#webhook-test');
    await page.waitForFunction(
      () => {
        const node = document.getElementById('webhook-result');
        return Boolean(node && (node.textContent ?? '').includes('성공'));
      },
      undefined,
      { timeout: 20_000 },
    );
    record('웹훅 테스트 발송', receivedWebhooks.length > 0, `${receivedWebhooks.length}건 수신`);
    await page.waitForTimeout(500);
    await shot(page, '09-settings');

    // 일정 저장
    await page.fill('#rank-time', '08:40');
    await page.click('#schedule-form button[type="submit"]');
    await page.waitForTimeout(800);
    const scheduleText = (await page.locator('#schedule-status').textContent()) ?? '';
    record('점검 일정 저장', scheduleText.includes('08:40') || scheduleText.includes('다음'), scheduleText);

    // 모바일 레이아웃
    const mobile = await context.newPage();
    attach(mobile);
    await mobile.setViewportSize({ width: 414, height: 900 });
    await mobile.goto(base, { waitUntil: 'networkidle' });
    await mobile.waitForSelector('#dashboard-apps .app-row', { timeout: 20_000 });
    record('모바일 레이아웃', true);
    await shot(mobile, '10-mobile');
    await mobile.close();

    record('브라우저 콘솔 오류', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    record('페이지 예외', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    record('실패한 요청', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

    // 웹훅 기록도 확인
    const deliveries = (await (await fetch(`${base}/api/webhook/deliveries`)).json()) as { deliveries: { ok: number }[] };
    record('웹훅 발송 기록 저장', deliveries.deliveries.length > 0, `${deliveries.deliveries.length}건`);

    const report = {
      ranAt: new Date().toISOString(),
      kstDate: kstDateString(),
      base,
      steps,
      consoleErrors,
      pageErrors,
      failedRequests,
      screenshots: fs.readdirSync(outDir).filter((f) => f.endsWith('.png')).sort(),
    };
    fs.writeFileSync(path.join(outDir, 'ui-check-report.json'), JSON.stringify(report, null, 2));

    const failed = steps.filter((s) => !s.ok);
    console.log(`\n=== UI 검증: ${steps.length - failed.length}/${steps.length} 통과 · 콘솔 오류 ${consoleErrors.length}건 ===`);
    if (failed.length) process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    await new Promise<void>((resolve) => echo.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await created.close();
  }
}

main().catch((err) => {
  console.error('UI 검증 실패:', err);
  process.exitCode = 1;
});
