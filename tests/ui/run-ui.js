// 브라우저 UI 시나리오 테스트 (Playwright). 실행 중인 서버 주소를 UI_BASE 로 지정.
// node tests/ui/run-ui.js  → 단계별 결과와 스크린샷(tests/ui/out/*.png)
import { chromium, devices } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.UI_BASE || 'http://127.0.0.1:8080';
const OUT = path.join(import.meta.dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const SAMPLE = path.join(import.meta.dirname, '..', '..', 'samples', 'enclosure_assembly.step');
const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push(['PASS', name, Date.now() - t0]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, e.message); throw e; }
};
// 캔버스가 실제로 그려졌는지(단색이 아닌지) 픽셀 분산으로 확인
const canvasStd = (page) => page.evaluate(() => {
  const c = document.querySelector('canvas'); const g = document.createElement('canvas'); g.width = 120; g.height = 80;
  const x = g.getContext('2d'); x.drawImage(c, 0, 0, 120, 80); const d = x.getImageData(0, 0, 120, 80).data;
  let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; s += v; s2 += v * v; n++; }
  return Math.sqrt(s2 / n - (s / n) ** 2);
});

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let shareUrl;
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const email = `ui-${Date.now()}@test.kr`;

  await step('회원가입(회사 계정)', async () => {
    await page.goto(`${BASE}/signup`);
    await page.getByLabel('회사명').fill('이음테스트 주식회사');
    await page.getByLabel('이름').fill('홍길동');
    await page.getByLabel('이메일').fill(email);
    await page.getByLabel('비밀번호').fill('password123');
    await page.getByRole('button', { name: '가입하고 시작하기' }).click();
    await page.getByRole('heading', { name: '프로젝트' }).waitFor();
  });
  await step('프로젝트 생성(산업 분야 선택)', async () => {
    await page.getByRole('button', { name: '＋ 새 프로젝트' }).first().click();
    await page.getByLabel('프로젝트명').fill('IP66 방수 제어함');
    await page.getByRole('button', { name: '전기·정보통신' }).click();
    await page.getByRole('button', { name: '만들기' }).click();
    await page.waitForURL(/\/app\/p\//);
  });
  await step('STEP 업로드 → 자동 변환 → 3D 표시', async () => {
    await page.locator('[data-testid=file-input]').setInputFiles(SAMPLE);
    await page.locator('[data-testid=model-row]').first().waitFor({ timeout: 90000 });
    await page.locator('[data-testid=model-row]').first().click();
    await page.locator('[data-testid=part-row]').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const sd = await canvasStd(page);
    if (sd < 4) throw new Error('캔버스가 비어 있음 std=' + sd);
    await page.screenshot({ path: path.join(OUT, '01-workspace.png') });
  });
  await step('부품 트리 18개 + 부품 선택 → 속성 패널', async () => {
    const n = await page.locator('[data-testid=part-row]').count();
    if (n !== 18) throw new Error('부품 수 ' + n);
    await page.locator('[data-testid=part-row]', { hasText: '상부_커버' }).click();
    await page.locator('[data-testid=part-props]').waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '02-select.png') });
  });
  await step('3D 화면 클릭으로 부품 선택', async () => {
    await page.locator('[data-testid=part-props] button', { hasText: '✕' }).click();
    const box = await page.locator('[data-testid=viewer] canvas').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('[data-testid=part-props]').waitFor({ timeout: 5000 });
  });
  await step('분해도 슬라이더 → 전체 분해', async () => {
    await page.getByRole('button', { name: '분해도' }).click();
    await page.getByRole('button', { name: '전체 분해' }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, '03-exploded.png') });
  });
  await step('부품 분해 방향 수정 → 저장', async () => {
    await page.locator('[data-testid=part-row]', { hasText: '후면_방열판' }).click();
    await page.locator('[data-testid=part-props] button', { hasText: '+X' }).click();
    await page.locator('[data-testid=save]').click();
    await page.locator('[data-testid=save]', { hasText: '저장됨' }).waitFor();
  });
  await step('조립 애니메이션 재생', async () => {
    await page.locator('[data-testid=play]').click();
    await page.waitForTimeout(6500);
    await page.screenshot({ path: path.join(OUT, '04-playing.png') });
    await page.locator('[data-testid=play]').click();
  });
  await step('공유 링크 생성 + QR', async () => {
    await page.getByRole('button', { name: '공유', exact: true }).click();
    await page.locator('[data-testid=share-create]').click();
    await page.locator('[data-testid=share-url]').first().waitFor();
    shareUrl = await page.locator('[data-testid=share-url]').first().inputValue();
    await page.getByRole('button', { name: 'QR코드' }).first().click();
    await page.locator('[data-testid=qr]').waitFor();
    await page.screenshot({ path: path.join(OUT, '05-share.png') });
  });
  await step('라이트 모드 전환', async () => {
    await page.getByTitle('다크/라이트 모드').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '06-light.png') });
    await page.getByTitle('다크/라이트 모드').click();
  });
  if (errors.length) throw new Error('페이지 오류: ' + errors.join(' | '));

  // 다른 기기(스마트폰)에서 공유 URL 열기 — 로그인 없음
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const m = await phone.newPage();
  await step('스마트폰에서 공유 URL 접속(비로그인) → 3D 표시', async () => {
    await m.goto(shareUrl.replace(/^https?:\/\/[^/]+/, BASE));
    await m.locator('[data-testid=share-page] canvas').waitFor({ timeout: 30000 });
    await m.waitForTimeout(2500);
    const sd = await canvasStd(m);
    if (sd < 4) throw new Error('모바일 캔버스 비어 있음 ' + sd);
    await m.screenshot({ path: path.join(OUT, '07-mobile.png') });
  });
  await step('모바일: 분해 실행 → 부품 정보 확인', async () => {
    await m.getByRole('button', { name: '분해', exact: true }).tap();
    await m.waitForTimeout(800);
    await m.locator('[data-testid=parts-toggle]').tap();
    await m.getByRole('button', { name: '후면_방열판' }).tap();
    await m.locator('[data-testid=share-part-card]').waitFor();
    await m.locator('[data-testid=parts-toggle]').tap();
    await m.waitForTimeout(500);
    await m.screenshot({ path: path.join(OUT, '08-mobile-exploded.png') });
  });
  await step('모바일: 터치 회전', async () => {
    const before = await m.evaluate(() => document.querySelector('canvas').toDataURL().length);
    const cdp = await phone.newCDPSession(m);
    const pts = (x) => [{ x, y: 380 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(120) });
    for (let x = 130; x <= 300; x += 15) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(x) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await m.waitForTimeout(800);
    const after = await m.evaluate(() => document.querySelector('canvas').toDataURL().length);
    if (before === after) throw new Error('터치 후 화면 변화 없음');
    await m.screenshot({ path: path.join(OUT, '09-mobile-rotated.png') });
  });
  await phone.close();

  await step('동영상 탭: MP4 렌더 요청 → 완료 → 플레이어', async () => {
    await page.getByRole('button', { name: '동영상 제작' }).click();
    const clips = page.locator('[data-testid=clip]');
    // 테스트 시간을 줄이려고 클립을 3개로 줄임
    while ((await clips.count()) > 3) await clips.last().locator('button', { hasText: '✕' }).click();
    await page.locator('select').filter({ hasText: 'Full HD' }).selectOption('hd');
    await page.locator('[data-testid=render-go]').click();
    await page.locator('[data-testid=video-row]').first().waitFor({ timeout: 240000 });
    await page.screenshot({ path: path.join(OUT, '10-video.png') });
  });
} finally {
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ base: BASE, results }, null, 2));
}
