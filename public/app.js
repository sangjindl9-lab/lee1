// 이음전력 진단 — 화면 (프레임워크 없이 동작, 모바일 촬영 우선)
const $ = (s, el = document) => el.querySelector(s);
// 화면 조립 시 배열·조건부(null/false) 자식을 그대로 넘길 수 있게 함
const _rc = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...k) { return _rc.apply(this, k.flat(Infinity).filter((c) => c != null && c !== false)); };
const app = $('#app');
let ME = null; let CFG = {};

// ---------- 공통 ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body instanceof FormData) opt.body = body; else if (body) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(url, opt);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `요청 실패(${res.status})`);
  return data;
}
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms); }
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 4500); } };
function modal(...content) { $('#modalBody').replaceChildren(...content); $('#modal').hidden = false; $('#modal .sheet').scrollTop = 0; }
function closeModal() { $('#modal').hidden = true; }
$('#modal .x').onclick = closeModal; $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
const fmt = (v, u = '') => (v == null || v === '' ? '—' : (typeof v === 'number' ? v.toLocaleString('ko-KR') : v) + u);
const won = (v) => (v == null ? '—' : v.toLocaleString('ko-KR') + '원');
const STL = { ok: '여유', caution: '주의', over: '초과', hold: '보류', info: '참고' };
const badge = (st, txt) => h('span', { class: 'badge b-' + st }, txt || STL[st] || st);
const ROLE = { user: '일반 사용자', contractor: '전기공사업체', reviewer: '검토 담당자', admin: '관리자' };

// 스키마 기반 입력 폼. type: text|number|select|check|date|textarea|datetime
function form(fields, data = {}) {
  const el = h('div', { class: 'form' }); const inputs = {};
  for (const f of fields) {
    if (f.section) { el.append(h('h3', { class: 'wide' }, f.section)); continue; }
    let inp; const v = getPath(data, f.k);
    if (f.type === 'select') inp = h('select', {}, (f.opts || []).map(([val, lab]) => h('option', { value: val, selected: String(v ?? '') === String(val) }, lab)));
    else if (f.type === 'check') inp = h('input', { type: 'checkbox', checked: !!v });
    else if (f.type === 'textarea') { inp = h('textarea', { placeholder: f.ph || '' }); inp.value = v ?? ''; }
    else inp = h('input', { type: f.type === 'number' ? 'text' : f.type || 'text', inputmode: f.type === 'number' ? 'decimal' : null, value: v ?? '', placeholder: f.ph || (f.type === 'number' ? '모르면 비워두기' : '') });
    inputs[f.k] = { inp, f };
    el.append(f.type === 'check' ? h('label', { class: 'ck' + (f.wide ? ' wide' : '') }, inp, f.l) : h('label', { class: 'f' + (f.wide ? ' wide' : '') }, f.l, inp, f.hint && h('span', { class: 'hint' }, f.hint)));
  }
  el.value = () => {
    const out = {};
    for (const [k, { inp, f }] of Object.entries(inputs)) {
      let v = f.type === 'check' ? inp.checked : inp.value.trim();
      if (f.type === 'number') v = v === '' ? null : Number(v.replace(/,/g, ''));
      if (f.type === 'number' && Number.isNaN(v)) throw new Error(`${f.l}: 숫자를 입력하세요.`);
      if (f.type === 'select' && v === '') v = null;
      setPath(out, k, v);
    }
    return out;
  };
  return el;
}
function getPath(o, k) { return k.split('.').reduce((a, p) => (a == null ? a : a[p]), o); }
function setPath(o, k, v) { const ps = k.split('.'); let c = o; ps.slice(0, -1).forEach((p) => { c[p] = c[p] || {}; c = c[p]; }); c[ps.at(-1)] = v; }

// 사진 선택/촬영 → 업로드
function pickFile({ capture = true, accept = 'image/*' } = {}) {
  return new Promise((resolve) => {
    const i = h('input', { type: 'file', accept, capture: capture && accept.startsWith('image') ? 'environment' : null });
    i.onchange = () => resolve(i.files[0] || null); i.click();
  });
}
async function shrink(file) { // 휴대폰 원본 사진을 업로드 전에 줄임(EXIF 회전은 서버에서 처리)
  if (!file.type.startsWith('image/') || file.size < 2.5e6) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const s = Math.min(1, 2600 / Math.max(bmp.width, bmp.height));
    const c = h('canvas', { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}
async function uploadTo(siteId, kind, opts) {
  const file = await pickFile(opts); if (!file) return null;
  const fd = new FormData(); fd.append('kind', kind); fd.append('file', await shrink(file));
  toast('업로드 중…', 20000);
  const r = await api('POST', `/api/sites/${siteId}/files`, fd); toast('업로드 완료'); return r;
}
const img = (fid, w = 400) => `/api/files/${fid}?w=${w}`;
// 촬영 버튼 + 미리 찍어둔 사진(갤러리) 선택 버튼
function photoBtns(kind, after, { label = '촬영', cls = '', accept = 'image/*' } = {}) {
  const go = (capture) => guard(async () => { const f = await uploadTo(sid(), kind, { capture, accept }); if (f) await after(f); });
  return [h('button', { class: cls, onclick: go(true) }, '📷 ' + label),
    h('button', { class: cls, onclick: go(false) }, '🖼 ' + (accept.includes('pdf') ? '사진·PDF 선택' : '사진 선택'))];
}

// ---------- 라우팅 ----------
const routes = [];
const route = (re, fn) => routes.push([re, fn]);
async function render() {
  const hash = location.hash.slice(1) || '/';
  closeModal();
  for (const [re, fn] of routes) { const m = hash.match(re); if (m) { try { await fn(...m.slice(1)); } catch (e) { app.replaceChildren(h('div', { class: 'card' }, h('b', {}, '오류'), h('p', {}, e.message))); } window.scrollTo(0, 0); return; } }
  app.replaceChildren(h('p', {}, '없는 화면입니다.'));
}
window.addEventListener('hashchange', render);
function nav() {
  const n = $('#nav'); n.replaceChildren();
  n.append(h('a', { href: '#/quick' }, '간편 계산'));
  if (/Android/i.test(navigator.userAgent) && !/IeumJindanApp/.test(navigator.userAgent)) n.append(h('a', { href: 'https://github.com/sangjindl9-lab/lee1/releases/download/jindan-latest/ieum-jindan.apk' }, '앱 받기'));
  if (!ME) { n.append(h('a', { href: '#/login' }, '로그인')); return; }
  n.append(h('a', { href: '#/' }, '내 장소'));
  if (['contractor', 'reviewer'].includes(ME.role)) n.append(h('a', { href: '#/company' }, '업체'));
  if (ME.role === 'admin') n.append(h('a', { href: '#/admin' }, '관리자'));
  n.append(h('button', { onclick: guard(async () => { await api('POST', '/api/auth/logout'); ME = null; nav(); location.hash = '#/login'; }) }, '로그아웃'));
}

// ---------- 로그인 ----------
route(/^\/login$/, () => {
  let mode = 'login';
  const box = h('div', { class: 'card', style: 'max-width:420px;margin:30px auto' });
  const draw = () => {
    const f = form(mode === 'login' ? [{ k: 'email', l: '이메일', type: 'email', wide: 1 }, { k: 'pw', l: '비밀번호', type: 'password', wide: 1 }]
      : [{ k: 'role', l: '가입 유형', type: 'select', opts: [['user', '일반 사용자(집·가게·사무실)'], ['contractor', '전기공사업체']], wide: 1 },
        { k: 'name', l: '이름', wide: 1 }, { k: 'email', l: '이메일', type: 'email', wide: 1 }, { k: 'pw', l: '비밀번호(8자 이상)', type: 'password', wide: 1 },
        { k: 'company_name', l: '업체명(전기공사업체만)', wide: 1 }, { k: 'phone', l: '연락처', wide: 1 }]);
    box.replaceChildren(h('h1', {}, mode === 'login' ? '로그인' : '회원가입'), f,
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'pri', onclick: guard(async () => {
        await api('POST', mode === 'login' ? '/api/auth/login' : '/api/auth/register', f.value());
        await loadMe(); location.hash = '#/';
      }) }, mode === 'login' ? '로그인' : '가입하기'), h('span', { class: 'sp' }),
      h('button', { class: 'sm', onclick: () => { mode = mode === 'login' ? 'reg' : 'login'; draw(); } }, mode === 'login' ? '회원가입' : '로그인으로')),
      h('p', { class: 'hint' }, '로그인 없이 ', h('a', { href: '#/quick' }, '무료 간편 계산'), '을 이용할 수 있습니다(저장 안 됨).'));
  };
  draw(); app.replaceChildren(box);
});

// ---------- 내 장소 ----------
route(/^\/$/, async () => {
  if (!ME) { location.hash = '#/login'; return; }
  const sites = await api('GET', '/api/sites');
  const f = form([{ k: 'name', l: '장소명', ph: '예: 우리집, ○○카페' }, { k: 'address', l: '주소' },
    { k: 'info.industry', l: '업종', type: 'select', opts: INDUSTRY }]);
  app.replaceChildren(
    h('div', { class: 'row' }, h('h1', {}, '내 장소'), h('span', { class: 'sp' }), h('span', { class: 'badge' }, ROLE[ME.role] + (ME.company ? ' · ' + ME.company.name : ''))),
    h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '새 장소 등록'), f, h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'acc', onclick: guard(async () => { const v = f.value(); const { id } = await api('POST', '/api/sites', v); location.hash = `#/site/${id}/info`; }) }, '등록하고 정보 입력'))),
    h('div', { class: 'list' }, sites.length ? sites.map((s) => h('a', { class: 'item', href: `#/site/${s.id}/result` },
      h('div', { class: 'sp' }, h('b', {}, s.name), h('div', { class: 'small muted' }, [s.address, s.industry && INDUSTRY.find((x) => x[0] === s.industry)?.[1], s.contract_kw != null && `계약 ${s.contract_kw}kW`].filter(Boolean).join(' · '))),
      !s.mine && h('span', { class: 'badge' }, '고객 공유'), h('span', { class: 'muted' }, '›'))) : h('p', { class: 'muted' }, '등록된 장소가 없습니다.')),
  );
});

const INDUSTRY = [['', '선택'], ['house', '주택'], ['apartment', '아파트'], ['restaurant', '음식점'], ['cafe', '카페'], ['salon', '미용실'], ['office', '사무실'], ['warehouse', '창고'], ['etc', '기타']];
const UNKNOWN = ['', '모름'];

// ---------- 장소 화면 ----------
const TABS = [['result', '결과'], ['info', '장소·계약'], ['devices', '기기'], ['panels', '분전반·회로'], ['bills', '고지서'], ['measure', '실측'], ['quote', '견적·비용'], ['reports', '보고서'], ['records', '기록·공유']];
let SITE = null;
route(/^\/site\/(\d+)(?:\/(\w+))?$/, async (id, tab = 'result') => {
  if (!ME) { location.hash = '#/login'; return; }
  SITE = await api('GET', `/api/sites/${id}`);
  const body = h('div');
  app.replaceChildren(h('div', { class: 'row' }, h('h1', {}, SITE.name), h('span', { class: 'sp' }), h('span', { class: 'small muted' }, SITE.address || '')),
    h('nav', { class: 'tabs' }, TABS.map(([k, l]) => h('a', { href: `#/site/${id}/${k}`, class: k === tab ? 'on' : '' }, l))), body);
  await (VIEWS[tab] || VIEWS.result)(body, SITE);
});
const reload = () => render();
const sid = () => SITE.id;

