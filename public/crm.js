'use strict';
/* 고객관리 화면 — 계약·전자계약, 과금·수납, 상담·지원, 요금제
   app.js 의 공통 함수(shell, api, esc, won, badge, toast, formData …)를 쓴다. 이 파일은 app.js 보다 먼저 읽힌다. */

const CON_STATE = { DRAFT: ['작성중', ''], PENDING: ['서명대기', 'warn'], SIGNED: ['체결', 'ok'], EXPIRED: ['만료', 'seal'], TERMINATED: ['해지', 'seal'] };
const INV_TONE = { 완납: 'ok', 연체: 'seal', '연체(부분)': 'seal', 부분입금: 'warn', 청구: 'steel', 예정: '', 취소: '' };
const STAGE_TONE = { 운영중: 'ok', 계약: 'steel', '제안·견적': 'warn', 해지: 'seal' };
const won0 = (n) => Number(n || 0).toLocaleString('ko-KR');
let CFG = null;
const crmConfig = async () => (CFG ??= await api('/crm/config'));
const opt = (list, val) => list.map((o) => (Array.isArray(o) ? `<option value="${esc(o[0])}" ${o[0] === val ? 'selected' : ''}>${esc(o[1])}</option>` : `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`)).join('');
function addMonths(s, m) {
  const [y, mo, d] = s.split('-').map(Number);
  const x = new Date(Date.UTC(y, mo - 1 + m, 1));
  x.setUTCDate(Math.min(d, new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate()));
  return x.toISOString().slice(0, 10);
}

