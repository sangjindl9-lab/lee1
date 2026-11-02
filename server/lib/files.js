const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { db } = require('../db');
const { HttpError } = require('../auth');

fs.mkdirSync(config.uploadDir, { recursive: true });
const tmpDir = path.join(config.uploadDir, '_tmp');
fs.mkdirSync(tmpDir, { recursive: true });

// 허용 확장자 → 분류
const ALLOWED = {
  image: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
  pdf: ['.pdf'],
  cad: ['.dwg', '.dxf'],
  office: ['.xlsx', '.xls', '.docx', '.doc', '.hwp', '.hwpx', '.pptx', '.txt', '.csv'],
  archive: ['.zip'],
  measure: ['.sor', '.trc', '.flw', '.dat', '.xml', '.json'], // 측정 원본 (해석하지 않고 보관만)
};
const ALL_EXT = Object.values(ALLOWED).flat();

const upload = multer({
  dest: tmpDir,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    // 브라우저가 보낸 파일명 인코딩 보정 (한글 파일명)
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALL_EXT.includes(ext)) return cb(new HttpError(400, `허용되지 않는 파일 형식입니다: ${ext || '(확장자 없음)'}`));
    cb(null, true);
  },
});

function kindOf(name) {
  const ext = path.extname(name).toLowerCase();
  for (const [k, list] of Object.entries(ALLOWED)) if (list.includes(ext)) return k;
  return 'other';
}

// 내용 서명 확인 (확장자 위장 방지)
function checkMagic(filePath, name) {
  const ext = path.extname(name).toLowerCase();
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  const hex = buf.toString('hex');
  if (ext === '.pdf') return buf.slice(0, 4).toString() === '%PDF';
  if (ext === '.png') return hex.startsWith('89504e47');
  if (ext === '.jpg' || ext === '.jpeg') return hex.startsWith('ffd8');
  if (ext === '.gif') return buf.slice(0, 3).toString() === 'GIF';
  if (ext === '.webp') return buf.slice(0, 4).toString() === 'RIFF';
  if (ext === '.xlsx' || ext === '.docx' || ext === '.zip' || ext === '.pptx' || ext === '.hwpx') return hex.startsWith('504b');
  if (ext === '.dwg') return buf.slice(0, 2).toString() === 'AC';
  return true;
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf' };

function saveUploaded(file, { siteId, ownerType, ownerId, category, caption, userId }) {
  try {
    if (!checkMagic(file.path, file.originalname)) throw new HttpError(400, `파일 내용이 확장자와 맞지 않습니다: ${file.originalname}`);
    const ext = path.extname(file.originalname).toLowerCase();
    const stored = crypto.randomBytes(16).toString('hex') + ext;
    const sub = path.join(config.uploadDir, String(siteId));
    fs.mkdirSync(sub, { recursive: true });
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
    fs.renameSync(file.path, path.join(sub, stored));
    const info = db.prepare(`INSERT INTO files(site_id, owner_type, owner_id, category, orig_name, mime, size, stored_name, sha256, caption, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(siteId, ownerType, ownerId, category, file.originalname, MIME[ext] || 'application/octet-stream', file.size, `${siteId}/${stored}`, hash, caption || null, userId);
    return info.lastInsertRowid;
  } finally {
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
  }
}

function cleanupTmp(files) {
  for (const f of files || []) if (f?.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
}

function absPath(row) { return path.join(config.uploadDir, row.stored_name); }

module.exports = { upload, saveUploaded, absPath, kindOf, cleanupTmp, ALLOWED };
