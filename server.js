// 에스에스전력 발주서 서버 (Render 웹 서비스용)
// - public/ 폴더의 화면을 보여주고, /api/* 로 데이터를 저장·조회한다.
// - DATABASE_URL 이 있으면 PostgreSQL, 없으면 ./data 폴더(개발용)에 저장한다.
// - 회사 비밀번호(APP_PASSWORD, 앱에서 바꾸면 DB에 저장)로 로그인하면 30일짜리 토큰을 준다.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { SEED } from "./seed.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.SESSION_SECRET || "";
const COLS = new Set(["vendors", "orders"]);
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const TOKEN_DAYS = 30;
const MAT_CHUNK = 1000;

/* ---------- 저장소: 키 → JSON ---------- */
async function makeStore() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "off" ? false : { rejectUnauthorized: false },
      max: 5,
    });
    await pool.query("CREATE TABLE IF NOT EXISTS kv (k text PRIMARY KEY, v jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())");
    return {
      async get(k) { const r = await pool.query("SELECT v FROM kv WHERE k=$1", [k]); return r.rows[0]?.v ?? null; },
      async set(k, v) { await pool.query("INSERT INTO kv(k,v,updated_at) VALUES($1,$2,now()) ON CONFLICT(k) DO UPDATE SET v=EXCLUDED.v, updated_at=now()", [k, JSON.stringify(v)]); },
      async del(k) { await pool.query("DELETE FROM kv WHERE k=$1", [k]); },
      async list(prefix) {
        const r = await pool.query("SELECT k, v FROM kv WHERE k LIKE $1 ORDER BY k", [prefix.replace(/[\\%_]/g, "\\$&") + "%"]);
        return r.rows.map((x) => ({ key: x.k, value: x.v }));
      },
    };
  }
  const dir = path.join(ROOT, "data");
  await fs.mkdir(dir, { recursive: true });
  const file = (k) => path.join(dir, encodeURIComponent(k) + ".json");
  console.warn("DATABASE_URL 이 없어 ./data 폴더에 저장합니다 (개발용).");
  return {
    async get(k) { try { return JSON.parse(await fs.readFile(file(k), "utf8")); } catch { return null; } },
    async set(k, v) { await fs.writeFile(file(k), JSON.stringify(v)); },
    async del(k) { await fs.rm(file(k), { force: true }); },
    async list(prefix) {
      const names = (await fs.readdir(dir)).map((n) => decodeURIComponent(n.replace(/\.json$/, ""))).filter((k) => k.startsWith(prefix)).sort();
      return Promise.all(names.map(async (key) => ({ key, value: await this.get(key) })));
    },
  };
}
const store = await makeStore();
// Render 위에서 DB 없이 돌면 재시작 때 데이터가 사라지므로 저장 기능을 막는다
const NO_DB = !!process.env.RENDER && !process.env.DATABASE_URL;

/* ---------- 인증 ---------- */
const hmac = (s) => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
const sha = (s) => crypto.createHash("sha256").update(s).digest();
const makeToken = () => { const exp = String(Date.now() + TOKEN_DAYS * 864e5); return exp + "." + hmac(exp); };
function verifyToken(tok) {
  if (!tok || !SECRET) return false;
  const [exp, mac] = tok.split(".");
  if (!exp || !mac) return false;
  const good = Buffer.from(hmac(exp)), got = Buffer.from(mac);
  return good.length === got.length && crypto.timingSafeEqual(good, got) && Number(exp) > Date.now();
}
async function checkPassword(pw) {
  if (typeof pw !== "string" || !pw) return false;
  const cfg = await store.get("config/auth");
  if (cfg?.salt && cfg?.hash) {
    const h = crypto.scryptSync(pw, cfg.salt, 32), want = Buffer.from(cfg.hash, "hex");
    return h.length === want.length && crypto.timingSafeEqual(h, want);
  }
  const env = process.env.APP_PASSWORD || "";
  return !!env && crypto.timingSafeEqual(sha(pw), sha(env));
}
// 같은 IP에서 비밀번호를 연속으로 틀리면 잠시 막는다
const fails = new Map();
function tooMany(ip) { const f = fails.get(ip); return f && f.n >= 8 && Date.now() - f.t < 10 * 60e3; }
function noteFail(ip) { const f = fails.get(ip); if (!f || Date.now() - f.t > 10 * 60e3) fails.set(ip, { n: 1, t: Date.now() }); else { f.n++; f.t = Date.now(); } }

/* ---------- 데이터 ---------- */
async function seedIfEmpty() {
  if (await store.get("config/seeded")) return;
  if (!(await store.list("vendors/")).length) {
    for (const v of SEED.vendors) await store.set("vendors/" + v.id, v);
    for (const o of SEED.orders) await store.set("orders/" + o.id, o);
    await store.set("materials/c0000", { idx: 0, items: SEED.materials });
  }
  await store.set("config/seeded", true);
}
const strip = (prefix, rows) => rows.filter((r) => r.value != null).map((r) => ({ ...r.value, id: r.key.slice(prefix.length) }));

