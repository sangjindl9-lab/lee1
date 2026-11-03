'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const sizeOf = require('image-size').imageSize || require('image-size');
const { db, uid, J, DATA_DIR, getSetting } = require('../db');
const { parseDxfFile } = require('./dxf');

const FILE_DIR = path.join(DATA_DIR, 'files');
const MAX_MB = +(process.env.MAX_UPLOAD_MB || 200);
const PDF_DPI = +(process.env.PDF_RENDER_DPI || 150);

function run(cmd, args, opts) {
  return new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: (opts && opts.timeout) || 300000, ...(opts || {}) }, (e, so, se) => e ? rej(Object.assign(e, { stderr: String(se || '') })) : res({ stdout: String(so), stderr: String(se) })));
}

// 파일 내용(매직바이트)으로 형식 판별 – 확장자만 믿지 않음
function sniff(buf, name) {
  const ext = path.extname(name || '').toLowerCase();
  const head = buf.slice(0, 32);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.slice(0, 4).toString() === 'GIF8') return 'image/gif';
  if (head.slice(0, 4).toString() === 'RIFF' && head.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (head.slice(0, 2).toString() === 'BM') return 'image/bmp';
  if (head.slice(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (/^AC10\d\d/.test(head.slice(0, 6).toString())) return 'application/acad';
  if (head.slice(0, 22).toString() === 'AutoCAD Binary DXF\r\n\x1a') return 'application/dxf-binary';
  const txt = buf.slice(0, 4096).toString('latin1');
  if (/^\s*0\s*[\r\n]+\s*SECTION/m.test(txt) || (/SECTION/.test(txt) && /HEADER|ENTITIES|TABLES/.test(txt))) return 'application/dxf';
  if (head.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'application/zip';
  if (['.txt', '.csv'].includes(ext)) return 'text/plain';
  return null;
}
const KIND_BY_MIME = { 'image/jpeg': 'image', 'image/png': 'image', 'image/gif': 'image', 'image/webp': 'image', 'image/bmp': 'image', 'application/pdf': 'pdf', 'application/acad': 'dwg', 'application/dxf': 'dxf', 'application/dxf-binary': 'dxf' };

function dirFor(pid, fid) { const d = path.join(FILE_DIR, pid || '_global', fid); fs.mkdirSync(d, { recursive: true }); return d; }

function storeBuffer(pid, buf, originalName, userId, allowKinds, forcedKind) {
  if (buf.length > MAX_MB * 1024 * 1024) throw httpErr(413, `파일 용량이 너무 큽니다. 최대 ${MAX_MB}MB까지 업로드할 수 있습니다.`);
  const mime = sniff(buf, originalName);
  if (!mime) throw httpErr(415, '파일 내용을 확인할 수 없는 형식입니다. JPG·PNG 이미지, PDF, DXF, DWG 파일을 업로드하세요.');
  let kind = forcedKind || KIND_BY_MIME[mime] || 'other';
  if (forcedKind && ['photo', 'logo', 'titleblock'].includes(forcedKind) && !mime.startsWith('image/')) throw httpErr(415, '이미지 파일(JPG·PNG)만 업로드할 수 있습니다.');
  if (forcedKind === 'spec' && !(mime === 'application/pdf' || mime.startsWith('image/'))) throw httpErr(415, '제품사양서는 PDF 또는 이미지 파일만 업로드할 수 있습니다.');
  if (allowKinds && !allowKinds.includes(KIND_BY_MIME[mime] || kind)) throw httpErr(415, `이 위치에는 ${allowKinds.join('·')} 파일만 업로드할 수 있습니다. (확인된 형식: ${mime})`);
  const id = uid();
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp', 'application/pdf': '.pdf', 'application/acad': '.dwg', 'application/dxf': '.dxf', 'application/dxf-binary': '.dxf', 'application/zip': '.zip', 'text/plain': '.txt' }[mime] || '.bin';
  const d = dirFor(pid, id); const p = path.join(d, 'original' + ext);
  fs.writeFileSync(p, buf);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  db.prepare('INSERT INTO files(id,project_id,original_name,mime,size,sha256,kind,storage_path,meta,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, pid, originalName, mime, buf.length, sha, kind, path.relative(DATA_DIR, p), '{}', userId);
  return getFile(id);
}
function getFile(id) { const r = db.prepare('SELECT * FROM files WHERE id=?').get(id); if (!r) return null; r.meta = J(r.meta); r.abs = path.join(DATA_DIR, r.storage_path); r.dir = path.dirname(r.abs); return r; }
function setMeta(id, meta) { db.prepare('UPDATE files SET meta=? WHERE id=?').run(JSON.stringify(meta), id); }
function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }

// ----- 비동기 작업 -----
function createJob(pid, type, userId) { const id = uid(); db.prepare('INSERT INTO jobs(id,project_id,type,status,progress,created_by) VALUES(?,?,?,?,?,?)').run(id, pid, type, '대기', 0, userId); return id; }
function updJob(id, f) { const cur = db.prepare('SELECT * FROM jobs WHERE id=?').get(id); const n = { ...cur, ...f }; db.prepare('UPDATE jobs SET status=?,progress=?,message=?,result=?,updated_at=datetime(\'now\') WHERE id=?').run(n.status, n.progress, n.message || null, typeof n.result === 'string' ? n.result : JSON.stringify(n.result || null), id); }
function getJob(id) { const r = db.prepare('SELECT * FROM jobs WHERE id=?').get(id); if (r) r.result = J(r.result); return r; }
function runJob(pid, type, userId, fn) {
  const id = createJob(pid, type, userId);
  setImmediate(async () => {
    updJob(id, { status: '진행', progress: 5 });
    try { const result = await fn(p => updJob(id, { status: '진행', progress: p })); updJob(id, { status: '완료', progress: 100, result, message: '완료' }); }
    catch (e) { console.error('[job]', type, e); updJob(id, { status: '실패', progress: 100, message: e.userMessage || e.message }); }
  });
  return id;
}

// ----- 형식별 분석 -----
async function analyze(file, progress) {
  if (file.kind === 'image') {
    const dim = sizeOf(fs.readFileSync(file.abs));
    const meta = { width: dim.width, height: dim.height, pages: 1, type: dim.type };
    setMeta(file.id, meta); return meta;
  }
  if (file.kind === 'pdf') {
    let info;
    try { info = (await run('pdfinfo', [file.abs])).stdout; } catch (e) { const er = new Error('PDF 분석 실패: 손상되었거나 암호가 걸린 PDF일 수 있습니다. ' + (e.stderr || '').slice(0, 200)); er.userMessage = er.message; throw er; }
    const pages = +((info.match(/Pages:\s+(\d+)/) || [])[1] || 1);
    const sz = (info.match(/Page size:\s+([\d.]+) x ([\d.]+)/) || []);
    const thumbs = [];
    const n = Math.min(pages, 60);
    await run('pdftoppm', ['-png', '-r', '18', '-f', '1', '-l', String(n), file.abs, path.join(file.dir, 'thumb')]);
    fs.readdirSync(file.dir).filter(f => f.startsWith('thumb')).sort().forEach(f => thumbs.push(f));
    progress && progress(60);
    // 벡터/스캔 판별(텍스트 유무 참고값)
    let hasText = false; try { hasText = (await run('pdftotext', ['-l', '3', file.abs, '-'])).stdout.trim().length > 20; } catch { }
    const meta = { pages, page_w_pt: +sz[1] || null, page_h_pt: +sz[2] || null, thumbs, hasText, note: hasText ? '벡터 PDF로 보입니다. 배경 이미지로 변환하여 사용하며, PDF 내부 선을 설계 객체로 인식하지는 않습니다.' : '스캔(이미지) PDF로 보입니다. 배경으로 사용합니다.' };
    setMeta(file.id, meta); return meta;
  }
  if (file.kind === 'dxf') {
    progress && progress(20);
    let r;
    try { r = parseDxfFile(file.abs); } catch (e) { const er = new Error('DXF 해석 실패: ' + e.message + ' (ASCII DXF R12~2018 형식을 권장합니다)'); er.userMessage = er.message; throw er; }
    fs.writeFileSync(path.join(file.dir, 'dxf.json'), JSON.stringify(r));
    const meta = { units: r.units, layers: r.layers, warnings: r.warnings, stats: r.stats, model: { width: r.model.width, height: r.model.height, origin: r.model.origin }, paper: { width: r.paper.width, height: r.paper.height, origin: r.paper.origin }, fonts: r.fonts, xrefs: r.xrefs };
    setMeta(file.id, meta); return meta;
  }
  if (file.kind === 'dwg') {
    const eng = getSetting('dwg_engine', null);
    if (!eng || !eng.path) { const er = new Error('DWG 변환 엔진이 설정되지 않았습니다. 관리자 > DWG 변환 엔진에서 설정하거나 CAD에서 DXF로 저장 후 업로드하세요.'); er.userMessage = er.message; throw er; }
    progress && progress(10);
    const outDxf = path.join(file.dir, 'converted.dxf');
    try {
      if (eng.type === 'oda') {
        const inDir = path.join(file.dir, 'odain'), outDir = path.join(file.dir, 'odaout'); fs.mkdirSync(inDir, { recursive: true }); fs.mkdirSync(outDir, { recursive: true });
        fs.copyFileSync(file.abs, path.join(inDir, 'in.dwg'));
        await run(eng.path, [inDir, outDir, 'ACAD2018', 'DXF', '0', '1', 'in.dwg'], { timeout: 600000 });
        fs.copyFileSync(path.join(outDir, 'in.dxf'), outDxf);
      } else {
        await run(eng.path, ['-y', '-o', outDxf, file.abs], { timeout: 600000 }).catch(e => { if (!fs.existsSync(outDxf)) throw e; });
      }
    } catch (e) { const er = new Error('DWG 변환 실패: ' + ((e.stderr || e.message || '').split('\n').filter(Boolean).slice(-3).join(' ')).slice(0, 300) + ' – 지원되지 않는 DWG 버전이거나 손상된 파일일 수 있습니다. CAD에서 DXF로 저장 후 업로드하세요.'); er.userMessage = er.message; throw er; }
    if (!fs.existsSync(outDxf) || fs.statSync(outDxf).size < 100) { const er = new Error('DWG 변환 결과가 비어 있습니다. DXF로 저장 후 업로드하세요.'); er.userMessage = er.message; throw er; }
    progress && progress(60);
    let r; try { r = parseDxfFile(outDxf); } catch (e) { const er = new Error('변환된 DXF 해석 실패: ' + e.message); er.userMessage = er.message; throw er; }
    r.warnings.unshift(`DWG → DXF 변환: ${eng.type === 'oda' ? 'ODA File Converter' : 'LibreDWG dwg2dxf'} 사용. 변환 엔진 한계로 일부 객체가 누락될 수 있으니 원본과 대조하세요.`);
    fs.writeFileSync(path.join(file.dir, 'dxf.json'), JSON.stringify(r));
    const ver = fs.readFileSync(file.abs).slice(0, 6).toString();
    const meta = { dwg_version: ver, converted: true, units: r.units, layers: r.layers, warnings: r.warnings, stats: r.stats, model: { width: r.model.width, height: r.model.height, origin: r.model.origin }, paper: { width: r.paper.width, height: r.paper.height, origin: r.paper.origin }, fonts: r.fonts, xrefs: r.xrefs };
    setMeta(file.id, meta); return meta;
  }
  return {};
}

async function renderPdfPage(file, page) {
  const out = path.join(file.dir, `page-${page}`);
  const png = out + '.png';
  if (!fs.existsSync(png)) await run('pdftoppm', ['-png', '-r', String(PDF_DPI), '-f', String(page), '-l', String(page), '-singlefile', file.abs, out]);
  const dim = sizeOf(fs.readFileSync(png));
  return { path: png, width: dim.width, height: dim.height, dpi: PDF_DPI };
}

// 벡터 PDF 페이지 → SVG (화면 표시·PDF 출력에서 벡터 배경으로 사용)
async function renderPdfSvg(file, page) {
  const out = path.join(file.dir, `page-${page}.svg`);
  if (!fs.existsSync(out)) await run('pdftocairo', ['-svg', '-f', String(page), '-l', String(page), file.abs, out], { timeout: 300000 });
  return out;
}
// 흑백 출력용 회색조 배경 (PDF: pdftoppm -gray, PNG·JPG: 순수 JS 변환)
async function grayImage(file, page) {
  if (file.kind === 'pdf') {
    const out = path.join(file.dir, `page-${page}-gray`);
    if (!fs.existsSync(out + '.png')) await run('pdftoppm', ['-png', '-gray', '-r', String(PDF_DPI), '-f', String(page), '-l', String(page), '-singlefile', file.abs, out]);
    return out + '.png';
  }
  const out = path.join(file.dir, 'gray.png'); if (fs.existsSync(out)) return out;
  const { PNG } = require('pngjs'); const buf = fs.readFileSync(file.abs); let w, h, data;
  if (file.mime === 'image/png') { const im = PNG.sync.read(buf); w = im.width; h = im.height; data = im.data; }
  else if (file.mime === 'image/jpeg') { const im = require('jpeg-js').decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 }); w = im.width; h = im.height; data = im.data; }
  else return null; // GIF·WEBP·BMP: 원본 색 유지
  for (let i = 0; i < data.length; i += 4) { const v = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]); data[i] = data[i + 1] = data[i + 2] = v; }
  const png = new PNG({ width: w, height: h }); png.data = Buffer.from(data.buffer || data); fs.writeFileSync(out, PNG.sync.write(png, { colorType: 0, inputColorType: 6 }));
  return out;
}

async function testDwgEngine(eng) {
  if (!eng || !eng.path) return { ok: false, message: '경로가 비어 있습니다.' };
  if (!fs.existsSync(eng.path)) return { ok: false, message: '실행 파일을 찾을 수 없습니다: ' + eng.path };
  try {
    if (eng.type === 'oda') return { ok: true, message: 'ODA File Converter 실행 파일 확인 (실행 테스트는 DWG 업로드 시 수행)' };
    const r = await run(eng.path, ['--version'], { timeout: 15000 });
    return { ok: true, message: (r.stdout || r.stderr).trim().split('\n')[0] };
  } catch (e) { return { ok: false, message: '실행 실패: ' + (e.stderr || e.message).slice(0, 200) }; }
}

module.exports = { storeBuffer, getFile, setMeta, analyze, renderPdfPage, renderPdfSvg, grayImage, runJob, getJob, testDwgEngine, sniff, httpErr, run, FILE_DIR };
