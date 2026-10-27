// 에스에스전력 휴가대장 서버 — 의존성 없음 (Node 18+)
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createZipWriter, readZip } = require("./zip");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PASSWORD = process.env.APP_PASSWORD || "";
const SECRET = process.env.SESSION_SECRET || crypto.createHash("sha256").update("hyuga:" + PASSWORD).digest("hex");
const FILE_DIR = path.join(DATA_DIR, "files");
const DB_FILE = path.join(DATA_DIR, "db.json");
const MAX_FILE = 20 * 1024 * 1024;

fs.mkdirSync(FILE_DIR, { recursive: true });
const BACKUP_DIR = path.join(DATA_DIR, "backups");
fs.mkdirSync(BACKUP_DIR, { recursive: true });
const MAX_RESTORE = 1024 * 1024 * 1024;
let db = { employees: {}, leaves: {}, files: {}, meta: {} };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, "utf8"))); } catch (e) {}
let saving = Promise.resolve();
function persist() {
  const snapshot = JSON.stringify(db);
  saving = saving.then(() => fs.promises.writeFile(DB_FILE + ".tmp", snapshot)
    .then(() => fs.promises.rename(DB_FILE + ".tmp", DB_FILE))).catch(e => console.error("저장 실패", e));
  return saving;
}