const VIEWS = {};

// ---- 결과
VIEWS.result = async (el) => {
  const c = await api('GET', `/api/sites/${sid()}/result`); const r = c.result;
  const vcls = r.verdict === '입력 조건상 여유 있음' ? 'v-ok' : r.verdict === '정보 부족으로 판단 보류' ? 'v-hold' : r.verdict.includes('동시') ? 'v-bad' : 'v-warn';
  const sc = r.scenarios;
  const asmF = form([{ k: 'default_pf', l: '역률 미입력 기기 가정', type: 'number', hint: '1.0은 전류를 가장 작게 보는 가정' }, { k: 'margin_pct', l: '여유율(%)', type: 'number', hint: '기술적 필요용량에 1회만 적용' },
    { k: 'caution_ratio', l: '주의 표시 기준(차단기 정격 대비)', type: 'number', hint: '예: 0.8 = 80%' }], r.assumptions);
  el.replaceChildren(
    h('div', { class: 'verdict ' + vcls }, h('small', {}, '검토 결과'), h('b', {}, r.verdict), r.flags.map((f) => h('div', {}, '⚠ ' + f)),
      h('div', { class: 'small', style: 'opacity:.85;margin-top:6px' }, '입력값·사진 추출값 기반 검토이며 안전 여부나 법적 적합성을 확인한 것이 아닙니다.')),
    h('div', { class: 'qa', style: 'margin-top:10px' }, c.answers.map((a) => h('div', {}, h('b', {}, a.q), a.a))),
    h('h2', {}, '주요 수치'),
    h('div', { class: 'kpis' },
      kpi('현재 계약전력', fmt(r.contract.contractKw, ' kW'), SITE.info.supply_type === 'building_managed' ? '건물 관리주체 배정용량' : '한전 계약'),
      kpi('현재 최대 동시 사용', fmt(sc.cur_peak.kw, ' kW'), '기기 입력 계산'),
      kpi('추가 후 최대 동시 사용', fmt(sc.add_peak.kw, ' kW'), sc.add_peak.excluded ? `계산 제외 ${sc.add_peak.excluded}대` : ''),
      kpi('실측 최대값', r.contract.measured ? fmt(r.contract.measured.peak_kw, ' kW') : '없음', r.contract.measured ? `측정 ${fmt(r.contract.measured.period_days)}일 ${r.contract.measured.notes.join(' ')}` : '실측 탭에서 입력'),
      kpi('기술적 필요용량 검토값', fmt(r.contract.technicalKw, ' kW'), r.contract.basis),
      kpi('약관 적용 계약전력', '확인 필요', r.contract.officialNote),
      kpi('추가 증설 검토량', fmt(r.contract.addKw, ' kW'), '기술적 검토값 기준'),
      kpi('한전 예상 납부금', c.kepco?.subtotal != null ? won(c.kepco.subtotal) : '한전 확인 필요', c.kepco ? `미확정 ${c.kepco.unresolved}건` : '견적 탭에서 신청 조건 입력'),
      kpi('내부 공사비 범위', c.quote.totals ? `${won(c.quote.totals.total[0])} ~ ${won(c.quote.totals.total[1])}` : '단가·항목 필요', c.quote.status),
      kpi('월 전기요금 변화', c.tariff.status === 'ok' ? won(c.tariff.monthlyDiff) : '보류', c.tariff.status === 'ok' ? '' : c.tariff.msg),
      kpi('결과 신뢰도', r.missing.length ? '낮음' : r.circuits.some((x) => x.status === 'hold') || r.main.some((m) => m.status === 'hold') ? '보통' : '입력 범위 내 양호', r.missing.length ? '미입력: ' + r.missing.join(', ') : '보류 항목은 아래 참고')),
    h('h2', {}, '시나리오별 예상 사용전력'),
    h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['시나리오', 'kW', 'L1', 'L2', 'L3', '상 미확인'].map((t) => h('th', {}, t))),
      Object.values(sc).map((s) => h('tr', {}, h('td', {}, s.label), h('td', {}, h('b', {}, fmt(s.kw))), h('td', {}, fmt(s.phaseKw.L1)), h('td', {}, fmt(s.phaseKw.L2)), h('td', {}, fmt(s.phaseKw.L3)), h('td', {}, fmt(s.unassignedKw)))))),
    h('h2', {}, '설비 수용능력(주차단기·분기회로)'),
    r.main.length ? h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['분전반', '판정', '내용'].map((t) => h('th', {}, t))),
      r.main.map((m) => h('tr', {}, h('td', {}, m.panel), h('td', {}, badge(m.status)), h('td', {}, [m.msg, ...m.issues].filter(Boolean).join(' / ')))))) : h('p', { class: 'muted' }, '분전반 정보 없음'),
    r.circuits.length ? h('div', { class: 'tw', style: 'margin-top:8px' }, h('table', {}, h('tr', {}, ['회로', '연결기기', '전류', '판정', '전선·전압강하'].map((t) => h('th', {}, t))),
      r.circuits.map((x) => h('tr', {}, h('td', {}, x.name, x.mismatch && h('div', { class: 'hint' }, '표기 불일치: ' + x.mismatch)), h('td', { class: 'small' }, x.devices.join(', ') || '—'),
        h('td', {}, x.msg), h('td', {}, badge(x.status)),
        h('td', { class: 'small' }, x.wire && h('div', {}, badge(x.wire.status), ' ', x.wire.msg), x.vdrop && h('div', {}, `전압강하 ${x.vdrop.pct}% ${x.vdrop.limit != null ? '(기준 ' + x.vdrop.limit + '%)' : '(기준 미등록)'} · ${x.vdrop.note}`),
          x.issues.map((i) => h('div', { class: 'hint' }, i))))))) : null,
    r.unassigned.length ? h('p', { class: 'warnbox' }, '미확인 회로 기기: ' + r.unassigned.join(', ') + ' — 분전반 탭에서 회로를 연결하세요.') : null,
    r.phase && h('div', { class: 'card' }, h('b', {}, '상별 부하 '), badge(r.phase.status), h('div', {}, `L1 ${fmt(r.phase.phaseKw.L1)}kW · L2 ${fmt(r.phase.phaseKw.L2)}kW · L3 ${fmt(r.phase.phaseKw.L3)}kW`), h('div', { class: 'small muted' }, r.phase.msg)),
    r.starts.length ? h('div', { class: 'card' }, h('b', {}, '모터 기동 검토(정상 운전과 별도)'), r.starts.map((s) => h('div', { class: 'small' }, `${s.name}: ${s.startA ? s.startA + 'A (' + s.source + ') ' : ''}${s.msg}`))) : null,
    h('h2', {}, '다음 확인 경로'), h('ol', {}, r.path.steps.map((s) => h('li', {}, s))),
    r.notes.length ? h('div', { class: 'warnbox' }, r.notes.join(' / ')) : null,
    h('h2', {}, '증설 없이 해결 가능한 대안'),
    h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['대안', '피크 감소', '초기 비용', '불편', '추가 확인'].map((t) => h('th', {}, t))),
      c.alternatives.list.map((a) => h('tr', {}, h('td', {}, a.name), h('td', {}, a.peakCutKw == null ? '계산 불가' : a.peakCutKw + ' kW'), h('td', { class: 'small' }, a.cost), h('td', { class: 'small' }, a.burden), h('td', { class: 'small' }, a.check))))),
    h('p', { class: 'warnbox' }, c.alternatives.note),
    h('h2', {}, '계산 가정(수정 가능)'),
    h('div', { class: 'card' }, asmF, h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { onclick: guard(async () => { await api('PUT', `/api/sites/${sid()}`, { assumptions: asmF.value() }); toast('재계산합니다'); reload(); }) }, '가정 저장 후 재계산')),
      h('p', { class: 'hint' }, '기기 전력 = 입력 소비전력 × 수량, 시나리오 전력 = Σ(기기 전력 × 해당 운전계수), 단상 I = P ÷ (V × 역률), 평형 삼상 I = P ÷ (√3 × 선간전압 × 역률). 계산 규칙 ' + c.versions.engine)),
  );
};
function kpi(label, val, hint) { return h('div', { class: 'kpi' }, h('small', {}, label), h('b', {}, val), hint && h('div', { class: 'hint' }, hint)); }

// ---- 장소·계약 정보
const SITE_FIELDS = [
  { section: '장소' }, { k: 'name', l: '장소명' }, { k: 'address', l: '주소', wide: 1 },
  { k: 'info.building_use', l: '건물 용도', ph: '근린생활시설 등' }, { k: 'info.area_m2', l: '면적(㎡)', type: 'number' }, { k: 'info.industry', l: '업종', type: 'select', opts: INDUSTRY },
  { section: '전기 계약' },
  { k: 'info.supply_type', l: '전기요금 납부 방식', type: 'select', opts: [['unknown', '모름'], ['kepco_direct', '한전과 직접 계약(고지서를 한전에서 받음)'], ['building_managed', '건물 관리비로 납부(아파트 세대·상가 호실 등)']], wide: 1 },
  { k: 'info.contract_kind', l: '계약종별', type: 'select', opts: [UNKNOWN, ['주택용', '주택용'], ['일반용(갑)', '일반용(갑)'], ['일반용(을)', '일반용(을)'], ['산업용(갑)', '산업용(갑)'], ['산업용(을)', '산업용(을)'], ['농사용', '농사용'], ['교육용', '교육용'], ['기타', '기타']] },
  { k: 'info.contract_kw', l: '계약전력(kW)', type: 'number', hint: '고지서의 "계약전력" 값. 월 사용량(kWh)이 아님' },
  { k: 'info.customer_no', l: '한전 고객번호', hint: '공유·업체 화면에서는 가려집니다' },
  { k: 'info.phase', l: '공급 방식', type: 'select', opts: [UNKNOWN, ['1', '단상'], ['3', '삼상']] },
  { k: 'info.v_phase', l: '상전압(V)', type: 'number', ph: '보통 220' }, { k: 'info.v_line', l: '선간전압(V, 삼상)', type: 'number', ph: '보통 380' },
  { k: 'info.wire_system', l: '전선식', type: 'select', opts: [UNKNOWN, ['단상2선', '단상2선'], ['단상3선', '단상3선'], ['삼상3선', '삼상3선'], ['삼상4선', '삼상4선']] },
  { section: '현장 조건' },
  { k: 'info.meter_location', l: '계량기 위치' }, { k: 'info.panel_location', l: '분전반 위치' },
  { k: 'info.service_entry', l: '인입 방식', type: 'select', opts: [UNKNOWN, ['overhead', '가공(전주)'], ['underground', '지중'], ['building', '건물 내 수전설비']] },
  { k: 'info.outage_window', l: '정전 가능한 시간', ph: '예: 일요일 오전' }, { k: 'info.desired_period', l: '공사 희망 시기' },
  { k: 'info.rented', l: '임대 공간', type: 'check' }, { k: 'info.needs_mgmt_consent', l: '건물 관리주체 협의 필요', type: 'check' },
  { k: 'info.notes', l: '메모', type: 'textarea', wide: 1 },
];
VIEWS.info = async (el, s) => {
  const f = form(SITE_FIELDS, s);
  const consent = h('input', { type: 'checkbox', checked: s.ai_consent, disabled: !s.mine });
  const docs = s.files.filter((x) => ['drawing', 'bill'].includes(x.kind));
  el.replaceChildren(
    h('div', { class: 'notice' }, '모르는 항목은 비워두거나 "모름"으로 두고 진행할 수 있습니다. 계약전력·예상 사용전력·설비 수용능력은 서로 다른 값입니다.'),
    h('div', { class: 'card' }, f, h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'pri', onclick: guard(async () => { const v = f.value(); await api('PUT', `/api/sites/${sid()}`, v); toast('저장됨'); reload(); }) }, '저장'))),
    s.info.supply_type === 'building_managed' && h('div', { class: 'warnbox' }, '건물 관리비로 전기요금을 내는 경우 계약전력 증설은 한전이 아니라 건물 관리주체의 배정용량 확인부터 진행합니다.'),
    h('h2', {}, '외부 AI 사진 분석 동의'),
    h('div', { class: 'card' }, h('label', { class: 'ck' }, consent, '분전반·명판·고지서 사진을 외부 AI(Anthropic)로 보내 글자·위치를 추출하는 데 동의합니다.'),
      h('p', { class: 'hint' }, `전송 항목: 분석을 누른 사진/PDF 1건씩. 결과는 원본값·수정값·확인자와 함께 저장됩니다. ${CFG.ai ? '' : '현재 서버에 AI 분석이 설정되지 않아 수동 입력만 가능합니다.'} ${s.ai_consent_at ? '동의 일시 ' + s.ai_consent_at : ''}`),
      s.mine && h('button', { class: 'sm', onclick: guard(async () => { await api('PUT', `/api/sites/${sid()}`, { ai_consent: consent.checked }); toast('저장됨'); reload(); }) }, '동의 상태 저장')),
    h('h2', {}, '기존 도면·서류'),
    h('div', { class: 'row' }, h('button', { onclick: guard(async () => { if (await uploadTo(sid(), 'drawing', { capture: false, accept: 'image/*,application/pdf' })) reload(); }) }, '도면 올리기')),
    h('div', { class: 'thumbs', style: 'margin-top:8px' }, docs.map((d) => h('a', { href: `/api/files/${d.id}`, target: '_blank' }, d.mime === 'application/pdf' ? h('span', { class: 'badge' }, 'PDF ' + d.name) : h('img', { src: img(d.id, 200) })))),
    h('h2', {}, '데이터'),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: `/api/sites/${sid()}/export` }, '전체 데이터 내보내기(JSON)'),
      s.mine && h('button', { class: 'dan', onclick: guard(async () => { if (!confirm('이 장소와 사진·보고서를 모두 삭제합니다. 되돌릴 수 없습니다.')) return; await api('DELETE', `/api/sites/${sid()}`); location.hash = '#/'; }) }, '장소 삭제')),
  );
};