/* ---------- HTTP ---------- */
const send = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
};
const fail = (res, status, message) => send(res, status, { error: message });
function readBody(req, limit = 5_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { const t = Buffer.concat(chunks).toString("utf8"); resolve(t ? JSON.parse(t) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

async function api(req, res, parts) {
  const route = parts[0] || "";
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

  if (route === "login" && req.method === "POST") {
    if (!SECRET) return fail(res, 500, "서버 설정(SESSION_SECRET)이 없습니다.");
    if (tooMany(ip)) return fail(res, 429, "비밀번호를 여러 번 틀렸습니다. 10분 뒤에 다시 시도해 주세요.");
    const { password } = await readBody(req, 10_000);
    if (!(await checkPassword(password))) { noteFail(ip); await new Promise((r) => setTimeout(r, 700)); return fail(res, 401, "비밀번호가 맞지 않습니다."); }
    fails.delete(ip);
    return send(res, 200, { token: makeToken() });
  }

  if (NO_DB) return fail(res, 503, "데이터베이스가 아직 연결되지 않았습니다. 관리자가 DATABASE_URL을 설정해야 합니다.");
  const auth = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!verifyToken(auth)) return fail(res, 401, "로그인이 필요합니다.");

  if (route === "all" && req.method === "GET") {
    await seedIfEmpty();
    const [vendors, orders, mats] = await Promise.all([store.list("vendors/"), store.list("orders/"), store.list("materials/")]);
    const materials = mats.map((m) => m.value).filter(Boolean).sort((a, b) => (a.idx || 0) - (b.idx || 0)).flatMap((m) => m.items || []);
    return send(res, 200, { vendors: strip("vendors/", vendors), orders: strip("orders/", orders), materials });
  }

  if (route === "doc" && parts.length === 3) {
    const [, col, id] = parts;
    if (!COLS.has(col) || !ID_RE.test(id)) return fail(res, 400, "잘못된 주소입니다.");
    if (req.method === "PUT") {
      const body = await readBody(req, 1_000_000);
      if (!body || typeof body !== "object" || Array.isArray(body)) return fail(res, 400, "잘못된 데이터입니다.");
      delete body.id;
      await store.set(`${col}/${id}`, body);
      return send(res, 200, { ok: true });
    }
    if (req.method === "DELETE") { await store.del(`${col}/${id}`); return send(res, 200, { ok: true }); }
  }

  if (route === "materials" && req.method === "PUT") {
    const { items } = await readBody(req);
    if (!Array.isArray(items)) return fail(res, 400, "잘못된 데이터입니다.");
    const clean = items.filter((m) => m && typeof m === "object" && m.name).map((m) => ({
      name: String(m.name).slice(0, 200), spec: String(m.spec ?? "").slice(0, 200), unit: String(m.unit ?? "").slice(0, 30),
      price: String(m.price ?? "").slice(0, 30), note: String(m.note ?? "").slice(0, 200),
    }));
    const n = Math.ceil(clean.length / MAT_CHUNK);
    for (let i = 0; i < n; i++) await store.set("materials/c" + String(i).padStart(4, "0"), { idx: i, items: clean.slice(i * MAT_CHUNK, (i + 1) * MAT_CHUNK) });
    for (const r of await store.list("materials/")) { const i = Number(r.key.slice("materials/c".length)); if (!(i < n)) await store.del(r.key); }
    return send(res, 200, { ok: true, count: clean.length });
  }

  if (route === "password" && req.method === "POST") {
    const { current, next } = await readBody(req, 10_000);
    if (!(await checkPassword(current))) return fail(res, 403, "현재 비밀번호가 맞지 않습니다.");
    if (typeof next !== "string" || next.length < 4) return fail(res, 400, "새 비밀번호는 4자 이상이어야 합니다.");
    const salt = crypto.randomBytes(16).toString("hex");
    await store.set("config/auth", { salt, hash: crypto.scryptSync(next, salt, 32).toString("hex"), changedAt: new Date().toISOString() });
    return send(res, 200, { ok: true });
  }

  return fail(res, 404, "없는 기능입니다.");
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json" };
async function staticFile(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || !path.extname(rel)) rel = "/index.html";
  const full = path.join(PUBLIC, path.normalize(rel));
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const body = await fs.readFile(full);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(full)] || "application/octet-stream",
      "cache-control": rel === "/index.html" ? "no-cache" : "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
    });
    res.end(body);
  } catch { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("없는 페이지입니다."); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/healthz") { res.writeHead(200); return res.end("ok"); }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url.pathname.slice(5).split("/").filter(Boolean));
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    return await staticFile(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (res.headersSent) return res.end();
    if (e?.message === "too_large") return fail(res, 413, "데이터가 너무 큽니다.");
    if (e instanceof SyntaxError) return fail(res, 400, "잘못된 데이터입니다.");
    return fail(res, 500, "서버 오류가 발생했습니다.");
  }
}).listen(PORT, () => console.log("발주서 서버 실행 중: 포트 " + PORT));
