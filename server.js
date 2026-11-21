// 이음 견적발주 — 웹 서버 (Express + PostgreSQL)
// 회원가입·로그인, 발주자·거래처·발주서 저장, 계정 삭제, 정적 화면 제공
"use strict";
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3300;
const DB_NAME = process.env.BALJU_DB_NAME || "balju";
const KINDS = new Set(["buyers", "vendors", "orders"]);
const SESSION_DAYS = 90;
const COOKIE = "balju_sid";

/* ── DB 준비: 같은 Postgres 서버 안에 전용 데이터베이스(balju)를 만들어 다른 앱과 섞이지 않게 한다 ── */
async function openPool() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL 이 없습니다.");
  const ssl = /sslmode=disable/.test(base) || /localhost|127\.0\.0\.1/.test(base) ? false : { rejectUnauthorized: false };
  if (process.env.BALJU_SAME_DB === "1") return new Pool({ connectionString: base, ssl });
  const admin = new Pool({ connectionString: base, ssl, max: 1 });
  try {
    const r = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB_NAME]);
    if (!r.rowCount) {
      await admin.query(`CREATE DATABASE "${DB_NAME.replace(/"/g, "")}"`);
      console.log(`[db] 데이터베이스 ${DB_NAME} 생성`);
    }
  } finally {
    await admin.end();
  }
  const u = new URL(base);
  u.pathname = "/" + DB_NAME;
  return new Pool({ connectionString: u.toString(), ssl });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS docs (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, id)
);`;

let pool;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

/* ── 간단한 요청 제한(로그인·가입 무차별 대입 방지) ── */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const h = hits.get(key) || { n: 0, t: now };
  if (now - h.t > windowMs) { h.n = 0; h.t = now; }
  h.n++;
  hits.set(key, h);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.t > windowMs) hits.delete(k);
  return h.n > max;
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader("Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`);
}
async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2, now() + interval '" + SESSION_DAYS + " days')",
    [sha(token), userId]);
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}
async function auth(req, res, next) {
  try {
    const token = readCookie(req, COOKIE);
    if (!token) return res.status(401).json({ error: "로그인이 필요합니다." });
    const r = await pool.query(
      "SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()",
      [sha(token)]);
    if (!r.rowCount) return res.status(401).json({ error: "로그인이 필요합니다." });
    req.user = r.rows[0];
    next();
  } catch (e) { next(e); }
}

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "3mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

const ip = (req) => req.ip || "x";
const cleanEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.post("/api/signup", async (req, res, next) => {
  try {
    if (limited("su:" + ip(req), 20, 3600e3)) return res.status(429).json({ error: "잠시 뒤 다시 시도해 주세요." });
    const email = cleanEmail(req.body.email), pw = String(req.body.password || "");
    if (!validEmail(email)) return res.status(400).json({ error: "이메일 주소를 확인해 주세요." });
    if (pw.length < 8 || pw.length > 100) return res.status(400).json({ error: "비밀번호는 8자 이상으로 정해 주세요." });
    if (!req.body.agree) return res.status(400).json({ error: "개인정보처리방침에 동의해 주세요." });
    const hash = await bcrypt.hash(pw, 10);
    const r = await pool.query("INSERT INTO users(email,pw_hash) VALUES($1,$2) ON CONFLICT (email) DO NOTHING RETURNING id", [email, hash]);
    if (!r.rowCount) return res.status(409).json({ error: "이미 가입된 이메일입니다. 로그인해 주세요." });
    await startSession(req, res, r.rows[0].id);
    res.json({ email });
  } catch (e) { next(e); }
});

app.post("/api/login", async (req, res, next) => {
  try {
    const email = cleanEmail(req.body.email), pw = String(req.body.password || "");
    if (limited("li:" + ip(req), 30, 600e3) || limited("le:" + email, 10, 600e3))
      return res.status(429).json({ error: "로그인 시도가 많습니다. 10분 뒤 다시 시도해 주세요." });
    const r = await pool.query("SELECT id, pw_hash FROM users WHERE email=$1", [email]);
    if (!r.rowCount || !(await bcrypt.compare(pw, r.rows[0].pw_hash)))
      return res.status(401).json({ error: "이메일 또는 비밀번호가 맞지 않습니다." });
    await startSession(req, res, r.rows[0].id);
    res.json({ email });
  } catch (e) { next(e); }
});

