// DWG: 공개 규격이 아니므로 LibreDWG(dwg2dxf, GPLv3 — 별도 실행 프로그램으로 호출)로 DXF 변환 후 DXF 분석기를 사용.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { analyzeDxf } from './dxf.js';

const run = promisify(execFile);
export const DWG2DXF = process.env.DWG2DXF_PATH || '/opt/libredwg/bin/dwg2dxf';
const VER = { AC1012: 'R13', AC1014: 'R14', AC1015: '2000', AC1018: '2004', AC1021: '2007', AC1024: '2010', AC1027: '2013', AC1032: '2018' };

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
    if (!st?.size) throw new Error(`DWG 를 변환하지 못했습니다 (AutoCAD ${VER[code] || code} 형식). DXF 로 저장해 올려 주세요. ${log.slice(-200)}`);
    const a = analyzeDxf(await fs.readFile(out), 'DWG');
    a.version = `${code} (AutoCAD ${VER[code] || '알 수 없음'})`;
    a.converter = 'LibreDWG dwg2dxf 0.13';
    // 재질·연관치수 등 형상과 무관한 경고는 제외하고, 도면 객체(entity) 경고와 읽기 오류만 알린다
    const warns = (log.match(/(?:Class entity[^\n]*|ERROR[^\n]*)/g) || []).length;
    if (warns) a.warnings.unshift(`DWG 변환 중 도면 객체 경고 ${warns}건 — 일부 객체(WIPEOUT 등)가 빠졌을 수 있습니다.`);
    return a;
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