/** 대화상자 — onSubmit 이 끝나면 닫힌다 (오류면 열어 둔 채 알림) */
function dlg(title, body, { submit = '저장', danger = false, wide = false, onSubmit, extra = '' } = {}) {
  const back = document.createElement('div');
  back.className = 'dlg-back';
  back.innerHTML = `<form class="dlg${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}" novalidate>
    <header><h2>${title}</h2><button type="button" class="x" aria-label="닫기">×</button></header>
    <div class="body">${body}</div>
    <footer>${extra}<button type="button" class="btn" data-close>취소</button>${onSubmit ? `<button class="btn ${danger ? 'danger' : 'primary'}">${submit}</button>` : ''}</footer></form>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('.x').onclick = close;
  back.querySelector('[data-close]').onclick = close;
  back.onclick = (e) => { if (e.target === back) close(); };
  const form = back.querySelector('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('footer .primary, footer .danger');
    if (btn) btn.disabled = true;
    try { await onSubmit(formData(form), form); close(); } catch (err) { toast(err.message, 'error'); if (btn) btn.disabled = false; }
  };
  return { back, form, close };
}

// ── 대시보드 보조 패널 (pageHome 아래) ─────────────────────────────
async function crmHome() {
  const el = document.getElementById('crmhome');
  if (!el) return;
  const s = await api('/crm/summary');
  const max = Math.max(1, ...s.monthly.map((m) => m.paid));
  el.innerHTML = `
    <h2 class="sec-title">영업 · 과금</h2>
    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="stat"><div class="label">연간 반복매출 (체결 ${s.activeContracts}건)</div><div class="value" style="font-size:19px">${won(s.arr)}</div></div>
      <div class="stat"><div class="label">이번 달 청구 (${s.dueThisMonth.count}건, VAT 포함)</div><div class="value" style="font-size:19px">${won(s.dueThisMonth.total)}</div></div>
      <div class="stat"><div class="label">미수금</div><div class="value" style="font-size:19px">${won(s.receivable)}</div></div>
      <div class="stat ${s.overdue.count ? 'alert' : ''}"><div class="label">연체 (${s.overdue.count}건)</div><div class="value" style="font-size:19px">${won(s.overdue.total)}</div></div>
    </div>
    <div class="grid cols-2">
      <section class="panel"><header><h2>영업 단계</h2><span class="muted small">서명 대기 계약 ${s.pending}건</span></header><div class="body"><div class="pipe">${s.pipeline.map(([st, n]) => `<div><b class="num">${n}</b><span>${esc(st)}</span></div>`).join('')}</div></div></section>
      <section class="panel"><header><h2>월별 수납액</h2><span class="muted small">최근 12개월</span></header><div class="body">
        <div class="bars">${s.monthly.map((m, i) => `<div class="c" title="${m.month} ${won(m.paid)}"><div class="b${i === 11 ? ' cur' : ''}" style="height:${((m.paid / max) * 100).toFixed(1)}%"></div><span>${Number(m.month.slice(5))}</span></div>`).join('')}</div>
      </div></section>
      <section class="panel"><header><h2>계약 갱신 · 만료</h2><span class="muted small">90일 이내</span></header>
        ${s.renewals.length ? `<div class="table-wrap"><table><tbody>${s.renewals.map((k) => `<tr class="click" data-go="#/contracts/${k.id}"><td>${esc(k.customerName)}<div class="muted small">${esc(k.product)} · ${esc(k.no)}</div></td><td class="num">${esc(k.endsOn)}</td><td class="r">${k.daysLeft < 0 ? badge(['만료', 'seal']) : badge([`D-${k.daysLeft}`, k.daysLeft <= 30 ? 'warn' : 'steel'])}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">90일 안에 끝나는 계약이 없습니다</div>'}</section>
      <section class="panel"><header><h2>연체 청구</h2><a href="#/billing" class="small">과금 보기</a></header>
        ${s.overdue.list.length ? `<div class="table-wrap"><table><tbody>${s.overdue.list.map((i) => `<tr class="click" data-go="#/customers/${i.customerId}"><td>${esc(i.customerName)}<div class="muted small">${esc(i.period)}</div></td><td class="small">${i.overdueDays}일 경과${i.overdueDays >= s.lateDays ? ' ' + badge(['정지 검토', 'seal']) : ''}</td><td class="r num">${won(i.unpaid)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">연체된 청구가 없습니다</div>'}</section>
    </div>
    <section class="panel"><header><h2>제품별 체결 현황</h2></header><div class="table-wrap"><table><thead><tr><th>제품</th><th class="r">계약</th><th class="r">연 이용료</th></tr></thead><tbody>
      ${s.byProduct.map((p) => `<tr><td>${esc(p.product)}</td><td class="r num">${p.count}</td><td class="r num">${won(p.annual)}</td></tr>`).join('')}</tbody></table></div></section>
    ${s.openTickets.length ? `<section class="panel"><header><h2>처리할 상담·지원</h2><a href="#/support" class="small">전체</a></header><div class="table-wrap"><table><tbody>${s.openTickets.map((t) => `<tr><td>${esc(t.title)}<div class="muted small">${esc(t.customerName)} · ${esc(t.type)}</div></td><td class="num small">${t.dueOn ? '기한 ' + esc(t.dueOn) : ''}</td><td class="r">${badge([t.status, t.status === '처리중' ? 'warn' : 'steel'])}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
}

// ── 고객 상세 보조 패널 (pageCustomer 안) ──────────────────────────
async function crmCustomer(c) {
  const el = document.getElementById('crmcust');
  if (!el) return;
  const [cfg, cons, invs, tks, all] = await Promise.all([crmConfig(), api('/contracts?customerId=' + c.id), api('/invoices?customerId=' + c.id), api('/tickets?customerId=' + c.id), api('/crm/customers')]);
  const me = all.find((x) => x.id === c.id) ?? {};
  const rem = invs.reduce((a, i) => a + i.unpaid, 0);
  el.innerHTML = `
    <section class="panel"><header><h2>영업 정보</h2>${badge([me.stage, STAGE_TONE[me.stage] ?? ''])}</header>
      <form id="crmf" class="body"><div class="form-grid">
        <label class="f">영업 단계<select name="stage">${opt(cfg.lists.STAGES, me.stage)}</select></label>
        <label class="f">업종 (면허)<input name="industry" value="${esc(me.industry)}" placeholder="예: 전기, 정보통신" /></label>
        <label class="f">주소<input name="address" value="${esc(me.address)}" /><span class="hint">계약서 이용자 주소로 들어갑니다</span></label>
        <label class="f">유입 경로<select name="source">${opt(['', '홈페이지', '소개', '전화 문의', '전시회·교육', '기존 거래처', '기타'], me.source ?? '')}</select></label>
      </div><div class="row end" style="margin-top:12px"><button class="btn primary">저장</button></div></form></section>
    <section class="panel"><header><h2>계약</h2><a class="btn sm primary" href="#/contracts/new?customer=${c.id}">새 계약</a></header>
      ${cons.length ? `<div class="table-wrap"><table><thead><tr><th>계약번호</th><th>제품</th><th>기간</th><th class="r">연 이용료</th><th>상태</th></tr></thead><tbody>${cons.map((k) => `<tr class="click" data-go="#/contracts/${k.id}"><td class="num">${esc(k.no)}</td><td>${esc(k.product)}<div class="muted small">${k.deployment === 'ONPREM' ? '설치형' : '호스팅형'} · ${esc(k.planName ?? '')} · ${k.seats}명</div></td><td class="num small">${esc(k.startsOn)} ~ ${esc(k.endsOn)}</td><td class="r num">${won(k.annualFee)}</td><td>${badge(CON_STATE[k.state])}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">계약이 없습니다</div>'}</section>
    <section class="panel"><header><h2>청구 · 수납</h2><span class="muted small">미수 ${won(rem)}</span></header>
      ${invs.length ? invTable(invs, cfg.lateDays, false) : '<div class="empty">청구 내역이 없습니다</div>'}</section>
    <section class="panel"><header><h2>상담 · 지원</h2><button class="btn sm" id="newtk">상담 기록</button></header>
      ${tks.length ? ticketTable(tks, false) : '<div class="empty">상담 기록이 없습니다</div>'}</section>`;
  document.getElementById('crmf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/customers/${c.id}/crm`, { method: 'PUT', json: formData(e.target) }); toast('영업 정보를 저장했습니다'); crmCustomer(c); } catch (err) { toast(err.message, 'error'); }
  };
  document.getElementById('newtk').onclick = () => ticketDialog(null, c.id, () => crmCustomer(c));
  bindInvoiceButtons(invs, () => crmCustomer(c));
  bindTicketButtons(tks, () => crmCustomer(c));
}

// ── 계약 목록 ──────────────────────────────────────────────────
async function pageContracts() {
  const st = new URLSearchParams(location.hash.split('?')[1] ?? '').get('s') ?? '';
  loading('contracts');
  const rows = (await api('/contracts')).filter((k) => !st || k.state === st);
  shell('contracts', `
    <div class="page-head"><div><h1>계약 · 전자계약</h1><p>이용(임대) 계약서를 만들고 양측 서명을 받습니다. 체결 후 청구 일정과 이음ERP 라이선스로 이어집니다.</p></div>
      <div class="row"><select id="cst" class="search">${opt([['', '전체 상태'], ...Object.entries(CON_STATE).map(([k, v]) => [k, v[0]])], st)}</select><a class="btn primary" href="#/contracts/new">+ 새 계약</a></div></div>
    <section class="panel">${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>계약번호</th><th>고객</th><th>제품 / 방식</th><th>기간</th><th class="hide-sm">과금</th><th class="r">연 이용료</th><th>상태</th></tr></thead>
      <tbody>${rows.map((k) => `<tr class="click" data-go="#/contracts/${k.id}"><td class="num nowrap">${esc(k.no)}</td><td><b>${esc(k.customerName)}</b></td>
        <td>${esc(k.product)}<div class="muted small">${k.deployment === 'ONPREM' ? '설치형' : '호스팅형'} · ${esc(k.planName ?? '')} · ${k.seats}명</div></td>
        <td class="num small">${esc(k.startsOn)}<br>~ ${esc(k.endsOn)}</td><td class="hide-sm small">${esc(k.billMethod)}<div class="muted">${esc(k.payMethod)}</div></td>
        <td class="r num">${won(k.annualFee)}</td><td>${badge(CON_STATE[k.state])}${k.status === 'PENDING' ? `<div class="muted small">${k.signed.provider ? '공급자 ✓' : '공급자 —'} · ${k.signed.customer ? '이용자 ✓' : '이용자 —'}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="empty">${st ? '조건에 맞는 계약이 없습니다' : '작성한 계약이 없습니다. [새 계약]에서 고객·제품·요금제를 고르면 이용료가 자동으로 계산됩니다.'}</div>`}</section>`);
  document.getElementById('cst').onchange = (e) => { location.hash = '#/contracts' + (e.target.value ? '?s=' + e.target.value : ''); };
}

// ── 계약 작성·수정 ───────────────────────────────────────────────
function calcFee(f, cfg) {
  const p = cfg.plans.find((x) => x.id === f.planId);
  if (!p) return { annual: 0, once: Number(f.extraOnce) || 0 };
  const n = (v) => Math.round(Number(v) || 0);
  let annual = n(f.deployment === 'ONPREM' ? p.install : p.hosting) + Math.max(0, n(f.seats) - n(p.seats)) * n(p.perSeat);
  let once = n(f.extraOnce) + (f.deployment === 'ONPREM' || !n(p.hosting) ? n(p.setup) : 0);
  for (const id of f.options) { const o = cfg.options.find((x) => x.id === id); if (o) { if (o.once) once += n(o.price); else annual += n(o.price); } }
  if (f.billMethod === '연간 선납') annual -= Math.round(annual / 12 * 2 / 1000) * 1000; // 2개월 무료
  if (n(f.discount)) annual = Math.round((annual * (100 - n(f.discount))) / 100 / 1000) * 1000;
  return { annual, once };
}

async function pageContractForm(id) {
  loading('contracts');
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const [cfg, custs, k] = await Promise.all([crmConfig(), api('/crm/customers'), id ? api('/contracts/' + id) : null]);
  if (k && (k.status === 'SIGNED' || k.status === 'TERMINATED')) { location.hash = '#/contracts/' + id; return; }
  const cust0 = custs.find((c) => c.id === (k?.customerId ?? params.get('customer')));
  const s = today();
  const v = k ?? { customerId: cust0?.id ?? '', product: '이음ERP', deployment: cust0?.deployment ?? 'HOSTED', planId: 'erp-starter', seats: 5, options: [], startsOn: s, endsOn: oneYear(s), billMethod: '연간 선납', payMethod: '계좌이체', payDays: 14, autoRenew: true, discount: 0, extraOnce: 0, special: '' };
  shell('contracts', `
    <div class="page-head"><div><h1>${k ? `계약서 수정 ${esc(k.no)}` : '새 계약'}</h1><p>${k?.status === 'PENDING' ? '저장하면 이미 받은 서명은 지워지고 처음부터 다시 서명받습니다.' : '저장하면 계약서가 만들어지고 서명 화면으로 넘어갑니다.'}</p></div></div>
    ${custs.length ? '' : '<div class="note warn" style="margin-bottom:16px">먼저 <a href="#/customers/new">고객을 등록</a>해 주세요.</div>'}
    <form id="kf">
      <section class="panel"><header><h2>계약 내용</h2></header><div class="body"><div class="form-grid">
        <label class="f wide">고객 *<select name="customerId" required>${opt([['', '고객 선택'], ...custs.map((c) => [c.id, `${c.name} (${biz(c.bizRegNo)})`])], v.customerId)}</select></label>
        <label class="f">제품<select name="product">${opt(cfg.lists.PRODUCTS, v.product)}</select></label>
        <label class="f">제공 방식<select name="deployment">${opt([['HOSTED', '호스팅형'], ['ONPREM', '설치형']], v.deployment)}</select></label>
        <label class="f">요금제<select name="planId"></select></label>
        <label class="f">사용자 수<input name="seats" type="number" min="1" value="${v.seats}" /></label>
        <div class="f wide"><span>유료 옵션</span><div class="chips" id="optbox"></div></div>
        <label class="f">계약 시작일<input name="startsOn" type="date" value="${v.startsOn}" required /></label>
        <label class="f">계약 종료일<input name="endsOn" type="date" value="${v.endsOn}" required /><span class="hint">기본 1년</span></label>
        <label class="f">과금 방법<select name="billMethod">${opt(Object.keys(cfg.lists.BILL_METHODS), v.billMethod)}</select></label>
        <label class="f">결제 수단<select name="payMethod">${opt(cfg.lists.PAY_METHODS, v.payMethod)}</select></label>
        <label class="f">납기 (청구일로부터 일수)<input name="payDays" type="number" min="0" max="120" value="${v.payDays}" /></label>
        <label class="f">자동 갱신<select name="autoRenew">${opt([['1', '만료 1개월 전 해지 통보 없으면 1년 자동 갱신'], ['0', '자동 갱신 없음']], v.autoRenew ? '1' : '0')}</select></label>
        <label class="f">할인율 (%)<input name="discount" type="number" min="0" max="100" value="${v.discount}" /></label>
        <label class="f">별도 1회 비용 (원)<input name="extraOnce" type="number" min="0" step="1000" value="${v.extraOnce}" /><span class="hint">커스터마이징 견적 등</span></label>
        <label class="f wide">특약사항<textarea name="special" rows="3" placeholder="커스터마이징 범위, 데이터 이전 조건 등">${esc(v.special ?? '')}</textarea></label>
      </div><div class="calc" id="calc"></div></div></section>
      <div class="row end">${k ? `<button type="button" class="btn danger" id="kdel">계약서 삭제</button>` : ''}<a class="btn" href="${k ? '#/contracts/' + k.id : '#/contracts'}">취소</a><button class="btn primary" id="kgo">저장하고 서명 화면으로</button></div>
    </form>`);
  const f = document.getElementById('kf');
  let seatsTouched = !!k;
  const draft = () => ({ billMethod: f.billMethod.value, planId: f.planId.value, deployment: f.deployment.value, seats: Number(f.seats.value), options: [...f.querySelectorAll('[name=opt]:checked')].map((x) => x.value), discount: Number(f.discount.value), extraOnce: Number(f.extraOnce.value) });
  const calc = () => {
    const r = calcFee(draft(), cfg);
    const n = cfg.lists.BILL_METHODS[f.billMethod.value] ?? 1;
    document.getElementById('calc').innerHTML = `<div><span>연 이용료 (공급가)</span><b class="num">${won(r.annual)}</b></div><div><span>1회성 비용</span><b class="num">${won(r.once)}</b></div><div><span>회차당 청구 (${n}회)</span><b class="num">${won(Math.round(r.annual / n))}</b></div><div><span>첫 해 합계 (VAT 포함)</span><b class="num">${won(Math.round((r.annual + r.once) * 1.1))}</b></div>`;
  };
  const fillProduct = (keepPlan, keepOpts) => {
    const p = f.product.value;
    f.planId.innerHTML = opt(cfg.plans.filter((x) => x.product === p).map((x) => [x.id, x.name]), keepPlan);
    const cur = keepOpts ?? [...f.querySelectorAll('[name=opt]:checked')].map((x) => x.value);
    document.getElementById('optbox').innerHTML = cfg.options.filter((o) => !o.product || o.product === p).map((o) => `<label><input type="checkbox" name="opt" value="${esc(o.id)}" ${cur.includes(o.id) ? 'checked' : ''} /> ${esc(o.name)} <span class="muted">${o.price ? won(o.price) + (o.once ? ' (1회)' : '/년') : '별도 견적'}</span></label>`).join('') || '<span class="muted small">선택할 옵션이 없습니다</span>';
    planSeats();
  };
  const planSeats = () => { const pl = cfg.plans.find((x) => x.id === f.planId.value); if (pl && !seatsTouched) f.seats.value = pl.seats; calc(); };
  fillProduct(v.planId, v.options);
  f.product.onchange = () => fillProduct();
  f.planId.onchange = planSeats;
  f.seats.oninput = () => { seatsTouched = true; calc(); };
  f.addEventListener('input', calc);
  f.addEventListener('change', calc);
  f.startsOn.onchange = () => { if (f.startsOn.value) f.endsOn.value = oneYear(f.startsOn.value); };
  f.customerId.onchange = () => { const c = custs.find((x) => x.id === f.customerId.value); if (c && !k) { f.deployment.value = c.deployment; calc(); } };
  if (k) document.getElementById('kdel').onclick = async () => {
    if (!confirm(`계약서 ${k.no}를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try { await api('/contracts/' + k.id, { method: 'DELETE' }); toast('계약서를 삭제했습니다'); location.hash = '#/contracts'; } catch (e) { toast(e.message, 'error'); }
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(f);
    if (!d.customerId) return toast('고객을 골라 주세요', 'error');
    const json = { ...d, ...draft(), payDays: Number(d.payDays), autoRenew: d.autoRenew === '1' };
    delete json.opt;
    try {
      const r = k ? (await api('/contracts/' + k.id, { method: 'PUT', json }), { id: k.id }) : await api('/contracts', { method: 'POST', json });
      toast('계약서를 저장했습니다');
      location.hash = '#/contracts/' + r.id;
    } catch (err) { toast(err.message, 'error'); }
  };
}

// ── 계약서 (보기·서명·체결 후 처리) ───────────────────────────────
function contractDoc(k) {
  const pv = k.config.provider ?? {};
  const cu = k.customer;
  const n = k.config && { '연간 선납': 1, '반기 분납': 2, '분기 분납': 4, '월 분납': 12 }[k.billMethod] || 1;
  const onprem = k.deployment === 'ONPREM';
  const art = (h, ps) => `<h4>${h}</h4>${ps.map((p) => `<p>${p}</p>`).join('')}`;
  const extras = k.feeDetail.filter((x) => !/^(기본 이용료|추가 사용자|설치형 초기 구축비|별도 1회 비용)/.test(x.name)).map((x) => esc(x.name));
  const sig = (s) => (s ? `<img src="${esc(s.image)}" alt="서명" /><div class="sig-meta">서명자 ${esc(s.name)} · ${dt(s.at)} · ${esc(s.method)}</div>` : '<div class="sig-empty">(서명 전)</div>');
  const signDate = (k.signedAt ?? new Date().toISOString()).slice(0, 10).replace(/-/g, '. ');
  return `<h3>소프트웨어 이용(임대) 계약서</h3>
    <p>${esc(pv.name)}(이하 "공급자")와 ${esc(cu.name)}(이하 "이용자")는 공급자가 제공하는 「${esc(k.product)}」 프로그램의 이용에 관하여 다음과 같이 계약을 체결한다.</p>
    <p class="r small">계약번호 ${esc(k.no)}</p>
    ${art('제1조 (목적)', [`이 계약은 공급자가 이용자에게 「${esc(k.product)}」(이하 "프로그램")의 이용권을 부여하고, 이용자가 그 대가를 지급하는 데 필요한 사항을 정함을 목적으로 한다.`])}
    ${art('제2조 (서비스 내용)', [
      `① 제공 방식: ${onprem ? '설치형 — 이용자가 지정한 서버 1식에 프로그램을 설치하여 제공한다.' : '호스팅형 — 공급자가 운영하는 클라우드에서 이용자 전용 독립 서버(데이터베이스 분리)로 제공한다.'}`,
      `② 요금제: ${esc(k.planName ?? '')} / 사용자 수: ${k.seats}명`,
      `③ 부가 옵션: ${extras.join(', ') || '없음'}`])}
    ${art('제3조 (계약기간)', [`① 계약기간은 ${k.startsOn}부터 ${k.endsOn}까지로 한다.`,
      k.autoRenew ? '② 계약 만료 1개월 전까지 어느 일방이 서면(전자문서 포함)으로 해지 의사를 통지하지 않으면 같은 조건으로 1년씩 자동 갱신된다. 단, 갱신 시 이용료는 공급자가 30일 전 통지한 요금표에 따른다.' : '② 계약기간이 끝나면 이 계약은 종료되며, 재계약은 따로 체결한다.'])}
    <h4>제4조 (이용료 및 지급방법)</h4>
    <table class="doc-table"><thead><tr><th>항목</th><th class="r">금액 (원, VAT 별도)</th><th>구분</th></tr></thead><tbody>
      ${k.feeDetail.map((x) => `<tr><td>${esc(x.name)}</td><td class="r">${won0(x.amount)}</td><td>${x.once ? '1회' : '연간'}</td></tr>`).join('')}
      <tr><th>연간 이용료 합계${k.discount ? ` (${k.discount}% 할인)` : ''}</th><th class="r">${won0(k.annualFee)}</th><th>연간</th></tr>
      ${k.onceFee ? `<tr><th>1회성 비용 합계</th><th class="r">${won0(k.onceFee)}</th><th>1회</th></tr>` : ''}
    </tbody></table>
    <p>① 연간 이용료는 「${esc(k.billMethod)}」 방식으로 ${n}회에 나누어 청구하며, 회차당 ${won0(Math.round(k.annualFee / n))}원(VAT 별도)이다. 1회성 비용은 첫 회차에 함께 청구한다.</p>
    <p>② 이용자는 청구일로부터 ${k.payDays}일 이내에 「${esc(k.payMethod)}」로 지급한다.${pv.bank ? ` (입금 계좌: ${esc(pv.bank)})` : ''}</p>
    <p>③ 공급자는 청구 시 전자세금계산서를 발행한다.</p>
    ${art('제5조 (이용권의 범위)', ['① 이용권은 비독점적이며 제3자에게 양도·대여·재판매할 수 없다.', '② 프로그램의 저작권과 지식재산권은 공급자에게 있으며, 이용자는 역설계·복제·변경을 할 수 없다.', '③ 공급자는 계약기간 동안 라이선스와 관리자 계정을 발급하며, 허용 사용자 수를 넘는 접속은 제한될 수 있다.'])}
    ${art('제6조 (데이터의 소유 및 보호)', ['① 이용자가 입력한 모든 데이터의 소유권은 이용자에게 있다.', `② 공급자는 개인정보 보호법 등 관계 법령에 따라 데이터를 보호하며, 이용자의 동의 없이 제3자에게 제공하지 않는다.${onprem ? '' : ' 호스팅형은 1일 1회 이상 백업한다.'}`, '③ 계약이 끝나면 이용자의 요청에 따라 30일 이내에 데이터를 엑셀 등 범용 형식으로 반환하고, 반환 후 공급자 보관분은 파기한다.'])}
    ${art('제7조 (유지보수 및 장애 대응)', ['① 공급자는 계약기간 동안 프로그램 업데이트와 오류 수정을 제공한다.', `② 장애가 접수되면 영업일 기준 4시간 이내에 1차 대응하며, 근무시간은 평일 09:00~18:00로 한다.${onprem ? ' 설치형은 이용자 서버·네트워크 자체의 장애를 대응 범위에서 제외한다.' : ''}`])}
    ${art('제8조 (커스터마이징)', ['이용자 고유 양식·업무에 맞춘 기능 추가는 별도 협의와 견적에 따라 진행하며, 개발된 기능의 권리는 특약이 없는 한 공급자에게 귀속된다.'])}
    ${art('제9조 (연체 및 이용정지)', ['① 이용료를 납기 안에 지급하지 않으면 공급자는 지급을 최고할 수 있다.', `② 납기 후 ${k.config.lateDays}일이 지나도 지급하지 않으면 공급자는 7일 전 통지 후 서비스를 조회 전용으로 제한할 수 있다. 제한 기간에도 데이터는 보존한다.`])}
    ${art('제10조 (계약의 해지)', ['① 어느 일방이 이 계약을 위반하고 시정 요구 후 14일 이내에 시정하지 않으면 상대방은 계약을 해지할 수 있다.', '② 이용자 사정으로 중도 해지하는 경우 이미 지급한 이용료는 반환하지 않으며, 미지급 이용료는 해지일까지 일할 계산하여 정산한다.'])}
    ${art('제11조 (손해배상)', ['공급자의 귀책사유로 이용자에게 손해가 생긴 경우 공급자의 배상 책임은 직전 12개월간 이용자가 지급한 이용료를 한도로 한다. 다만 고의 또는 중대한 과실이 있으면 그러하지 아니하다.'])}
    ${art('제12조 (비밀유지)', ['양 당사자는 이 계약으로 알게 된 상대방의 영업상 비밀을 계약 종료 후 3년간 제3자에게 누설하지 않는다.'])}
    ${art('제13조 (전자서명 및 관할)', ['① 이 계약은 전자문서로 작성하며 양 당사자의 전자서명으로 성립한다.', '② 이 계약에 관한 분쟁은 공급자 본점 소재지를 관할하는 법원을 제1심 관할법원으로 한다.'])}
    ${k.special ? art('특약사항', [esc(k.special).replace(/\n/g, '<br>')]) : ''}
    <p class="c" style="margin-top:18px">${signDate}.</p>
    <div class="sigs">
      <div><b>공급자</b><br>${esc(pv.name)} (사업자번호 ${esc(pv.bizNo)})<br>${esc(pv.address)}<br>대표 ${esc(pv.ceo)}${sig(k.signatures.provider)}</div>
      <div><b>이용자</b><br>${esc(cu.name)} (사업자번호 ${biz(cu.bizRegNo)})<br>${esc(cu.address ?? '')}<br>대표 ${esc(cu.ceoName ?? '')}${sig(k.signatures.customer)}</div>
    </div>
    ${k.docHash ? `<div class="doc-hash">문서 해시(SHA-256) ${esc(k.docHash)}<br>체결 일시 ${dt(k.signedAt)}</div>` : ''}`;
}

async function pageContract(id) {
  loading('contracts');
  const k = await api('/contracts/' + id);
  const st = k.state;
  const open = k.status === 'DRAFT' || k.status === 'PENDING';
  const erp = k.product === '이음ERP';
  const s = k.signatures;
  const deployDiff = erp && k.customer.deployment !== k.deployment;
  shell('contracts', `
    <div class="page-head noprint"><div><h1>${esc(k.no)} ${badge(CON_STATE[st])}</h1><p><a href="#/customers/${k.customerId}">${esc(k.customer.name)}</a> · ${esc(k.product)} · 연 ${won(k.annualFee)}</p></div>
      <div class="row">
        <button class="btn" id="kprint">인쇄 / PDF 저장</button>
        ${open ? `<a class="btn" href="#/contracts/${k.id}/edit">내용 수정</a>
          <button class="btn ${s.provider ? '' : 'primary'}" data-sign="provider">${s.provider ? '공급자 서명 다시' : '공급자 서명'}</button>
          <button class="btn ${s.customer ? '' : 'primary'}" data-sign="customer">${s.customer ? '이용자 서명 다시' : '이용자 서명'}</button>` : ''}
        ${k.status === 'SIGNED' ? `
          <button class="btn ${k.invoiceCount ? '' : 'primary'}" id="kinv">${k.invoiceCount ? `청구 ${k.invoiceCount}건 보기` : '청구 일정 생성'}</button>
          ${erp ? `<button class="btn ${k.licenseRowId ? '' : 'primary'}" id="klic">${k.licenseRowId ? '라이선스 발급됨' : '라이선스 발급'}</button>` : ''}
          <button class="btn" id="kren">갱신 계약 만들기</button>
          ${st === 'SIGNED' ? '<button class="btn danger" id="kterm">해지</button>' : ''}` : ''}
      </div></div>
    ${open ? `<div class="note noprint" style="margin-bottom:12px">양측이 모두 서명하면 계약이 체결되고 문서 해시가 기록됩니다. 고객이 멀리 있으면 [인쇄 / PDF 저장]으로 계약서를 보내 검토받은 뒤, 방문·화상 미팅에서 이 화면으로 서명받으세요.</div>` : ''}
    ${k.status === 'SIGNED' && erp && !k.licenseRowId ? `<div class="note warn noprint" style="margin-bottom:12px">이음ERP 계약이 체결됐습니다. [라이선스 발급]을 누르면 사용자 ${k.seats}명, ${esc(k.startsOn)} ~ ${esc(k.endsOn)} 라이선스가 이 고객에게 발급됩니다.${deployDiff ? ` 고객 등록 정보의 판매 방식(${k.customer.deployment === 'ONPREM' ? '설치형' : '호스팅형'})이 계약과 다릅니다. 고객 정보를 먼저 맞춰 주세요.` : ''}</div>` : ''}
    <article class="panel sheet"><div class="body paper">${contractDoc(k)}</div></article>`);
  document.getElementById('kprint').addEventListener('click', () => window.print());
  document.querySelectorAll('[data-sign]').forEach((b) => (b.onclick = () => signDialog(k, b.dataset.sign)));
  const inv = document.getElementById('kinv');
  if (inv) inv.onclick = async () => {
    if (k.invoiceCount) { location.hash = '#/billing?q=' + encodeURIComponent(k.no); return; }
    try { const r = await api(`/contracts/${k.id}/invoices`, { method: 'POST' }); toast(`청구 ${r.count}건을 만들었습니다`); location.hash = '#/billing?q=' + encodeURIComponent(k.no); } catch (e) { toast(e.message, 'error'); }
  };
  const lic = document.getElementById('klic');
  if (lic) lic.onclick = async () => {
    if (k.licenseRowId) { location.hash = '#/customers/' + k.customerId; return; }
    if (k.customer.licenseKind === 'SUSPEND') return toast('사용 중지된 고객입니다. 고객 화면에서 먼저 중지를 해제해 주세요', 'error');
    const kind = k.customer.hasLicense ? 'RENEW' : 'NEW';
    if (!confirm(`${k.customer.name}에 ${kind === 'NEW' ? '신규' : '연장'} 라이선스를 발급할까요?\n사용자 ${k.seats}명 · ${k.startsOn} ~ ${k.endsOn} · ${won(k.annualFee)}`)) return;
    try {
      const l = await api(`/customers/${k.customerId}/licenses`, { method: 'POST', json: { kind, maxUsers: k.seats, startsOn: k.startsOn, expiresAt: k.endsOn, amount: k.annualFee, memo: `계약 ${k.no}` } });
      await api(`/contracts/${k.id}/license`, { method: 'POST', json: { licenseRowId: l.id } });
      issuedDialog({ id: k.customerId, name: k.customer.name }, l);
    } catch (e) { toast(e.message, 'error'); }
  };
  const ren = document.getElementById('kren');
  if (ren) ren.onclick = async () => {
    try { const r = await api(`/contracts/${k.id}/renew`, { method: 'POST' }); toast(`갱신 계약서 ${r.no}를 만들었습니다`); location.hash = '#/contracts/' + r.id; } catch (e) { toast(e.message, 'error'); }
  };
  const term = document.getElementById('kterm');
  if (term) term.onclick = async () => {
    if (!confirm(`${k.no} 계약을 오늘 날짜로 해지할까요?`)) return;
    try {
      await api(`/contracts/${k.id}/terminate`, { method: 'POST' });
      if (erp && k.customer.hasLicense && k.customer.licenseKind !== 'SUSPEND' && confirm('이 고객의 이음ERP 라이선스도 사용 중지할까요? (고객 ERP가 조회 전용으로 바뀝니다)')) {
        await api(`/customers/${k.customerId}/licenses`, { method: 'POST', json: { kind: 'SUSPEND', memo: `계약 ${k.no} 해지` } });
      }
      toast('해지했습니다');
      pageContract(k.id);
    } catch (e) { toast(e.message, 'error'); }
  };
}

function signDialog(k, who) {
  const pv = k.config.provider ?? {};
  const name0 = who === 'provider' ? pv.ceo : k.customer.ceoName ?? '';
  const d = dlg(who === 'provider' ? '공급자 전자서명' : '이용자 전자서명', `
    <div class="form-grid">
      <label class="f">서명자 성명 *<input name="name" value="${esc(name0)}" required /></label>
      <label class="f">서명 방식<select name="method">${opt(['대면 서명', '화상 미팅 서명', '대리인 서명 (위임장 보관)'], '대면 서명')}</select></label>
    </div>
    <p class="small muted" style="margin:12px 0 6px">아래 칸에 손가락이나 마우스로 서명하세요.</p>
    <canvas class="pad" width="600" height="180"></canvas>
    <div class="row" style="justify-content:space-between;margin-top:8px">
      <label class="small"><input type="checkbox" name="agree" style="width:auto;min-height:0" /> 계약서 전문을 확인했고 내용에 동의합니다</label>
      <button type="button" class="btn sm" data-clear>다시 쓰기</button></div>`,
  { submit: '서명 완료', onSubmit: async (f) => {
    if (!f.name?.trim()) throw new Error('서명자 성명을 입력해 주세요');
    if (!drawn) throw new Error('서명 칸에 서명해 주세요');
    if (!f.agree) throw new Error('계약 내용 동의에 체크해 주세요');
    const small = document.createElement('canvas');
    small.width = 300; small.height = 90;
    small.getContext('2d').drawImage(cv, 0, 0, 300, 90);
    const r = await api(`/contracts/${k.id}/sign`, { method: 'POST', json: { who, name: f.name.trim(), method: f.method, agree: true, image: small.toDataURL('image/png') } });
    toast(r.status === 'SIGNED' ? '양측 서명 완료 — 계약이 체결됐습니다' : '서명을 저장했습니다');
    pageContract(k.id);
  } });
  const cv = d.form.querySelector('canvas');
  const ctx = cv.getContext('2d');
  ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  let drawn = false, down = false, last = null;
  const pt = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height]; };
  cv.onpointerdown = (e) => { down = true; last = pt(e); cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = (e) => { if (!down) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; drawn = true; };
  cv.onpointerup = cv.onpointercancel = () => { down = false; };
  d.form.querySelector('[data-clear]').onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; };
}

// ── 과금·수납 ──────────────────────────────────────────────────
function invTable(rows, lateDays, withCustomer = true) {
  return `<div class="table-wrap"><table class="wide-table"><thead><tr><th>청구번호</th>${withCustomer ? '<th>고객</th>' : ''}<th>청구 내용</th><th>납기</th><th class="r hide-sm">공급가</th><th class="r hide-sm">VAT</th><th class="r">합계</th><th class="r">입금</th><th>상태</th><th></th></tr></thead><tbody>
    ${rows.map((i) => `<tr><td class="num small nowrap">${esc(i.no)}</td>${withCustomer ? `<td><a href="#/customers/${i.customerId}">${esc(i.customerName)}</a></td>` : ''}
      <td>${esc(i.period)}<div class="muted small">${esc(i.payMethod ?? '')}${i.taxInvoice ? ' · 세금계산서 발행' : ''}${i.contractNo ? ` · <a href="#/contracts/${i.contractId}">${esc(i.contractNo)}</a>` : ''}</div></td>
      <td class="num small nowrap">${esc(i.dueDate)}${i.overdueDays ? `<div style="color:var(--seal)">${i.overdueDays}일 경과${i.overdueDays >= lateDays ? ' · 정지 검토' : ''}</div>` : ''}</td>
      <td class="r num hide-sm">${won0(i.supply)}</td><td class="r num hide-sm">${won0(i.vat)}</td><td class="r num"><b>${won0(i.total)}</b></td>
      <td class="r num">${won0(i.paid)}${i.paidAt ? `<div class="muted small">${esc(i.paidAt)}</div>` : ''}</td><td>${badge([i.state, INV_TONE[i.state] ?? ''])}</td>
      <td class="r"><div class="row end" style="flex-wrap:nowrap">${['완납', '취소'].includes(i.state) ? '' : `<button class="btn sm primary" data-pay="${i.id}">입금</button>`}<button class="btn sm" data-inv="${i.id}">수정</button></div></td></tr>`).join('')}
  </tbody></table></div>`;
}
function bindInvoiceButtons(rows, refresh) {
  document.querySelectorAll('[data-pay]').forEach((b) => (b.onclick = () => payDialog(rows.find((i) => i.id === b.dataset.pay), refresh)));
  document.querySelectorAll('[data-inv]').forEach((b) => (b.onclick = () => invoiceDialog(rows.find((i) => i.id === b.dataset.inv), refresh)));
}

async function pageBilling() {
  const p = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const term = p.get('q') ?? '', st = p.get('s') ?? '';
  loading('billing');
  const [cfg, all] = await Promise.all([crmConfig(), api('/invoices')]);
  const rows = all.filter((i) => (!st || i.state === st) && (!term || [i.no, i.customerName, i.period, i.contractNo].join(' ').includes(term)));
  const sum = (fn) => rows.reduce((a, i) => a + fn(i), 0);
  shell('billing', `
    <div class="page-head"><div><h1>과금 · 수납</h1><p>청구 일정, 입금 확인, 연체 관리입니다. 금액은 VAT 포함이며, 납기 ${cfg.lateDays}일 경과 시 '정지 검토'가 표시됩니다.</p></div>
      <div class="row"><a class="btn" href="/api/admin/invoices?format=csv">엑셀(CSV) 내려받기</a><button class="btn primary" id="newinv">+ 개별 청구</button></div></div>
    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="stat"><div class="label">청구 합계 (${rows.length}건)</div><div class="value" style="font-size:19px">${won(sum((i) => (i.canceled ? 0 : i.total)))}</div></div>
      <div class="stat"><div class="label">입금 합계</div><div class="value" style="font-size:19px">${won(sum((i) => i.paid))}</div></div>
      <div class="stat"><div class="label">미수 잔액</div><div class="value" style="font-size:19px">${won(sum((i) => i.unpaid))}</div></div>
      <div class="stat alert"><div class="label">연체 잔액</div><div class="value" style="font-size:19px">${won(sum((i) => (i.overdueDays ? i.unpaid : 0)))}</div></div>
    </div>
    <form id="bf" class="row" style="margin-bottom:12px"><input class="search" name="q" placeholder="청구번호·고객·계약번호·내용" value="${esc(term)}" />
      <select name="s" class="search" style="max-width:160px">${opt([['', '전체 상태'], ...['예정', '청구', '부분입금', '완납', '연체', '연체(부분)', '취소'].map((x) => [x, x])], st)}</select><button class="btn">검색</button></form>
    <section class="panel">${rows.length ? invTable(rows, cfg.lateDays) : `<div class="empty">${all.length ? '조건에 맞는 청구가 없습니다' : '청구가 없습니다. 계약서 화면에서 [청구 일정 생성]을 누르면 과금 방법에 맞춰 자동으로 만들어집니다.'}</div>`}</section>`);
  document.getElementById('bf').onsubmit = (e) => { e.preventDefault(); const f = formData(e.target); location.hash = '#/billing?' + new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString(); };
  document.getElementById('newinv').onclick = () => invoiceDialog(null, pageBilling);
  bindInvoiceButtons(rows, pageBilling);
}

async function invoiceDialog(i, refresh) {
  const [cfg, custs, cons] = await Promise.all([crmConfig(), api('/crm/customers'), api('/contracts')]);
  const v = i ?? { issueDate: today(), dueDate: addDays(today(), 14), payMethod: '계좌이체', supply: 0, billed: true };
  dlg(i ? `청구 수정 ${esc(i.no)}` : '개별 청구 추가', `<div class="form-grid">
      ${i ? `<div class="f"><span>고객</span><b>${esc(i.customerName)}</b></div>` : `<label class="f">고객 *<select name="customerId" required>${opt([['', '고객 선택'], ...custs.map((c) => [c.id, c.name])], '')}</select></label>`}
      ${i ? `<div class="f"><span>연결 계약</span><span>${esc(i.contractNo ?? '없음')}</span></div>` : `<label class="f">연결 계약<select name="contractId">${opt([['', '(계약 없이 청구)'], ...cons.map((k) => [k.id, `${k.no} · ${k.customerName}`])], '')}</select></label>`}
      <label class="f wide">청구 내용 *<input name="period" value="${esc(v.period ?? '')}" placeholder="예: 커스터마이징 개발비, 사용자 5명 추가" required /></label>
      <label class="f">청구일<input type="date" name="issueDate" value="${esc(v.issueDate)}" /></label>
      <label class="f">납기<input type="date" name="dueDate" value="${esc(v.dueDate)}" /></label>
      <label class="f">공급가 (원)<input type="number" name="supply" min="0" step="1000" value="${v.supply}" /><span class="hint">VAT 10%는 자동 계산</span></label>
      <label class="f">결제 수단<select name="payMethod">${opt(cfg.lists.PAY_METHODS, v.payMethod)}</select></label>
      <div class="f wide chips">
        <label><input type="checkbox" name="billed" ${v.billed ? 'checked' : ''} /> 청구서 보냄</label>
        <label><input type="checkbox" name="taxInvoice" ${v.taxInvoice ? 'checked' : ''} /> 세금계산서 발행</label>
        ${i ? `<label><input type="checkbox" name="canceled" ${v.canceled ? 'checked' : ''} /> 청구 취소</label>` : ''}</div>
      <label class="f wide">메모<input name="memo" value="${esc(v.memo ?? '')}" /></label></div>`,
  { extra: i && !i.paid ? '<button type="button" class="btn danger" data-del style="margin-right:auto">삭제</button>' : '',
    onSubmit: async (f) => {
      const json = { ...f, supply: Number(f.supply), billed: !!f.billed, taxInvoice: !!f.taxInvoice, canceled: !!f.canceled };
      if (i) await api('/invoices/' + i.id, { method: 'PUT', json }); else await api('/invoices', { method: 'POST', json });
      toast('청구를 저장했습니다');
      refresh();
    } });
  const back = document.querySelector('.dlg-back:last-of-type');
  back?.querySelector('[data-accept]')?.addEventListener('click', () => { back.remove(); location.hash = `#/requests/new?customer=${t.customerId}&ticket=${t.id}`; });
  back?.querySelector('[data-del]')?.addEventListener('click', async (e) => {
    if (!confirm('이 청구를 삭제할까요?')) return;
    try { await api('/invoices/' + i.id, { method: 'DELETE' }); e.target.closest('.dlg-back').remove(); toast('삭제했습니다'); refresh(); } catch (err) { toast(err.message, 'error'); }
  });
}

async function payDialog(i, refresh) {
  const cfg = await crmConfig();
  dlg('입금 확인', `
    <dl class="dl" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:14px">
      <div><dt>고객</dt><dd>${esc(i.customerName)}</dd></div><div><dt>청구 내용</dt><dd>${esc(i.period)}</dd></div>
      <div><dt>청구 합계</dt><dd class="num">${won(i.total)}</dd></div><div><dt>지금까지 입금</dt><dd class="num">${won(i.paid)}</dd></div></dl>
    <div class="form-grid">
      <label class="f">이번 입금액 (원)<input type="number" name="amount" min="1" value="${i.total - i.paid}" required /></label>
      <label class="f">입금일<input type="date" name="date" value="${today()}" /></label>
      <label class="f">입금 수단<select name="method">${opt(cfg.lists.PAY_METHODS, i.payMethod)}</select></label>
      <label class="f">입금자명<input name="payer" /></label>
      <label class="f wide small"><span><input type="checkbox" name="taxInvoice" ${i.taxInvoice ? 'checked' : ''} style="width:auto;min-height:0" /> 세금계산서 발행 완료</span></label></div>
    ${i.payments.length ? `<p class="small muted" style="margin:12px 0 0">입금 기록: ${i.payments.map((p) => `${esc(p.date)} ${won(p.amount)}`).join(' · ')}</p>` : ''}`,
  { submit: '입금 반영', onSubmit: async (f) => {
    await api(`/invoices/${i.id}/pay`, { method: 'POST', json: { ...f, amount: Number(f.amount), taxInvoice: !!f.taxInvoice } });
    toast('입금을 반영했습니다');
    refresh();
  } });
}

// ── 상담·지원 ──────────────────────────────────────────────────
function ticketTable(rows, withCustomer = true) {
  return `<div class="table-wrap"><table class="wide-table"><thead><tr><th>접수일</th>${withCustomer ? '<th>고객</th>' : ''}<th>유형</th><th>내용</th><th class="hide-sm">기한</th><th>상태</th><th></th></tr></thead><tbody>
    ${rows.map((t) => `<tr><td class="num small">${esc(t.openedOn)}</td>${withCustomer ? `<td><a href="#/customers/${t.customerId}">${esc(t.customerName)}</a></td>` : ''}
      <td>${badge([t.type, t.type === '장애' ? 'seal' : t.type === '커스터마이징' ? 'warn' : ''])}${t.source === 'ERP' ? ' <span class="badge steel" title="고객이 ERP의 고장·수정 요청 메뉴로 보낸 건">ERP</span>' : ''}</td>
      <td><b>${esc(t.title)}</b>${t.files?.length ? ` <span class="muted small">📎${t.files.length}</span>` : ''}${t.requester ? `<div class="small muted">${esc(t.requester)}</div>` : ''}${t.body ? `<div class="muted small pre">${esc(t.body.slice(0, 160))}</div>` : ''}</td><td class="num small hide-sm">${esc(t.dueOn ?? '')}</td>
      <td>${badge([t.source === 'ERP' && t.status === '접수' ? '접수 대기' : t.status, t.status === '완료' ? 'ok' : t.status === '처리중' ? 'warn' : t.source === 'ERP' ? 'seal' : 'steel'])}</td><td class="r"><button class="btn sm" data-tk="${t.id}">${t.source === 'ERP' && t.status === '접수' ? '열기' : '수정'}</button></td></tr>`).join('')}
  </tbody></table></div>`;
}
function bindTicketButtons(rows, refresh) {
  document.querySelectorAll('[data-tk]').forEach((b) => (b.onclick = () => ticketDialog(rows.find((t) => t.id === b.dataset.tk), null, refresh)));
}
async function pageSupport() {
  const st = new URLSearchParams(location.hash.split('?')[1] ?? '').get('s') ?? '';
  loading('support');
  const all = await api('/tickets');
  const rows = all.filter((t) => (st === 'open' ? t.status !== '완료' : !st || t.status === st));
  shell('support', `
    <div class="page-head"><div><h1>상담 · 지원</h1><p>도입 상담, 장애 접수, 기능 요청, 커스터마이징 이력을 고객별로 남깁니다.</p></div>
      <div class="row"><select id="tst" class="search">${opt([['', '전체'], ['open', '처리 안 된 것'], ['접수', '접수'], ['처리중', '처리중'], ['완료', '완료']], st)}</select><button class="btn primary" id="newtk">+ 상담 기록</button></div></div>
    <section class="panel">${rows.length ? ticketTable(rows) : `<div class="empty">${all.length ? '조건에 맞는 기록이 없습니다' : '상담 기록이 없습니다. 전화·방문 상담 내용을 [상담 기록]으로 남기세요.'}</div>`}</section>`);
  document.getElementById('tst').onchange = (e) => { location.hash = '#/support' + (e.target.value ? '?s=' + e.target.value : ''); };
  document.getElementById('newtk').onclick = () => ticketDialog(null, null, pageSupport);
  bindTicketButtons(rows, pageSupport);
}
async function ticketDialog(t, customerId, refresh) {
  const [cfg, custs] = await Promise.all([crmConfig(), api('/crm/customers')]);
  const v = t ?? { customerId: customerId ?? '', type: '상담', status: '접수', openedOn: today() };
  dlg(t ? '상담 · 지원 수정' : '상담 기록', `<div class="form-grid">
      ${t ? `<div class="f"><span>고객</span><b>${esc(t.customerName)}</b></div>` : `<label class="f">고객 *<select name="customerId" required>${opt([['', '고객 선택'], ...custs.map((c) => [c.id, c.name])], v.customerId)}</select></label>`}
      <label class="f">유형<select name="type">${opt(cfg.lists.TICKET_TYPES, v.type)}</select></label>
      <label class="f wide">제목 *<input name="title" value="${esc(v.title ?? '')}" required /></label>
      <label class="f wide">내용<textarea name="body" rows="4">${esc(v.body ?? '')}</textarea></label>
      <label class="f">접수일<input type="date" name="openedOn" value="${esc(v.openedOn)}" /></label>
      <label class="f">처리 기한<input type="date" name="dueOn" value="${esc(v.dueOn ?? '')}" /></label>
      <label class="f">상태<select name="status">${opt(cfg.lists.TICKET_STATES, v.status)}</select></label>
      <label class="f">담당<input name="owner" value="${esc(v.owner ?? '')}" /></label>
      ${t?.source === 'ERP' ? `
      <div class="f wide"><span>고객 ERP에서 보낸 요청</span><div class="small">${t.requester ? `요청자 ${esc(t.requester)}` : ''}${t.screen ? ` · 화면 ${esc(t.screen)}` : ''}</div>
        ${t.files?.length ? `<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px">${t.files.map((f) => `<a class="btn sm" href="/api/admin/tickets/${t.id}/files/${f.id}" target="_blank" rel="noopener">📎 ${esc(f.name)} <span class="muted">${Math.ceil(f.size / 1024)}KB</span></a>`).join('')}</div>` : ''}
        ${t.requestId ? `<div style="margin-top:6px"><a href="#/requests/${t.requestId}">→ 연결된 수정 요청 보기</a></div>` : ''}</div>
      <label class="f wide">고객에게 보이는 답변<textarea name="reply" rows="3" placeholder="고객 ERP의 요청 목록에 그대로 보입니다. 예: 확인했습니다. 다음 주 금요일 업데이트에 반영됩니다.">${esc(t.reply ?? '')}</textarea></label>` : ''}</div>`,
  { extra: (t ? '<button type="button" class="btn danger" data-del style="margin-right:auto">삭제</button>' : '') + (t?.source === 'ERP' && !t.requestId ? '<button type="button" class="btn" data-accept>수정 요청으로 접수</button>' : ''),
    onSubmit: async (f) => {
      if (t) await api('/tickets/' + t.id, { method: 'PUT', json: f }); else await api('/tickets', { method: 'POST', json: f });
      toast('저장했습니다');
      refresh();
    } }).back.querySelector('[data-del]')?.addEventListener('click', async (e) => {
    if (!confirm('이 상담 기록을 삭제할까요?')) return;
    try { await api('/tickets/' + t.id, { method: 'DELETE' }); e.target.closest('.dlg-back').remove(); toast('삭제했습니다'); refresh(); } catch (err) { toast(err.message, 'error'); }
  });
}

// ── 요금제·공급자 설정 ────────────────────────────────────────────
async function pagePricing() {
  loading('pricing');
  CFG = null;
  const c = await crmConfig();
  const pv = c.provider ?? {};
  const prodSel = (v, blank) => `<select data-k="product">${blank ? '<option value="">전 제품</option>' : ''}${opt(c.lists.PRODUCTS, v)}</select>`;
  const planRow = (p) => `<tr data-id="${esc(p.id ?? '')}"><td>${prodSel(p.product)}</td><td><input data-k="name" value="${esc(p.name)}" /></td>${['hosting', 'install', 'setup', 'seats', 'perSeat'].map((k) => `<td><input data-k="${k}" type="number" min="0" class="r" value="${Number(p[k]) || 0}" /></td>`).join('')}<td><button type="button" class="btn sm danger" data-rm>삭제</button></td></tr>`;
  const optRow = (o) => `<tr data-id="${esc(o.id ?? '')}"><td><input data-k="name" value="${esc(o.name)}" /></td><td>${prodSel(o.product, true)}</td><td><input data-k="price" type="number" min="0" class="r" value="${Number(o.price) || 0}" /></td><td><select data-k="once">${opt([['0', '매년'], ['1', '1회']], o.once ? '1' : '0')}</select></td><td><button type="button" class="btn sm danger" data-rm>삭제</button></td></tr>`;
  shell('pricing', `
    <div class="page-head"><div><h1>요금제 · 계약 설정</h1><p>계약서 이용료 계산과 계약서에 들어갈 공급자 정보입니다. 바꾼 단가는 새로 쓰는 계약부터 적용됩니다.</p></div>
      <button class="btn primary" id="psave">설정 저장</button></div>
    ${!c.saved || c.examplePrices ? '<div class="note warn" style="margin-bottom:16px">지금 단가는 예시 값입니다. 실제 판매 단가로 고친 뒤 아래 \'단가 상태\'를 확정으로 바꿔 저장해 주세요.</div>' : ''}
    <section class="panel"><header><h2>요금제 (연간, 공급가)</h2><button class="btn sm" id="addplan">요금제 추가</button></header>
      <div class="table-wrap"><table class="edit" id="plans"><thead><tr><th>제품</th><th>요금제명</th><th>호스팅형 연</th><th>설치형 연</th><th>설치형 구축비</th><th>기본 사용자</th><th>추가 1인 연</th><th></th></tr></thead>
      <tbody>${c.plans.map(planRow).join('')}</tbody></table></div></section>
    <section class="panel"><header><h2>유료 옵션</h2><button class="btn sm" id="addopt">옵션 추가</button></header>
      <div class="table-wrap"><table class="edit" id="opts"><thead><tr><th>옵션명</th><th>적용 제품</th><th>금액</th><th>과금</th><th></th></tr></thead>
      <tbody>${c.options.map(optRow).join('')}</tbody></table></div></section>
    <section class="panel"><header><h2>공급자 정보 · 과금 정책</h2></header><form id="pvf" class="body"><div class="form-grid">
      ${[['name', '상호'], ['bizNo', '사업자등록번호'], ['ceo', '대표자'], ['phone', '대표 전화'], ['email', '청구 담당 이메일'], ['bank', '입금 계좌 (은행·계좌·예금주)'], ['address', '주소']].map(([k, l]) => `<label class="f${k === 'address' ? ' wide' : ''}">${l}<input name="${k}" value="${esc(pv[k] ?? '')}" /></label>`).join('')}
      <label class="f">이용 제한 통지 기준 (연체 일수)<input name="lateDays" type="number" min="1" value="${c.lateDays}" /></label>
      <label class="f">단가 상태<select name="examplePrices">${opt([['1', '예시 단가 (확정 전)'], ['0', '실제 판매 단가 확정']], c.examplePrices ? '1' : '0')}</select></label>
    </div></form></section>`);
  const bindRm = () => document.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => b.closest('tr').remove()));
  bindRm();
  document.getElementById('addplan').onclick = () => { document.querySelector('#plans tbody').insertAdjacentHTML('beforeend', planRow({ product: '이음ERP', name: '새 요금제', seats: 5 })); bindRm(); };
  document.getElementById('addopt').onclick = () => { document.querySelector('#opts tbody').insertAdjacentHTML('beforeend', optRow({ name: '새 옵션', product: '' })); bindRm(); };
  const read = (sel) => [...document.querySelectorAll(sel + ' tbody tr')].map((tr) => {
    const o = { id: tr.dataset.id || undefined };
    tr.querySelectorAll('[data-k]').forEach((el) => { o[el.dataset.k] = el.type === 'number' ? Number(el.value) : el.value; });
    return o;
  });
  document.getElementById('psave').onclick = async () => {
    const f = formData(document.getElementById('pvf'));
    const json = { plans: read('#plans'), options: read('#opts').map((o) => ({ ...o, once: o.once === '1' })), provider: f, lateDays: Number(f.lateDays), examplePrices: f.examplePrices === '1' };
    try { await api('/crm/config', { method: 'PUT', json }); CFG = null; toast('설정을 저장했습니다'); pagePricing(); } catch (e) { toast(e.message, 'error'); }
  };
}