app.post("/api/logout", async (req, res, next) => {
  try {
    const token = readCookie(req, COOKIE);
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash=$1", [sha(token)]);
    setSessionCookie(req, res, "", 0);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get("/api/me", auth, (req, res) => res.json({ email: req.user.email }));

app.post("/api/password", auth, async (req, res, next) => {
  try {
    const cur = String(req.body.current || ""), pw = String(req.body.password || "");
    if (pw.length < 8 || pw.length > 100) return res.status(400).json({ error: "새 비밀번호는 8자 이상으로 정해 주세요." });
    const r = await pool.query("SELECT pw_hash FROM users WHERE id=$1", [req.user.id]);
    if (!(await bcrypt.compare(cur, r.rows[0].pw_hash))) return res.status(401).json({ error: "지금 비밀번호가 맞지 않습니다." });
    await pool.query("UPDATE users SET pw_hash=$1 WHERE id=$2", [await bcrypt.hash(pw, 10), req.user.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get("/api/data", auth, async (req, res, next) => {
  try {
    const r = await pool.query("SELECT kind, id, data FROM docs WHERE user_id=$1 ORDER BY updated_at", [req.user.id]);
    const out = { buyers: [], vendors: [], orders: [] };
    for (const row of r.rows) if (out[row.kind]) out[row.kind].push(Object.assign({}, row.data, { id: row.id }));
    res.json(out);
  } catch (e) { next(e); }
});

const okId = (s) => /^[A-Za-z0-9_-]{1,64}$/.test(s);
app.put("/api/docs/:kind/:id", auth, async (req, res, next) => {
  try {
    const { kind, id } = req.params;
    if (!KINDS.has(kind) || !okId(id)) return res.status(400).json({ error: "잘못된 요청입니다." });
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).json({ error: "잘못된 요청입니다." });
    const n = await pool.query("SELECT count(*)::int AS n FROM docs WHERE user_id=$1 AND kind=$2", [req.user.id, kind]);
    if (n.rows[0].n >= 5000) {
      const ex = await pool.query("SELECT 1 FROM docs WHERE user_id=$1 AND kind=$2 AND id=$3", [req.user.id, kind, id]);
      if (!ex.rowCount) return res.status(413).json({ error: "저장 개수가 너무 많습니다. 오래된 항목을 지워 주세요." });
    }
    await pool.query(
      `INSERT INTO docs(user_id,kind,id,data,updated_at) VALUES($1,$2,$3,$4,now())
       ON CONFLICT (user_id,kind,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`,
      [req.user.id, kind, id, JSON.stringify(req.body)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.delete("/api/docs/:kind/:id", auth, async (req, res, next) => {
  try {
    const { kind, id } = req.params;
    if (!KINDS.has(kind) || !okId(id)) return res.status(400).json({ error: "잘못된 요청입니다." });
    await pool.query("DELETE FROM docs WHERE user_id=$1 AND kind=$2 AND id=$3", [req.user.id, kind, id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 계정 삭제(Google Play 계정 삭제 정책): 비밀번호 확인 뒤 사용자와 모든 자료를 즉시 지운다.
app.post("/api/account/delete", auth, async (req, res, next) => {
  try {
    const r = await pool.query("SELECT pw_hash FROM users WHERE id=$1", [req.user.id]);
    if (!(await bcrypt.compare(String(req.body.password || ""), r.rows[0].pw_hash)))
      return res.status(401).json({ error: "비밀번호가 맞지 않습니다." });
    await pool.query("DELETE FROM users WHERE id=$1", [req.user.id]);
    setSessionCookie(req, res, "", 0);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ── 정적 파일 ── */
const nm = (p) => path.join(__dirname, "node_modules", p);
app.get("/vendor/html2canvas.min.js", (req, res) => res.sendFile(nm("html2canvas/dist/html2canvas.min.js"), { maxAge: "30d" }));
app.get("/vendor/jspdf.umd.min.js", (req, res) => res.sendFile(nm("jspdf/dist/jspdf.umd.min.js"), { maxAge: "30d" }));
app.get(["/privacy", "/privacy.html"], (req, res) => res.sendFile(path.join(__dirname, "public/privacy.html")));
app.get(["/delete-account", "/delete-account.html"], (req, res) => res.sendFile(path.join(__dirname, "public/delete-account.html")));
// 스토어 등록용 이미지(아이콘·그래픽·스크린샷)는 다른 사이트에서도 가져갈 수 있게 연다.
app.use("/store", (req, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); next(); });
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res, p) { if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache"); },
}));

app.use("/api", (req, res) => res.status(404).json({ error: "없는 주소입니다." }));
app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") return res.status(413).json({ error: "내용이 너무 큽니다. 도장 이미지를 더 작은 파일로 올려 주세요." });
  console.error(err);
  res.status(500).json({ error: "서버 오류가 났습니다. 잠시 뒤 다시 시도해 주세요." });
});

(async () => {
  pool = await openPool();
  await pool.query(SCHEMA);
  setInterval(() => pool.query("DELETE FROM sessions WHERE expires_at < now()").catch(() => {}), 6 * 3600e3);
  app.listen(PORT, "0.0.0.0", () => console.log(`[balju] http://0.0.0.0:${PORT}`));
})().catch((e) => { console.error("[balju] 시작 실패", e); process.exit(1); });
