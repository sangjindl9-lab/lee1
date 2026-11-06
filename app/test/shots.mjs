// 홈·PDF·DWG 화면만 찍는다(디자인 확인용)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = new URL('../www', import.meta.url).pathname, out = new URL('./out', import.meta.url).pathname; mkdirSync(out, { recursive: true });
const server = createServer((req, res) => { const p = join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0])); if (!existsSync(p) || statSync(p).isDirectory()) { res.statusCode = 404; return res.end(); } res.setHeader('content-type', { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png' }[extname(p)] || 'application/octet-stream'); res.end(readFileSync(p)); }).listen(8767);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8767/');
await page.evaluate(() => localStorage.setItem('eumviewer.recents', JSON.stringify([{ uri: 'x:1', name: '전기공사 1단계 검측요청서.pdf', t: Date.now() }, { uri: 'x:2', name: '3층 전기 평면도.dwg', t: Date.now() - 86400000 }])));
await page.reload(); await page.waitForTimeout(600);
await page.screenshot({ path: join(out, 'd0-home.png') });
for (const [f, n] of [['sample.pdf', 'd1-pdf'], ['wipeout_door.dxf', 'd2-dxf']]) {
  const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open')]);
  await ch.setFiles('/tmp/samples/' + f);
  await page.waitForFunction(() => document.getElementById('tools').children.length > 0); await page.waitForTimeout(1500);
  await page.click('#tools .tool:nth-child(2)'); await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, n + '.png') });
  await page.click('#back'); await page.waitForTimeout(300);
}
await browser.close(); server.close();