// ---- 기기
const DEVICE_PRESETS = ['에어컨', '냉난방기', '냉장고', '냉동고', '인덕션', '전기레인지', '오븐', '튀김기', '식기세척기', '온수기', '커피머신', '제빙기', '세탁기', '건조기', '컴퓨터', '서버', '복합기', '조명', '전기히터', '펌프', '모터', '전기차 충전기'];
function deviceFields(s) {
  return [
    { section: '기본' }, { k: 'name', l: '기기명', ph: '예: 인덕션' }, { k: 'maker', l: '제조사' }, { k: 'model', l: '모델명' }, { k: 'qty', l: '수량', type: 'number' },
    { k: 'status', l: '구분', type: 'select', opts: [['current', '현재 사용 중'], ['planned', '추가 예정']] },
    { k: 'category', l: '분류', type: 'select', opts: [['', '일반'], ['motor', '모터·압축기'], ['heater', '전열기기'], ['ev', '전기차 충전기']] },
    { section: '전기 입력(명판의 소비전력·정격입력)' },
    { k: 'power_value', l: '소비전력', type: 'number', hint: '전기 입력전력. 냉방능력·모터출력 아님' }, { k: 'power_unit', l: '단위', type: 'select', opts: [['W', 'W'], ['kW', 'kW']] },
    { k: 'rated_current', l: '정격전류(A)', type: 'number' }, { k: 'voltage', l: '전압(V)', type: 'number' },
    { k: 'phase', l: '상', type: 'select', opts: [['1', '단상'], ['3', '삼상']] }, { k: 'pf', l: '역률', type: 'number', ph: '모르면 비워두기' },
    { section: '능력·출력(참고용, 소비전력으로 쓰지 않음)' },
    { k: 'cooling_capacity_kw', l: '냉방능력(kW)', type: 'number' }, { k: 'heating_capacity_kw', l: '난방능력(kW)', type: 'number' },
    { k: 'motor_output_kw', l: '모터 정격출력(kW)', type: 'number', hint: '소비전력이 없을 때만 효율로 환산' }, { k: 'efficiency', l: '효율(0~1)', type: 'number' },
    { k: 'start_current_a', l: '기동전류(A)', type: 'number', hint: '제조사 자료가 있을 때만' }, { k: 'start_source', l: '기동 특성 출처' },
    { section: '사용 조건' },
    { k: 'hours_per_day', l: '하루 사용시간(h)', type: 'number' }, { k: 'days_per_week', l: '주간 사용일수', type: 'number' }, { k: 'time_band', l: '사용 시간대', ph: '예: 11~14시' },
    { k: 'simultaneous', l: '다른 기기와 동시 사용', type: 'check' },
    { k: 'factor_normal', l: '운전계수: 일반 사용', type: 'number', hint: '0~1. 비우면 최대값과 같음' },
    { k: 'factor_peak', l: '운전계수: 최대 동시', type: 'number', hint: '비우면 동시 사용=1, 아니면 0' },
    { k: 'factor_shifted', l: '운전계수: 시간대 분산', type: 'number', hint: '피크 시간대를 피하면 0' },
    { k: 'ev_limit_kw', l: '충전출력 제한(kW, 충전기만)', type: 'number' },
    { section: '연결' },
    { k: 'circuit_id', l: '연결 회로', type: 'select', opts: [['', '미확인 회로'], ...s.circuits.map((c) => [c.id, `${s.panels.find((p) => p.id === c.panel_id)?.name || ''} · ${c.name}`])] },
    { k: 'conn_phase', l: '연결 상(삼상 장소)', type: 'select', opts: [['', '회로 따름/미확인'], ['L1', 'L1(R)'], ['L2', 'L2(S)'], ['L3', 'L3(T)'], ['3P', '삼상']] },
    { k: 'source', l: '값의 출처', type: 'select', opts: [['user', '사용자 입력'], ['nameplate', '명판'], ['manual', '설명서'], ['measured', '실측'], ['reference', '참고값']] },
    { k: 'note', l: '메모', type: 'textarea', wide: 1 },
  ];
}
async function deviceEditor(s, d = { qty: 1, status: 'current', power_unit: 'W', phase: '1', simultaneous: true, source: 'user' }) {
  const refs = await api('GET', '/api/master/device_refs').catch(() => []);
  const f = form(deviceFields(s), d);
  const pre = h('div', { class: 'row' }, DEVICE_PRESETS.map((n) => h('button', { class: 'sm', onclick: () => { $('input', f).value = n; } }, n)));
  const refBox = refs.length ? h('div', { class: 'card' }, h('b', {}, '참고값(관리자 등록, 명판값·실측값 우선)'),
    refs.map((r) => h('div', { class: 'row small' }, `${r.name}: ${r.power_w}W`, h('span', { class: 'muted' }, r.source || ''), h('button', { class: 'sm', onclick: () => {
      const v = f.value(); Object.assign(v, { name: v.name || r.name, power_value: r.power_w, power_unit: 'W', source: 'reference' }); modal(...deviceEditorBody(s, v, f0)); } }, '적용')))) : null;
  const f0 = { refs };
  modal(...deviceEditorBody(s, d, f0, f, pre, refBox));
}
function deviceEditorBody(s, d, ctx, f = form(deviceFields(s), d), pre = null, refBox = null) {
  return [h('h2', {}, d.id ? '기기 수정' : '기기 추가'), pre, f, refBox,
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'pri', onclick: guard(async () => {
      const v = f.value(); if (!v.name) throw new Error('기기명을 입력하세요.');
      if (v.circuit_id) v.circuit_id = Number(v.circuit_id);
      if (d.id) await api('PUT', `/api/sites/${sid()}/devices/${d.id}`, v); else await api('POST', `/api/sites/${sid()}/devices`, v);
      closeModal(); toast('저장됨'); reload(); }) }, '저장'),
    d.id && h('button', { class: 'dan', onclick: guard(async () => { if (!confirm('삭제할까요?')) return; await api('DELETE', `/api/sites/${sid()}/devices/${d.id}`); closeModal(); reload(); }) }, '삭제'))];
}
VIEWS.devices = async (el, s) => {
  const cname = (id) => { const c = s.circuits.find((x) => String(x.id) === String(id)); return c ? c.name : '미확인 회로'; };
  const pw = (d) => d.power_value != null ? `${d.power_value}${d.power_unit || 'W'}` : d.rated_current != null ? `${d.rated_current}A` : d.motor_output_kw != null ? `출력 ${d.motor_output_kw}kW` : d.cooling_capacity_kw != null ? h('span', { class: 'badge b-over' }, '소비전력 없음(냉방능력만)') : '—';
  const sec = (title, st) => {
    const ds = s.devices.filter((d) => (d.status || 'current') === st);
    return [h('h2', {}, `${title} (${ds.length})`), ds.length ? h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['기기', '수량', '소비전력', '회로', '출처', ''].map((t) => h('th', {}, t))),
      ds.map((d) => h('tr', {}, h('td', {}, h('b', {}, d.name), h('div', { class: 'hint' }, [d.maker, d.model].filter(Boolean).join(' '))), h('td', {}, d.qty ?? 1), h('td', {}, pw(d)),
        h('td', { class: 'small' }, cname(d.circuit_id)), h('td', { class: 'small' }, { user: '사용자', nameplate: '명판', manual: '설명서', measured: '실측', reference: '참고값' }[d.source] || '—'),
        h('td', {}, h('button', { class: 'sm', onclick: guard(() => deviceEditor(s, d)) }, '수정')))))) : h('p', { class: 'muted' }, '없음')];
  };
  el.replaceChildren(
    h('div', { class: 'row' }, h('button', { class: 'acc', onclick: guard(() => deviceEditor(s)) }, '+ 직접 입력'),
      photoBtns('nameplate', (f) => analyze(f, 'nameplate'), { label: '명판 촬영으로 등록' })),
    h('div', { class: 'row', style: 'margin-top:6px' }, h('span', { class: 'small muted' }, '추가 예정기기:'),
      photoBtns('nameplate', (f) => analyze(f, 'nameplate', null, 'planned'), { label: '명판 촬영', cls: 'sm' })),
    h('p', { class: 'hint' }, '냉방능력·난방능력은 전기 소비전력이 아닙니다. 명판의 "소비전력" 또는 "정격입력"을 입력하세요. 대표값은 참고값이며 명판·실측값을 우선합니다.'),
    sec('현재 사용 중', 'current'), sec('추가 예정', 'planned'));
};

