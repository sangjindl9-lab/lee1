import { WAGES_2026H2 } from './stdlib.js';

export const uid = () => Math.random().toString(36).slice(2, 10);

// 원가계산 제비율 기본값 (2026년 4대보험 요율 반영, 나머지는 발주처·공사규모 기준 확인 후 수정)
export const DEFAULT_RATES = [
  { key: 'indirectMat', label: '간접재료비', base: '직접재료비', rate: 0, on: false },
  { key: 'indirectLabor', label: '간접노무비', base: '직접노무비', rate: 10.0, on: true },
  { key: 'sanjae', label: '산재보험료', base: '노무비', rate: 3.56, on: true },
  { key: 'goyong', label: '고용보험료', base: '노무비', rate: 1.01, on: true },
  { key: 'health', label: '국민건강보험료', base: '직접노무비', rate: 3.595, on: true },
  { key: 'pension', label: '국민연금보험료', base: '직접노무비', rate: 4.75, on: true },
  { key: 'care', label: '노인장기요양보험료', base: '건강보험료', rate: 13.14, on: true },
  { key: 'retire', label: '퇴직공제부금비', base: '직접노무비', rate: 2.3, on: true },
  { key: 'safety', label: '산업안전보건관리비', base: '재료비+직접노무비', rate: 3.11, on: true },
  { key: 'env', label: '환경보전비', base: '재료비+직접노무비+기계경비', rate: 0.3, on: true },
  { key: 'etc', label: '기타경비', base: '재료비+노무비', rate: 5.0, on: true },
  { key: 'subGuar', label: '하도급대금지급보증서발급수수료', base: '재료비+직접노무비+기계경비', rate: 0.081, on: false },
  { key: 'machGuar', label: '건설기계대여대금지급보증서발급수수료', base: '기계경비', rate: 0.07, on: false },
  { key: 'gm', label: '일반관리비', base: '재료비+노무비+경비', rate: 6.0, on: true },
  { key: 'profit', label: '이윤', base: '노무비+경비+일반관리비', rate: 15.0, on: true },
  { key: 'damage', label: '공사손해보험료', base: '총원가', rate: 0, on: false },
  { key: 'vat', label: '부가가치세', base: '공급가액', rate: 10.0, on: true },
];

export function sampleProject() {
  const m = (code, name, spec, unit, p1, p2, p3) => ({ id: uid(), code, name, spec, unit, p1, p2, p3, applied: 0 });
  const mats = [
    m('M01', 'LED 평판등', '640×640 50W', 'EA', 89000, 92000, 0),
    m('M02', 'LED 매입등', '6인치 15W', 'EA', 21500, 23000, 20800),
    m('M03', '전선', 'HFIX 2.5㎟', 'm', 452, 468, 0),
    m('M04', '전선', 'HFIX 4㎟', 'm', 715, 730, 0),
    m('M05', '합성수지제 가요전선관', 'CD 16C', 'm', 330, 345, 0),
    m('M06', '아웃렛박스', '8각 54mm', 'EA', 820, 870, 0),
    m('M07', '텀블러 스위치', '1구 15A', 'EA', 3100, 3300, 0),
    m('M08', '분전반', '주4P 50A 분기 2P 12회로', '면', 680000, 0, 655000),
  ];
  const l = (name, wage) => ({ id: uid(), name, wage });
  const labors = [
    l('내선전공', 276108),
    l('저압케이블전공', 306274),
    l('보통인부', 172698),
    l('통신내선공', 286219),
  ];
  const lab = (n) => labors.find((x) => x.name === n).id;
  const unit = (code, name, spec, unitName, toolRate, items) => ({ id: uid(), code, name, spec, unit: unitName, toolRate, items: items.map((i) => ({ id: uid(), ...i })) });
  const units = [
    unit('제1호표', 'LED 평판등 설치', '640×640 50W', 'EA', 3, [
      { kind: '자재', ref: mats[0].id, qty: 1 },
      { kind: '노무', ref: lab('내선전공'), qty: 0.2 },
    ]),
    unit('제2호표', 'LED 매입등 설치', '6인치 15W', 'EA', 3, [
      { kind: '자재', ref: mats[1].id, qty: 1 },
      { kind: '노무', ref: lab('내선전공'), qty: 0.15 },
    ]),
    unit('제3호표', '전선 입선', 'HFIX 2.5㎟', 'm', 3, [
      { kind: '자재', ref: mats[2].id, qty: 1.1 },
      { kind: '노무', ref: lab('내선전공'), qty: 0.01 },
    ]),
    unit('제4호표', '합성수지제 가요전선관 배관', 'CD 16C', 'm', 3, [
      { kind: '자재', ref: mats[4].id, qty: 1.1 },
      { kind: '노무', ref: lab('내선전공'), qty: 0.044 },
    ]),
    unit('제5호표', '분전반 설치', '주4P 50A 12회로', '면', 3, [
      { kind: '자재', ref: mats[7].id, qty: 1 },
      { kind: '노무', ref: lab('내선전공'), qty: 1.2 },
      { kind: '경비', name: '운반비', spec: '', unit: '식', qty: 1, price: 30000 },
    ]),
  ];
  const it = (src, ref, qty, note = '') => ({ id: uid(), src, ref, qty, note, name: '', spec: '', unit: '', m: 0, l: 0, e: 0 });
  const sections = [
    { id: uid(), name: '1. 조명설비공사', items: [it('unit', units[0].id, 42), it('unit', units[1].id, 18), it('unit', units[2].id, 860), it('unit', units[3].id, 320), it('mat', mats[5].id, 60, '사급')] },
    { id: uid(), name: '2. 전력간선 및 분전반', items: [it('unit', units[4].id, 2), it('mat', mats[6].id, 24)] },
    { id: uid(), name: '3. 철거 및 기타', items: [{ ...it('manual', null, 1), name: '기존 조명기구 철거', spec: '형광등 2등용', unit: '식', m: 0, l: 1850000, e: 120000 }, { ...it('manual', null, 1), name: '폐기물 처리', spec: '', unit: '식', m: 0, l: 0, e: 350000 }] },
  ];
  return {
    id: uid(),
    sample: true,
    name: '○○초등학교 LED 조명 교체 전기공사',
    client: '○○교육지원청',
    location: '강원특별자치도 원주시',
    kind: '전기',
    date: new Date().toISOString().slice(0, 10),
    company: '㈜에스에스전력',
    bizNo: '220-86-60440',
    roundUnit: 1000,
    mats, labors, units, sections,
    rates: DEFAULT_RATES.map((r) => ({ ...r })),
    scrap: 0,
    contract: { mode: 'none', bidRate: 87.745, target: 0 },
    estimate: { to: '○○교육지원청 귀중', validDays: 30, rate: 100, target: 0, note: '부가가치세 포함 금액입니다.\n현장 여건에 따라 수량이 변경될 수 있습니다.', tail: 1000 },
    updated: Date.now(),
  };
}

export function blankProject() {
  const p = sampleProject();
  return {
    ...p, id: uid(), sample: false, name: '새 공사', client: '', location: '',
    mats: [], labors: WAGES_2026H2.list.map(([name, wage]) => ({ id: uid(), name, wage })), units: [],
    sections: [{ id: uid(), name: '1. 공종', items: [] }],
  };
}
