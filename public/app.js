'use strict';
/* SS-ERP 라이선스 관리 — 화면 (빌드 없는 단일 스크립트) */

const $app = document.getElementById('app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const biz = (v) => { const n = String(v ?? '').replace(/\D/g, ''); return n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : esc(v); };
const dt = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

const KIND = { NEW: ['신규', 'steel'], RENEW: ['연장', 'ok'], CHANGE: ['변경', ''], SUSPEND: ['사용 중지', 'seal'], RESUME: ['중지 해제', 'ok'] };
const STATE = { ACTIVE: ['사용 중', 'ok'], EXPIRING: ['만료 임박', 'warn'], EXPIRED: ['만료', 'seal'], SUSPENDED: ['사용 중지', 'seal'], NONE: ['미발급', ''] };
const DEPLOY = { HOSTED: '호스팅형', ONPREM: '설치형' };
const badge = ([label, tone]) => `<span class="badge ${tone}">${esc(label)}</span>`;

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = kind;
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function api(path, opts = {}) {
  const res = await fetch('/api/admin' + path, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', 'x-portal': '1' },
    body: opts.json ? JSON.stringify(opts.json) : undefined,
    credentials: 'same-origin',
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { renderLogin(); throw new Error('로그인이 필요합니다'); }
  if (!res.ok) throw new Error(body.message ?? '처리하지 못했습니다');
  return body;
}

async function copy(text, label = '복사했습니다') {
  try { await navigator.clipboard.writeText(text); toast(label); } catch { prompt('복사해서 사용하세요', text); }
}

// ── 로그인 ─────────────────────────────────────────────────────
function renderLogin() {
  $app.innerHTML = `
    <div class="login">
      <form id="lf">
        <div class="brand" style="color:var(--ink);padding:0"><span class="mark">SS</span><div>SS-ERP 라이선스 관리<small style="color:var(--muted)">판매자 전용</small></div></div>
        <label class="f">관리자 비밀번호<input type="password" name="pw" autocomplete="current-password" required autofocus /></label>
        <div class="err" id="le"></div>
        <button class="btn primary" type="submit">로그인</button>
      </form>
    </div>`;
  document.getElementById('lf').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/login', { method: 'POST', json: { password: e.target.pw.value } });
      route();
    } catch (err) {
      document.getElementById('le').textContent = err.message;
    }
  };
}

// ── 공통 틀 ────────────────────────────────────────────────────
function shell(active, inner) {
  const nav = [['#/', '대시보드', 'home'], ['#/customers', '고객', 'customers'], ['#/licenses', '발급 대장', 'licenses'], ['#/audit', '활동 기록', 'audit'], ['#/settings', '설정', 'settings']];
  $app.innerHTML = `
    <div class="shell">
      <nav class="side" aria-label="메뉴">
        <div class="brand"><span class="mark">SS</span><div>라이선스 관리<small>SS-ERP 판매자 전용</small></div></div>
        ${nav.map(([href, label, key]) => `<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`).join('')}
        <div class="spacer"></div>
        <button class="link" id="logout">로그아웃</button>
      </nav>
      <main class="main" id="main">${inner}</main>
    </div>`;
  document.getElementById('logout').onclick = async () => { await api('/logout', { method: 'POST' }).catch(() => 0); renderLogin(); };
}
const loading = (active) => shell(active, '<p class="muted">불러오는 중…</p>');