// ---- 분석 결과 확인(원문 위치 표시 → 확인·수정 → 반영)
async function analyze(file, target, targetId = null, status = null) {
  toast('사진 분석 중…(최대 1분)', 60000);
  const ex = await api('POST', `/api/sites/${sid()}/extract`, { file_id: file.id, target, target_id: targetId });
  toast(ex.status === 'done' ? '분석 완료 — 값을 확인하세요' : '분석하지 못했습니다');
  if (ex.status !== 'done') {
    modal(h('h2', {}, '자동 분석 불가'), h('p', { class: 'warnbox' }, ex.error || '분석 실패'), h('p', {}, '사진은 저장되었습니다. 값을 직접 입력해 주세요.'),
      h('div', { class: 'photo' }, h('img', { src: img(file.id, 1200) })),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'pri', onclick: () => { closeModal(); if (target === 'nameplate') deviceEditor(SITE, { qty: 1, status: status || 'current', power_unit: 'W', phase: '1', simultaneous: true, source: 'nameplate' }); else if (target === 'bill') billEditor(SITE, { file_id: file.id }); else reload(); } }, '직접 입력하기')));
    return;
  }
  reviewExtraction({ ...ex, file_id: file.id, target }, status);
}
function reviewExtraction(ex, status) {
  const pic = h('div', { class: 'photo' }, h('img', { src: img(ex.file_id, 1400) }));
  const boxes = [];
  const addBox = (bb, label, cls = '') => { if (!bb || bb.length !== 4) return null; const b = h('div', { class: 'bbox ' + cls, style: `left:${bb[0] * 100}%;top:${bb[1] * 100}%;width:${bb[2] * 100}%;height:${bb[3] * 100}%` }, label && h('span', {}, label)); pic.append(b); boxes.push(b); return b; };
  const focus = (b) => { boxes.forEach((x) => x.classList.remove('sel')); b?.classList.add('sel'); };
  (ex.findings || []).forEach((x) => addBox(x.bbox, '의심', 'sus'));
  const decisions = new Map(); const rows = [];
  const isPanel = ex.target === 'panel';
  (ex.fields || []).forEach((f, idx) => {
    const box = addBox(f.bbox, String(idx + 1));
    const low = f.needs_confirm;
    const st = h('select', {}, [['confirmed', '확인'], ['edited', '수정'], ['rejected', '제외']].map(([v, l]) => h('option', { value: v, selected: f.status === 'rejected' && v === 'rejected' }, l)));
    if (f.status === 'rejected') st.value = 'rejected';
    else if (low) { st.prepend(h('option', { value: 'pending', selected: true }, '확인 필요')); }
    let body; let getVal;
    if (isPanel) {
      const role = h('select', {}, [['main', '주차단기'], ['branch', '분기차단기']].map(([v, l]) => h('option', { value: v, selected: f.role === v || (f.role !== 'main' && v === 'branch') }, l)));
      const lab = h('input', { value: f.label || '', placeholder: '회로명' });
      const bf = form([{ k: 'maker', l: '제조사' }, { k: 'model', l: '모델' }, { k: 'type', l: '종류' }, { k: 'poles', l: '극수(P)', type: 'number' }, { k: 'af', l: 'AF(프레임)', type: 'number' }, { k: 'at', l: 'AT(정격전류)', type: 'number' },
        { k: 'sens_ma', l: '감도전류(mA)', type: 'number' }, { k: 'ka', l: '차단용량(kA)', type: 'number' }, { k: 'voltage', l: '정격전압(V)', type: 'number' }, { k: 'adjustable', l: '조정형', type: 'check' }, { k: 'set_current', l: '실제 설정값(A)', type: 'number' }], f.fields);
      bf.addEventListener('input', () => { st.value = 'edited'; });
      body = h('div', {}, h('div', { class: 'row' }, h('b', {}, `#${idx + 1}`), role, lab, h('span', { class: 'conf' }, `신뢰도 ${Math.round(f.confidence * 100)}%`)), f.text && h('div', { class: 'hint' }, '원문: ' + f.text), bf,
        f.notes.map((n) => h('div', { class: 'hint', style: 'color:var(--bad)' }, '⚠ ' + n)));
      getVal = () => ({ role: role.value, label: lab.value, fields: bf.value() });
    } else {
      const inp = h('input', { value: f.value ?? '' }); inp.oninput = () => { st.value = 'edited'; };
      body = h('div', {}, h('div', { class: 'row' }, h('b', {}, `#${idx + 1} ${f.label || f.key}`), h('span', { class: 'conf' }, `신뢰도 ${Math.round(f.confidence * 100)}%`), f.unit && h('span', { class: 'badge' }, f.unit)),
        f.text && h('div', { class: 'hint' }, '원문: ' + f.text), inp, f.notes.map((n) => h('div', { class: 'hint', style: 'color:var(--bad)' }, '⚠ ' + n)));
      getVal = () => ({ value: inp.value });
    }
    const row = h('div', { class: 'fieldrow' + (low ? ' low' : '') + (f.status === 'rejected' ? ' rej' : ''), onclick: () => focus(box) }, body, st);
    rows.push(row); decisions.set(idx, { st, getVal });
  });
  modal(h('h2', {}, '추출값 확인'),
    h('p', { class: 'notice' }, '사진 분석은 보조 기능입니다. 각 값을 사진과 대조해 확인·수정하세요. "확인 필요" 상태로 둔 값은 계산에 반영되지 않습니다.'),
    pic, ex.unreadable?.length ? h('p', { class: 'warnbox' }, '확인 불가: ' + ex.unreadable.join(', ') + ' — 재촬영하거나 직접 입력하세요.') : null,
    (ex.findings || []).length ? h('div', { class: 'warnbox' }, h('b', {}, '외관상 의심 지점(현장 전문가 확인 필요)'), ex.findings.map((x) => h('div', {}, '· ' + x.desc))) : null,
    isPanel && ex.fields.length ? h('label', { class: 'f' }, '반영할 분전반', h('select', { id: 'panelSel' }, h('option', { value: '' }, '새 분전반'), SITE.panels.map((p) => h('option', { value: p.id }, p.name)))) : null,
    rows.length ? rows : h('p', {}, '읽은 값이 없습니다. 재촬영하거나 직접 입력하세요.'),
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'pri', onclick: guard(async () => {
      const out = [];
      for (const [idx, { st, getVal }] of decisions) { if (st.value === 'pending') continue; out.push({ idx, status: st.value, ...getVal() }); }
      await api('POST', `/api/sites/${sid()}/extractions/${ex.id}/apply`, { fields: out, panel_id: $('#panelSel')?.value || null, status });
      closeModal(); toast('확인한 값만 반영했습니다'); reload(); }) }, '확인한 값 반영'), h('button', { onclick: closeModal }, '나중에')));
}

// ---- 분전반·회로
const PHOTO_SLOTS = [['panel', '분전반 전체'], ['main_breaker', '주차단기 명판'], ['branch_breaker', '분기차단기 명판'], ['circuit_label', '회로명 표기'], ['meter', '계량기'], ['panel_inside', '내부 배선(전문가만)']];
const BRK = [{ k: 'breaker.maker', l: '제조사' }, { k: 'breaker.type', l: '종류', type: 'select', opts: [UNKNOWN, ['MCCB', 'MCCB(배선용)'], ['ELB', 'ELB(누전)'], ['MCB', 'MCB'], ['기타', '기타']] },
  { k: 'breaker.poles', l: '극수', type: 'number' }, { k: 'breaker.af', l: 'AF(프레임)', type: 'number' }, { k: 'breaker.at', l: 'AT(정격전류)', type: 'number' },
  { k: 'breaker.sens_ma', l: '감도전류(mA)', type: 'number' }, { k: 'breaker.ka', l: '차단용량(kA)', type: 'number' }, { k: 'breaker.adjustable', l: '조정형', type: 'check' }, { k: 'breaker.set_current', l: '설정값(A)', type: 'number' }];
