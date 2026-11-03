'use strict';
/* 공용 기본 품목. 제품별 성능(임피던스·외경·감쇠·권장거리 등)은 제조사 사양서로 입력해야 하므로
 * 규격명에서 확정되는 값(심선 수, 단면적, 코어 수)만 채우고 나머지는 비워 둡니다. */
const crypto = require('crypto');
const P = (category, kind, name, spec, unit, props) => ({ category, kind, name, spec, unit, props: props || {} });
const LIST = [
  P('cable', 'utp', 'UTP 케이블', 'CAT.5e 4P', 'm', { category: 'CAT.5e', pairs: 4, max_length_m: 100, max_length_basis: '채널 100m 일반 기준 – 제품·장비 사양 확인' }),
  P('cable', 'utp', 'UTP 케이블', 'CAT.6 4P', 'm', { category: 'CAT.6', pairs: 4, max_length_m: 100, max_length_basis: '채널 100m 일반 기준 – 제품·장비 사양 확인' }),
  P('cable', 'stp', 'F/UTP 케이블', 'CAT.6 4P', 'm', { category: 'CAT.6', pairs: 4, shield: 'F/UTP', max_length_m: 100, max_length_basis: '채널 100m 일반 기준 – 제품·장비 사양 확인' }),
  P('cable', 'fiber', '광케이블 SM', '4C', 'm', { mode: 'SM', cores: 4 }),
  P('cable', 'fiber', '광케이블 SM', '8C', 'm', { mode: 'SM', cores: 8 }),
  P('cable', 'fiber', '광케이블 SM', '12C', 'm', { mode: 'SM', cores: 12 }),
  P('cable', 'fiber', '광케이블 MM', '4C', 'm', { mode: 'MM', cores: 4 }),
  P('cable', 'coax', '동축케이블', '3C-2V', 'm', {}),
  P('cable', 'coax', '동축케이블', '5C-2V', 'm', {}),
  P('cable', 'coax', '동축케이블', '5C-FB', 'm', {}),
  P('cable', 'coax', '동축케이블', 'RG-59', 'm', {}),
  P('cable', 'coax', '동축케이블', 'RG-6', 'm', {}),
  P('cable', 'composite', '영상·전원 복합케이블', '5C-FB + 2C 0.75㎟', 'm', { video_spec: '5C-FB', power_cores: 2, power_mm2: 0.75 }),
  P('cable', 'power', '전원케이블', 'VCTF 2C 0.75㎟', 'm', { cores: 2, conductor_mm2: 0.75, current: 'AC/DC' }),
  P('cable', 'power', '전원케이블', 'VCTF 2C 1.5㎟', 'm', { cores: 2, conductor_mm2: 1.5 }),
  P('cable', 'power', '전원케이블', 'F-CV 2C 2.5㎟', 'm', { cores: 2, conductor_mm2: 2.5 }),
  P('cable', 'ground', '접지선', 'F-GV 4㎟', 'm', { conductor_mm2: 4 }),
  P('conduit', 'pipe', '합성수지 전선관(HI-PVC)', '16mm', 'm', {}),
  P('conduit', 'pipe', '합성수지 전선관(HI-PVC)', '22mm', 'm', {}),
  P('conduit', 'pipe', '합성수지 전선관(HI-PVC)', '28mm', 'm', {}),
  P('conduit', 'pipe', '파상형 경질 폴리에틸렌관(ELP)', '30mm', 'm', {}),
  P('conduit', 'pipe', '파상형 경질 폴리에틸렌관(ELP)', '50mm', 'm', {}),
  P('conduit', 'pipe', '합성수지제 가요관(CD관)', '22mm', 'm', {}),
  P('conduit', 'pipe', '강제 전선관(후강)', '28mm', 'm', {}),
  P('conduit', 'tray', '케이블트레이', '300×100', 'm', {}),
  P('accessory', 'connector', 'BNC 커넥터', '압착형', 'EA', { role: 'bnc' }),
  P('accessory', 'connector', '동축 중간 연결기', 'BNC I형', 'EA', { role: 'bnc_joint' }),
  P('accessory', 'connector', '영상 변환 어댑터', 'BNC-RCA', 'EA', { role: 'video_adapter' }),
  P('accessory', 'connector', 'DC 전원 커넥터', '5.5×2.1', 'EA', { role: 'dc_plug' }),
  P('accessory', 'connector', '전원 단자', '압착단자', 'EA', { role: 'terminal' }),
  P('accessory', 'connector', 'RJ45 플러그', 'CAT.6', 'EA', { role: 'rj45_plug' }),
  P('accessory', 'connector', 'RJ45 차폐 플러그', 'CAT.6 STP', 'EA', { role: 'rj45_plug_stp' }),
  P('accessory', 'connector', 'RJ45 잭(키스톤)', 'CAT.6', 'EA', { role: 'rj45_jack' }),
  P('accessory', 'fiber', '광 피그테일', 'SM SC/APC', 'EA', { role: 'pigtail' }),
  P('accessory', 'fiber', '광커넥터', 'SM SC', 'EA', { role: 'fiber_conn' }),
  P('accessory', 'fiber', '광 패치코드', 'SM SC-LC 3m', 'EA', { role: 'patch_cord' }),
  P('accessory', 'ground', '접지 압착단자', '4㎟', 'EA', { role: 'lug' }),
  P('accessory', 'misc', '방수 처리 자재', '자기융착테이프·방수캡', '개소', { role: 'waterproof' }),
  P('accessory', 'misc', '케이블 식별표시', '표찰', 'EA', { role: 'label' })
];
function seed(db) {
  const ins = db.prepare('INSERT INTO products(id,company_id,category,kind,name,spec,unit,data) VALUES(?,?,?,?,?,?,?,?)');
  db.transaction(() => LIST.forEach(p => ins.run(crypto.randomUUID(), null, p.category, p.kind, p.name, p.spec, p.unit, JSON.stringify(p.props))))();
}
module.exports = { seed, LIST };