// ── 대시보드 ───────────────────────────────────────────────────
async function pageHome() {
  loading('home');
  const s = await api('/summary');
  const expRow = (c) => `<tr class="click" data-go="#/customers/${c.id}"><td>${esc(c.name)}</td><td class="num">${esc(c.current.expiresAt)}</td><td class="r num">${c.current.daysLeft < 0 ? '만료' : c.current.daysLeft + '일'}</td><td>${badge(STATE[c.state])}</td></tr>`;
  shell('home', `
    <div class="page-head"><div><h1>대시보드</h1><p>연간 구독 라이선스 현황입니다. 만료 30일 전부터 '만료 임박'에 나타납니다.</p></div>
      <a class="btn primary" href="#/customers/new">+ 고객 등록</a></div>
    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="stat"><div class="label">전체 고객</div><div class="value">${s.customers}</div></div>
      <div class="stat"><div class="label">사용 중</div><div class="value">${s.active}</div></div>
      <div class="stat ${s.expiring.length ? 'alert' : ''}"><div class="label">만료 임박 (30일)</div><div class="value">${s.expiring.length}</div></div>
      <div class="stat"><div class="label">${esc(s.revenueYear.year)}년 발급 금액</div><div class="value" style="font-size:19px">${won(s.revenueYear.total)}</div></div>
    </div>
    <div class="grid cols-2">
      <section class="panel"><header><h2>갱신 연락이 필요한 고객</h2><span class="muted small">만료 임박 ${s.expiring.length} · 만료 ${s.expired.length}</span></header>
        ${s.expiring.length + s.expired.length ? `<div class="table-wrap"><table><thead><tr><th>고객</th><th>만료일</th><th class="r">남은 기간</th><th>상태</th></tr></thead><tbody>${[...s.expiring, ...s.expired].map(expRow).join('')}</tbody></table></div>` : '<div class="empty">갱신이 필요한 고객이 없습니다</div>'}
      </section>
      <section class="panel"><header><h2>최근 발급</h2><a href="#/licenses" class="small">전체 보기</a></header>
        ${s.recent.length ? `<div class="table-wrap"><table><thead><tr><th>발급일</th><th>고객</th><th>종류</th><th class="r">사용자</th></tr></thead><tbody>${s.recent.map((l) => `<tr class="click" data-go="#/customers/${l.customerId}"><td class="num small">${dt(l.issuedAt)}</td><td>${esc(l.customerName)}</td><td>${badge(KIND[l.kind])}</td><td class="r num">${l.maxUsers}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">아직 발급한 라이선스가 없습니다</div>'}
      </section>
    </div>
    <p class="muted small">사용 중 사용자 수 합계 <span class="num">${s.seats}</span>명 · 미발급 고객 ${s.none} · 사용 중지 ${s.suspended}</p>`);
}

// ── 고객 목록 ──────────────────────────────────────────────────
async function pageCustomers() {
  const term = new URLSearchParams(location.hash.split('?')[1] ?? '').get('q') ?? '';
  loading('customers');
  const rows = await api('/customers' + (term ? `?q=${encodeURIComponent(term)}` : ''));
  shell('customers', `
    <div class="page-head"><div><h1>고객</h1><p>라이선스를 판매한 회사입니다. 고객을 눌러 라이선스를 발급·연장하세요.</p></div>
      <div class="row"><form id="sf" class="row"><input class="search" name="q" placeholder="회사명·사업자번호·담당자" value="${esc(term)}" /></form><a class="btn primary" href="#/customers/new">+ 고객 등록</a></div></div>
    <section class="panel">${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>회사명</th><th>사업자등록번호</th><th class="hide-sm">방식</th><th class="r">사용자</th><th>만료일</th><th>상태</th><th class="hide-sm">최근 접속</th></tr></thead>
      <tbody>${rows.map((c) => `<tr class="click" data-go="#/customers/${c.id}">
        <td><b>${esc(c.name)}</b>${c.contactName ? `<div class="muted small">${esc(c.contactName)}</div>` : ''}</td>
        <td class="num">${biz(c.bizRegNo)}</td><td class="hide-sm">${DEPLOY[c.deployment]}</td>
        <td class="r num">${c.current ? `${c.lastActiveUsers ?? '–'} / ${c.current.maxUsers}` : '–'}</td>
        <td class="num">${c.current ? esc(c.current.expiresAt) : '–'}</td><td>${badge(STATE[c.state])}</td>
        <td class="hide-sm small muted">${c.lastSeenAt ? dt(c.lastSeenAt) : '연결 전'}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${term ? '검색 결과가 없습니다' : '등록된 고객이 없습니다. 첫 고객을 등록하세요.'}</div>`}</section>`);
  document.getElementById('sf').onsubmit = (e) => { e.preventDefault(); location.hash = '#/customers?q=' + encodeURIComponent(e.target.q.value.trim()); };
}

// ── 고객 등록·수정 폼 ──────────────────────────────────────────
function customerForm(c = {}) {
  return `<div class="form-grid">
    <label class="f">회사명 *<input name="name" required maxlength="100" value="${esc(c.name)}" placeholder="㈜예시전력" /></label>
    <label class="f">사업자등록번호 *<input name="bizRegNo" required inputmode="numeric" value="${esc(c.bizRegNo ? biz(c.bizRegNo) : '')}" placeholder="000-00-00000" /><span class="hint">고객 ERP의 회사 정보와 같아야 라이선스가 작동합니다</span></label>
    <label class="f">대표자<input name="ceoName" value="${esc(c.ceoName)}" /></label>
    <label class="f">판매 방식<select name="deployment"><option value="HOSTED" ${c.deployment !== 'ONPREM' ? 'selected' : ''}>호스팅형 (공급사 서버에서 운영)</option><option value="ONPREM" ${c.deployment === 'ONPREM' ? 'selected' : ''}>설치형 (고객사 서버에 설치)</option></select></label>
    <label class="f">담당자<input name="contactName" value="${esc(c.contactName)}" /></label>
    <label class="f">연락처<input name="phone" value="${esc(c.phone)}" /></label>
    <label class="f">이메일<input name="email" type="email" value="${esc(c.email)}" /></label>
    <label class="f">ERP 접속 주소<input name="serverUrl" value="${esc(c.serverUrl)}" placeholder="https://" /></label>
    <label class="f wide">메모<textarea name="memo" rows="3">${esc(c.memo)}</textarea></label>
  </div>`;
}
const formData = (form) => Object.fromEntries(new FormData(form).entries());

function pageNewCustomer() {
  shell('customers', `
    <div class="page-head"><div><h1>고객 등록</h1><p>등록하면 고객 서버 연결용 설치 코드가 자동으로 만들어집니다.</p></div></div>
    <form class="panel" id="cf"><div class="body">${customerForm()}</div>
      <div class="body row end" style="border-top:1px solid var(--line)"><a class="btn" href="#/customers">취소</a><button class="btn primary">등록</button></div></form>`);
  document.getElementById('cf').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/customers', { method: 'POST', json: formData(e.target) });
      toast('고객을 등록했습니다');
      location.hash = '#/customers/' + r.id;
    } catch (err) { toast(err.message, 'error'); }
  };
}

