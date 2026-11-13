// 브라우저(휴대폰 크기)로 화면을 열어 PDF·DWG·DXF 열기, 그리기, 저장까지 돌려 본다.
// 사용: node test/run.mjs  (www/ 가 빌드돼 있어야 함)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = new URL('../www', import.meta.url).pathname;
const samples = process.env.SAMPLES || '/tmp/samples';
const out = new URL('./out', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.bcmap': 'application/octet-stream' };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(p) || statSync(p).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', types[extname(p)] || 'application/octet-stream');
  res.end(readFileSync(p));
}).listen(8765);

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true, locale: 'ko-KR' });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });

async function open(file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open')]);
  await chooser.setFiles(file);
  await page.waitForFunction(() => document.getElementById('viewer').hidden === false && document.getElementById('tools').children.length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
}
async function shot(name) { await page.screenshot({ path: join(out, name + '.png') }); console.log('shot', name); }
async function tool(label) { await page.click(`#tools .tool:has-text("${label}")`); await page.waitForTimeout(200); }
async function stagePt(x, y) { const b = await page.locator('#stage').boundingBox(); return { x: b.x + x, y: b.y + y }; }
async function tap(x, y) { const p = await stagePt(x, y); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(250); }
async function drag(x1, y1, x2, y2) {
  const a = await stagePt(x1, y1), b = await stagePt(x2, y2);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8);
  await page.mouse.up(); await page.waitForTimeout(200);
}
async function dialog(values, okLabel = '확인') {
  await page.waitForSelector('.dialog');
  for (const [i, v] of values.entries()) {
    const inp = page.locator('.dialog input, .dialog textarea, .dialog select').nth(i);
    if (await inp.evaluate((e) => e.tagName) === 'SELECT') await inp.selectOption(String(v)); else await inp.fill(String(v));
  }
  await page.click(`.dialog .btn:has-text("${okLabel}")`);
  await page.waitForTimeout(200);
}

await page.goto('http://localhost:8765/');
await shot('00-home');

// ── PDF ──
await open(join(samples, 'sample.pdf'));
await shot('10-pdf-open');
console.log('pdf tools:', (await page.locator('#tools .tool').allInnerTexts()).map(t=>t.replace(/\s+/g,'')).join(','), '| kind:', await page.locator('#kind').textContent(), '| save hidden:', await page.locator('#save').isHidden());
await tool('펜'); await drag(120, 300, 260, 360); await drag(260, 360, 150, 420);
await tool('형광펜'); await drag(100, 125, 300, 125);
await tool('글'); await tap(100, 500); await dialog(['메모 테스트\n둘째 줄', 14]);
await tool('도형'); await drag(220, 420, 330, 520); // 사각형
await tool('도형'); await page.click('.sheet-item:has-text("화살표")'); await drag(120, 300, 300, 380);
await shot('11-pdf-annot');
await tool('글자고치기'); await page.waitForTimeout(800); await shot('12-pdf-textboxes');
// 첫 쪽 제목 글자 위치: 쪽 좌표 (60, 842-760-20) → 화면 좌표로 변환
const pt = await page.evaluate(() => { const pg = document.querySelector('.page'); const r = pg.getBoundingClientRect(); const st = document.getElementById('stage').getBoundingClientRect(); const s = r.width / pg.offsetWidth; return { x: r.left - st.left + 70 * s, y: r.top - st.top + 72 * s }; });
await tap(pt.x, pt.y); await dialog(['검측요청서 수정본']);
await tool('양식'); await page.waitForTimeout(800);
const wpt = await page.evaluate(() => { const pg = document.querySelector('.page'); const r = pg.getBoundingClientRect(); const st = document.getElementById('stage').getBoundingClientRect(); const s = r.width / pg.offsetWidth; return { x: r.left - st.left + 400 * s, y: r.top - st.top + (842 - 712) * s, cx: r.left - st.left + 310 * s, cy: r.top - st.top + (842 - 660) * s }; });
await tap(wpt.x, wpt.y); await dialog(['홍길동']);
await tap(wpt.cx, wpt.cy);
await shot('13-pdf-form');
await tool('측정'); await tool('축척'); await dialog([100]);
await tool('거리');
const lp = await page.evaluate(() => { const pg = document.querySelector('.page'); const r = pg.getBoundingClientRect(); const st = document.getElementById('stage').getBoundingClientRect(); const s = r.width / pg.offsetWidth; return { x1: r.left - st.left + 60 * s, y: r.top - st.top + (842 - 600) * s, x2: r.left - st.left + (60 + 50 / (25.4 / 72)) * s }; });
await tap(lp.x1, lp.y); await tap(lp.x2, lp.y); await tool('완료');
const label = await page.locator('.mlabel').first().textContent();
console.log('measure label (expect ≈ 5.00 m at 1:100):', label);
await shot('14-pdf-measure');
await tool('나가기');
// 쪽 관리: 3쪽 회전, 2쪽 삭제
await tool('쪽'); await page.waitForTimeout(800); await shot('15-pages');
await page.locator('.prow').nth(2).locator('button:has-text("⟳")').click();
await page.locator('.prow').nth(1).locator('button:has-text("✕")').click(); await page.click('.dialog .btn:has-text("지우기")');
await page.click('.panel-head .btn'); await page.waitForTimeout(500);
await shot('16-after-pages');
// 저장(브라우저에서는 다운로드)
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
await dl.saveAs(join(out, 'saved.pdf'));
console.log('saved.pdf', statSync(join(out, 'saved.pdf')).size, 'bytes');
await page.waitForTimeout(500);
await goHome();
async function goHome() {
  await page.click('#back'); await page.waitForTimeout(400);
  if (await page.locator('.sheet').count()) await page.click('.sheet-item:has-text("저장하지 않고")');
  else if (await page.locator('.dialog').count()) await page.click('.dialog .btn.primary');
  await page.waitForTimeout(400);
}

// ── DWG ──
await open(join(samples, 'example_2000.dwg'));
await shot('20-dwg');
await tool('레이어'); await shot('21-dwg-layers'); await page.click('.sheet-cancel');
await tool('거리'); await tap(120, 300); await tap(260, 380); await tool('완료');
console.log('dwg measure:', await page.locator('.mlabel').first().textContent());
await shot('22-dwg-measure');
console.log('dwg tools:', (await page.locator('#tools .tool').allInnerTexts()).map(t=>t.replace(/\s+/g,'')).join(','), '| kind:', await page.locator('#kind').textContent(), '| save hidden:', await page.locator('#save').isHidden());
await goHome();

// ── DXF ──
for (const [i, f] of ['wipeout_door.dxf', 'text.dxf', 'Leader.dxf'].entries()) {
  await open(join(samples, f));
  await shot('3' + i + '-' + f.replace('.dxf', ''));
  await goHome();
}

console.log('page errors:', errors.length);
await browser.close();
server.close();