function panelEditor(p = {}) {
  const f = form([{ k: 'name', l: '분전반 이름' }, { k: 'location', l: '위치' }, ...BRK.map((x) => ({ ...x, k: x.k.replace('breaker.', 'main_breaker.') }))], p);
  modal(h('h2', {}, p.id ? '분전반·주차단기 수정' : '분전반 추가'), h('p', { class: 'hint' }, 'AF는 프레임 크기, AT가 정격전류입니다. 분기차단기 정격 합계는 주차단기 용량이 아닙니다.'), f,
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'pri', onclick: guard(async () => { const v = f.value(); v.main_breaker = { ...(p.main_breaker || {}), ...v.main_breaker, source: 'user' };
      if (p.id) await api('PUT', `/api/sites/${sid()}/panels/${p.id}`, v); else await api('POST', `/api/sites/${sid()}/panels`, v); closeModal(); reload(); }) }, '저장'),
    p.id && h('button', { class: 'dan', onclick: guard(async () => { if (!confirm('분전반과 하위 회로를 삭제할까요?')) return; await api('DELETE', `/api/sites/${sid()}/panels/${p.id}`); closeModal(); reload(); }) }, '삭제')));
}
function circuitEditor(c) {
  const f = form([{ k: 'name', l: '회로명' }, { k: 'phase', l: '상', type: 'select', opts: [['', '미확인'], ['L1', 'L1(R)'], ['L2', 'L2(S)'], ['L3', 'L3(T)'], ['3P', '삼상']] }, { k: 'spare', l: '예비회로', type: 'check' },
    { k: 'dedicated', l: '전용회로', type: 'check' }, { k: 'label_mismatch', l: '회로명과 실제 연결기기 불일치', wide: 1, ph: '예: "전등"으로 표기됐지만 에어컨 연결' },
    { section: '분기차단기' }, ...BRK,
    { section: '전선(케이블 표기 또는 전문가 확인값 — 사진만으로 확정 금지)' },
    { k: 'wire.material', l: '도체', type: 'select', opts: [UNKNOWN, ['Cu', '구리'], ['Al', '알루미늄']] }, { k: 'wire.insulation', l: '전선 종류', ph: 'HFIX, F-CV 등' }, { k: 'wire.size_mm2', l: '단면적(mm²)', type: 'number' },
    { k: 'wire.length_m', l: '길이(m)', type: 'number' }, { k: 'wire.install_method', l: '포설 방법', ph: '기준표의 표기와 동일하게' }, { k: 'wire.ambient_c', l: '주위온도(℃)', type: 'number' }, { k: 'wire.grouping', l: '집합 회로수', type: 'number' },
    { k: 'wire.confirmed_by', l: '확인자' }], c);
  modal(h('h2', {}, c.id ? '회로 수정' : '회로 추가'), f, h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'pri', onclick: guard(async () => {
    const v = f.value(); if (c.id) await api('PUT', `/api/sites/${sid()}/circuits/${c.id}`, v); else await api('POST', `/api/sites/${sid()}/circuits`, { ...v, panel_id: c.panel_id }); closeModal(); reload(); }) }, '저장'),
  c.id && h('button', { class: 'dan', onclick: guard(async () => { if (!confirm('회로를 삭제할까요? 연결된 기기는 "미확인 회로"가 됩니다.')) return; await api('DELETE', `/api/sites/${sid()}/circuits/${c.id}`); closeModal(); reload(); }) }, '삭제')));
}
const brTxt = (b = {}) => [b.type, b.poles && b.poles + 'P', b.af && b.af + 'AF', b.at && b.at + 'AT', b.adjustable && `설정 ${b.set_current ?? '?'}A`, b.sens_ma && b.sens_ma + 'mA', b.ka && b.ka + 'kA'].filter(Boolean).join(' ') || '정격 미확인';
VIEWS.panels = async (el, s) => {
  const photos = (kind) => s.files.filter((f) => f.kind === kind);
  const lastEx = (fid) => s.extractions.find((e) => e.file_id === fid);
  el.replaceChildren(
    h('div', { class: 'warnbox' }, h('b', {}, '안전 안내 '), '보호커버를 열거나 충전부·배선을 만지지 마세요. 겉면과 명판만 촬영합니다. 내부 촬영이 필요하면 전문가 확인 단계로 넘깁니다.'),
    h('h2', {}, '사진'),
    h('div', { class: 'grid' }, PHOTO_SLOTS.map(([k, l]) => h('div', { class: 'slot' }, h('b', {}, l),
      k === 'panel_inside' && ME.role === 'user' ? h('span', { class: 'hint' }, '전기공사업체·검토 담당자가 안전하게 확보한 사진만 등록') :
        h('div', { class: 'row' }, photoBtns(k, (f) => (k !== 'panel_inside' ? analyze(f, k === 'meter' ? 'meter' : 'panel') : reload()), { cls: 'sm' })),
      h('div', { class: 'thumbs' }, photos(k).map((f) => { const e = lastEx(f.id); return h('div', {}, h('img', { src: img(f.id, 200), onclick: () => e?.status === 'done' ? reviewExtraction({ ...e, file_id: f.id }) : window.open(`/api/files/${f.id}`) }),
        h('div', { class: 'hint' }, e ? ({ done: e.applied_at ? '확인 반영됨' : '확인 대기', not_configured: 'AI 미설정', no_consent: '동의 없음', failed: '분석 실패' }[e.status]) : '미분석'),
        !e || e.status !== 'done' ? h('button', { class: 'sm', onclick: guard(() => analyze(f, k === 'meter' ? 'meter' : 'panel')) }, '분석') : null); }))))),
    h('div', { class: 'row', style: 'margin-top:14px' }, h('h2', { style: 'margin:0' }, '분전반 → 주차단기 → 분기회로 → 기기'), h('span', { class: 'sp' }), h('button', { class: 'acc', onclick: () => panelEditor() }, '+ 분전반')),
    s.panels.length ? s.panels.map((p) => {
      const cs = s.circuits.filter((c) => c.panel_id === p.id);
      return h('div', { class: 'card tree' },
        h('div', { class: 'row' }, h('b', {}, p.name || '분전반'), h('span', { class: 'muted small' }, p.location || ''), h('span', { class: 'sp' }),
          h('a', { class: 'btn sm', href: `/api/sites/${sid()}/panels/${p.id}/qr.png`, target: '_blank' }, 'QR'), h('button', { class: 'sm', onclick: () => panelEditor(p) }, '수정')),
        h('ul', {}, h('li', {}, '주차단기: ', h('b', {}, brTxt(p.main_breaker)), p.main_breaker?.source === 'photo' && h('span', { class: 'badge' }, '사진 확인값'),
          h('ul', {}, cs.map((c) => h('li', {}, h('a', { href: 'javascript:void 0', onclick: () => circuitEditor(c) }, c.name || '회로'), ' ', h('span', { class: 'small muted' }, brTxt(c.breaker)), c.phase && h('span', { class: 'badge' }, c.phase), c.spare && h('span', { class: 'badge' }, '예비'),
            c.label_mismatch && h('span', { class: 'badge b-caution' }, '표기 불일치'),
            h('ul', {}, s.devices.filter((d) => String(d.circuit_id) === String(c.id)).map((d) => h('li', { class: 'small' }, d.name, d.status === 'planned' ? ' (추가 예정)' : ''))))),
          h('li', {}, h('button', { class: 'sm', onclick: () => circuitEditor({ panel_id: p.id }) }, '+ 회로'))))));
    }) : h('p', { class: 'muted' }, '분전반을 추가하거나 주차단기 사진을 분석해 반영하세요.'),
    s.devices.some((d) => !d.circuit_id) ? h('div', { class: 'card' }, h('b', {}, '미확인 회로 기기'), h('div', { class: 'small' }, s.devices.filter((d) => !d.circuit_id).map((d) => d.name).join(', ')), h('div', { class: 'hint' }, '기기 탭에서 연결 회로를 지정하세요.')) : null,
  );
};

// ---- 고지서
function billEditor(s, b = {}) {
  const f = form([{ k: 'period_start', l: '사용기간 시작', type: 'date' }, { k: 'period_end', l: '사용기간 끝', type: 'date' }, { k: 'contract_kind', l: '계약종별' }, { k: 'contract_kw', l: '계약전력(kW)', type: 'number' },
    { k: 'usage_kwh', l: '사용량(kWh)', type: 'number', hint: '월 사용량. 순간 전력(kW)이 아님' }, { k: 'max_demand_kw', l: '최대수요전력(kW)', type: 'number', hint: '고지서에 표시된 경우만' },
    { k: 'base_charge', l: '기본요금(원)', type: 'number' }, { k: 'energy_charge', l: '전력량요금(원)', type: 'number' }, { k: 'total_charge', l: '청구금액(원)', type: 'number' }, { k: 'other', l: '기타 요금 항목', wide: 1 }, { k: 'confirmed', l: '내용 확인함(계산 반영)', type: 'check' }], b);
  modal(h('h2', {}, b.id ? '고지서 수정' : '고지서 직접 입력'), b.file_id && h('div', { class: 'photo' }, h('img', { src: img(b.file_id, 1000) })), f,
    h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'pri', onclick: guard(async () => { const v = f.value();
      if (b.id) await api('PUT', `/api/sites/${sid()}/bills/${b.id}`, v); else await api('POST', `/api/sites/${sid()}/bills`, { ...v, file_id: b.file_id }); closeModal(); reload(); }) }, '저장'),
    b.id && h('button', { class: 'dan', onclick: guard(async () => { await api('DELETE', `/api/sites/${sid()}/bills/${b.id}`); closeModal(); reload(); }) }, '삭제')));
}
VIEWS.bills = async (el, s) => {
  const c = await api('GET', `/api/sites/${sid()}/result`);
  const bills = [...s.bills].sort((a, b) => String(a.period_end).localeCompare(String(b.period_end)));
  el.replaceChildren(
    h('div', { class: 'row' }, photoBtns('bill', (f) => analyze(f, 'bill'), { label: '고지서 촬영', cls: 'acc', accept: 'image/*,application/pdf' }),
      h('button', { onclick: () => billEditor(s) }, '직접 입력')),
    h('p', { class: 'hint' }, '추출값은 원문 위치와 함께 보여주며, 확인한 값만 계산에 반영합니다. 월 사용량(kWh)은 최대수요전력(kW)으로 쓰지 않습니다. 최근 12개월을 등록하면 계절별 비교가 됩니다.'),
    h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['기간', '계약전력', '사용량', '최대수요', '청구액', '상태', ''].map((t) => h('th', {}, t))),
      bills.map((b) => h('tr', {}, h('td', { class: 'small' }, `${b.period_start || ''} ~ ${b.period_end || ''}`), h('td', {}, fmt(b.contract_kw, 'kW')), h('td', {}, fmt(b.usage_kwh, 'kWh')), h('td', {}, fmt(b.max_demand_kw, 'kW')),
        h('td', {}, won(b.total_charge)), h('td', {}, b.confirmed ? badge('ok', '확인') : badge('hold', '미확인')), h('td', {}, h('button', { class: 'sm', onclick: () => billEditor(s, b) }, '수정')))))),
    h('h2', {}, '계절별 비교'),
    c.seasonal.count ? h('div', { class: 'kpis' }, Object.entries(c.seasonal.groups).map(([k, g]) => kpi(k, `${fmt(Math.round(g.kwh / g.months))} kWh/월`, `${g.months}개월 · 평균 ${won(Math.round(g.charge / g.months))}${g.maxDemand != null ? ' · 최대수요 ' + g.maxDemand + 'kW' : ''}`))) : h('p', { class: 'muted' }, '확인된 고지서가 없습니다.'),
    c.seasonal.note && h('p', { class: 'warnbox' }, c.seasonal.note),
  );
};

// ---- 실측(전문가 모드)
VIEWS.measure = async (el, s) => {
  const fields = [{ k: 'measured_at', l: '계측 일시', type: 'datetime-local' }, { k: 'period_days', l: '측정기간(일)', type: 'number' }, { k: 'peak_season', l: '냉난방 성수기 측정', type: 'check' },
    { k: 'peak_kw', l: '측정 최대전력(kW)', type: 'number' }, { k: 'pf', l: '역률', type: 'number' },
    { k: 'v.L1', l: '전압 L1(V)', type: 'number' }, { k: 'v.L2', l: '전압 L2(V)', type: 'number' }, { k: 'v.L3', l: '전압 L3(V)', type: 'number' },
    { k: 'a.L1', l: '전류 L1(A)', type: 'number' }, { k: 'a.L2', l: '전류 L2(A)', type: 'number' }, { k: 'a.L3', l: '전류 L3(A)', type: 'number' },
    { k: 'running', l: '계측 당시 운전기기', wide: 1 }, { k: 'insulation', l: '절연저항 측정 결과', wide: 1 }, { k: 'ground', l: '접지저항 측정 결과', wide: 1 },
    { k: 'measured_by', l: '측정자' }, { k: 'instrument', l: '계측기' }, { k: 'note', l: '메모', type: 'textarea', wide: 1 }];
  const f = form(fields, {});
  el.replaceChildren(
    h('div', { class: 'notice' }, '전문가 모드: 계측값을 수동으로 입력합니다(계측기 실시간 연동 기능은 없습니다). 측정기간이 짧거나 비수기 측정이면 연중 최대부하로 보지 않습니다.'),
    h('div', { class: 'card' }, f, h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'pri', onclick: guard(async () => { await api('POST', `/api/sites/${sid()}/measurements`, f.value()); toast('저장됨'); reload(); }) }, '계측값 저장'))),
    h('h2', {}, '기록된 계측'),
    s.measurements.length ? h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['일시', '기간', '최대kW', '상별 전류', '측정자', ''].map((t) => h('th', {}, t))),
      s.measurements.map((m) => h('tr', {}, h('td', { class: 'small' }, m.measured_at || m.note || ''), h('td', {}, fmt(m.period_days, '일')), h('td', {}, fmt(m.peak_kw)), h('td', { class: 'small' }, m.a ? `${fmt(m.a.L1)} / ${fmt(m.a.L2)} / ${fmt(m.a.L3)}` : '—'),
        h('td', {}, m.measured_by || '—'), h('td', {}, h('button', { class: 'sm dan', onclick: guard(async () => { await api('DELETE', `/api/sites/${sid()}/measurements/${m.id}`); reload(); }) }, '삭제')))))) : h('p', { class: 'muted' }, '없음'),
    h('p', { class: 'hint' }, '전선 종류·굵기·길이·포설 조건과 차단기 설정값은 분전반 탭의 각 회로에서 입력합니다. 허용전류·전압강하 판정은 관리자가 등록한 기준표의 조건과 일치할 때만 합니다.'),
  );
};

