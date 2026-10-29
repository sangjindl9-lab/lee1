/**
 * SS-ERP 외부 호출 중계 서버
 *  - ERP 서버가 직접 붙지 못하는 공공데이터포털(apis.data.go.kr 등)에 대신 요청을 보내고 응답을 그대로 돌려준다.
 *  - 비밀 토큰(RELAY_TOKEN)이 맞는 요청만, 허용된 호스트(ALLOWED_HOSTS)로만 보낸다. 다른 곳으로는 절대 보내지 않는다.
 *  - 요청: GET|POST /r?u=<원래 주소(인코딩)>  헤더 x-relay-token: <토큰>
 */
const http = require('http');

const PORT = Number(process.env.PORT || 10000);
const TOKEN = process.env.RELAY_TOKEN;
const ALLOWED = (process.env.ALLOWED_HOSTS || 'apis.data.go.kr,api.odcloud.kr,infuser.odcloud.kr').split(',').map((s) => s.trim()).filter(Boolean);
const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || 40000);
if (!TOKEN || TOKEN.length < 16) { console.error('RELAY_TOKEN 이 없거나 너무 짧습니다 (16자 이상)'); process.exit(1); }

const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const readBody = (req, limit = 2 * 1024 * 1024) => new Promise((ok, bad) => { const c = []; let n = 0; req.on('data', (d) => { n += d.length; if (n > limit) { bad(new Error('too_large')); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c))); req.on('error', bad); });
const safeEq = (a, b) => { if (typeof a !== 'string' || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return send(res, 200, { ok: true });
  if (url.pathname !== '/r') return send(res, 404, { error: 'not_found' });
  if (!safeEq(req.headers['x-relay-token'], TOKEN)) return send(res, 401, { error: 'unauthorized' });
  let target;
  try { target = new URL(url.searchParams.get('u') || ''); } catch { return send(res, 400, { error: 'bad_url' }); }
  if (target.protocol !== 'https:' || !ALLOWED.includes(target.hostname)) return send(res, 403, { error: 'host_not_allowed', host: target.hostname });
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'method' });
  const started = Date.now();
  try {
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    const headers = { accept: req.headers.accept || 'application/json, text/xml;q=0.9, */*;q=0.5', 'user-agent': 'SS-ERP-relay/1.0' };
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    const r = await fetch(target, { method: req.method, headers, body, signal: AbortSignal.timeout(TIMEOUT), redirect: 'manual' });
    const text = await r.text();
    console.log(`${req.method} ${target.hostname}${target.pathname} -> ${r.status} ${text.length}b ${Date.now() - started}ms`);
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store', 'x-relay-upstream-status': String(r.status) });
    res.end(text);
  } catch (e) {
    console.log(`${req.method} ${target.hostname}${target.pathname} -> FAIL ${e.name} ${e.message} ${Date.now() - started}ms`);
    send(res, 502, { error: 'upstream', code: e.name === 'TimeoutError' ? 'TIMEOUT' : (e.cause && e.cause.code) || e.name, message: e.message });
  }
}).listen(PORT, '0.0.0.0', () => console.log(`SS-ERP relay :${PORT} 허용 호스트 ${ALLOWED.join(', ')}`));
