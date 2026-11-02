// 완료 검증 스크립트 (API 수준). 별도 데이터 폴더에 시연 데이터를 만들고 서버를 띄워 실제 요청으로 확인합니다.
// 사용: npm run verify
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'cable-verify-'));
const PORT = 3299;
const BASE = `http://127.0.0.1:${PORT}`;
const ENV = { ...process.env, DATA_DIR: DATA, PORT: String(PORT), SESSION_SECRET: 'verify-secret', ADMIN_PASSWORD: 'verify-admin-1', DEMO_PASSWORD: 'verify-demo-1' };
const results = [];
const ok = (no, name, pass, detail = '') => { results.push({ no, name, pass, detail }); console.log(`${pass ? '통과' : '실패'} [${no}] ${name}${detail ? ' — ' + detail : ''}`); };

let server;
function start() {
  return new Promise((res, rej) => {
    server = spawn('node', ['server/index.js'], { cwd: ROOT, env: ENV });
    server.stdout.on('data', d => { if (String(d).includes('http://')) res(); });
    server.stderr.on('data', d => { if (!String(d).includes('경고')) process.stderr.write(d); });
    setTimeout(() => rej(new Error('서버 시작 시간 초과')), 15000);
  });
}
const stop = () => new Promise(r => { server.on('exit', r); server.kill(); });

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, body, raw) {
    const init = { method, headers: {} };
    if (this.cookie) init.headers.cookie = this.cookie;
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    const r = await fetch(BASE + url, { ...init, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    if (raw) return r;
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : await r.text() };
  }
  async login(u, p) { const r = await this.req('POST', '/api/login', { username: u, password: p }); if (r.status !== 200) throw new Error('로그인 실패 ' + u); return this; }
}

