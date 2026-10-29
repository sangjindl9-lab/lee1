'use strict';
/* 예시(샘플) 데이터 — 환경변수 SEED_SAMPLE=1 일 때 서버 시작 시 한 번만 넣음.
   모든 기록에 sample:true 가 붙어 화면에 보라색 "예시"로 표시되고, [설정 → 예시 데이터 모두 삭제]로 지울 수 있음. */
const crypto = require('crypto');
const uid = p => p + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');

function build() {
  const S = { A: uid('s'), B: uid('s'), C: uid('s'), D: uid('s'), E: uid('s') };
  const L = {}; for (let i = 1; i <= 12; i++) L[i] = uid('l');
  const t = Date.now();
  const site = o => Object.assign({
    sample: true, address: '', clientContact: '', clientPerson: '', contractNo: '', prime: '', primeContact: '', primeNo: '',
    contractDate: '', startDate: '', endPlanned: '', endActual: '', manager: '', note: '',
    primeInput: { amt: null, basis: 'supply' }, subMode: 'rate', rate: null, subInput: { amt: null, basis: 'supply' },
    ourInput: { amt: null, basis: 'supply' }, confirmedSupply: null, changes: [], history: [{ at: '2026-10-29 09:00', by: '예시 데이터', text: '예시 현장 등록' }]
  }, o);

  const sites = [
    site({ id: S.A, name: '(예시) ○○시청 청사 구내통신 개선공사', address: '○○시 ○○로 100', type: 'sub', kind: '구내통신', client: '○○시청', clientContact: '정보통신과 주무관 · 031-000-0000',
      prime: '예시종합건설㈜', primeContact: '공무 과장 · 010-0000-0000', primeNo: '예시-2026-071', contractDate: '2026-07-20', startDate: '2026-08-01', endPlanned: '2026-12-20', status: '진행 중', manager: '예시 현장소장', billTo: '예시종합건설㈜',
      note: '원도급 1억 원에 하도급률 80%를 적용해 계산한 뒤 확정한 예시입니다. 1차 설계변경이 반영되어 있고, 금액 미확정 추가공사가 1건 있습니다.',
      primeInput: { amt: 100000000, basis: 'supply' }, subMode: 'rate', rate: 80, confirmedSupply: 80000000,
      changes: [
        { id: uid('c'), created: t, date: '2026-09-25', kind: '설계변경', reason: '케이블 트레이 경로 변경 및 통신 단자함 2개소 추가', status: '확정', primeAfter: 110000000, ourAfter: 87000000, estimate: null, note: '1차 변경계약' },
        { id: uid('c'), created: t + 1, date: '2026-10-20', kind: '추가공사', reason: '3층 회의실 무선AP 추가 요청 (금액 협의 중)', status: '미확정', primeAfter: null, ourAfter: null, estimate: 3000000, note: '견적 제출 완료' }] }),
    site({ id: S.B, name: '(예시) △△교육지원청 관내 학교 CCTV 설치공사', address: '△△시 일대 초·중학교 4개교', type: 'prime', kind: 'CCTV', client: '△△교육지원청', clientContact: '시설과 · 02-000-0000', clientPerson: '재무과 계약 담당', contractNo: '제2026-0915호',
      contractDate: '2026-09-28', startDate: '2026-10-05', endPlanned: '2026-11-30', status: '진행 중', manager: '예시 공무 담당', billTo: '△△교육지원청',
      note: '원도급 예시입니다. 계약금액을 부가세 포함 합계 49,500,000원으로 입력해 공급가액 45,000,000원으로 환산했습니다. 2~4차 학교는 외주를 줬습니다.',
      ourInput: { amt: 49500000, basis: 'total' }, confirmedSupply: 45000000 }),
    site({ id: S.C, name: '(예시) □□군 마을 광통신선로 이설공사', address: '□□군 □□면 일대', type: 'sub', kind: '통신선로', client: '□□군청', prime: '예시건설산업㈜', primeContact: '현장소장 · 010-0000-1111',
      startDate: '2026-11-10', endPlanned: '2027-02-26', status: '계약 전', manager: '예시 공무 담당', billTo: '예시건설산업㈜',
      note: '원도급 금액을 모르는 예시입니다. 하도급 금액만 직접 입력해 하도급률이 "계산 불가"로 표시되고, 확정 금액이 비어 있어 미확정으로 나옵니다.',
      subMode: 'direct', subInput: { amt: 30000000, basis: 'supply' } }),
    site({ id: S.D, name: '(예시) ◇◇공단 사옥 방송·음향설비 교체공사', address: '◇◇시 ◇◇대로 25', type: 'sub', kind: '방송·음향', client: '◇◇공단', prime: '예시전기㈜', primeContact: '공무 대리 · 010-0000-4444', primeNo: 'P-2026-118',
      contractDate: '2026-05-10', startDate: '2026-05-20', endPlanned: '2026-08-31', endActual: '2026-08-28', status: '정산 중', manager: '예시 현장소장', billTo: '예시전기㈜',
      note: '준공 후 정산 중인 예시입니다. 계약서 금액(직접 입력)으로 하도급률을 역산했습니다. 준공금 일부가 아직 들어오지 않았습니다.',
      primeInput: { amt: 72000000, basis: 'supply' }, subMode: 'direct', subInput: { amt: 61200000, basis: 'supply' }, confirmedSupply: 61200000 }),
    site({ id: S.E, name: '(예시) ☆☆도서관 전기·통신 보수공사', address: '☆☆시 ☆☆로 7', type: 'prime', kind: '전기', client: '☆☆시립도서관', clientPerson: '총무팀 계약 담당', contractNo: '2026-수의-033',
      contractDate: '2026-03-02', startDate: '2026-03-09', endPlanned: '2026-04-30', endActual: '2026-04-24', status: '완료', manager: '예시 현장소장', billTo: '☆☆시립도서관',
      note: '청구·수금까지 끝난 완료 현장 예시입니다.', ourInput: { amt: 18000000, basis: 'supply' }, confirmedSupply: 18000000 })
  ];

  const log = (id, siteId, date, content, workers, manDays, equipment = '', note = '', hours = '08:00~17:00') =>
    ({ id, sample: true, siteId, date, content, workers, manDays, hours, equipment, note, author: '예시 작성자', createdAt: date + ' 17:30' });
  const logs = [
    log(L[1], S.A, '2026-10-20', '1층 통신실 랙 설치 및 접지 공사', 3, 3, '', '랙 위치 감리 확인 완료'),
    log(L[2], S.A, '2026-10-22', '2층 케이블 트레이 설치 30m', 3, 3, '고소작업대 1대'),
    log(L[3], S.A, '2026-10-26', '2층 통신실 케이블 트레이 설치\nUTP Cat.6 40회선 포설', 3, 3, '고소작업대 1대', '내일 천장 점검구 개방 필요 — 원도급 공무 과장에게 전달'),
    log(L[4], S.A, '2026-10-27', '통신 단자함 2개소 설치, 회선 성단 24회선', 2, 2),
    log(L[5], S.A, '2026-10-28', '3층 배관 및 입선, 기존 케이블 철거', 4, 4, '', '철거 케이블 폐기물 반출 예정'),
    log(L[6], S.B, '2026-10-13', '1차 학교 현장 확인, 카메라 위치 협의', 2, 1, '', '학교 행정실과 설치 위치 확정', '09:00~13:00'),
    log(L[7], S.B, '2026-10-27', '1차 학교 카메라 브라켓 설치 8개소', 2, 2, '사다리차 반일', '수업 시간 중 소음 작업 금지', '09:00~18:00'),
    log(L[8], S.B, '2026-10-28', '1차 학교 카메라 8대 설치, NVR 설정', 2, 2, '', '', '09:00~18:00'),
    log(L[9], S.D, '2026-06-15', '스피커 교체 42개소, 앰프 랙 설치', 4, 4),
    log(L[10], S.D, '2026-08-27', '방송 설비 시험 운전 및 준공 검사 대응', 2, 2, '', '준공 검사 통과'),
    log(L[11], S.E, '2026-03-20', '열람실 조명 회로 정비, 콘센트 증설 12개소', 3, 3),
    log(L[12], S.E, '2026-04-22', '통신 배선 정리 및 준공 사진 촬영', 2, 1, '', '', '13:00~17:00')
  ];

  const lab = (siteId, date, worker, content, qty, unitPrice, payDue, paid, logId) =>
    ({ id: uid('w'), sample: true, siteId, date, worker, content, qty, unit: '공수', unitPrice, amount: Math.round(qty * unitPrice), payDue, paidDate: paid ? payDue : '', paid, logId: logId || null });
  const labor = [
    lab(S.A, '2026-10-20', '예시 작업반 (3명)', '통신실 랙 설치·접지', 3, 230000, '2026-11-10', false, L[1]),
    lab(S.A, '2026-10-22', '예시 작업반 (3명)', '케이블 트레이 설치', 3, 230000, '2026-11-10', false, L[2]),
    lab(S.A, '2026-10-26', '예시 작업반 (3명)', '트레이 설치·UTP 포설', 3, 230000, '2026-11-10', false, L[3]),
    lab(S.B, '2026-10-27', '예시전설 (협력업체)', '카메라 브라켓 설치', 2, 250000, '2026-10-28', true, L[7]),
    lab(S.D, '2026-06-15', '예시 작업반 (4명)', '스피커 교체·앰프 랙', 4, 220000, '2026-07-10', true, L[9]),
    lab(S.D, '2026-08-27', '예시 작업반 (2명)', '시험 운전', 2, 220000, '2026-09-10', true, L[10]),
    lab(S.E, '2026-03-20', '예시 작업반 (3명)', '조명 회로·콘센트', 3, 210000, '2026-04-10', true, L[11]),
    lab(S.E, '2026-04-22', '예시 작업반 (2명)', '통신 배선 정리', 1, 210000, '2026-05-10', true, L[12])
  ];
  // 일부 공수가 아직 인건비에 안 잡힌 상태(L4, L5, L6, L8)를 남겨 "작업일지에서 불러오기"를 연습할 수 있게 함

  const cost = (siteId, cat, name, spec, qty, unitPrice, vendor, date) =>
    ({ id: uid('m'), sample: true, siteId, cat, name, spec, qty, unitPrice, supply: Math.round(qty * unitPrice), vat: Math.floor(Math.round(qty * unitPrice) / 10), taxed: true, vendor, date, note: '' });
  const costs = [
    cost(S.A, '자재', 'UTP Cat.6 케이블', '305m/BOX', 6, 145000, '예시전선상사', '2026-10-20'),
    cost(S.A, '자재', '케이블 트레이', '300×100', 40, 38000, '예시전선상사', '2026-10-21'),
    cost(S.A, '자재', '19인치 통신 랙', '42U', 2, 620000, '예시통신자재', '2026-10-18'),
    cost(S.A, '장비 임대료', '고소작업대', '1일', 2, 180000, '예시중기', '2026-10-26'),
    cost(S.B, '자재', 'IP 카메라', '4MP 돔형', 24, 210000, '예시보안유통', '2026-10-15'),
    cost(S.B, '자재', 'NVR', '16채널', 4, 480000, '예시보안유통', '2026-10-15'),
    cost(S.B, '운반비', '자재 운반', '1톤', 1, 120000, '예시용달', '2026-10-16'),
    cost(S.D, '자재', '천장형 스피커', '5W', 42, 68000, '예시음향', '2026-06-10'),
    cost(S.D, '자재', '파워앰프', '480W', 2, 1450000, '예시음향', '2026-06-10'),
    cost(S.E, '자재', 'LED 등기구', '50W 평판', 36, 42000, '예시전기자재', '2026-03-15'),
    cost(S.E, '기타', '폐기물 처리', '혼합', 1, 250000, '예시환경', '2026-04-23')
  ];

  const subs = [
    { id: uid('o'), sample: true, siteId: S.B, partner: '예시통신㈜', scope: '2~4차 학교 배관·배선', contractDate: '2026-10-10', supply: 8000000, vat: 800000, note: '외주 계약 예시',
      payments: [{ id: uid('p'), date: '2026-10-25', amount: 4400000, note: '선급 50%' }] }
  ];

  const bill = (siteId, seq, kind, date, supply, billTo, dueDate, receipts, note) =>
    ({ id: uid('b'), sample: true, siteId, seq, kind, date, supply, vat: Math.floor(supply / 10), billTo, dueDate, note: note || '', receipts: receipts.map(r => ({ id: uid('r'), date: r[0], amount: r[1], note: r[2] || '' })) });
  const bills = [
    bill(S.A, 1, '기성', '2026-09-30', 20000000, '예시종합건설㈜', '2026-10-31', [['2026-10-15', 15000000, '일부 입금']], '1회 기성'),
    bill(S.A, 2, '기성', '2026-10-25', 15000000, '예시종합건설㈜', '2026-11-25', [], '2회 기성'),
    bill(S.B, 1, '기성', '2026-10-20', 9000000, '△△교육지원청', '2026-11-05', [['2026-10-27', 9900000]], '1회 기성'),
    bill(S.D, 1, '기성', '2026-07-05', 30000000, '예시전기㈜', '2026-07-31', [['2026-07-30', 33000000]]),
    bill(S.D, 2, '준공', '2026-09-05', 31200000, '예시전기㈜', '2026-10-10', [['2026-10-02', 20000000, '일부 입금']], '준공금 — 잔액 미수'),
    bill(S.E, 1, '준공', '2026-04-28', 18000000, '☆☆시립도서관', '2026-05-20', [['2026-05-15', 19800000]])
  ];

  const docs = [
    { cat: '계약서·변경계약서', name: '하도급계약서_○○시청.pdf', desc: '최초 하도급 계약서 (예시 — 파일 없음)', siteId: S.A },
    { cat: '도면·시방서', name: '구내통신_평면도.pdf', desc: '설계 도면 (예시 — 파일 없음)', siteId: S.A },
    { cat: '착공 서류', name: '착공계_제출본.hwp', desc: '예시 항목 — 실제 회사 양식을 올려 쓰세요', siteId: S.B },
    { cat: '준공 서류', name: '준공계_◇◇공단.hwp', desc: '예시 항목 — 파일 없음', siteId: S.D }
  ].map(d => Object.assign({ id: uid('d'), sample: true, size: 0, type: '', author: '예시 데이터', date: '2026-10-29', created: t, file: null, phase: '' }, d));

  const partners = [
    ['○○시청', '발주기관', '정보통신과', '031-000-0000'], ['△△교육지원청', '발주기관', '시설과', '02-000-0000'],
    ['예시종합건설㈜', '원도급업체', '공무 과장', '010-0000-0000'], ['예시전기㈜', '원도급업체', '공무 대리', '010-0000-4444'],
    ['예시전선상사', '자재 구매처', '영업 담당', '010-0000-2222'], ['예시보안유통', '자재 구매처', '영업 담당', '010-0000-5555'],
    ['예시통신㈜', '협력업체', '대표', '010-0000-3333'], ['예시중기', '장비업체', '배차 담당', '010-0000-6666']
  ].map(p => ({ id: uid('t'), sample: true, name: p[0], type: p[1], person: p[2], phone: p[3], bizNo: '', note: '예시' }));

  return { sites, logs, labor, costs, subs, bills, docs, partners };
}

module.exports = function seed(db, nowStr) {
  if (process.env.SEED_SAMPLE !== '1') return;
  const done = db.prepare("SELECT 1 FROM records WHERE col='meta' AND id='sample-seeded'").get();
  if (done) return;
  const d = build();
  const ins = db.prepare('INSERT INTO records(col,id,site_id,data,rev,updated_at,updated_by) VALUES(?,?,?,?,1,?,?)');
  const at = nowStr();
  db.transaction(() => {
    for (const [col, list] of Object.entries(d))
      for (const r of list) ins.run(col, r.id, col === 'sites' ? r.id : (r.siteId || null), JSON.stringify(r), at, '예시 데이터');
    ins.run('meta', 'sample-seeded', null, JSON.stringify({ at }), at, 'system');
    db.prepare('INSERT INTO audit(at,user_id,user_name,action,col,rec_id,site_id,summary) VALUES(?,?,?,?,?,?,?,?)').run(at, 'system', '시스템', '등록', 'sites', null, null, `예시 데이터 등록 (현장 ${d.sites.length}곳)`);
  })();
  console.log(`[예시 데이터] 현장 ${d.sites.length}곳과 관련 기록을 넣었습니다.`);
};
module.exports.build = build;
