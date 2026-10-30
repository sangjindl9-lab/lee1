// SS-ERP 소개 사이트 + 도입 문의 접수 (이메일 발송 + 파일 보관)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || './data';
const TO = process.env.INQUIRY_TO || 'sangjindl9@gmail.com';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const SMTP = process.env.SMTP_USER && process.env.SMTP_PASS
  ? { host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 465), secure: (process.env.SMTP_PORT || '465') === '465', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
  : null;
const transporter = SMTP ? nodemailer.createTransport(SMTP) : null;
fs.mkdirSync(DATA_DIR, { recursive: true });
const LOG = path.join(DATA_DIR, 'inquiries.jsonl');

// 페이지는 시작할 때 한 번 읽어 둔다 (문의 폼은 서버로 전송되도록 공개 페이지에서 처리)
const page = fs.readFileSync(path.join('public', 'page.html'), 'utf8');
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="전기·정보통신 공사업체가 직접 만든 SS-ERP, 검측서류 자동 작성, 예정공정표 작성 프로그램"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%23fff' stroke='%23e0462f' stroke-width='3'/%3E%3Ctext x='16' y='21' font-size='12' font-weight='700' text-anchor='middle' fill='%23e0462f' font-family='sans-serif'%3ESS%3C/text%3E%3C/svg%3E"><style>:root{padding:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${page}</body></html>`;

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
    const item = { at: new Date().toISOString(), company: clean(d.company, 100), name: clean(d.name, 50), phone: clean(d.phone, 40), email: clean(d.email, 120), product: clean(d.product, 40), message: String(d.message ?? '').trim().slice(0, 3000), ip };
    if (!item.company || !item.name || !item.phone) return json(res, 400, { ok: false, message: '회사명·담당자·연락처를 입력해 주세요' });
    fs.appendFileSync(LOG, JSON.stringify(item) + '\n');
    let mailed = false;
    if (transporter) {
      try {
        await transporter.sendMail({
          from: `"SS-ERP 도입 문의" <${process.env.SMTP_USER}>`, to: TO, replyTo: item.email || undefined,
          subject: `[SS-ERP 도입 문의] ${item.company} · ${item.name} · ${item.product}`,
          text: `회사명: ${item.company}\n담당자: ${item.name}\n연락처: ${item.phone}\n이메일: ${item.email || '-'}\n관심 제품: ${item.product}\n\n문의 내용:\n${item.message || '-'}\n\n접수: ${item.at} / ${ip}`,
          html: `<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">${[['회사명', item.company], ['담당자', item.name], ['연락처', item.phone], ['이메일', item.email || '-'], ['관심 제품', item.product]].map(([k, v]) => `<tr><th align="left" style="padding:4px 12px 4px 0;color:#555">${k}</th><td style="padding:4px 0">${esc(v)}</td></tr>`).join('')}</table><p style="white-space:pre-wrap;font-family:sans-serif;font-size:14px;border-top:1px solid #ddd;padding-top:10px">${esc(item.message) || '-'}</p><p style="color:#888;font-size:12px">접수 ${item.at} · ${esc(ip)}</p>`,
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
  if (url.pathname === '/health') return json(res, 200, { ok: true, smtp: !!transporter, to: TO });
  if (url.pathname === '/admin/inquiries') {
    if (!ADMIN_TOKEN || url.searchParams.get('token') !== ADMIN_TOKEN) return json(res, 403, { ok: false });
    const rows = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).reverse() : [];
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta charset="utf-8"><title>도입 문의 ${rows.length}건</title><style>body{font-family:sans-serif;padding:20px}table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left}td.m{white-space:pre-wrap;max-width:420px}</style><h1>도입 문의 ${rows.length}건</h1><table><tr><th>접수</th><th>회사</th><th>담당자</th><th>연락처</th><th>이메일</th><th>제품</th><th>내용</th></tr>${rows.map((r) => `<tr><td>${r.at.slice(0, 16).replace('T', ' ')}</td><td>${esc(r.company)}</td><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.email)}</td><td>${esc(r.product)}</td><td class="m">${esc(r.message)}</td></tr>`).join('')}</table>`);
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    return res.end(html);
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('없는 페이지입니다');
}).listen(PORT, async () => {
  console.log(`SS-ERP 소개 사이트 :${PORT} (문의 → ${TO}, SMTP ${transporter ? '설정됨' : '미설정 — 파일 보관만'})`);
  // SEND_TEST_MAIL=1 로 띄우면 시작할 때 테스트 메일을 한 통 보낸다
  if (process.env.SEND_TEST_MAIL && transporter) {
    try { const r = await transporter.sendMail({ from: `"SS-ERP 도입 문의" <${process.env.SMTP_USER}>`, to: TO, subject: '[SS-ERP 도입 문의] 테스트 메일', text: `문의 폼 메일 발송 테스트입니다.\n${new Date().toISOString()}` }); console.log('테스트 메일 발송됨:', r.response); }
    catch (e) { console.error('테스트 메일 실패:', e.message); }
  }
});
