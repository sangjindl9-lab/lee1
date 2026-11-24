// 스토어용 스크린샷(언어별): node test/storeshots.mjs en-US out-dir
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, extname } from 'node:path';
const [locale = 'en-US', out = '/tmp/l10n/shots'] = process.argv.slice(2);
const L = locale.slice(0, 2);
mkdirSync(out, { recursive: true });
const root = new URL('../www', import.meta.url).pathname;
const server = createServer((req, res) => { const p = join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])); if (!existsSync(p) || statSync(p).isDirectory()) { res.statusCode = 404; return res.end(); } res.setHeader('content-type', { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png' }[extname(p)] || 'application/octet-stream'); res.end(readFileSync(p)); }).listen(8780);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, hasTouch: true, locale, timezoneId: 'Asia/Seoul' });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.route(/railway\.app/, (r) => r.abort());
const T = {
  en: { recents: ['Phase 1 Inspection Request.pdf', '3F Electrical Floor Plan.dwg', 'Telecom Riser Diagram.dxf'], pdf: 'Inspection_Request.pdf', note: 'Checked OK' },
  ja: { recents: ['第1段階 検査依頼書.pdf', '3階 電気平面図.dwg', '通信幹線系統図.dxf'], pdf: '検査依頼書.pdf', note: '確認済み 問題なし' },
}[L];
const shot = (n) => page.screenshot({ path: join(out, n + '.png') });
await page.goto('http://localhost:8780/');
const now = new Date('2026-11-06T22:58:00+09:00').getTime();
await page.evaluate(([names, now]) => localStorage.setItem('eumviewer.recents', JSON.stringify(names.map((name, i) => ({ uri: 'x:' + i, name, t: now - i * 86400000 })))), [T.recents, now]);
await page.reload(); await page.waitForTimeout(800);
await shot('1-home');

async function open(file, asName) {
  copyFileSync(file, '/tmp/l10n/' + asName);
  const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open')]);
  await ch.setFiles({ name: asName, mimeType: 'application/octet-stream', buffer: readFileSync(file) });
  await page.waitForTimeout(1500); const tt = await page.evaluate(() => document.getElementById('toast').textContent); if (tt) console.log('toast:', tt);
  await page.waitForFunction(() => document.getElementById('tools').children.length > 0, null, { timeout: 40000 }).catch(async (e) => { await shot('stuck'); console.log('stuck', await page.evaluate(() => document.body.innerText.slice(0, 300))); throw e; });
  await page.waitForTimeout(1800);
  await page.evaluate(() => document.querySelector('.dialog .primary')?.click());
}
const tool = (i) => page.click(`#tools .tool:nth-child(${i})`).then(() => page.waitForTimeout(250));
async function pageBox() { return page.locator('#content canvas').first().boundingBox(); }
const P = (b, x, y) => ({ x: b.x + x / 595 * b.width, y: b.y + y / 842 * b.height }); // PDF pt(위에서부터)
async function drag(a, c, steps = 12) { await page.mouse.move(a.x, a.y); await page.mouse.down(); for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + (c.x - a.x) * i / steps, a.y + (c.y - a.y) * i / steps); await page.mouse.up(); await page.waitForTimeout(200); }
async function tap(p) { await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(350); }

// PDF 편집
await open(`/tmp/samples/sample-${L}.pdf`, T.pdf);
let b = await pageBox();
await tool(4); await drag(P(b, 60, 140), P(b, 420, 140)); // 형광펜(축척 글자 위)
await tool(6);
await drag(P(b, 330, 330), P(b, 520, 450));
await tool(5); await tap(P(b, 330, 560));
await page.fill('.dialog textarea', T.note); await page.fill('.dialog input[type=number]', '20'); await page.click('.dialog .primary'); await page.waitForTimeout(400);
await tool(6); await page.waitForTimeout(1200);
await shot('2-pdf-edit');

// PDF 측정
await tool(1);
await tool(10);
await page.click('#tools .tool:nth-child(6)'); await page.waitForTimeout(300); // 축척
await page.fill('.dialog input', '100'); await page.click('.dialog .primary'); await page.waitForTimeout(400);
b = await pageBox();
await tap(P(b, 60, 242)); await tap(P(b, 60 + 141.7, 242));
await page.click('#tools .tool:nth-child(4)'); await page.waitForTimeout(250); await page.click('#tools .tool:nth-child(3)'); await page.waitForTimeout(250);
await tap(P(b, 60, 392)); await tap(P(b, 260, 392)); await tap(P(b, 260, 542)); await tap(P(b, 60, 542));
await page.click('#tools .tool:nth-child(4)'); await page.waitForTimeout(1200);
await shot('3-pdf-measure');
// 나가기 → 닫기(저장 안 함)
await page.click('#back'); await page.waitForTimeout(400);
const disc = await page.$$('.sheet-item'); if (disc.length > 1) await disc[1].click(); else await page.evaluate(() => document.querySelector('.dialog .primary')?.click());
await page.waitForTimeout(600);

// CAD
await open('/tmp/samples/example_2000.dwg', 'Sample_Drawing.dwg');
await page.waitForTimeout(3500);
await shot('4-cad');
const s = await page.locator('#stage').boundingBox();
await tool(2);
await tap({ x: s.x + s.width * 0.18, y: s.y + s.height * 0.46 });
await tap({ x: s.x + s.width * 0.80, y: s.y + s.height * 0.46 });
await page.waitForTimeout(1200);
await shot('5-cad-measure');
await browser.close(); server.close();
console.log('done', locale);
