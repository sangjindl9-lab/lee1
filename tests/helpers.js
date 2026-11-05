// 통합 테스트 공용: 실제 서버를 테스트 DB 로 띄우고 쿠키를 유지하는 HTTP 클라이언트 제공
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const SAMPLES = path.join(ROOT, 'samples');
const PORT = 8000 + Math.floor(Math.random() * 900);
export const BASE = `http://127.0.0.1:${PORT}`;
export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/eum3d_test';

let proc;
export async function startServer() {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eum3d-test-'));
  proc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: TEST_DB, DATA_DIR: dataDir, JWT_SECRET: 'test-secret', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; if (process.env.SERVER_LOG) process.stdout.write(d); });
  proc.stderr.on('data', (d) => { log += d; if (process.env.SERVER_LOG) process.stderr.write(d); });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return { dataDir, log: () => log }; } catch { /* 기동 대기 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('서버 기동 실패\n' + log);
}
export async function stopServer() {
  if (!proc) return;
  proc.kill('SIGTERM');
  await new Promise((r) => { proc.on('exit', r); setTimeout(r, 5000); });
}

export class Client {
  cookie = '';
  async req(method, url, body, headers = {}) {
    const isBuf = Buffer.isBuffer(body);
    const res = await fetch(BASE + url, {
      method, headers: { ...(body && !isBuf ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body ? (isBuf ? body : JSON.stringify(body)) : undefined,
    });
    const sc = res.headers.getSetCookie?.() || [];
    for (const c of sc) {
      const kv = c.split(';')[0];
      const name = kv.split('=')[0];
      const rest = this.cookie.split('; ').filter((x) => x && !x.startsWith(name + '='));
      this.cookie = [...rest, kv].join('; ');
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  get = (u, h) => this.req('GET', u, undefined, h);
  post = (u, b, h) => this.req('POST', u, b || {}, h);
  put = (u, b, h) => this.req('PUT', u, b, h);
  patch = (u, b) => this.req('PATCH', u, b);
}

export async function signup(tag) {
  const c = new Client();
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.kr`;
  const r = await c.post('/api/auth/signup', { companyName: `${tag} 주식회사`, name: `${tag} 담당`, email, password: 'password123' });
  if (r.status !== 201) throw new Error('signup ' + JSON.stringify(r.data));
  c.user = r.data.user; c.email = email;
  return c;
}

/** 분할 업로드 (작은 chunk 로 강제 분할해 다중 조각 경로 검증) */
export async function upload(c, projectId, file, { chunk = 256 * 1024, name } = {}) {
  const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(path.join(SAMPLES, file));
  const s = await c.post(`/api/projects/${projectId}/uploads`, { name: name || file, size: buf.length });
  if (s.status !== 201) return s;
  for (let i = 0, k = 0; i < buf.length; i += chunk, k++) {
    const r = await c.put(`/api/uploads/${s.data.uploadId}/chunks/${k}`, buf.subarray(i, i + chunk), { 'Content-Type': 'application/octet-stream' });
    if (r.status !== 200) return r;
  }
  return c.post(`/api/uploads/${s.data.uploadId}/complete`);
}

export async function waitJob(c, jobId, timeoutMs = 180000) {
  const t0 = Date.now();
  for (;;) {
    const r = await c.get(`/api/jobs/${jobId}`);
    if (r.data.status === 'done' || r.data.status === 'failed') return r.data;
    if (Date.now() - t0 > timeoutMs) throw new Error('작업 시간 초과 ' + JSON.stringify(r.data));
    await new Promise((res) => setTimeout(res, 400));
  }
}

export async function newProject(c, name = '테스트 프로젝트', industry = 'machine') {
  const r = await c.post('/api/projects', { name, industry });
  if (r.status !== 201) throw new Error(JSON.stringify(r.data));
  return r.data;
}
