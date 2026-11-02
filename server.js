// 이음ERP 소개 사이트 + 도입 문의 접수 (이메일 발송 + 파일 보관)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { PAGES, HOME_FAQ } from './pages.js';

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || './data';
const TO = process.env.INQUIRY_TO || 'lee@ieumerp.kr';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const SMTP = process.env.SMTP_USER && process.env.SMTP_PASS
  ? { host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 465), secure: (process.env.SMTP_PORT || '465') === '465', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
  : null;
const transporter = SMTP ? nodemailer.createTransport(SMTP) : null;
fs.mkdirSync(DATA_DIR, { recursive: true });
const LOG = path.join(DATA_DIR, 'inquiries.jsonl');

// 검색·링크 미리보기용 머리 정보. 네이버·구글 소유 확인 코드는 환경변수로 넣는다
const SITE = (process.env.SITE_URL || 'https://ieumerp.kr').replace(/\/$/, '');
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const read = (f) => fs.readFileSync(path.join('public', f), 'utf8');
const CSS = read('site.css');
const CSS_V = crypto.createHash('sha1').update(CSS).digest('hex').slice(0, 8);
// 머리줄·꼬리줄은 모든 페이지가 같이 쓴다 (하위 페이지에서도 메뉴가 첫 페이지 칸으로 가도록 / 를 붙인다)
const HEADER = read('_header.html').replace(/href="#top"/, 'href="/"').replace(/href="#/g, 'href="/#');
const FOOTER = read('_footer.html');
const ORG = { '@type': 'Organization', '@id': `${SITE}/#org`, name: '주식회사 이음소프트', url: SITE, email: 'lee@ieumerp.kr', telephone: '+82-70-7938-5027', logo: `${SITE}/og.png` };
const faqLd = (faq) => faq && faq.length ? { '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) } : null;

const faqHtml = (faq) => `<div class="faq">${faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>`;
function render({ path: p, title, desc, ogTitle, body, ld = [], faq }) {
  if (faq) body = body.replace('<!--FAQ-->', faqHtml(faq));
  const graph = [ORG, ...ld, faqLd(faq)].filter(Boolean);
  const head = [
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    `<title>${title}</title>`,
    `<meta name="description" content="${attr(desc)}">`,
    `<link rel="canonical" href="${SITE}${p}">`,
    '<meta property="og:type" content="website"><meta property="og:site_name" content="이음ERP"><meta property="og:locale" content="ko_KR">',
    `<meta property="og:title" content="${attr(ogTitle || title)}">`, `<meta property="og:description" content="${attr(desc)}">`,
    `<meta property="og:url" content="${SITE}${p}">`, `<meta property="og:image" content="${SITE}/og.png">`,
    '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">',
    process.env.NAVER_SITE_VERIFICATION ? `<meta name="naver-site-verification" content="${attr(process.env.NAVER_SITE_VERIFICATION)}">` : '',
    process.env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${attr(process.env.GOOGLE_SITE_VERIFICATION)}">` : '',
    '<link rel="icon" href="/favicon.png">',
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800&display=swap">',
    `<link rel="stylesheet" href="/site.css?v=${CSS_V}">`,
    `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`,
  ].filter(Boolean).join('');
  return `<!doctype html><html lang="ko"><head>${head}</head><body>${HEADER}${body}${FOOTER}</body></html>`;
}

// 첫 페이지 + 제품별 페이지 (pages.js) — 시작할 때 한 번 만들어 둔다
const HOME = {
  path: '/',
  title: '이음ERP | 전기·정보통신 공사업체 ERP · 검측서류 · 공정표', // 네이버 권장 40자 이내
  ogTitle: '공사 회사가 직접 만든 이음ERP',
  desc: '전기·정보통신 공사 회사가 직접 만든 공사업체 ERP. 현장관리·발주 결재·기성·세금계산서·회계부터 검측서류·예정공정표·사진대지까지.', // 80자 이내
  body: read('page.html').replace('<!--HEADER-->\n', '').replace('<!--FOOTER-->\n', ''),
  ld: [{ '@type': 'SoftwareApplication', name: '이음ERP', applicationCategory: 'BusinessApplication', operatingSystem: 'Web, Android', url: SITE, description: '전기·정보통신 공사업체용 ERP', offers: { '@type': 'Offer', price: '79000', priceCurrency: 'KRW' }, publisher: { '@id': `${SITE}/#org` } }],
  faq: HOME_FAQ,
};
const PAGE_LIST = [HOME, ...PAGES.map((pg) => ({ ...pg, body: read(`pages/${pg.file}`) }))];
const RENDERED = new Map(PAGE_LIST.map((pg) => { const html = render(pg); return [pg.path, { html, gz: zlib.gzipSync(html) }]; }));
const TODAY = new Date().toISOString().slice(0, 10);
const ROBOTS = `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\n`;
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${PAGE_LIST.map((pg) => `<url><loc>${SITE}${pg.path}</loc><lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>${pg.path === '/' ? '1.0' : '0.8'}</priority></url>`).join('')}</urlset>\n`;
const STATIC_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const CSS_GZ = zlib.gzipSync(CSS);
const NOT_FOUND = render({ path: '/404', title: '없는 페이지입니다 | 이음ERP', desc: '찾는 페이지가 없습니다.', body: '<section class="sec"><div class="wrap"><h1 style="font-size:32px">찾는 페이지가 없습니다</h1><p style="margin-top:16px"><a class="btn n" href="/">첫 페이지로</a></p></div></section>' }).replace('<head>', '<head><meta name="robots" content="noindex">');

const recent = new Map(); // ip -> timestamps (간단한 과다 요청 방지)
function tooMany(ip) {
  const now = Date.now(); const arr = (recent.get(ip) || []).filter((t) => now - t < 3600_000);
  arr.push(now); recent.set(ip, arr); return arr.length > 10;
}
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const clean = (v, max) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

async function handleInquiry(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 20_000) req.destroy(); });
  req.on('end', async () => {
    let d; try { d = JSON.parse(body); } catch { return json(res, 400, { ok: false, message: '잘못된 요청입니다' }); }
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    if (tooMany(ip)) return json(res, 429, { ok: false, message: '잠시 뒤 다시 시도해 주세요' });
    const item = { at: new Date().toISOString(), company: clean(d.company, 100), name: clean(d.name, 50), phone: clean(d.phone, 40), email: clean(d.email, 120), product: clean(d.product, 40), source: clean(d.source, 60), ref: clean(d.ref, 300), message: String(d.message ?? '').trim().slice(0, 3000), ip };
    if (!item.company || !item.name || !item.phone) return json(res, 400, { ok: false, message: '회사명·담당자·연락처를 입력해 주세요' });
    fs.appendFileSync(LOG, JSON.stringify(item) + '\n');
    let mailed = false;
    if (transporter) {
      try {
        await transporter.sendMail({
          from: `"이음ERP 도입 문의" <${process.env.SMTP_USER}>`, to: TO, replyTo: item.email || undefined,
          subject: `[이음ERP 도입 문의] ${item.company} · ${item.name} · ${item.product}`,
          text: `회사명: ${item.company}\n담당자: ${item.name}\n연락처: ${item.phone}\n이메일: ${item.email || '-'}\n관심 제품: ${item.product}\n알게 된 경로: ${item.source || '-'}${item.ref ? ` (${item.ref})` : ''}\n\n문의 내용:\n${item.message || '-'}\n\n접수: ${item.at} / ${ip}`,
          html: `<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">${[['회사명', item.company], ['담당자', item.name], ['연락처', item.phone], ['이메일', item.email || '-'], ['관심 제품', item.product], ['알게 된 경로', (item.source || '-') + (item.ref ? ` (${item.ref})` : '')]].map(([k, v]) => `<tr><th align="left" style="padding:4px 12px 4px 0;color:#555">${k}</th><td style="padding:4px 0">${esc(v)}</td></tr>`).join('')}</table><p style="white-space:pre-wrap;font-family:sans-serif;font-size:14px;border-top:1px solid #ddd;padding-top:10px">${esc(item.message) || '-'}</p><p style="color:#888;font-size:12px">접수 ${item.at} · ${esc(ip)}</p>`,
        });
        mailed = true;
      } catch (e) { console.error('메일 발송 실패:', e.message); }
    }
    console.log(`[문의] ${item.company} ${item.name} ${item.phone} mailed=${mailed}`);
    json(res, 200, { ok: true, mailed });
  });
}
function json(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/api/inquiry') return handleInquiry(req, res);
  // www·onrender 주소로 들어오면 대표 주소로 (검색에서 주소가 둘로 갈리지 않게)
  const host = String(req.headers.host || '');
  // 대표 주소(SITE_URL)가 아닌 www·onrender·railway 주소면 대표 주소로. 대표 주소가 www 여도 돌고 돌지 않게 대표 주소 자체는 건너뛴다
  const canon = SITE.replace(/^https?:\/\//, '');
  if ((req.method === 'GET' || req.method === 'HEAD') && host !== canon && (host.startsWith('www.') || host === canon.replace(/^www\./, '') || host.endsWith('.onrender.com') || host.endsWith('.up.railway.app')) && SITE.startsWith('https://')) {
    res.writeHead(301, { location: SITE + url.pathname + url.search }); return res.end();
  }
  if (url.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(ROBOTS); }
  if (url.pathname === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' }); return res.end(SITEMAP); }
  if (url.pathname === '/site.css') {
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable', vary: 'accept-encoding', ...(gz ? { 'content-encoding': 'gzip' } : {}) });
    return res.end(gz ? CSS_GZ : CSS);
  }
  if (/^\/(og|favicon)\.png$/.test(url.pathname) || /^\/img\/[a-z0-9]+\.(png|jpg|webp)$/.test(url.pathname)) {
    const f = path.join('public', url.pathname);
    if (fs.existsSync(f)) {
      res.writeHead(200, { 'content-type': STATIC_TYPES[path.extname(f)], 'cache-control': url.pathname.startsWith('/img/') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400' });
      return res.end(fs.readFileSync(f));
    }
  }
  // 사용 영상 — 범위 요청(Range)을 받아 원하는 지점부터 재생되게
  const vm = url.pathname.match(/^\/video\/([a-z0-9-]+)\.(mp4|jpg)$/);
  if (vm) {
    const f = path.join('public', 'video', `${vm[1]}.${vm[2]}`);
    if (fs.existsSync(f)) {
      const size = fs.statSync(f).size; const type = vm[2] === 'mp4' ? 'video/mp4' : 'image/jpeg';
      const head = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=604800' };
      const r = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (r) {
        let start = r[1] === '' ? size - Number(r[2]) : Number(r[1]); let end = r[1] !== '' && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
        if (!(start >= 0 && start <= end)) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
        return req.method === 'HEAD' ? res.end() : fs.createReadStream(f, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...head, 'content-length': size });
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(f).pipe(res);
    }
  }
  if (url.pathname === '/health') return json(res, 200, { ok: true, smtp: !!transporter, to: TO });
  if (url.pathname === '/admin/inquiries') {
    if (!ADMIN_TOKEN || url.searchParams.get('token') !== ADMIN_TOKEN) return json(res, 403, { ok: false });
    const rows = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).reverse() : [];
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>도입 문의 ${rows.length}건</title><style>body{font-family:sans-serif;padding:20px}table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left}td.m{white-space:pre-wrap;max-width:420px}</style><h1>도입 문의 ${rows.length}건</h1><table><tr><th>접수</th><th>회사</th><th>담당자</th><th>연락처</th><th>이메일</th><th>제품</th><th>경로</th><th>내용</th></tr>${rows.map((r) => `<tr><td>${r.at.slice(0, 16).replace('T', ' ')}</td><td>${esc(r.company)}</td><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.email)}</td><td>${esc(r.product)}</td><td>${esc(r.source || '')}${r.ref ? `<br><small>${esc(r.ref)}</small>` : ''}</td><td class="m">${esc(r.message)}</td></tr>`).join('')}</table>`);
  }
  const pg = (req.method === 'GET' || req.method === 'HEAD') && RENDERED.get(url.pathname === '/index.html' ? '/' : (url.pathname.replace(/\/$/, '') || '/'));
  if (pg) {
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', vary: 'accept-encoding', ...(gz ? { 'content-encoding': 'gzip' } : {}) });
    return res.end(gz ? pg.gz : pg.html);
  }
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end(NOT_FOUND);
}).listen(PORT, async () => {
  console.log(`이음ERP 소개 사이트 :${PORT} (문의 → ${TO}, SMTP ${transporter ? '설정됨' : '미설정 — 파일 보관만'})`);
  // SEND_TEST_MAIL=1 로 띄우면 시작할 때 테스트 메일을 한 통 보낸다
  if (process.env.SEND_TEST_MAIL && transporter) {
    try { const r = await transporter.sendMail({ from: `"이음ERP 도입 문의" <${process.env.SMTP_USER}>`, to: TO, subject: '[이음ERP 도입 문의] 테스트 메일', text: `문의 폼 메일 발송 테스트입니다.\n${new Date().toISOString()}` }); console.log('테스트 메일 발송됨:', r.response); }
    catch (e) { console.error('테스트 메일 실패:', e.message); }
  }
});
