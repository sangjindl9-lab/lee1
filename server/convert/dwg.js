// DWG: 공개 규격이 아니므로 LibreDWG(dwg2dxf, GPLv3 — 별도 실행 프로그램으로 호출)로 DXF 변환 후 DXF 분석기를 사용.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyzeDxf, analyzeParsed } from './dxf.js';
import { dwgJsonToDxf } from './dwgjson.js';

const run = promisify(execFile);
export const DWG2DXF = process.env.DWG2DXF_PATH || '/opt/libredwg/bin/dwg2dxf';
const VER = { AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018' };

async function viaJson(file, dir) {
  const js = path.join(dir, 'b.json');
  const DWGREAD = path.join(path.dirname(DWG2DXF), 'dwgread');
  try { await run(DWGREAD, ['-O', 'JSON', '-o', js, file], { timeout: 240000, maxBuffer: 1 << 26 }); } catch { /* 결과 파일로 판단 */ }
  const j = JSON.parse(await fs.readFile(js, 'utf8'));
  const d = dwgJsonToDxf(j);
  const a = analyzeParsed(d, d.layerLT, 'DWG');
  a.converter = 'LibreDWG dwgread(JSON) 0.13';
  a.warnings.unshift('DWG→DXF 변환에서 객체가 빠져 JSON 읽기로 다시 분석했습니다.');
  return a;
}

export async function analyzeDwg(file) {
  if (!fss.existsSync(DWG2DXF)) throw new Error('DWG 변환 엔진(LibreDWG dwg2dxf)이 설치되어 있지 않습니다. 관리자에게 문의하거나 DXF 로 저장해 올려 주세요.');
  const head = Buffer.alloc(6); const fd = await fs.open(file); await fd.read(head, 0, 6, 0); await fd.close();
  const code = head.toString('latin1');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eum3d-dwg-'));
  const out = path.join(dir, 'out.dxf');
  try {
    let log = '';
    try { const r = await run(DWG2DXF, ['-y', '-o', out, file], { timeout: 180000, maxBuffer: 1 << 26 }); log = r.stderr; }
    catch (e) { log = String(e.stderr || e.message); } // 경고만 있어도 비정상 종료할 수 있어 결과 파일로 판단
    const st = await fs.stat(out).catch(() => null);
    let a = null;
    if (st?.size) { try { a = analyzeDxf(await fs.readFile(out), 'DWG'); } catch { a = null; } }
    // dwg2dxf 가 도중에 멈추거나(세그폴트) 블록 오류로 객체를 거의 못 쓴 경우: 같은 엔진의 JSON 읽기(dwgread)로 다시 시도해 더 많이 읽은 쪽을 쓴다
    const nEnt = (x) => Object.values(x?.entityCounts || {}).reduce((t, v) => t + v, 0);
    if (a && (nEnt(a) < 50 || /ERROR/.test(log))) {
      const b = await viaJson(file, dir).catch(() => null);
      if (b && nEnt(b) > nEnt(a) * 1.5) a = b;
    }
    if (!a) {
      const js = path.join(dir, 'out.json');
      const DWGREAD = path.join(path.dirname(DWG2DXF), 'dwgread');
      try { await run(DWGREAD, ['-O', 'JSON', '-o', js, file], { timeout: 240000, maxBuffer: 1 << 26 }); } catch { /* 결과 파일로 판단 */ }
      const raw = await fs.readFile(js, 'utf8').catch(() => '');
      let j = null; try { j = JSON.parse(raw); } catch { j = null; }
      if (!j) throw new Error(`DWG 를 변환하지 못했습니다 (AutoCAD ${VER[code] || code} 형식). DXF 로 저장해 올려 주세요. ${log.slice(-200)}`);
      const d = dwgJsonToDxf(j);
      a = analyzeParsed(d, d.layerLT, 'DWG');
      a.converter = 'LibreDWG dwgread(JSON) 0.13';
      a.warnings.unshift('DWG→DXF 변환이 중간에 멈춰 JSON 읽기로 대신 분석했습니다. 일부 객체가 빠졌을 수 있습니다.');
    }
    a.version = `${code} (AutoCAD ${VER[code] || '알 수 없음'})`;
    a.converter ||= 'LibreDWG dwg2dxf 0.13';
    // 재질·연관치수 등 형상과 무관한 경고는 제외하고, 도면 객체(entity) 경고와 읽기 오류만 알린다
    const warns = (log.match(/(?:Class entity[^\n]*|ERROR[^\n]*)/g) || []).length;
    if (warns) a.warnings.unshift(`DWG 변환 중 도면 객체 경고 ${warns}건 — 일부 객체(WIPEOUT 등)가 빠졌을 수 있습니다.`);
    return a;
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