// ---- 견적·비용
VIEWS.quote = async (el, s) => {
  const c = await api('GET', `/api/sites/${sid()}/result`);
  const prices = await api('GET', '/api/master/unit_prices');
  const codes = [...new Map(prices.map((p) => [p.code, p])).values()];
  let items = (c.quoteRow?.items || []).map((x) => ({ ...x }));
  const itemsBox = h('div');
  const drawItems = () => itemsBox.replaceChildren(h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['공사항목', '단위', '수량 최소', '수량 최대', ''].map((t) => h('th', {}, t))),
    items.map((it, i) => h('tr', {}, h('td', {}, it.name, h('div', { class: 'hint' }, it.code)), h('td', {}, it.unit || ''),
      h('td', {}, h('input', { value: it.qty_min ?? '', inputmode: 'decimal', onchange: (e) => { it.qty_min = Number(e.target.value) || 0; } })),
      h('td', {}, h('input', { value: it.qty_max ?? '', inputmode: 'decimal', onchange: (e) => { it.qty_max = Number(e.target.value) || 0; } })),
      h('td', {}, h('button', { class: 'sm dan', onclick: () => { items.splice(i, 1); drawItems(); } }, '×')))))));
  drawItems();
  const sel = h('select', {}, h('option', { value: '' }, codes.length ? '등록 단가에서 항목 선택' : '등록된 단가 없음(관리자·업체 단가 등록 필요)'), codes.map((p) => h('option', { value: p.code }, `${p.name} (${p.code})`)));
  const custom = form([{ k: 'name', l: '직접 항목명' }, { k: 'code', l: '항목 코드', hint: '단가표의 코드와 같아야 계산됨' }, { k: 'unit', l: '단위' }]);
  const kf = form([{ k: 'app_type', l: '신청 유형', type: 'select', opts: [['', '선택 안 함'], ['new', '신규'], ['increase', '증설'], ['change', '공급방식 변경']] },
    { k: 'kw_after', l: '변경 계약전력(kW)', type: 'number' }, { k: 'voltage_class', l: '공급전압 구분', ph: '요율표 표기와 동일하게(예: 저압)' },
    { k: 'method', l: '공급 방식', type: 'select', opts: [['', '모름'], ['overhead', '공중(가공)'], ['underground', '지중']] }, { k: 'distance_m', l: '거리(m)', type: 'number' },
    { k: 'use_existing', l: '기존 설비 활용', type: 'check' }, { k: 'special_negotiation', l: '별도 협의 대상', type: 'check' }, { k: 'apply_date', l: '신청 예정일', type: 'date' }, { k: 'region', l: '공사 지역(단가 선택)' }], c.quoteRow?.kepco_req || {});
  const tf = form([{ k: 'applied_kw_now', l: '현재 요금적용전력(kW)', type: 'number', hint: '고지서 표기. 계약전력과 다를 수 있음' }, { k: 'applied_kw_after', l: '변경 후 요금적용전력(kW)', type: 'number' }], c.quoteRow?.tariff_req || {});
  const save = async (confirmed = false) => { await api('PUT', `/api/sites/${sid()}/quote`, { items, kepco_req: kf.value(), tariff_req: tf.value(), confirmed }); toast('저장·재계산'); reload(); };
  const q = c.quote;
  el.replaceChildren(
    h('h2', {}, '전기공사비 항목'),
    h('p', { class: 'hint' }, '각 항목은 수량 × 등록 단가(재료비·노무비·경비)로 계산합니다. 사진만으로 케이블 길이·은폐 구간을 확정하지 않으므로 수량은 범위로 입력하세요.'),
    itemsBox,
    h('div', { class: 'row', style: 'margin-top:8px' }, sel, h('button', { onclick: () => { const p = codes.find((x) => x.code === sel.value); if (p) { items.push({ code: p.code, name: p.name, unit: p.unit, qty_min: 1, qty_max: 1 }); drawItems(); } } }, '항목 추가')),
    h('details', {}, h('summary', {}, '단가표에 없는 항목 추가'), custom, h('button', { class: 'sm', onclick: guard(() => { const v = custom.value(); if (!v.name) throw new Error('항목명'); items.push({ ...v, code: v.code || v.name, qty_min: 1, qty_max: 1 }); drawItems(); }) }, '추가')),
    h('h2', {}, '한전 신청 조건(공사비와 별도)'),
    s.info.supply_type === 'building_managed' ? h('p', { class: 'warnbox' }, '건물 관리비 납부 장소입니다. 한전 납부금 대신 건물 관리주체의 배정용량·분담 기준을 확인하세요.') : h('div', { class: 'card' }, kf),
    h('h2', {}, '전기요금 비교 조건'), h('div', { class: 'card' }, tf),
    h('div', { class: 'row', style: 'margin:12px 0' }, h('button', { class: 'pri', onclick: guard(() => save(false)) }, '저장하고 계산'),
      ['contractor', 'admin'].includes(ME.role) && h('button', { class: 'acc', onclick: guard(() => save(true)) }, '업체 확정 견적으로 저장')),
    h('h2', {}, '계산 결과'),
    h('div', { class: 'card' }, h('b', {}, '견적 상태: '), badge(q.status === '정보 부족' ? 'hold' : 'ok', q.status),
      q.totals ? h('div', { class: 'kpis', style: 'margin-top:8px' }, kpi('재료비', `${won(q.totals.material[0])} ~ ${won(q.totals.material[1])}`), kpi('노무비', `${won(q.totals.labor[0])} ~ ${won(q.totals.labor[1])}`),
        kpi('경비', `${won(q.totals.expense[0])} ~ ${won(q.totals.expense[1])}`), kpi('부가세', `${won(q.totals.vat[0])} ~ ${won(q.totals.vat[1])}`), kpi('합계', `${won(q.totals.total[0])} ~ ${won(q.totals.total[1])}`)) : null,
      q.unresolved.length ? h('div', { class: 'warnbox', style: 'margin-top:8px' }, '제외(단가 없음·만료): ', q.unresolved.join(' / ')) : null),
    h('div', { class: 'card' }, h('b', {}, '한전 예상 납부금'), !c.kepco ? h('p', { class: 'muted' }, '신청 조건을 입력하면 등록된 공식 요율로 계산합니다. 요율이 없으면 "한전 확인 필요"로 표시합니다.') :
      [h('div', { class: 'small muted' }, c.kepco.state), c.kepco.items.map((i) => h('div', { class: 'row small' }, h('b', {}, i.label), i.status === 'estimated' ? `${i.qty} × ${won(i.unit_price)} = ${won(i.total)} (요율 ${i.version || ''}, ${i.valid_from || ''}~${i.valid_to || ''})` : badge('hold', '한전 확인 필요'), i.reason || '')),
        c.kepco.subtotal != null && h('div', {}, '예상 합계(확정 항목만) ', h('b', {}, won(c.kepco.subtotal)), ` · 미확정 ${c.kepco.unresolved}건`)]),
    h('div', { class: 'card' }, h('b', {}, '전기요금 변화'), c.tariff.status === 'ok' ? h('div', {}, `현재 ${won(c.tariff.now.subtotal)} → 변경 후 ${won(c.tariff.after.subtotal)} (월 ${won(c.tariff.monthlyDiff)})`, c.tariff.paybackMonths ? ` · 회수기간 약 ${c.tariff.paybackMonths}개월` : '', h('div', { class: 'hint' }, c.tariff.now.note, c.tariff.note || '')) : h('p', { class: 'muted' }, c.tariff.msg),
      h('div', { class: 'hint' }, `월 사용량 추정(기기 입력 기준): 현재 ${fmt(c.tariff.kwhNow)}kWh → 추가 후 ${fmt(c.tariff.kwhAfter)}kWh. ${c.tariff.appliedAssumed || ''}`)),
  );
};

// ---- 보고서
VIEWS.reports = async (el, s) => {
  const op = h('textarea', { placeholder: '사진 추출값·계산 조건 검토 의견' });
  el.replaceChildren(
    h('div', { class: 'row' }, h('button', { class: 'pri', onclick: guard(async () => { await api('POST', `/api/sites/${sid()}/reports`, { kind: 'basic' }); toast('보고서 저장됨'); reload(); }) }, '기본 보고서 저장(무료)'),
      h('button', { class: 'acc', disabled: !ME.entitled, onclick: guard(async () => { await api('POST', `/api/sites/${sid()}/reports`, { kind: 'detail' }); toast('상세 보고서 저장됨'); reload(); }) }, '상세 보고서(사진·추출값·Excel)')),
    !ME.entitled && h('p', { class: 'hint' }, '상세 보고서는 이용권이 필요합니다. ' + (CFG.payments || '')),
    h('p', { class: 'hint' }, '보고서는 저장 당시의 입력값·계산 결과·규칙 버전을 그대로 보존합니다. 이후 값을 바꿔도 이전 보고서는 그대로 재현됩니다.'),
    h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['번호', '종류', '작성일', ''].map((t) => h('th', {}, t))),
      s.reports.map((r) => h('tr', {}, h('td', {}, r.id), h('td', {}, r.kind === 'detail' ? '상세' : '기본'), h('td', { class: 'small' }, r.created_at),
        h('td', {}, h('div', { class: 'row' }, h('a', { class: 'btn sm', href: `/api/reports/${r.id}/pdf`, target: '_blank' }, 'PDF'),
          (r.kind === 'detail' || ME.entitled) && h('a', { class: 'btn sm', href: `/api/reports/${r.id}/xlsx` }, 'Excel'),
          h('button', { class: 'sm', onclick: guard(async () => { const x = await api('POST', `/api/reports/${r.id}/share`, { days: 7 }); const url = location.origin + x.url;
            try { await navigator.clipboard.writeText(url); toast('7일간 유효한 공유 링크를 복사했습니다'); } catch { prompt('공유 링크(7일)', url); } }) }, '공유 링크'))))))),
    h('h2', {}, '검토 의견'),
    s.reviews.map((r) => h('div', { class: 'card small' }, h('b', {}, `${r.name || ''} (${ROLE[r.role] || ''})`), ' ', h('span', { class: 'muted' }, r.created_at), h('div', {}, r.opinion))),
    ['reviewer', 'contractor', 'admin'].includes(ME.role) ? h('div', { class: 'card' }, op, h('button', { class: 'sm', style: 'margin-top:6px', onclick: guard(async () => { await api('POST', `/api/sites/${sid()}/reviews`, { opinion: op.value }); reload(); }) }, '의견 기록')) : null,
  );
};

