// 홈 화면 "파일 열기" 버튼이 눌리지 않는지, PDF 안 검색이 되는지 본다. 사용: node test/search.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = new URL('../www', import.meta.url).pathname;
const samples = process.env.SAMPLES || '/tmp/samples';
const out = new URL('./out', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ttf': 'font/ttf' };
const server = createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const p = join(root, u === '/' ? 'index.html' : u);
  if (!existsSync(p) || statSync(p).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', types[extname(p)] || 'application/octet-stream');
  res.end(readFileSync(p));
}).listen(8766);
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, hasTouch: true, locale: 'ko-KR' });
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); process.exitCode = 1; });
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };

// 최근 문서가 화면보다 많아도 "파일 열기" 버튼이 눌려 잘리지 않아야 한다
await page.addInitScript((key) => {
  localStorage.setItem(key, JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ uri: 'x' + i, name: `문서${i}.pdf`, t: Date.now() }))));
}, 'eumviewer.recents');
await page.goto('http://localhost:8766/');
await page.waitForTimeout(500);
const btn = await page.$eval('#open', (b) => ({ h: b.clientHeight, sh: b.scrollHeight, n: document.querySelectorAll('.recent').length }));
ok(btn.n === 12 && btn.h >= btn.sh && btn.h > 100, `파일 열기 버튼 높이 ${btn.h}px (내용 ${btn.sh}px, 최근 문서 ${btn.n}개)`);
await page.screenshot({ path: join(out, 's0-home.png') });

const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#open')]);
await chooser.setFiles(join(samples, 'sample.pdf'));
await page.waitForFunction(() => document.getElementById('tools').children.length > 0, null, { timeout: 60000 });
await page.waitForTimeout(1000);
const find = async (q, via = '검색') => {
  await page.click(`#tools .tool:has-text("${via}")`);
  await page.fill('.dialog input', q);
  await page.click('.dialog .btn.primary');
  await page.waitForTimeout(600);
};
const hint = () => page.locator('#hint').textContent();
const curVisible = () => page.$eval('.hit.cur', (e) => { const r = e.getBoundingClientRect(), s = document.getElementById('stage').getBoundingClientRect(); return r.top >= s.top && r.bottom <= s.bottom && r.left >= s.left && r.right <= s.right; });

await find('cable');
ok((await hint()).includes('1 / 6'), '대소문자 무시: ' + await hint());
await page.click('#tools .tool:has-text("다음")'); await page.click('#tools .tool:has-text("다음")');
await page.waitForTimeout(300);
ok((await hint()).includes('3 / 6') && (await hint()).includes('2쪽') && await curVisible(), '다음 → 2쪽으로 이동해 보임: ' + await hint());
await page.screenshot({ path: join(out, 's1-search-en.png') });
await page.click('#tools .tool:has-text("이전")'); await page.click('#tools .tool:has-text("이전")'); await page.click('#tools .tool:has-text("이전")');
ok((await hint()).includes('6 / 6') && await curVisible(), '이전 → 끝으로 돌아감: ' + await hint());
await find('하도급', '다시 찾기');
ok((await hint()).includes('1 / 6'), '한글 + 조각난 낱말(하도|급률): ' + await hint());
await page.screenshot({ path: join(out, 's2-search-ko.png') });
await find('Cable  Schedule', '다시 찾기');
ok((await hint()).includes('1 / 3'), '띄어쓰기 포함: ' + await hint());
await find('없는말', '다시 찾기');
ok(await page.locator('.hit').count() === 0 && (await page.locator('#toast').textContent()).includes('찾지 못했습니다'), '없는 글자: ' + await page.locator('#toast').textContent());
ok(await page.locator('#tools .tool:has-text("펜")').count() > 0, '검색을 끝내면 원래 도구로 돌아감');
await browser.close(); server.close();
