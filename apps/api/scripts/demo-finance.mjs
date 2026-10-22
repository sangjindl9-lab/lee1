/**
 * 시연용 5단계 데이터 — 국민 운영계좌 거래내역(CSV) 업로드 → 이미 기록된 지급·수금은 자동 대사,
 * 수수료 1건 전표 처리, 나머지(결재된 지급결의와 같은 출금, 이자, 미확인 입금)는 화면에서 처리하도록 남김.
 * 나라장터 연동은 '샘플 계약(테스트 전용)'으로 켜 둔다.
 */
const BASE = (process.argv[2] ?? 'http://localhost:4000') + '/api/v1';
const PW = process.env.DEMO_PASSWORD ?? 'Demo!2026erp';

async function session(loginId) {
  const cookies = {};
  const call = async (method, path, body) => {
    const headers = { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
    const form = body instanceof FormData;
    if (body && !form) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = decodeURIComponent(cookies.erp_csrf ?? '');
    if (call.companyId) headers['x-company-id'] = call.companyId;
    const res = await fetch(BASE + path, { method, headers, body: body ? (form ? body : JSON.stringify(body)) : undefined });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      cookies[k] = v;
    }
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  };
  // 앞선 시연 스크립트들이 같은 IP 로 로그인해 분당 로그인 제한에 걸릴 수 있다 → 1분 기다렸다 다시
  for (let i = 0; ; i++) {
    try {
      await call('POST', '/auth/login', { loginId, password: PW });
      break;
    } catch (e) {
      if (i >= 2 || !String(e.message).includes('429')) throw e;
      await new Promise((r) => setTimeout(r, 61_000));
    }
  }
  const me = await call('GET', '/auth/me');
  call.companyId = me.companies.find((c) => c.code === 'SS').id;
  return call;
}

const admin = await session('admin');
const acct = await session('acct');
const kst = (d = 0) => new Date(Date.now() + 9 * 3600000 + d * 86400000).toISOString().slice(0, 10);

const bank = (await acct('GET', '/bank-accounts')).find((b) => b.kind === 'BANK');
const paid = (await acct('GET', '/payment-requests?status=PAID&size=50')).rows;
const approved = (await acct('GET', '/payment-requests?status=APPROVED&size=50')).rows;
const cols = (await acct('GET', `/collections?from=${kst(-120)}&to=${kst()}`)).filter((c) => c.status === 'CONFIRMED' && c.bankAccountId === bank.id);

// 거래 목록 (날짜순) — 잔액은 기초잔액에서 누적
const tx = [];
for (const c of cols) tx.push({ date: c.collectDate, time: '10:12:05', desc: c.kind === 'ADVANCE' ? '선급금' : '기성금', who: '강서교육지원청', inn: c.amount, out: '' });
for (const p of paid) tx.push({ date: (p.paidAt ?? p.requestDate).slice(0, 10), time: '14:30:41', desc: '인터넷이체', who: p.payeeName, inn: '', out: p.totalAmount });
if (approved[0]) tx.push({ date: kst(), time: '15:02:10', desc: '인터넷이체', who: approved[0].payeeName, inn: '', out: approved[0].totalAmount });
tx.push({ date: kst(-3), time: '09:00:00', desc: '타행이체수수료', who: '', inn: '', out: '500' });
tx.push({ date: kst(-1), time: '09:00:00', desc: '타행이체수수료', who: '', inn: '', out: '500' });
tx.push({ date: kst(-2), time: '00:10:00', desc: '예금결산이자', who: '', inn: '18452', out: '' });
tx.push({ date: kst(-1), time: '11:47:30', desc: '타행입금', who: '(주)미래건설', inn: '3300000', out: '' });
tx.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
let bal = 385000000;
const n = (v) => Math.round(Number(v || 0));
const lines = ['거래일시,적요,기재내용,출금액(원),입금액(원),잔액(원),거래점'];
for (const t of tx) {
  bal += n(t.inn) - n(t.out);
  lines.push([`${t.date} ${t.time}`, t.desc, t.who, t.out ? n(t.out) : '', t.inn ? n(t.inn) : '', bal, '인터넷'].map((v) => `"${v}"`).join(','));
}
const fd = new FormData();
fd.append('file', new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }), 'kb_거래내역.csv');
const r = await acct('POST', `/bank-transactions/import?bankAccountId=${bank.id}&dryRun=false`, fd);
console.log(`통장 거래 ${r.inserted}건 등록, 자동 대사 ${r.autoMatched}건`);

// 수수료 1건은 전표로 처리 (나머지 1건은 화면에서 해 보도록 남김)
const accounts = await acct('GET', '/accounts');
const fee = accounts.find((a) => a.name.includes('지급수수료')) ?? accounts.find((a) => a.code === '831');
const open = (await acct('GET', `/bank-transactions?bankAccountId=${bank.id}&status=UNMATCHED&direction=OUT`)).rows.filter((t) => t.amount === '500.00');
if (fee && open[0]) await acct('POST', `/bank-transactions/${open[0].id}/journal`, { accountId: fee.id, memo: '타행이체수수료' });

// 나라장터 — 샘플 계약 (테스트 전용)
await admin('PUT', '/integrations/G2B', { provider: 'SAMPLE', mode: 'TEST', enabled: true, settings: {}, secrets: {} }).catch((e) => console.log('나라장터 샘플 설정 생략', e.message));
console.log('5단계 시연 데이터 완료');
