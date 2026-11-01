// 파일 저장: 내용 해시와 함께 복사본을 보관한다 (원본이 바뀌어도 계약은 이 복사본 기준)
const fs = require('fs');
const path = require('path');
const { get, run, DATA_DIR } = require('./db');
const C = require('./core');

const ALLOWED = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'text/csv': 'csv' };
const MAX = Number(process.env.MAX_FILE_MB || 15) * 1024 * 1024;

function sniff(buf) {
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return null;
}
function storeFile(companyId, buf, name, { origin = 'upload', originRef = null, mime = null } = {}) {
  if (!buf?.length) throw C.bad('빈 파일입니다');
  if (buf.length > MAX) throw C.bad(`파일이 너무 큽니다 (최대 ${MAX / 1048576}MB)`);
  const m = mime || sniff(buf);
  if (!m || !ALLOWED[m]) throw C.bad('PNG·JPG·PDF·XLSX 파일만 올릴 수 있습니다');
  const sha = C.sha256(buf);
  const rel = path.join('files', String(companyId), sha.slice(0, 2), `${sha}.${ALLOWED[m]}`);
  const abs = path.join(DATA_DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, buf);
  const r = run(`insert into files(company_id,name,mime,size,sha256,path,origin,origin_ref) values(?,?,?,?,?,?,?,?)`,
    companyId, String(name || 'file').slice(0, 150), m, buf.length, sha, rel, origin, originRef);
  return Number(r.lastInsertRowid);
}
function fromDataUrl(companyId, dataUrl, name, opts) {
  const m = /^data:([\w/.+-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw C.bad('파일 형식이 올바르지 않습니다');
  return storeFile(companyId, Buffer.from(m[2], 'base64'), name, opts);
}
function readFile(id) {
  const f = get(`select * from files where id=?`, id);
  if (!f) throw C.notFound('파일이 없습니다');
  return { ...f, buf: fs.readFileSync(path.join(DATA_DIR, f.path)) };
}
// 만료되는 다운로드 주소 (권한 확인 후에만 발급)
function signedUrl(fileId, companyId, minutes = 10) {
  const exp = Date.now() + minutes * 60e3;
  const sig = C.hmac(`dl:${fileId}:${companyId}:${exp}`);
  return { url: `/dl/${fileId}?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp).toISOString() };
}
function checkSigned(fileId, exp, sig) {
  const f = get(`select company_id from files where id=?`, fileId);
  if (!f || !exp || Number(exp) < Date.now()) return false;
  const want = C.hmac(`dl:${fileId}:${f.company_id}:${exp}`);
  return typeof sig === 'string' && sig.length === want.length && require('crypto').timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
module.exports = { storeFile, fromDataUrl, readFile, signedUrl, checkSigned, sniff };