// ── 고객 상세 ──────────────────────────────────────────────────
async function pageCustomer(id) {
  loading('customers');
  const c = await api('/customers/' + id);
  const cur = c.current;
  const suspended = c.state === 'SUSPENDED';
  shell('customers', `
    <div class="page-head"><div><h1>${esc(c.name)} ${badge(STATE[c.state])}</h1><p class="num">${biz(c.bizRegNo)} · ${DEPLOY[c.deployment]}</p></div>
      <div class="row">
        ${!cur ? `<button class="btn primary" data-issue="NEW">신규 라이선스 발급</button>` : suspended ? `<button class="btn primary" data-issue="RESUME">중지 해제</button>` : `
          <button class="btn primary" data-issue="RENEW">1년 연장</button>
          <button class="btn" data-issue="CHANGE">사용자 수 변경</button>
          <button class="btn danger" data-issue="SUSPEND">사용 중지</button>`}
      </div></div>

    <div class="grid cols-2">
      <section class="panel"><header><h2>현재 라이선스</h2></header><div class="body">
        ${cur ? `<dl class="dl">
          <div><dt>만료일</dt><dd class="num">${esc(cur.expiresAt)} <span class="muted">(${cur.daysLeft < 0 ? '만료' : cur.daysLeft + '일 남음'})</span></dd></div>
          <div><dt>사용자 수</dt><dd class="num">${cur.maxUsers}명</dd></div>
          <div><dt>마지막 발급</dt><dd>${badge(KIND[cur.kind])}</dd></div>
          <div><dt>ERP 사용 중 인원</dt><dd class="num">${c.lastActiveUsers ?? '–'}명</dd></div>
          <div><dt>ERP 최근 접속</dt><dd class="small">${c.lastSeenAt ? dt(c.lastSeenAt) : '연결 전'}</dd></div>
          <div><dt>ERP 버전</dt><dd class="num small">${esc(c.lastAppVersion ?? '–')}</dd></div>
        </dl>` : '<div class="note">아직 발급한 라이선스가 없습니다. 오른쪽 위 <b>신규 라이선스 발급</b>을 누르세요.</div>'}
      </div></section>

      <section class="panel"><header><h2>설치 코드</h2><button class="btn sm" id="regen">다시 만들기</button></header><div class="body">
        <div class="code-box"><span class="code">${esc(c.activationCode)}</span><button class="btn sm" id="copycode">복사</button></div>
        <p class="small muted" style="margin:10px 0 0">고객 ERP의 <b>관리 &gt; 라이선스 &gt; 온라인 자동 갱신</b>에 이 코드를 넣으면 발급·연장한 라이선스가 자동으로 들어갑니다.
        호스팅형은 서버의 <span class="mono">LICENSE_ACTIVATION_CODE</span> 환경변수로 넣어도 됩니다.</p>
      </div></section>
    </div>

    <section class="panel"><header><h2>발급 이력</h2><span class="muted small">${c.licenses.length}건</span></header>
      ${c.licenses.length ? `<div class="table-wrap"><table><thead><tr><th>발급일시</th><th>종류</th><th class="r">사용자</th><th>기간</th><th class="r">금액</th><th class="hide-sm">메모</th><th></th></tr></thead><tbody>
        ${c.licenses.map((l, i) => `<tr><td class="num small">${dt(l.issuedAt)}${i === 0 ? ' <span class="badge steel">현재</span>' : ''}</td><td>${badge(KIND[l.kind])}</td><td class="r num">${l.maxUsers}</td>
          <td class="num small">${esc(l.startsOn)} ~ ${esc(l.expiresAt)}</td><td class="r num">${l.amount ? won(l.amount) : '–'}</td><td class="hide-sm small">${esc(l.memo ?? '')}</td>
          <td class="r"><div class="row end"><button class="btn sm" data-copy="${l.id}">복사</button><a class="btn sm" href="/api/admin/licenses/${l.id}?download=1">파일</a></div></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">발급 이력이 없습니다</div>'}
    </section>

    <section class="panel"><header><h2>고객 정보</h2></header>
      <form id="ef"><div class="body">${customerForm(c)}</div><div class="body row end" style="border-top:1px solid var(--line)"><button class="btn primary">저장</button></div></form>
    </section>`);

  document.getElementById('copycode').onclick = () => copy(c.activationCode, '설치 코드를 복사했습니다');
  document.getElementById('regen').onclick = async () => {
    if (!confirm('설치 코드를 새로 만들면 지금 연결된 고객 서버는 새 코드로 다시 연결해야 합니다. 계속할까요?')) return;
    try { await api(`/customers/${id}/code`, { method: 'POST' }); toast('설치 코드를 새로 만들었습니다'); pageCustomer(id); } catch (e) { toast(e.message, 'error'); }
  };
  document.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => {
    const l = await api('/licenses/' + b.dataset.copy);
    copy(l.licenseText, '라이선스 문자열을 복사했습니다');
  }));
  document.querySelectorAll('[data-issue]').forEach((b) => (b.onclick = () => issueDialog(c, b.dataset.issue)));
  document.getElementById('ef').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/customers/' + id, { method: 'PUT', json: formData(e.target) }); toast('저장했습니다'); pageCustomer(id); } catch (err) { toast(err.message, 'error'); }
  };
}

