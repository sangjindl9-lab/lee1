/**
 * 시연용 3단계 데이터 — 홈택스 엑셀로 받은 매입 세금계산서, 검수 대사(일치·차이), 경비 계산서, 매출 계산서(가상 발행·작성중), 문서 스캔 1건
 * demo-purchase.mjs 다음에 실행한다.
 */
import ExcelJS from 'exceljs';

const BASE = (process.argv[2] ?? 'http://localhost:4000') + '/api/v1';
const PW = process.env.DEMO_PASSWORD ?? 'Demo!2026erp';

async function session(loginId) {
  const cookies = {};
  const call = async (method, path, body, raw) => {
    const headers = { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (!(body instanceof FormData) && body) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = decodeURIComponent(cookies.erp_csrf ?? '');
    if (call.companyId) headers['x-company-id'] = call.companyId;
    const res = await fetch(BASE + path, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      cookies[k] = v;
    }
    if (raw) return Buffer.from(await res.arrayBuffer());
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  await call('POST', '/auth/login', { loginId, password: PW });
  const me = await call('GET', '/auth/me');
  call.companyId = me.companies.find((c) => c.code === 'SS').id;
  return call;
}

const acct = await session('acct');
const buyer = await session('buyer');
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const ymd = today.replace(/-/g, '');
const OUR = '1018117536';
const vendors = (await acct('GET', '/vendors?size=50')).rows;
const V = (name) => vendors.find((v) => v.name.includes(name));
const projects = (await acct('GET', '/projects?size=50')).rows;
const P = (name) => projects.find((p) => p.name.includes(name))?.id;

// 검수 내역 — LS전선 발주별 합계
const receipts = (await acct('GET', '/purchase-orders/receipts?size=200')).rows.filter((r) => (r.status ?? r.r?.status) === 'CONFIRMED');
const byPo = new Map();
for (const r of receipts) {
  const poId = r.poId ?? r.r?.poId;
  const cur = byPo.get(poId) ?? { poId, vendorName: r.vendorName, title: r.poTitle, supply: 0, ids: [] };
  cur.supply += Number(r.supplyAmount ?? r.r?.supplyAmount);
  cur.ids.push(r.id ?? r.r?.id);
  byPo.set(poId, cur);
}
const lsPos = [...byPo.values()].filter((p) => p.vendorName?.includes('LS전선'));

// 1) 홈택스 매입 목록 엑셀
const ls = V('LS전선'), dh = V('대한전기자재');
const rows = [];
let seq = 1;
const add = (sup, supName, supply, item) => rows.push({ approvalNo: `${ymd}-41000011-${String(seq++).padStart(8, '0')}`, sup, supName, supply, vat: Math.floor(supply / 10), item });
if (lsPos[0]) add(ls.bizRegNo, ls.name, lsPos[0].supply, lsPos[0].title);
if (lsPos[1]) add(ls.bizRegNo, ls.name, lsPos[1].supply + 150000, `${lsPos[1].title} (운반비 포함)`);
add(dh.bizRegNo, dh.name, 640000, '안전모·안전조끼');
add('2208162517', '㈜현장식당 강서점', 820000, '10월 현장 식대');
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('매입');
ws.addRow(['전자세금계산서 목록 (매입)']);
ws.addRow([]);
ws.addRow(['작성일자', '승인번호', '발급일자', '전송일자', '공급자사업자등록번호', '종사업장번호', '상호', '대표자명', '주소', '공급받는자사업자등록번호', '종사업장번호', '상호', '대표자명', '주소', '합계금액', '공급가액', '세액', '전자세금계산서분류', '전자세금계산서종류', '발급유형', '비고', '영수/청구 구분', '공급자 이메일', '공급받는자 이메일1', '공급받는자 이메일2', '품목일자', '품목명', '품목규격', '품목수량', '품목단가', '품목공급가액', '품목세액', '품목비고']);
const dash = (b) => b.replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3');
for (const r of rows) ws.addRow([today, r.approvalNo, today, today, dash(r.sup), '', r.supName, '대표', '서울', dash(OUR), '', '㈜에스에스전력', '이상진', '서울특별시 강서구', r.supply + r.vat, r.supply, r.vat, '세금계산서', '일반', '전자발급', '', '청구', '', '', '', today, r.item, '', '1', r.supply, r.supply, r.vat, '']);
const fd = new FormData();
fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), '홈택스_매입.xlsx');
const imp = await acct('POST', '/tax-invoices/import?direction=PURCHASE&dryRun=false', fd);