// ---- 로그인 ----
const sign = v => v + "." + crypto.createHmac("sha256", SECRET).update(v).digest("hex").slice(0, 32);
function authed(req) {
  if (!PASSWORD) return true;
  const m = /(?:^|;\s*)hs=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return false;
  const raw = decodeURIComponent(m[1]); const i = raw.lastIndexOf(".");
  const v = raw.slice(0, i);
  return i > 0 && sign(v) === raw && Number(v) > Date.now();
}
const LOGIN = msg => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>휴가대장 로그인</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f2f4f6;font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#17202b}
form{background:#fff;border:1px solid #d8dde4;border-radius:8px;padding:28px;width:min(340px,90vw);display:flex;flex-direction:column;gap:12px}
h1{margin:0;font-size:22px}p{margin:0;color:#5b6674;font-size:13px}input{font:inherit;padding:10px;border:1px solid #d8dde4;border-radius:6px}
button{font:inherit;font-weight:700;padding:10px;border:0;border-radius:6px;background:#1f4e79;color:#fff;cursor:pointer}.e{color:#c3382c}</style></head>
<body><form method="post" action="/login"><h1>휴가대장</h1><p>㈜에스에스전력</p>${msg ? `<p class="e">${msg}</p>` : ""}
<input type="password" name="pw" placeholder="비밀번호" autofocus required><button>들어가기</button></form></body></html>`;

// ---- 유틸 ----
function send(res, code, body, type = "application/json; charset=utf-8", extra = {}) {
  res.writeHead(code, Object.assign({ "Content-Type": type, "Cache-Control": "no-store" }, extra));
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((ok, bad) => {
    const chunks = []; let n = 0;
    req.on("data", c => { n += c.length; if (n > limit) { bad(new Error("too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => ok(Buffer.concat(chunks))); req.on("error", bad);
  });
}
const validId = s => /^[A-Za-z0-9_-]{1,64}$/.test(s);
const clean = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
const EMP_KEYS = ["name", "pos", "hire", "adj", "left"];
const LEAVE_KEYS = ["empId", "type", "start", "end", "days", "deduct", "submitted", "reason", "note", "files", "createdAt"];
const stamp = () => { const d = new Date(Date.now() + 9 * 3600e3).toISOString(); return d.slice(0, 10).replace(/-/g, "") + "_" + d.slice(11, 16).replace(":", ""); };

// 백업 ZIP 구성: db.json(전체 데이터) + files/<id>(원본) + 휴가대장.csv(사람이 보는 용도)
function ledgerCsv() {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const name = id => (db.employees[id] || {}).name || "(삭제된 직원)";
  const rows = Object.values(db.leaves).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const lines = [["직원", "휴가종류", "시작일", "종료일", "일수", "연차차감", "사유", "서류제출일", "비고", "원본 파일"].map(q).join(",")]
    .concat(rows.map(l => [name(l.empId), l.type, l.start, l.end, l.days, l.deduct ? "Y" : "N", l.reason, l.submitted, l.note,
      (l.files || []).map(f => "files/" + f.id + " (" + (f.name || "") + ")").join(" / ")].map(q).join(",")));
  return Buffer.from("﻿" + lines.join("\r\n"), "utf8");
}
async function writeBackup(write) {
  const zip = createZipWriter(write);
  await zip.add("db.json", Buffer.from(JSON.stringify({ format: "hyuga-backup-1", createdAt: new Date().toISOString(), ...db }, null, 1)));
  await zip.add("휴가대장.csv", ledgerCsv());
  for (const id of Object.keys(db.files)) {
    const buf = await fs.promises.readFile(path.join(FILE_DIR, id)).catch(() => null);
    if (buf) await zip.add("files/" + id, buf);
  }
  await zip.finish();
}
async function saveBackupToDisk(label) {
  const file = path.join(BACKUP_DIR, `휴가대장_${label}_${stamp()}.zip`);
  const fh = await fs.promises.open(file, "w");
  try { await writeBackup(b => fh.write(b)); } finally { await fh.close(); }
  // 서버 안의 자동 백업은 최근 10개만 유지
  const list = (await fs.promises.readdir(BACKUP_DIR)).filter(f => f.endsWith(".zip")).sort();
  const olds = await Promise.all(list.map(async f => ({ f, t: (await fs.promises.stat(path.join(BACKUP_DIR, f))).mtimeMs })));
  olds.sort((a, b) => b.t - a.t).slice(10).forEach(o => fs.promises.unlink(path.join(BACKUP_DIR, o.f)).catch(() => {}));
  return file;
}

const MIME_OK =/^(image\/(jpeg|png|gif|webp|heic|heif)|application\/pdf)$/;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;

    if (p === "/health") return send(res, 200, "ok", "text/plain");
    if (p === "/login" && req.method === "POST") {
      const form = new URLSearchParams((await readBody(req, 4096)).toString());
      if (PASSWORD && form.get("pw") === PASSWORD) {
        const v = String(Date.now() + 30 * 864e5);
        return send(res, 302, "", "text/plain", { Location: "/", "Set-Cookie": `hs=${encodeURIComponent(sign(v))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}` });
      }
      return send(res, 401, LOGIN("비밀번호가 맞지 않습니다."), "text/html; charset=utf-8");
    }
    if (p === "/logout") return send(res, 302, "", "text/plain", { Location: "/", "Set-Cookie": "hs=; Path=/; Max-Age=0" });
    if (!authed(req)) {
      if (p.startsWith("/api/") || p.startsWith("/files/")) return send(res, 401, { error: "login" });
      return send(res, 200, LOGIN(""), "text/html; charset=utf-8");
    }

    if (p === "/" || p === "/index.html") return send(res, 200, fs.readFileSync(path.join(__dirname, "public", "index.html")), "text/html; charset=utf-8");

    if (p === "/api/data" && req.method === "GET") {
      return send(res, 200, {
        emps: Object.entries(db.employees).map(([id, v]) => ({ id, ...v })),
        leaves: Object.entries(db.leaves).map(([id, v]) => ({ id, ...v })),
      });
    }
    if (p === "/api/backup/info" && req.method === "GET") {
      const sizes = await Promise.all(Object.keys(db.files).map(id => fs.promises.stat(path.join(FILE_DIR, id)).then(s => s.size).catch(() => 0)));
      const auto = (await fs.promises.readdir(BACKUP_DIR)).filter(f => f.endsWith(".zip")).sort().reverse();
      return send(res, 200, { lastBackup: (db.meta || {}).lastBackup || null, lastRestore: (db.meta || {}).lastRestore || null,
        employees: Object.keys(db.employees).length, leaves: Object.keys(db.leaves).length,
        files: sizes.length, bytes: sizes.reduce((a, b) => a + b, 0), auto });
    }
    if (p === "/api/backup" && req.method === "GET") {
      db.meta = Object.assign({}, db.meta, { lastBackup: new Date().toISOString() }); await persist();
      res.writeHead(200, { "Content-Type": "application/zip", "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="hyuga_backup_${stamp()}.zip"; filename*=UTF-8''${encodeURIComponent("휴가대장_백업_" + stamp() + ".zip")}` });
      await writeBackup(b => new Promise(ok => { if (res.write(b)) ok(); else res.once("drain", ok); }));
      return res.end();
    }
    if (p === "/api/restore" && req.method === "POST") {
      const buf = await readBody(req, MAX_RESTORE);
      let entries, data;
      try { entries = readZip(buf); data = JSON.parse(entries["db.json"].toString("utf8")); }
      catch (e) { return send(res, 400, { error: "휴가대장 백업 파일이 아닙니다" }); }
      if (data.format !== "hyuga-backup-1" || typeof data.employees !== "object" || typeof data.leaves !== "object")
        return send(res, 400, { error: "휴가대장 백업 파일이 아닙니다" });
      // 덮어쓰기 전에 현재 상태를 서버에 자동 보관
      const safety = await saveBackupToDisk("복원전");
      const files = {};
      for (const [id, meta] of Object.entries(data.files || {})) {
        const b = entries["files/" + id];
        if (!/^[a-f0-9]{24}$/.test(id) || !b) continue;
        await fs.promises.writeFile(path.join(FILE_DIR, id), b); files[id] = meta;
      }
      for (const id of Object.keys(db.files)) if (!files[id]) fs.promises.unlink(path.join(FILE_DIR, id)).catch(() => {});
      db = { employees: data.employees, leaves: data.leaves, files, meta: Object.assign({}, db.meta, { lastRestore: new Date().toISOString() }) };
      await persist();
      return send(res, 200, { ok: true, employees: Object.keys(db.employees).length, leaves: Object.keys(db.leaves).length,
        files: Object.keys(files).length, safety: path.basename(safety) });
    }
    if (p.startsWith("/api/backup/auto/") && req.method === "GET") {
      const name = decodeURIComponent(p.slice("/api/backup/auto/".length));
      if (name.includes("/") || name.includes("..") || !name.endsWith(".zip")) return send(res, 400, { error: "name" });
      const f = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(f)) return send(res, 404, { error: "없는 백업입니다" });
      res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="hyuga_backup.zip"; filename*=UTF-8''${encodeURIComponent(name)}` });
      return fs.createReadStream(f).pipe(res);
    }
    let m;
    if ((m = /^\/api\/(employees|leaves)\/([^/]+)$/.exec(p))) {
      const [, col, id] = m; if (!validId(id)) return send(res, 400, { error: "id" });
      if (req.method === "PUT") {
        const body = JSON.parse((await readBody(req, 512 * 1024)).toString() || "{}");
        db[col][id] = clean(body, col === "employees" ? EMP_KEYS : LEAVE_KEYS);
        await persist(); return send(res, 200, { ok: true });
      }
      if (req.method === "DELETE") { delete db[col][id]; await persist(); return send(res, 200, { ok: true }); }
    }
    if (p === "/api/files" && req.method === "POST") {
      const type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
      if (!MIME_OK.test(type)) return send(res, 415, { error: "이미지(JPG·PNG) 또는 PDF만 올릴 수 있습니다" });
      const buf = await readBody(req, MAX_FILE);
      const id = crypto.randomBytes(12).toString("hex");
      await fs.promises.writeFile(path.join(FILE_DIR, id), buf);
      const name = decodeURIComponent(req.headers["x-filename"] || "원본").slice(0, 200);
      db.files[id] = { name, type, size: buf.length, at: new Date().toISOString() }; await persist();
      return send(res, 200, { id, url: "/files/" + id, name, contentType: type });
    }
    if ((m = /^\/(?:api\/)?files\/([a-f0-9]{24})$/.exec(p))) {
      const id = m[1]; const meta = db.files[id];
      if (req.method === "DELETE") {
        delete db.files[id]; await persist(); fs.promises.unlink(path.join(FILE_DIR, id)).catch(() => {});
        return send(res, 200, { ok: true });
      }
      if (!meta) return send(res, 404, "없는 파일입니다", "text/plain; charset=utf-8");
      res.writeHead(200, { "Content-Type": meta.type, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`, "Cache-Control": "private, max-age=86400" });
      return fs.createReadStream(path.join(FILE_DIR, id)).pipe(res);
    }
    send(res, 404, { error: "not_found" });
  } catch (e) {
    if (e.message === "too_large") return send(res, 413, { error: "파일이 20MB를 넘습니다" });
    console.error(e); send(res, 500, { error: "server" });
  }
});
// 하루 한 번 서버 안에 자동 백업 (데이터가 바뀐 날만)
let lastAutoHash = "";
async function autoBackup() {
  const h = crypto.createHash("md5").update(JSON.stringify([db.employees, db.leaves, Object.keys(db.files)])).digest("hex");
  if (h === lastAutoHash || (!Object.keys(db.employees).length && !Object.keys(db.leaves).length)) return;
  try { await saveBackupToDisk("자동"); lastAutoHash = h; } catch (e) { console.error("자동 백업 실패", e); }
}
setTimeout(autoBackup, 60e3); setInterval(autoBackup, 24 * 3600e3);

server.listen(PORT,() => console.log(`휴가대장 서버 :${PORT}  데이터 ${DATA_DIR}  비밀번호 ${PASSWORD ? "설정됨" : "없음"}`));
