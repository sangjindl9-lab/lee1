#!/usr/bin/env node
/**
 * 시연용 발주 데이터 만들기 — 실제 API 를 거쳐 만든다 (결재·검수 규칙 그대로 적용)
 *   SEED_DEMO=true npm run db:seed 뒤에 실행:  node scripts/demo-purchase.mjs [http://localhost:4000]
 */
const BASE = (process.argv[2] ?? 'http://localhost:4000') + '/api/v1';
const PW = process.env.DEMO_PASSWORD ?? 'Demo!2026erp';

async function session(loginId) {
  let cookies = {};
  const call = async (method, path, body) => {
    const headers = { 'content-type': 'application/json', cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (method !== 'GET') headers['x-csrf-token'] = decodeURIComponent(cookies.erp_csrf ?? '');
    if (call.companyId) headers['x-company-id'] = call.companyId;
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      cookies[k] = v;
    }
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  await call('POST', '/auth/login', { loginId, password: PW });
  const me = await call('GET', '/auth/me');
  call.companyId = me.companies.find((c) => c.code === 'SS').id;
  return call;
}

const buyer = await session('buyer');
const ceo = await session('ceo');
const site = await session('site1');

const projects = (await buyer('GET', '/projects?size=50')).rows;
const P = (name) => projects.find((p) => p.name.includes(name)).id;
const vendors = (await buyer('GET', '/vendors?size=50')).rows;
const V = (name) => vendors.find((v) => v.name.includes(name)).id;
const mats = (await buyer('GET', '/materials?size=100')).rows;
const M = (name, spec) => {
  const m = mats.find((x) => x.name === name && (!spec || x.spec === spec));
  return { materialId: m.id, name: m.name, spec: m.spec, unit: m.unit, unitPrice: m.defaultPrice.split('.')[0] };
};
const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const addDays = (n) => new Date(Date.now() + 9 * 3600000 + n * 86400000).toISOString().slice(0, 10);

async function makePo(body, flow) {
  const po = await buyer('POST', '/purchase-orders', { orderDate: today, ourContact: '최구매', ourPhone: '010-2345-6789', ...body });
  if (flow === 'draft') return po;
  const s = await buyer('POST', `/purchase-orders/${po.id}/submit`, { version: po.version });
  if (flow === 'pending') return po;
  const a = await ceo('GET', `/approvals/${s.approvalId}`);
  if (flow === 'reject') {
    await ceo('POST', `/approvals/${a.id}/act`, { action: 'reject', comment: '조명기구 단가가 지난 발주보다 높습니다. 재견적 받아 주세요.', version: a.version });
    return po;
  }
  await ceo('POST', `/approvals/${a.id}/act`, { action: 'approve', comment: flow === 'full' ? '긴급 건, 바로 진행' : null, version: a.version });
  return buyer('GET', `/purchase-orders/${po.id}`);
}

// 1) 강서초 — 승인, 일부 입고
const p1 = await makePo({
  projectId: P('강서초'), vendorId: V('LS전선'), title: '강서초 1차 간선 케이블', deliveryDate: addDays(5), deliveryPlace: '강서초등학교 본관 지하 전기실', paymentTerms: '외상 30일', vendorContact: '김전선',
  lines: [
    { ...M('F-CV 케이블', '16sq 4C'), qty: '420' },
    { ...M('F-CV 케이블', '6sq 2C'), qty: '1200' },
    { ...M('TFR-CV 케이블', '35sq 1C'), qty: '180' },
    { ...M('전선관(HI-PVC)', '28C'), qty: '260' },
    { ...M('풀박스'), qty: '24' },
    { ...M('케이블타이'), qty: '20' },
  ],
}, 'approve');
await buyer('POST', `/purchase-orders/${p1.id}/sent`, { version: p1.version });
await site('POST', `/purchase-orders/${p1.id}/receipts`, {
  receiptDate: today, inspectorName: '박소장', memo: '거래명세표 No.2610-114',
  lines: [{ poLineId: p1.lines[0].id, qty: '200' }, { poLineId: p1.lines[1].id, qty: '1200' }, { poLineId: p1.lines[3].id, qty: '260' }],
});

// 2) 마곡 통신 — 대표이사 결재 대기
await makePo({
  projectId: P('마곡'), vendorId: V('대한전기자재'), title: '마곡 R&D센터 통신 랙·UTP', deliveryDate: addDays(7), paymentTerms: '월말 마감 익월 15일',
  lines: [{ ...M('UTP 케이블'), qty: '38' }, { ...M('19인치 랙'), qty: '4' }, { ...M('RJ45 모듈러잭'), qty: '600' }, { ...M('광케이블'), qty: '850' }],
}, 'pending');

// 3) 김포 물류 — 반려
await makePo({
  projectId: P('김포'), vendorId: V('대한전기자재'), title: '김포 물류창고 조명기구',
  lines: [{ ...M('LED 평판등'), qty: '320', unitPrice: '46000' }, { ...M('LED 다운라이트'), qty: '140' }],
}, 'reject');

// 4) 마곡 — 승인, 입고 완료
const p4 = await makePo({
  projectId: P('마곡'), vendorId: V('LS전선'), title: '마곡 분전반·차단기', orderDate: addDays(-9), deliveryDate: addDays(-2), paymentTerms: '외상 30일',
  lines: [{ ...M('분전반'), qty: '6' }, { ...M('차단기(MCCB)'), qty: '6' }, { ...M('누전차단기(ELB)'), qty: '72' }],
}, 'full');
await site('POST', `/purchase-orders/${p4.id}/receipts`, { receiptDate: today, inspectorName: '박소장', lines: p4.lines.map((l) => ({ poLineId: l.id, qty: l.qty })) });

// 5) 강서초 — 작성중 (임시저장)
await makePo({
  projectId: P('강서초'), vendorId: V('대한전기자재'), title: '강서초 교실 배선기구',
  lines: [{ ...M('콘센트'), qty: '180' }, { ...M('HFIX 전선', '2.5sq'), qty: '3000' }, { ...M('절연테이프'), qty: '60' }],
}, 'draft');

console.log('시연용 발주서 5건 생성: 일부입고·결재대기·반려·입고완료·작성중');