// ---- 기록·공유·상담
VIEWS.records = async (el, s) => {
  const c = await api('GET', `/api/sites/${sid()}/result`);
  const companies = await api('GET', '/api/companies');
  const actual = s.records.filter((r) => r.kind === 'actual_cost').reduce((a, r) => a + (r.amount || 0), 0);
  const cf = form([{ k: 'company_id', l: '상담 업체', type: 'select', opts: [['', '운영자에게 문의'], ...companies.map((x) => [x.id, x.name])] }, { k: 'phone', l: '연락처' }, { k: 'message', l: '요청 내용', type: 'textarea', wide: 1 }]);
  const shareSel = h('select', {}, companies.map((x) => h('option', { value: x.id }, x.name)));
  const costIn = h('input', { inputmode: 'numeric', placeholder: '실제 공사비(원)' }); const noteIn = h('input', { placeholder: '메모' });
  const rec = (kind, label) => photoBtns(kind, async (f) => { await api('POST', `/api/sites/${sid()}/records`, { kind, file_id: f.id }); reload(); }, { label });
  el.replaceChildren(
    h('h2', {}, '현장 방문 상담 요청'), h('div', { class: 'card' }, cf, h('button', { class: 'pri', style: 'margin-top:8px', onclick: guard(async () => { const v = cf.value(); await api('POST', `/api/sites/${sid()}/consults`, v); toast('상담 요청이 접수되었습니다'); reload(); }) }, '상담 요청')),
    s.consults.map((x) => h('div', { class: 'small' }, `${x.created_at} · ${x.status} · ${x.message}`)),
    s.mine && [h('h2', {}, '업체에 자료 공유(고객 동의)'), h('div', { class: 'card' }, h('p', { class: 'small' }, '선택한 업체가 이 장소의 기기·사진·결과를 볼 수 있습니다. 언제든 철회할 수 있습니다.'),
      h('div', { class: 'row' }, shareSel, h('button', { onclick: guard(async () => { if (!shareSel.value) return; await api('POST', `/api/sites/${sid()}/shares`, { company_id: Number(shareSel.value) }); reload(); }) }, '동의하고 공유')),
      s.shares.map((x) => h('div', { class: 'row small' }, `${x.company} · ${x.consent_at}`, x.revoked_at ? h('span', { class: 'badge' }, '철회됨') : h('button', { class: 'sm dan', onclick: guard(async () => { await api('DELETE', `/api/sites/${sid()}/shares/${x.id}`); reload(); }) }, '철회'))))],
    h('h2', {}, '공사 전후 사진·실제 비용'),
    h('div', { class: 'row' }, h('b', { class: 'small' }, '공사 전'), rec('before', '촬영')), h('div', { class: 'row', style: 'margin-top:6px' }, h('b', { class: 'small' }, '공사 후'), rec('after', '촬영')),
    h('div', { class: 'thumbs', style: 'margin:8px 0' }, s.records.filter((r) => r.file_id).map((r) => h('div', {}, h('img', { src: img(r.file_id, 200) }), h('div', { class: 'hint' }, r.kind === 'before' ? '공사 전' : '공사 후')))),
    h('div', { class: 'row' }, costIn, noteIn, h('button', { onclick: guard(async () => { await api('POST', `/api/sites/${sid()}/records`, { kind: 'actual_cost', amount: Number(costIn.value.replace(/,/g, '')), note: noteIn.value }); reload(); }) }, '실제 비용 기록')),
    actual ? h('div', { class: 'card' }, h('b', {}, '실제 비용과 개략 견적 차이'), h('div', {}, `실제 ${won(actual)} / 견적 ${c.quote.totals ? won(c.quote.totals.total[0]) + ' ~ ' + won(c.quote.totals.total[1]) : '없음'}`),
      c.quote.totals && h('div', {}, actual < c.quote.totals.total[0] ? `견적 하한보다 ${won(c.quote.totals.total[0] - actual)} 적음` : actual > c.quote.totals.total[1] ? `견적 상한보다 ${won(actual - c.quote.totals.total[1])} 많음` : '견적 범위 안')) : null,
    h('h2', {}, '변경 기록'), h('div', { id: 'audit' }, h('button', { class: 'sm', onclick: guard(async () => {
      const rows = await api('GET', `/api/sites/${sid()}/audit`);
      $('#audit').replaceChildren(h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['일시', '사용자', '대상', '작업'].map((t) => h('th', {}, t))), rows.map((a) => h('tr', {}, h('td', { class: 'small' }, a.at), h('td', {}, a.name || ''), h('td', {}, `${a.entity} ${a.entity_id ?? ''}`), h('td', {}, a.action))))));
    }) }, '분석·수정·견적 변경 기록 보기')),
  );
};

// ---------- 무료 간편 계산 ----------
route(/^\/quick$/, () => {
  const sf = form([{ k: 'phase', l: '공급 방식', type: 'select', opts: [['1', '단상'], ['3', '삼상']] }, { k: 'v_phase', l: '상전압(V)', type: 'number' }, { k: 'v_line', l: '선간전압(V)', type: 'number' },
    { k: 'contract_kw', l: '계약전력(kW)', type: 'number' }, { k: 'main_at', l: '주차단기 정격 AT(A)', type: 'number' }], { phase: '1', v_phase: 220, v_line: 380 });
  const devs = [{ name: '', power_value: null, qty: 1, status: 'current' }];
  const list = h('div'); const out = h('div');
  const draw = () => list.replaceChildren(...devs.map((d, i) => h('div', { class: 'row', style: 'margin:4px 0' },
    h('input', { placeholder: '기기명', value: d.name, oninput: (e) => { d.name = e.target.value; }, style: 'flex:2' }),
    h('input', { placeholder: '소비전력 W', inputmode: 'decimal', value: d.power_value ?? '', oninput: (e) => { d.power_value = e.target.value ? Number(e.target.value) : null; }, style: 'flex:1' }),
    h('input', { placeholder: '수량', inputmode: 'numeric', value: d.qty, oninput: (e) => { d.qty = Number(e.target.value) || 1; }, style: 'width:70px' }),
    h('select', { onchange: (e) => { d.status = e.target.value; }, style: 'width:120px' }, h('option', { value: 'current', selected: d.status === 'current' }, '현재'), h('option', { value: 'planned', selected: d.status === 'planned' }, '추가 예정')),
    h('button', { class: 'sm', onclick: () => { devs.splice(i, 1); draw(); } }, '×'))));
  draw();
  app.replaceChildren(h('h1', {}, '무료 간편 계산'), h('p', { class: 'muted' }, '저장되지 않습니다. 회로별 검토·사진 분석·견적·보고서는 회원 저장 기능을 이용하세요.'),
    h('div', { class: 'card' }, sf), h('div', { class: 'card' }, h('b', {}, '기기(명판의 소비전력 W)'), list, h('button', { class: 'sm', onclick: () => { devs.push({ name: '', qty: 1, status: 'current' }); draw(); } }, '+ 기기')),
    h('button', { class: 'acc', onclick: guard(async () => {
      const s = sf.value(); const panels = s.main_at ? [{ id: 'm', name: '주분전반', main_breaker: { at: s.main_at } }] : [];
      const { result: r } = await api('POST', '/api/quick', { site: s, devices: devs.filter((d) => d.name || d.power_value).map((d, i) => ({ ...d, id: i, power_unit: 'W', conn_phase: s.phase === '3' ? null : 'L1' })), panels });
      out.replaceChildren(h('div', { class: 'verdict ' + (r.verdict.includes('여유') ? 'v-ok' : r.verdict.includes('보류') ? 'v-hold' : 'v-warn'), style: 'margin-top:12px' }, h('b', {}, r.verdict)),
        h('div', { class: 'kpis', style: 'margin-top:8px' }, Object.values(r.scenarios).slice(0, 4).map((x) => kpi(x.label, fmt(x.kw, ' kW'))), kpi('기술적 검토값', fmt(r.contract.technicalKw, ' kW'), r.contract.officialNote)),
        r.main.map((m) => h('p', {}, '주차단기: ', badge(m.status), ' ', m.msg)), r.missing.length ? h('p', { class: 'warnbox' }, '부족한 정보: ' + r.missing.join(', ')) : null,
        r.devices.filter((d) => d.warnings.length).map((d) => h('p', { class: 'hint' }, `${d.name}: ${d.warnings.join(' / ')}`)),
        h('p', { class: 'hint' }, '입력 조건 기반 검토값이며, 분기회로·배선 상태는 반영되지 않았습니다.'));
    }) }, '계산'), out);
});

// ---------- 업체 ----------
route(/^\/company$/, async () => {
  const { company: co, members } = await api('GET', '/api/company');
  const consults = await api('GET', '/api/consults');
  const f = form([{ k: 'name', l: '업체명' }, { k: 'phone', l: '연락처' }, { k: 'address', l: '주소', wide: 1 }, { k: 'biz_no', l: '사업자등록번호' }, { k: 'quote_valid_days', l: '견적 유효기간(일)', type: 'number' }], co);
  const mf = form([{ k: 'name', l: '이름' }, { k: 'email', l: '이메일' }, { k: 'pw', l: '초기 비밀번호', type: 'password' }, { k: 'role', l: '역할', type: 'select', opts: [['reviewer', '검토 담당자'], ['contractor', '업체 직원']] }]);
  const own = ME.role === 'contractor';
  app.replaceChildren(h('h1', {}, '업체 설정'),
    h('div', { class: 'card' }, co.logo_file && h('img', { src: `/api/files/${co.logo_file}?w=300`, style: 'height:48px' }), f,
      own && h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'pri', onclick: guard(async () => { await api('PUT', '/api/company', f.value()); toast('저장됨'); }) }, '저장'),
        h('button', { onclick: guard(async () => { const file = await pickFile({ capture: false }); if (!file) return; const fd = new FormData(); fd.append('file', file); await api('POST', '/api/company/logo', fd); render(); }) }, '로고 올리기'))),
    h('p', { class: 'hint' }, `이용권: ${co.plan_until ? co.plan_until + '까지' : '없음'} · ${CFG.payments || ''}`),
    h('h2', {}, '구성원'), h('div', {}, members.map((m) => h('div', { class: 'small' }, `${m.name || ''} ${m.email} · ${ROLE[m.role]}`))),
    own && h('div', { class: 'card' }, mf, h('button', { class: 'sm', style: 'margin-top:8px', onclick: guard(async () => { await api('POST', '/api/company/members', mf.value()); render(); }) }, '구성원 추가')),
    h('h2', {}, '자사 단가'), masterEditor('unit_prices', PRICE_FIELDS, own),
    h('h2', {}, '상담 요청'), consults.length ? h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['일시', '장소', '연락처', '내용', '상태'].map((t) => h('th', {}, t))),
      consults.map((x) => h('tr', {}, h('td', { class: 'small' }, x.created_at), h('td', {}, x.site_id ? h('a', { href: `#/site/${x.site_id}/result` }, x.site) : ''), h('td', {}, x.phone), h('td', {}, x.message),
        h('td', {}, h('select', { onchange: guard(async (e) => { await api('PUT', `/api/consults/${x.id}`, { status: e.target.value }); toast('변경됨'); }) }, ['접수', '연락함', '방문 예정', '완료'].map((v) => h('option', { selected: x.status === v }, v)))))))) : h('p', { class: 'muted' }, '없음'));
});

// ---------- 관리자 ----------
const PRICE_FIELDS = [{ k: 'code', l: '항목 코드' }, { k: 'name', l: '공사항목' }, { k: 'spec', l: '규격' }, { k: 'unit', l: '단위' }, { k: 'material', l: '재료비 단가', type: 'number' }, { k: 'labor', l: '노무비 단가', type: 'number' },
  { k: 'expense', l: '경비 단가', type: 'number' }, { k: 'region', l: '지역' }, { k: 'base_date', l: '기준일', type: 'date' }, { k: 'valid_to', l: '적용 종료일', type: 'date' }, { k: 'source', l: '출처', wide: 1 }];
