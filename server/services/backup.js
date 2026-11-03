'use strict';
/* 프로젝트 백업(zip: project.json + 원본·첨부 파일) 및 복원(새 ID로 별도 프로젝트 생성) */
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const { db, uid, DATA_DIR } = require('../db');

function collect(pid) {
  const all = t => db.prepare(`SELECT * FROM ${t} WHERE project_id=?`).all(pid);
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(pid);
  const files = all('files');
  const prodIds = new Set(['devices', 'cables', 'conduits'].flatMap(t => db.prepare(`SELECT product_id FROM ${t} WHERE project_id=? AND product_id IS NOT NULL`).all(pid).map(r => r.product_id)));
  const products = [...prodIds].map(id => db.prepare('SELECT * FROM products WHERE id=?').get(id)).filter(Boolean);
  return { format: 'cctv-design-backup', version: 1, created_at: new Date().toISOString(), project, sheets: all('sheets'), sheet_revisions: all('sheet_revisions'), devices: all('devices'), cables: all('cables'), conduits: all('conduits'), annotations: all('annotations'), attachments: all('attachments'), change_log: all('change_log'), files, products };
}
function backup(pid, out) {
  const data = collect(pid);
  const zip = archiver.ZipArchive ? new archiver.ZipArchive({ zlib: { level: 6 } }) : archiver('zip', { zlib: { level: 6 } });
  const p = new Promise((res, rej) => { zip.on('error', rej); out.on('finish', res); out.on('close', res); });
  zip.pipe(out);
  zip.append(JSON.stringify(data), { name: 'project.json' });
  data.files.forEach(f => { const dir = path.dirname(path.join(DATA_DIR, f.storage_path)); if (fs.existsSync(dir)) zip.directory(dir, 'files/' + f.id); });
  zip.finalize();
  return p;
}
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
function restore(buf, user) {
  let zip; try { zip = new AdmZip(buf); } catch { throw Object.assign(new Error('백업 파일(zip)을 읽을 수 없습니다.'), { status: 400 }); }
  const ent = zip.getEntry('project.json'); if (!ent) throw Object.assign(new Error('올바른 백업 파일이 아닙니다 (project.json 없음).'), { status: 400 });
  const raw = ent.getData().toString('utf8'); let data;
  try { data = JSON.parse(raw); } catch { throw Object.assign(new Error('백업 데이터 손상'), { status: 400 }); }
  if (data.format !== 'cctv-design-backup') throw Object.assign(new Error('지원하지 않는 백업 형식입니다.'), { status: 400 });
  // 프로젝트·도면·객체·파일 ID 재발급 (제품 ID는 존재하면 유지, 없으면 복원)
  const map = new Map();
  [data.project].concat(data.sheets, data.sheet_revisions, data.devices, data.cables, data.conduits, data.annotations, data.attachments, data.files).forEach(r => r && map.set(r.id, uid()));
  const keepProducts = new Set(); data.products.forEach(p => { if (db.prepare('SELECT 1 FROM products WHERE id=?').get(p.id)) keepProducts.add(p.id); else map.set(p.id, uid()); });
  const remapped = JSON.parse(JSON.stringify(data).replace(UUID, m => map.get(m) || m));
  const pid = remapped.project.id;
  db.transaction(() => {
    const ins = (t, r) => { const cols = Object.keys(r); db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...cols.map(c => r[c])); };
    const pr = { ...remapped.project, name: remapped.project.name + ' (복원 ' + new Date().toLocaleDateString('ko-KR') + ')', company_id: user.company_id, created_by: user.id };
    ins('projects', pr);
    remapped.products.forEach((p, i) => { if (!keepProducts.has(data.products[i].id)) ins('products', { ...p, company_id: user.company_id }); });
    remapped.files.forEach(f => {
      const oldId = [...map.entries()].find(([, v]) => v === f.id)[0];
      const srcDir = 'files/' + oldId + '/'; const dstDir = path.join(DATA_DIR, 'files', pid, f.id); fs.mkdirSync(dstDir, { recursive: true });
      zip.getEntries().filter(e => e.entryName.startsWith(srcDir) && !e.isDirectory).forEach(e => fs.writeFileSync(path.join(dstDir, e.entryName.slice(srcDir.length)), e.getData()));
      ins('files', { ...f, project_id: pid, storage_path: path.relative(DATA_DIR, path.join(dstDir, path.basename(f.storage_path))) });
    });
    ['sheets', 'sheet_revisions', 'devices', 'cables', 'conduits', 'annotations', 'attachments'].forEach(t => remapped[t].forEach(r => ins(t, { ...r, project_id: pid })));
    remapped.change_log.forEach(r => { const { id, ...x } = r; ins('change_log', { ...x, project_id: pid }); });
    if (user.role !== 'admin') db.prepare('INSERT INTO project_members VALUES(?,?,?)').run(pid, user.id, 'designer');
    db.prepare('INSERT INTO change_log(project_id,user_id,user_name,entity,entity_id,action,reason) VALUES(?,?,?,?,?,?,?)').run(pid, user.id, user.name, 'project', pid, 'restore', '백업에서 복원');
  })();
  return pid;
}
module.exports = { backup, restore };
