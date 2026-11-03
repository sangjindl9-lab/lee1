// 간단한 API 클라이언트 (샘플 생성·검증 스크립트용, 쿠키 세션 유지)
const fs = require('fs');
const path = require('path');
class Client {
  constructor(base) { this.base = base || process.env.BASE_URL || 'http://localhost:3000'; this.cookie = ''; }
  async req(method, url, body, opts = {}) {
    const headers = { cookie: this.cookie };
    if (process.env.SEED_INTERNAL) headers['x-forwarded-proto'] = 'https'; // 서버 내부 샘플 생성(보안 쿠키 환경)
    let b;
    if (body instanceof FormData) b = body; else if (body !== undefined) { headers['content-type'] = 'application/json'; b = JSON.stringify(body); }
    const r = await fetch(this.base + url, { method, headers, body: b, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    if (opts.raw) return r;
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer());
    if (!r.ok && !opts.allowFail) { const e = new Error(`${method} ${url} → ${r.status} ${data && data.error ? data.error : ''}`); e.status = r.status; e.data = data; throw e; }
    return opts.allowFail ? { status: r.status, data } : data;
  }
  get(u, o) { return this.req('GET', u, undefined, o); }
  post(u, b, o) { return this.req('POST', u, b, o); }
  put(u, b, o) { return this.req('PUT', u, b, o); }
  async login(u, p) { return this.post('/api/login', { username: u, password: p }); }
  async upload(url, file, fields) { const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(file)]), path.basename(file)); Object.entries(fields || {}).forEach(([k, v]) => fd.append(k, v)); return this.post(url, fd); }
  async job(id) { for (let i = 0; i < 600; i++) { const j = await this.get('/api/jobs/' + id); if (j.status === '완료') return j; if (j.status === '실패') throw new Error('작업 실패: ' + j.message); await new Promise(r => setTimeout(r, 300)); } throw new Error('작업 시간 초과'); }
}
module.exports = { Client };