const MASTER_FIELDS = {
  rates_kepco: [{ k: 'version', l: '요율 버전' }, { k: 'item', l: '항목', type: 'select', opts: [['basic', '기본시설부담금'], ['distance', '거리시설부담금'], ['other', '기타']] }, { k: 'name', l: '항목명' },
    { k: 'app_types', l: '신청 유형(쉼표: new,increase,change)' }, { k: 'voltage_class', l: '공급전압 구분' }, { k: 'method', l: '공급방식', type: 'select', opts: [['', '공통'], ['overhead', '공중'], ['underground', '지중']] },
    { k: 'unit', l: '단위', type: 'select', opts: [['per_kw', 'kW당'], ['per_m', 'm당'], ['fixed', '정액']] }, { k: 'unit_price', l: '단가(원)', type: 'number' }, { k: 'free_qty', l: '무상 기준량(kW 또는 m)', type: 'number' },
    { k: 'taxable', l: '과세', type: 'check' }, { k: 'valid_from', l: '적용 시작일', type: 'date' }, { k: 'valid_to', l: '적용 종료일', type: 'date' }, { k: 'source_url', l: '공식 출처 URL', wide: 1 },
    { k: 'doc', l: '근거 문서(약관 조항 등)', wide: 1 }, { k: 'conditions', l: '적용 조건·예외', type: 'textarea', wide: 1 }, { k: 'reviewed_by', l: '검토자' }, { k: 'reviewed_at', l: '검토일', type: 'date' }],
  rates_tariff: [{ k: 'version', l: '요금 규칙 버전' }, { k: 'contract_kind', l: '계약종별(장소 정보와 동일 표기)' }, { k: 'basic_per_kw', l: '기본요금(원/kW)', type: 'number' }, { k: 'energy_per_kwh', l: '전력량요금(원/kWh)', type: 'number' },
    { k: 'season', l: '계절·시간대 조건' }, { k: 'valid_from', l: '적용 시작일', type: 'date' }, { k: 'valid_to', l: '적용 종료일', type: 'date' }, { k: 'source_url', l: '출처 URL', wide: 1 }, { k: 'reviewed_by', l: '검토자' }],
  standards: [{ k: 'kind', l: '구분', type: 'select', opts: [['ampacity', '허용전류표 항목'], ['limit', '판정 기준값']] }, { k: 'standard', l: '기준 명칭' }, { k: 'version', l: '버전' },
    { k: 'material', l: '[허용전류] 도체(Cu/Al)' }, { k: 'insulation', l: '[허용전류] 전선 종류' }, { k: 'size_mm2', l: '[허용전류] 단면적', type: 'number' }, { k: 'method', l: '[허용전류] 포설 방법' },
    { k: 'ambient_c', l: '[허용전류] 주위온도', type: 'number' }, { k: 'grouping', l: '[허용전류] 집합 회로수', type: 'number' }, { k: 'ampacity_a', l: '[허용전류] 허용전류(A)', type: 'number' },
    { k: 'key', l: '[기준값] 키', type: 'select', opts: [['', '-'], ['vdrop_limit_pct', '전압강하 한도(%)'], ['unbalance_limit_pct', '설비 불평형률 한도(%)']] }, { k: 'value', l: '[기준값] 값', type: 'number' }, { k: 'conditions', l: '적용 조건', wide: 1 }],
  device_refs: [{ k: 'name', l: '기기 종류' }, { k: 'power_w', l: '참고 소비전력(W)', type: 'number' }, { k: 'source', l: '출처(필수)', wide: 1 }, { k: 'note', l: '비고', wide: 1 }],
  unit_prices: PRICE_FIELDS,
};
function masterEditor(table, fields, writable = true) {
  const box = h('div');
  const load = guard(async () => {
    const rows = await api('GET', `/api/master/${table}`);
    const cols = fields.filter((f) => !f.section).slice(0, 6);
    const edit = (row = {}) => { const f = form(fields, { ...row, app_types: Array.isArray(row.app_types) ? row.app_types.join(',') : row.app_types });
      modal(h('h2', {}, row.id ? '수정' : '추가'), f, h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'pri', onclick: guard(async () => {
        const v = f.value(); if (typeof v.app_types === 'string') v.app_types = v.app_types ? v.app_types.split(',').map((x) => x.trim()).filter(Boolean) : [];
        if (table === 'device_refs' && !v.source) throw new Error('참고값은 출처가 있어야 합니다.');
        if (row.id) await api('PUT', `/api/master/${table}/${row.id}`, v); else await api('POST', `/api/master/${table}`, v); closeModal(); load(); }) }, '저장'),
        row.id && h('button', { class: 'dan', onclick: guard(async () => { await api('DELETE', `/api/master/${table}/${row.id}`); closeModal(); load(); }) }, '삭제'))); };
    box.replaceChildren(writable && h('button', { class: 'sm acc', onclick: () => edit() }, '+ 추가'),
      h('div', { class: 'tw', style: 'margin-top:6px' }, h('table', {}, h('tr', {}, cols.map((c) => h('th', {}, c.l)), h('th', {}, '')),
        rows.map((r) => h('tr', {}, cols.map((c) => h('td', { class: 'small' }, fmt(getPath(r, c.k) === true ? '예' : getPath(r, c.k)))), h('td', {}, writable && (ME.role === 'admin' || r.company_id) && h('button', { class: 'sm', onclick: () => edit(r) }, '수정')))))),
      !rows.length && h('p', { class: 'muted small' }, '등록된 항목이 없습니다. 미등록 항목은 계산에서 "확인 필요/보류"로 표시됩니다.'));
  });
  load(); return box;
}
route(/^\/admin(?:\/(\w+))?$/, async (tab = 'settings') => {
  if (ME?.role !== 'admin') { app.replaceChildren(h('p', {}, '관리자만 접근할 수 있습니다.')); return; }
  const T = [['settings', '서비스 설정'], ['rates_kepco', '한전 요율'], ['rates_tariff', '요금 규칙'], ['unit_prices', '공사 단가'], ['standards', '적용 기준'], ['device_refs', '기기 참고값'], ['users', '사용자·이용권'], ['audit', '변경 이력']];
  const body = h('div');
  app.replaceChildren(h('h1', {}, '관리자'), h('nav', { class: 'tabs' }, T.map(([k, l]) => h('a', { href: `#/admin/${k}`, class: k === tab ? 'on' : '' }, l))), body);
  if (tab === 'settings') {
    const st = await api('GET', '/api/admin/settings');
    const f = form([{ k: 'service_name', l: '서비스명' }, { k: 'vat_rate', l: '부가세율', type: 'number' }, { k: 'operator.name', l: '운영업체명' }, { k: 'operator.biz_no', l: '사업자등록번호' },
      { k: 'operator.phone', l: '연락처' }, { k: 'operator.email', l: '이메일' }, { k: 'operator.address', l: '주소', wide: 1 }, { k: 'payments_note', l: '이용권·결제 안내 문구', wide: 1 }], st);
    body.replaceChildren(h('div', { class: 'card' }, f, h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'pri', onclick: guard(async () => { await api('PUT', '/api/admin/settings', f.value()); await loadMe(); toast('저장됨'); }) }, '저장'),
      h('button', { onclick: guard(async () => { const file = await pickFile({ capture: false }); if (!file) return; const fd = new FormData(); fd.append('file', file); await api('POST', '/api/admin/logo', fd); await loadMe(); toast('로고 변경됨'); }) }, '로고 변경'))),
    h('div', { class: 'card' }, h('b', {}, '외부 연동 상태'), h('div', {}, `사진 분석(AI): ${CFG.ai ? '설정됨' : '미설정 — ANTHROPIC_API_KEY 환경변수 필요'}`), h('div', {}, '한전 API 연동: 없음(수동 입력·고지서 업로드로 운영)'), h('div', {}, '결제: 미연동(관리자가 이용권 부여)'), h('div', {}, '계측기 연동: 없음')),
    h('a', { class: 'btn', href: '/api/admin/backup' }, 'DB 백업 내려받기'));
  } else if (tab === 'users') {
    const { users, companies } = await api('GET', '/api/admin/users');
    body.replaceChildren(h('h2', {}, '사용자'), h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['이메일', '역할', '업체', '이용권(까지)', ''].map((t) => h('th', {}, t))), users.map((u) => {
      const role = h('select', {}, Object.entries(ROLE).map(([k, l]) => h('option', { value: k, selected: u.role === k }, l)));
      const co = h('select', {}, h('option', { value: '' }, '없음'), companies.map((c) => h('option', { value: c.id, selected: u.company_id === c.id }, c.name)));
      const pl = h('input', { type: 'date', value: u.plan_until || '' });
      return h('tr', {}, h('td', { class: 'small' }, u.email, h('div', { class: 'hint' }, u.name || '')), h('td', {}, role), h('td', {}, co), h('td', {}, pl),
        h('td', {}, h('button', { class: 'sm', onclick: guard(async () => { await api('PUT', `/api/admin/users/${u.id}`, { role: role.value, company_id: co.value ? Number(co.value) : null, plan_until: pl.value || null }); toast('저장됨'); }) }, '저장')));
    }))), h('h2', {}, '업체 이용권'), h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['업체', '이용권(까지)', ''].map((t) => h('th', {}, t))), companies.map((c) => { const pl = h('input', { type: 'date', value: c.plan_until || '' });
      return h('tr', {}, h('td', {}, c.name), h('td', {}, pl), h('td', {}, h('button', { class: 'sm', onclick: guard(async () => { await api('PUT', `/api/admin/companies/${c.id}`, { plan_until: pl.value || null }); toast('저장됨'); }) }, '저장'))); }))));
  } else if (tab === 'audit') {
    const rows = await api('GET', '/api/admin/audit');
    body.replaceChildren(h('div', { class: 'tw' }, h('table', {}, h('tr', {}, ['일시', '사용자', '대상', '작업', '장소'].map((t) => h('th', {}, t))), rows.map((a) => h('tr', {}, h('td', { class: 'small' }, a.at), h('td', { class: 'small' }, a.email || ''), h('td', {}, `${a.entity} ${a.entity_id ?? ''}`), h('td', {}, a.action), h('td', {}, a.site_id ?? ''))))));
  } else {
    const notes = { rates_kepco: '공식 약관·단가표의 내용만 출처·적용기간과 함께 등록하세요. 유효한 요율이 없으면 계산 결과는 "한전 확인 필요"로 표시됩니다.',
      rates_tariff: '계약종별에 맞는 검증된 요금 규칙만 등록하세요. 없으면 요금 비교를 보류합니다.', unit_prices: '공통 단가(관리자)와 업체별 단가(업체 화면)가 함께 사용됩니다. 기준일·지역·출처를 남기세요.',
      standards: '허용전류는 기준표의 조건(도체·전선 종류·굵기·포설·온도·집합)과 정확히 일치할 때만 판정에 사용합니다. 기준 명칭·버전을 저장하세요.', device_refs: '대표 소비전력은 참고값으로만 표시되며 명판값·실측값이 우선합니다. 출처 없는 값은 등록하지 마세요.' };
    body.replaceChildren(h('p', { class: 'notice' }, notes[tab]), masterEditor(tab, MASTER_FIELDS[tab]));
  }
});

// ---------- 시작 ----------
async function loadMe() {
  CFG = await api('GET', '/api/config'); ME = (await api('GET', '/api/me')).user;
  $('#svcName').textContent = CFG.service_name; document.title = CFG.service_name;
  if (CFG.logo) { $('#logo').src = CFG.logo + '?t=' + Date.now(); $('#logo').hidden = false; $('.mark').hidden = true; }
  nav();
}
loadMe().then(render).catch((e) => { app.textContent = '서버에 연결할 수 없습니다: ' + e.message; });