// ── 발급 대화상자 ──────────────────────────────────────────────
function addDays(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function oneYear(ymd) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

function issueDialog(c, kind) {
  const cur = c.current;
  const T = { NEW: '신규 라이선스 발급', RENEW: '1년 연장', CHANGE: '사용자 수 변경', SUSPEND: '사용 중지', RESUME: '중지 해제' }[kind];
  let start = today();
  if (kind === 'RENEW' && cur && cur.daysLeft >= 0) start = addDays(cur.expiresAt, 1);
  const end = kind === 'CHANGE' ? cur.expiresAt : oneYear(start);
  let body = '';
  if (kind === 'SUSPEND') {
    body = `<div class="note seal">만료일을 어제로 바꾼 라이선스를 새로 발급합니다. 고객 ERP가 다음 확인 때(최대 6시간) <b>조회 전용</b>으로 바뀝니다. 자료는 지워지지 않으며 '중지 해제'로 되돌릴 수 있습니다.</div>
      <div style="margin-top:12px"><label class="f">사유<input name="memo" placeholder="예: 연체" /></label></div>`;
  } else if (kind === 'RESUME') {
    body = `<div class="note">중지 전 만료일로 라이선스를 다시 발급합니다.</div><div style="margin-top:12px"><label class="f">메모<input name="memo" /></label></div>`;
  } else {
    body = `<div class="form-grid">
      <label class="f">사용자 수 *<input name="maxUsers" type="number" min="1" max="10000" required value="${cur?.maxUsers ?? 10}" /></label>
      <label class="f">금액 (원)<input name="amount" type="number" min="0" step="1000" value="${kind === 'CHANGE' ? 0 : ''}" placeholder="0" /><span class="hint">매출 집계용 · 공급가액 기준 권장</span></label>
      ${kind === 'CHANGE' ? '' : `<label class="f">시작일<input name="startsOn" type="date" value="${start}" /></label>`}
      <label class="f">만료일<input name="expiresAt" type="date" value="${end}" /><span class="hint">${kind === 'CHANGE' ? '보통 기존 만료일 그대로' : '연간 구독: 시작일부터 1년'}</span></label>
      <label class="f wide">메모<input name="memo" placeholder="${kind === 'NEW' ? '예: 2026년 계약, 견적서 번호' : ''}" /></label>
    </div>`;
  }
  const back = document.createElement('div');
  back.className = 'dlg-back';
  back.innerHTML = `<form class="dlg" role="dialog" aria-modal="true" aria-label="${T}">
    <header><h2>${T} — ${esc(c.name)}</h2><button type="button" class="x" aria-label="닫기">×</button></header>
    <div class="body">${body}</div>
    <footer><button type="button" class="btn" data-close>취소</button><button class="btn ${kind === 'SUSPEND' ? 'danger' : 'primary'}">${kind === 'SUSPEND' ? '사용 중지' : '발급'}</button></footer></form>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector('.x').onclick = close;
  back.querySelector('[data-close]').onclick = close;
  back.onclick = (e) => { if (e.target === back) close(); };
  back.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const json = { kind, memo: f.memo || undefined };
    if (f.maxUsers) json.maxUsers = Number(f.maxUsers);
    if (f.amount) json.amount = Number(f.amount);
    if (f.startsOn) json.startsOn = f.startsOn;
    if (f.expiresAt) json.expiresAt = f.expiresAt;
    try {
      const l = await api(`/customers/${c.id}/licenses`, { method: 'POST', json });
      close();
      issuedDialog(c, l);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function issuedDialog(c, l) {
  const back = document.createElement('div');
  back.className = 'dlg-back';
  back.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">
    <header><h2>발급 완료</h2><button type="button" class="x" aria-label="닫기">×</button></header>
    <div class="body" style="display:grid;gap:12px">
      <p style="margin:0">${esc(c.name)} · <span class="num">${l.maxUsers}명 · ${esc(l.expiresAt)}까지</span></p>
      <div class="note">온라인으로 연결된 고객 서버는 자동으로 받습니다(최대 6시간, ERP에서 '지금 확인'을 누르면 즉시).
        연결하지 않은 설치형 고객에게는 아래 문자열이나 파일을 전달하세요.</div>
      <div class="lic-text">${esc(l.licenseText)}</div>
    </div>
    <footer><a class="btn" href="/api/admin/licenses/${l.id}?download=1">파일로 받기</a><button class="btn primary" data-copy>문자열 복사</button></footer></div>`;
  document.body.appendChild(back);
  const close = () => { back.remove(); pageCustomer(c.id); };
  back.querySelector('.x').onclick = close;
  back.onclick = (e) => { if (e.target === back) close(); };
  back.querySelector('[data-copy]').onclick = () => copy(l.licenseText, '라이선스 문자열을 복사했습니다');
}

// ── 발급 대장 ──────────────────────────────────────────────────
async function pageLicenses() {
  loading('licenses');
  const rows = await api('/licenses');
  const total = rows.reduce((a, r) => a + r.amount, 0);
  shell('licenses', `
    <div class="page-head"><div><h1>발급 대장</h1><p>지금까지 발급한 모든 라이선스입니다. 발급 내역은 지우거나 고칠 수 없습니다.</p></div>
      <a class="btn" href="/api/admin/licenses?format=csv">엑셀(CSV) 내려받기</a></div>
    <section class="panel">${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>발급일시</th><th>고객</th><th class="hide-sm">사업자등록번호</th><th>종류</th><th class="r">사용자</th><th>기간</th><th class="r">금액</th></tr></thead>
      <tbody>${rows.map((l) => `<tr class="click" data-go="#/customers/${l.customerId}"><td class="num small">${dt(l.issuedAt)}</td><td>${esc(l.customerName)}</td><td class="num hide-sm">${biz(l.bizRegNo)}</td>
        <td>${badge(KIND[l.kind])}</td><td class="r num">${l.maxUsers}</td><td class="num small">${esc(l.startsOn)} ~ ${esc(l.expiresAt)}</td><td class="r num">${l.amount ? won(l.amount) : '–'}</td></tr>`).join('')}
      </tbody><tfoot><tr><th colspan="6">합계 ${rows.length}건</th><th class="r num">${won(total)}</th></tr></tfoot></table></div>`
      : '<div class="empty">발급한 라이선스가 없습니다</div>'}</section>`);
}

// ── 활동 기록 ──────────────────────────────────────────────────
async function pageAudit() {
  loading('audit');
  const rows = await api('/audit');
  shell('audit', `
    <div class="page-head"><div><h1>활동 기록</h1><p>로그인, 고객 등록, 라이선스 발급 등 최근 300건입니다.</p></div></div>
    <section class="panel">${rows.length ? `<div class="table-wrap"><table><thead><tr><th>일시</th><th>내용</th><th class="hide-sm">접속 IP</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="num small">${dt(r.at)}</td><td>${esc(r.summary)}</td><td class="num small hide-sm">${esc(r.ip ?? '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">기록이 없습니다</div>'}</section>`);
}

// ── 설정 ───────────────────────────────────────────────────────
async function pageSettings() {
  loading('settings');
  const me = await api('/me');
  shell('settings', `
    <div class="page-head"><div><h1>설정</h1><p>판매자 서명키 정보입니다.</p></div></div>
    <section class="panel"><header><h2>판매자 공개키</h2><button class="btn sm" id="cp">복사</button></header><div class="body">
      <p class="muted" style="margin-top:0">SS-ERP에 들어 있는 공개키와 같아야 이 사이트에서 발급한 라이선스가 인정됩니다. 공개키는 알려져도 괜찮습니다.</p>
      <div class="lic-text">${esc(me.publicKey)}</div>
      <div class="note warn" style="margin-top:12px">비밀키(서명키)는 이 서버의 환경변수에만 있고 화면에는 나오지 않습니다. 따로 보관한 백업 파일을 잃어버리지 마세요. 비밀키가 유출되면 누구나 라이선스를 만들 수 있으니 즉시 키를 교체해야 합니다.</div>
    </div></section>`);
  document.getElementById('cp').onclick = () => copy(me.publicKey, '공개키를 복사했습니다');
}

// ── 라우팅 ─────────────────────────────────────────────────────
async function route() {
  const h = location.hash.split('?')[0] || '#/';
  try {
    if (h === '#/' || h === '#') await pageHome();
    else if (h === '#/customers') await pageCustomers();
    else if (h === '#/customers/new') pageNewCustomer();
    else if (h.startsWith('#/customers/')) await pageCustomer(h.slice('#/customers/'.length));
    else if (h === '#/licenses') await pageLicenses();
    else if (h === '#/audit') await pageAudit();
    else if (h === '#/settings') await pageSettings();
    else location.hash = '#/';
  } catch (e) {
    if (e.message !== '로그인이 필요합니다') toast(e.message, 'error');
  }
}
document.addEventListener('click', (e) => {
  const tr = e.target.closest('[data-go]');
  if (tr && !e.target.closest('a,button')) location.hash = tr.dataset.go;
});
window.addEventListener('hashchange', route);
route();