async function main() {
  execFileSync('node', ['server/init-admin.js'], { cwd: ROOT, env: ENV });
  execFileSync('node', ['server/seed-demo.js'], { cwd: ROOT, env: ENV, stdio: 'ignore' });
  await start();
  const A = await new Client().login('admin', 'verify-admin-1');
  const site = 1;
  const find = async (mgmt) => (await A.req('GET', `/api/sites/${site}/assets?q=${encodeURIComponent(mgmt)}`)).data.find(a => a.mgmt_no === mgmt);
  const drawings = (await A.req('GET', `/api/sites/${site}/drawings`)).data;
  const revB = drawings[0].revisions[0], revA = drawings[0].revisions[1];

  // ---- 1. 전력케이블 1건 흐름 + 재시작·재로그인 후 유지 ----
  const lp = await find('LP-1');
  const lpCard = (await A.req('GET', `/api/assets/${lp.id}`)).data;
  const freeCircuit = lpCard.ports.find(p => !p.peer);
  const c = await A.req('POST', `/api/sites/${site}/assets`, { category: 'power_cable', mgmt_no: 'PC-900', name: '검증용 케이블', status: '시공 완료', details: { panel_name: 'LP-1', circuit_no: freeCircuit.name, cable_type: 'F-CV', size: '4sq', design_length: 20 } });
  const pcId = c.data.id;
  await A.req('POST', `/api/sites/${site}/connections`, { kind: 'power', a: { type: 'port', id: freeCircuit.id }, b: { type: 'cable', id: pcId, end: 'A' } });
  const fd = new FormData();
  const fileBuf = fs.readFileSync(path.join(ROOT, 'public', 'index.html'));
  fd.append('owner_type', 'asset'); fd.append('owner_id', pcId); fd.append('category', 'other');
  fd.append('files', new Blob([fileBuf]), 'verify.txt');
  const up = await A.req('POST', '/api/files', fd);
  const markRes = await A.req('POST', `/api/revisions/${revB.id}/marks`, { asset_id: pcId, shape: 'polyline', page: 1, geom: { pts: [[0.1, 0.2], [0.3, 0.2], [0.3, 0.4]] } });
  await A.req('POST', `/api/assets/${pcId}/measurements`, { test_type: 'insulation', measured_at: '2026-11-02T10:00', test_voltage: 500, unit: 'MΩ', rows: [{ combination: 'L-E', value: 300 }] });
  const pdf1 = await A.req('GET', `/api/pdf/card/${pcId}`, undefined, true);
  const pdfBuf = Buffer.from(await pdf1.arrayBuffer());
  fs.writeFileSync(path.join(DATA, 'card.pdf'), pdfBuf);
  await stop(); await start();
  const A2 = await new Client().login('admin', 'verify-admin-1');
  const card2 = (await A2.req('GET', `/api/assets/${pcId}`)).data;
  const dl = await A2.req('GET', `/api/files/${up.data.ids[0]}`, undefined, true);
  const same = crypto.createHash('sha256').update(Buffer.from(await dl.arrayBuffer())).digest('hex') === crypto.createHash('sha256').update(fileBuf).digest('hex');
  const markKept = (await A2.req('GET', `/api/revisions/${revB.id}`)).data.marks.find(m => m.id === markRes.data.id);
  ok(1, '재시작·재로그인 후 데이터·첨부파일·도면 연결 유지', card2.asset?.mgmt_no === 'PC-900' && same && !!markKept && JSON.stringify(markKept.geom.pts[2]) === '[0.3,0.4]' && card2.ends.A?.text?.includes('LP-1') && card2.measurements.length === 1 && pdfBuf.slice(0, 4).toString() === '%PDF',
    `설비 ${card2.asset?.mgmt_no}, 첨부 해시 일치 ${same}, 도면 표시 ${!!markKept}, A단 ${card2.ends.A?.text}, PDF ${pdfBuf.length}바이트`);

  // ---- 4. 광코어 종단 추적 ----
  const fo1 = await find('FO-01');
  const foCard = (await A2.req('GET', `/api/assets/${fo1.id}`)).data;
  const tr = (await A2.req('GET', `/api/trace?type=core&id=${foCard.cores[0].id}`)).data;
  const leaves = []; (function w(n) { if (!n.children.length) leaves.push(`${n.text}:${n.end}`); n.children.forEach(w); })(tr.A);
  ok(4, '광코어 접속을 따라 종단까지 추적', leaves.some(l => l.startsWith('SW-2 P1:종단')) && leaves.some(l => l.startsWith('SW-1 P10:종단')), leaves.join(', '));

  // ---- 5. 중복 연결 차단 ----
  const pp = await find('PP-1');
  const ppCard = (await A2.req('GET', `/api/assets/${pp.id}`)).data;
  const p1 = ppCard.ports.find(p => p.name === 'P1');
  const dupPort = await A2.req('POST', `/api/sites/${site}/connections`, { kind: 'fixed', a: { type: 'port', id: p1.id, end: 'rear' }, b: { type: 'asset', id: pcId } });
  const fo2 = await find('FO-02');
  const fo2Card = (await A2.req('GET', `/api/assets/${fo2.id}`)).data;
  const dupCore = await A2.req('POST', `/api/sites/${site}/connections`, { kind: 'splice', a: { type: 'core', id: foCard.cores[0].id, end: 'B' }, b: { type: 'core', id: fo2Card.cores[5].id, end: 'A' } });
  const badCore = await A2.req('POST', `/api/sites/${site}/connections`, { kind: 'splice', a: { type: 'core', id: foCard.cores[11].id, end: 'B' }, b: { type: 'core', id: fo2Card.cores[6].id, end: 'A' } });
  ok(5, '동일 포트·코어 중복 연결 차단', dupPort.status === 409 && dupCore.status === 409 && badCore.status === 400, `포트 ${dupPort.status} "${dupPort.data.error}", 코어 ${dupCore.status}, 불량 코어 ${badCore.status}`);

  // ---- 6. 측정 재등록 후 과거 결과 보존 ----
  const pc1 = await find('PC-001');
  const before = (await A2.req('GET', `/api/assets/${pc1.id}`)).data.measurements;
  await A2.req('POST', `/api/assets/${pc1.id}/measurements`, { test_type: 'insulation', measured_at: '2026-11-02T11:00', test_voltage: 500, unit: 'MΩ', rows: [{ combination: 'L1-E', value: 600 }] });
  const target = before.find(m => m.value === 0.4);
  const corr = await A2.req('POST', `/api/measurements/${target.id}/correct`, { value: 0.45, correction_reason: '검증: 기록 오기 정정' });
  const after = (await A2.req('GET', `/api/assets/${pc1.id}`)).data.measurements;
  const oldStill = after.find(m => m.id === target.id);
  ok(6, '측정 재등록·정정 후 과거 결과 보존', after.length === before.length + 2 && before.every(b => after.some(a => a.id === b.id && a.value === b.value)) && oldStill.superseded_by === corr.data.id,
    `이전 ${before.length}건 → ${after.length}건, 정정 전 기록 값 ${oldStill.value} 유지`);

  // ---- 7. 시험기준 없을 때 임의 합격 처리 안 함 ----
  const lnCard = await find('LN-001');
  const lanM = await A2.req('POST', `/api/assets/${lnCard.id}/measurements`, { test_type: 'lan_cert', measured_at: '2026-11-02T12:00', overall: 'PASS', items: [{ name: 'Wire Map', result: 'PASS' }] });
  const unitBad = await A2.req('POST', `/api/assets/${pc1.id}/measurements`, { test_type: 'insulation', measured_at: '2026-11-02T12:00', test_voltage: 500, unit: 'kΩ', rows: [{ combination: 'L1-E', value: 999 }] });
  const condBad = await A2.req('POST', `/api/assets/${pc1.id}/measurements`, { test_type: 'insulation', measured_at: '2026-11-02T12:00', test_voltage: 1000, unit: 'MΩ', rows: [{ combination: 'L1-E', value: 999 }] });
  // 기준 변경 후 과거 판정 불변
  const crit = (await A2.req('GET', `/api/sites/${site}/criteria`)).data.find(x => x.test_type === 'insulation' && x.active);
  const pastFail = after.find(m => m.value === 0.45);
  await A2.req('PUT', `/api/criteria/${crit.id}`, { value: 0.1, basis_doc: '검증용 변경', effective_date: '2026-01-01' });
  const pastAfter = (await A2.req('GET', `/api/assets/${pc1.id}`)).data.measurements.find(m => m.id === pastFail.id);
  ok(7, '시험기준이 없거나 맞지 않으면 합격 처리 안 함', lanM.data.results[0].auto_result === '판정기준 미설정' && unitBad.data.results[0].auto_result === '판정 불가' && condBad.data.results[0].auto_result === '판정 불가' && pastAfter.auto_result === '부적합' && pastAfter.criteria_snapshot.value === 1,
    `LAN(기준 없음) ${lanM.data.results[0].auto_result}, 단위 불일치 ${unitBad.data.results[0].auto_result}, 시험전압 불일치 ${condBad.data.results[0].auto_result}, 기준 변경 후 과거 판정 ${pastAfter.auto_result}(기준 v${pastAfter.criteria_snapshot.version} 유지)`);

  // ---- 8. 도면 개정 후 이전 도면·이력 조회 ----
  const ra = (await A2.req('GET', `/api/revisions/${revA.id}`)).data;
  const rb = (await A2.req('GET', `/api/revisions/${revB.id}`)).data;
  const fileA = await A2.req('GET', `/api/files/${ra.display_file_id}`, undefined, true);
  const pc1Marks = (await A2.req('GET', `/api/assets/${pc1.id}`)).data.marks;
  ok(8, '도면 개정 후 이전 도면과 이력 조회', ra.marks.length === 12 && rb.marks.filter(m => m.needs_recheck).length >= 12 && fileA.status === 200 && pc1Marks.some(m => m.rev_no === 'A') && pc1Marks.some(m => m.rev_no === 'B'),
    `Rev.A 표시 ${ra.marks.length}개 보존, Rev.B 재확인 필요 ${rb.marks.filter(m => m.needs_recheck).length}개, Rev.A 파일 ${fileA.status}`);

  // ---- 9. 권한 없는 현장 접근 차단 ----
  const O = await new Client().login('demo_other', 'verify-demo-1');
  const r1 = await O.req('GET', `/api/assets/${pc1.id}`);
  const r2 = await O.req('GET', `/api/files/${up.data.ids[0]}`);
  const r3 = await O.req('GET', `/api/sites/${site}/assets`);
  const r4 = await O.req('GET', `/api/pdf/card/${pc1.id}`);
  const r5 = await O.req('GET', `/api/revisions/${revA.id}`);
  const tok = (await A2.req('GET', `/api/assets/${pc1.id}`)).data.asset.qr_token;
  const r6 = await O.req('GET', `/q/${tok}`);
  const V = await new Client().login('demo_viewer', 'verify-demo-1');
  const r7 = await V.req('POST', `/api/sites/${site}/assets`, { category: 'load', mgmt_no: 'X-1' });
  const anon = await new Client().req('GET', `/api/files/${up.data.ids[0]}`);
  ok(9, '권한 없는 현장의 API·첨부파일 접근 차단', [r1, r2, r3, r4, r5, r6].every(r => r.status === 403) && r7.status === 403 && anon.status === 401,
    `설비 ${r1.status}, 첨부 ${r2.status}, 목록 ${r3.status}, PDF ${r4.status}, 도면 ${r5.status}, QR ${r6.status}, 조회자 등록 ${r7.status}, 비로그인 첨부 ${anon.status}`);

  // ---- 10. QR 조회 (API 부분) ----
  const W = await new Client().login('demo_worker', 'verify-demo-1');
  const q1 = await W.req('GET', `/q/${tok}`);
  const qAnon = await new Client().req('GET', `/q/${tok}`);
  const qBad = await W.req('GET', `/q/nonexistent-token`);
  const fd2 = new FormData(); fd2.append('owner_type', 'asset'); fd2.append('owner_id', pc1.id); fd2.append('category', 'photo');
  fd2.append('files', new Blob([fs.readFileSync(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'package.json'))]), 'fake.jpg');
  const fake = await W.req('POST', '/api/files', fd2);
  ok(10, 'QR 조회 흐름 (로그인→권한 확인→카드) 및 사진 검증', q1.status === 302 && String(q1.data).length >= 0 && qAnon.status === 302 && qBad.status === 404 && fake.status === 400,
    `작업자 QR → 302 카드 이동, 비로그인 → 302 로그인, 없는 QR → ${qBad.status}, 확장자 위장 사진 → ${fake.status}`);

  // ---- 11. 엑셀 오류 행 식별 및 의도한 방식 저장 ----
  const tpl = await A2.req('GET', `/api/sites/${site}/excel/template/power_cable`, undefined, true);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await tpl.arrayBuffer()));
  const ws = wb.getWorksheet('등록양식');
  const hdr = ws.getRow(1).values; const col = l => hdr.indexOf(l);
  const addRow = (o) => { const r = []; for (const [k, v] of Object.entries(o)) r[col(k)] = v; ws.addRow(r); };
  const lpFree = lpCard.ports.filter(p => !p.peer && p.id !== freeCircuit.id)[0];
  addRow({ '관리번호*': 'XL-001', '명칭': '정상 행', '분전반·배전반': 'LP-1', '연결 분전반 관리번호': 'LP-1', '연결 회로명': lpFree.name, '설계길이(m)': 12 });
  addRow({ '명칭': '관리번호 누락' });
  addRow({ '관리번호*': 'XL-001', '명칭': '파일 내 중복' });
  addRow({ '관리번호*': 'XL-003', '연결 분전반 관리번호': 'LP-999' });
  addRow({ '관리번호*': 'XL-004', '설계길이(m)': '열두' });
  addRow({ '관리번호*': 'XL-005', '상태': '완료됨' });
  addRow({ '관리번호*': 'XL-006', '연결 분전반 관리번호': 'LP-1', '연결 회로명': 'L-1' });
  addRow({ '관리번호*': 'XL-007', '명칭': '정상 행 2' });
  const xbuf = await wb.xlsx.writeBuffer();
  const pv = async () => { const f = new FormData(); f.append('category', 'power_cable'); f.append('file', new Blob([xbuf]), 'test.xlsx'); return (await A2.req('POST', `/api/sites/${site}/excel/preview`, f)).data; };
  const p1v = await pv();
  const aon = await A2.req('POST', `/api/import/${p1v.job_id}/commit`, { mode: 'all_or_nothing', dup: 'skip' });
  const afterAon = await find('XL-001');
  const p2v = await pv();
  const vo = await A2.req('POST', `/api/import/${p2v.job_id}/commit`, { mode: 'valid_only', dup: 'skip' });
  const x1 = await find('XL-001'), x7 = await find('XL-007'), x3 = await find('XL-003');
  const x1Card = x1 ? (await A2.req('GET', `/api/assets/${x1.id}`)).data : null;
  ok(11, '엑셀 오류 행 식별, 정상 데이터만 의도대로 저장', p1v.error_count === 6 && aon.data.saved === 0 && !afterAon && vo.data.created === 2 && !!x1 && !!x7 && !x3 && x1Card.ends.A?.text?.includes(lpFree.name),
    `오류 ${p1v.error_count}행 식별 (${p1v.rows.filter(r => r.errors.length).map(r => `${r.row}행:${r.errors[0]}`).join('; ')}), 전체취소 모드 저장 ${aon.data.saved}건, 정상만 저장 모드 신규 ${vo.data.created}건, XL-001 회로 연결 ${x1Card?.ends.A?.text}`);

  // ---- 기타: 동시 수정 충돌 · 감사 로그 보호 · 연결 설비 삭제 제한 ----
  const cur = (await A2.req('GET', `/api/assets/${pcId}`)).data.asset;
  const u1 = await A2.req('PUT', `/api/assets/${pcId}`, { notes: '첫 번째 수정', version: cur.version });
  const u2 = await A2.req('PUT', `/api/assets/${pcId}`, { notes: '오래된 화면에서 수정', version: cur.version });
  const del = await A2.req('DELETE', `/api/assets/${pc1.id}`);
  const Database = require('better-sqlite3');
  const raw = new Database(path.join(DATA, 'app.db'));
  let auditBlocked = false; try { raw.prepare('UPDATE audit_logs SET action=? WHERE id=1').run('x'); } catch { auditBlocked = true; }
  let auditDelBlocked = false; try { raw.prepare('DELETE FROM audit_logs').run(); } catch { auditDelBlocked = true; }
  ok('추가', '동시 수정 충돌 감지·연결 설비 삭제 제한·감사 로그 보호', u1.status === 200 && u2.status === 409 && del.status === 409 && auditBlocked && auditDelBlocked,
    `두 번째 수정 ${u2.status}, 연결된 설비 삭제 ${del.status}, 감사로그 수정·삭제 차단 ${auditBlocked && auditDelBlocked}`);

  // ---- 12. PDF 한글·표·사진 (텍스트 추출로 확인, 이미지 확인은 verify-ui 캡처) ----
  const many = []; for (let i = 0; i < 70; i++) many.push({ combination: `검증-${i}`, value: 100 + i });
  await A2.req('POST', `/api/assets/${pcId}/measurements`, { test_type: 'insulation', measured_at: '2026-11-02T13:00', test_voltage: 500, unit: 'MΩ', rows: many });
  const save = async (url, name) => { const r = await A2.req('GET', url, undefined, true); const f = path.join(DATA, name); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); return f; };
  const fMeas = await save(`/api/sites/${site}/pdf/measurements`, 'meas.pdf');
  const fCard = await save(`/api/pdf/card/${pc1.id}`, 'card-pc1.pdf');
  const fPhoto = await save(`/api/sites/${site}/pdf/photos`, 'photos.pdf');
  let pdfOk = false, pdfDetail = 'pdftotext 없음 (검사 생략)';
  try {
    const txt = (f, pg) => execFileSync('pdftotext', ['-layout', ...(pg ? ['-f', String(pg), '-l', String(pg)] : []), f, '-']).toString();
    const pages = f => Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f]).toString())[1]);
    const mp = pages(fMeas);
    const headerOnEvery = Array.from({ length: mp }, (_, i) => txt(fMeas, i + 1).includes('측정일시')).every(Boolean);
    const cardTxt = txt(fCard);
    const imgs = execFileSync('pdfimages', ['-list', fPhoto]).toString().split('\n').filter(l => /^\s+\d+\s+\d+\s+image/.test(l)).length;
    pdfOk = mp >= 2 && headerOnEvery && cardTxt.includes('전력케이블 이력 카드') && cardTxt.includes('급수펌프') && imgs >= 4;
    pdfDetail = `측정목록 ${mp}쪽 모든 쪽 표 머리글 반복 ${headerOnEvery}, 이력카드 한글 텍스트 추출 ${cardTxt.includes('급수펌프')}, 사진대장 이미지 ${imgs}개`;
  } catch (e) { pdfDetail = '검사 오류: ' + e.message; }
  ok(12, 'PDF 한글·표 머리글 반복·사진 포함', pdfOk, pdfDetail);

  await stop();
  fs.writeFileSync(path.join(ROOT, 'test', 'verify-result.json'), JSON.stringify({ at: new Date().toISOString(), data_dir: DATA, results }, null, 2));
  console.log(`\n${results.filter(r => r.pass).length}/${results.length} 통과 · 검증 데이터: ${DATA}`);
  process.exit(results.every(r => r.pass) ? 0 : 1);
}

main().catch(async e => { console.error(e); try { await stop(); } catch {} process.exit(1); });