// 2) 대사·처리
const list = (await acct('GET', '/tax-invoices?direction=PURCHASE&status=COLLECTED&size=50')).rows;
const find = (no) => list.find((x) => x.approvalNo === no);
if (lsPos[0]) {
  const t = find(rows[0].approvalNo);
  const m = await acct('POST', `/tax-invoices/${t.id}/match`, { version: t.version, links: lsPos[0].ids.map((receiptId) => ({ receiptId })) });
  await acct('POST', `/tax-invoices/${t.id}/post`, { version: m.version });
}
if (lsPos[1]) {
  const t = find(rows[1].approvalNo);
  await acct('POST', `/tax-invoices/${t.id}/match`, { version: t.version, links: lsPos[1].ids.map((receiptId) => ({ receiptId })) }); // 차이 15만원 — 처리 대기
}
const accs = Object.fromEntries((await acct('GET', '/accounts')).map((a) => [a.code, a.id]));
const meal = find(rows[rows.length - 1].approvalNo);
const mv = await acct('POST', `/tax-invoices/${meal.id}/vendor`, { create: true });
await acct('POST', `/tax-invoices/${meal.id}/post`, { version: mv.version, accountId: accs['811'] ?? accs['812'], projectId: P('강서초') ?? null });

// 3) 매출 — 강서교육청 가상 발행, 대성건설 작성중
const edu = V('강서교육'), ds = V('대성건설');
const gs = P('강서초');
const s1 = await acct('POST', '/tax-invoices', { direction: 'SALES', writeDate: today, vendorId: edu.id, projectId: gs, lines: [{ itemDate: today, name: '강서초 전기설비 개선공사 2회 기성', supplyAmount: '86400000', vatAmount: '8640000' }] });
const sub = await acct('POST', `/tax-invoices/${s1.id}/submit`, { version: s1.version });
const ap = await acct('GET', `/approvals/${sub.approvalId}`);
await acct('POST', `/approvals/${ap.id}/act`, { action: 'approve', version: ap.version });
const s1d = await acct('GET', `/tax-invoices/${s1.id}`);
await acct('POST', `/tax-invoices/${s1.id}/issue`, { version: s1d.version });
await acct('POST', '/tax-invoices', { direction: 'SALES', writeDate: today, vendorId: ds.id, projectId: P('마곡') ?? null, lines: [{ itemDate: today, name: '마곡 오피스 전기공사 선급금', supplyAmount: '30000000', vatAmount: '3000000' }] });

// 4) 문서 스캔 — 결재된 발주서 PDF를 '받은 발주서'처럼 올려 인식
const pos = (await buyer('GET', '/purchase-orders?size=50')).rows.filter((p) => ['APPROVED', 'SENT', 'PARTIAL', 'RECEIVED'].includes(p.status));
if (pos[0]) {
  const pdf = await buyer('GET', `/purchase-orders/${pos[0].id}/pdf`, null, true);
  const f2 = new FormData();
  f2.append('docType', 'STATEMENT');
  f2.append('file', new Blob([pdf], { type: 'application/pdf' }), '거래명세표_스캔.pdf');
  await buyer('POST', '/documents', f2).catch((e) => console.log('스캔 시연 건너뜀:', e.message));
}
console.log(`시연용 세금계산서: 매입 ${imp.inserted}건 (대사·처리 포함), 매출 2건, 문서 스캔 1건`);
