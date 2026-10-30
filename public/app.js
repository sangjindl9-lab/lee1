'use strict';
/* 이음ERP 라이선스 관리 — 화면 (빌드 없는 단일 스크립트) */

const $app = document.getElementById('app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const biz = (v) => { const n = String(v ?? '').replace(/\D/g, ''); return n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : esc(v); };
const dt = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

const KIND = { NEW: ['신규', 'steel'], RENEW: ['연장', 'ok'], CHANGE: ['변경', ''], SUSPEND: ['사용 중지', 'seal'], RESUME: ['중지 해제', 'ok'] };
const STATE = { ACTIVE: ['사용 중', 'ok'], EXPIRING: ['만료 임박', 'warn'], EXPIRED: ['만료', 'seal'], SUSPENDED: ['사용 중지', 'seal'], NONE: ['미발급', ''] };
const DEPLOY = { HOSTED: '호스팅형', ONPREM: '설치형' };
const gb = (mb) => (mb >= 1024 ? `${+(mb / 1024).toFixed(mb % 1024 ? 1 : 0)}GB` : `${mb}MB`);
/** 데이터 사용량 표시 — 80% 이상 주의, 100% 이상 초과 */
const usage = (used, quota) => {
  if (used == null || !quota) return '<span class="muted">–</span>';
  const pct = Math.round((used / quota) * 100);
  const tone = pct >= 100 ? 'seal' : pct >= 80 ? 'warn' : '';
  return `<span class="num ${tone ? 'tone-' + tone : ''}">${gb(used)} / ${gb(quota)} (${pct}%)</span>`;
};
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
        <div class="brand" style="color:var(--ink);padding:0"><img class="mark-img" src="/brand/symbol.png" alt="" /><div>이음ERP 라이선스 관리<small style="color:var(--muted)">판매자 전용</small></div></div>
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
  const nav = [['#/', '대시보드', 'home'], ['#/customers', '고객', 'customers'], ['#/contracts', '계약 · 전자계약', 'contracts'], ['#/billing', '과금 · 수납', 'billing'], ['#/support', '상담 · 지원', 'support'],
    ['#/licenses', '발급 대장', 'licenses'], ['#/requests', '요청 대장', 'requests'], ['#/pricing', '요금제', 'pricing'], ['#/audit', '활동 기록', 'audit'], ['#/settings', '설정', 'settings']];
  $app.innerHTML = `
    <div class="shell">
      <nav class="side" aria-label="메뉴">
        <div class="brand"><img class="mark-img" src="/brand/symbol-light.png" alt="" /><div>이음ERP 라이선스 관리<small>주식회사 이음소프트 · 판매자 전용</small></div></div>
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
      <a class="btn primary" href="#/customers/new">+ 고객 등록 · 납품</a></div>
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
    <p class="muted small">사용 중 사용자 수 합계 <span class="num">${s.seats}</span>명 · 미발급 고객 ${s.none} · 사용 중지 ${s.suspended}</p>
    <div id="crmhome"></div>`);
  await crmHome();
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
      <thead><tr><th>회사명</th><th>사업자등록번호</th><th>영업 단계</th><th class="hide-sm">방식</th><th class="r">사용자</th><th class="hide-sm r">데이터</th><th>만료일</th><th>상태</th><th class="hide-sm">최근 접속</th></tr></thead>
      <tbody>${rows.map((c) => `<tr class="click" data-go="#/customers/${c.id}">
        <td><b>${esc(c.name)}</b>${c.contactName ? `<div class="muted small">${esc(c.contactName)}</div>` : ''}</td>
        <td class="num">${biz(c.bizRegNo)}</td><td>${badge([c.stage, STAGE_TONE[c.stage] ?? ''])}</td><td class="hide-sm">${DEPLOY[c.deployment]}</td>
        <td class="r num">${c.current ? `${c.lastActiveUsers ?? '–'} / ${c.current.maxUsers}` : '–'}</td>
        <td class="hide-sm r small">${c.current ? usage(c.usedMB, c.current.storageMB) : '–'}</td>
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

async function pageNewCustomer() {
  loading('customers');
  const rw = await api('/railway').catch(() => ({ connected: false }));
  const start = today();
  shell('customers', `
    <div class="page-head"><div><h1>고객 등록 · 납품</h1><p>등록하면 라이선스 발급과 고객 전용 ERP 서버 개설이 한 번에 진행됩니다. 접속 주소는 30초 안에 나오고, 설치는 5~10분 뒤 끝납니다. 주소가 나오면 바로 납품서를 보낼 수 있습니다.</p></div></div>
    <form id="cf">
      <section class="panel"><header><h2>1. 고객 정보</h2></header><div class="body">${customerForm()}</div></section>
      <section class="panel"><header><h2>2. 라이선스 (연간 구독)</h2></header><div class="body"><div class="form-grid">
        <label class="f">사용자 수 *<input name="maxUsers" type="number" min="1" max="10000" value="10" required /></label>
        <label class="f">저장 용량 (GB) *<input name="storageGB" type="number" min="0.25" max="1024" step="0.25" value="1" required /><span class="hint">데이터베이스 + 첨부파일 합계 · 기본 1GB</span></label>
        <label class="f">금액 (원)<input name="amount" type="number" min="0" step="1000" placeholder="0" /><span class="hint">매출 집계용 · 공급가액 기준 권장</span></label>
        <label class="f">시작일<input name="startsOn" type="date" value="${start}" /></label>
        <label class="f">만료일<input name="expiresAt" type="date" value="${oneYear(start)}" /><span class="hint">기본 1년</span></label>
        <label class="f wide">메모<input name="licMemo" placeholder="예: 2026년 계약, 견적서 번호" /></label>
      </div></div></section>
      <section class="panel" id="srvsec"><header><h2>3. 고객 전용 서버 (호스팅형)</h2>${rw.connected ? '' : '<span class="badge warn">Railway 연결 필요</span>'}</header><div class="body">
        ${rw.connected ? '' : '<div class="note warn" style="margin-bottom:12px">서버를 자동으로 만들려면 먼저 <a href="#/settings">설정 &gt; Railway 연결</a>을 마쳐 주세요. 지금은 고객 등록과 라이선스만 진행됩니다.</div>'}
        ${rw.connected ? `<div class="choice" role="radiogroup" aria-label="ERP 설치">
          <label><input type="radio" name="install" value="now" checked /> <b>지금 ERP 설치</b><span class="small muted">등록과 함께 고객 전용 서버를 만듭니다. 주소는 30초 안에, 설치는 5~10분</span></label>
          <label><input type="radio" name="install" value="later" /> <b>나중에 설치</b><span class="small muted">고객 등록과 라이선스만. 서버는 고객 화면에서 원할 때 개설</span></label>
        </div>` : ''}
        <div class="form-grid" id="srvfields">
          <label class="f">고객 관리자 아이디 *<input name="adminId" value="admin" pattern="[a-z0-9._\\-]{4,32}" required /><span class="hint">고객이 처음 로그인할 아이디 (영문 소문자·숫자 4~32자)</span></label>
          <label class="f">회사 코드 *<input name="companyCode" placeholder="예: HN" pattern="[A-Za-z0-9]{2,10}" required /><span class="hint">ERP 문서번호 앞에 붙는 영문 약어 2~10자</span></label>
        </div>
        <p class="small muted" style="margin:10px 0 0">임시 비밀번호는 자동으로 만들어지고, 고객이 첫 로그인 때 바꾸게 됩니다. 서버는 다른 고객과 완전히 분리된 새 서버(데이터베이스 포함)로 만들어지며, 예시 데이터 없이 비어 있는 상태로 시작합니다.</p>
      </div></section>
      <div class="row end"><a class="btn" href="#/customers">취소</a><button class="btn primary" id="go">${rw.connected ? '등록하고 ERP 만들기' : '등록하고 납품 준비'}</button></div>
    </form>`);
  const form = document.getElementById('cf');
  const srv = document.getElementById('srvsec');
  const sync = () => {
    const hosted = form.deployment.value === 'HOSTED';
    srv.style.display = hosted ? '' : 'none';
    const now = hosted && rw.connected && form.install?.value === 'now';
    document.getElementById('srvfields').style.display = now || !rw.connected ? '' : 'none';
    form.adminId.required = now;
    form.companyCode.required = now;
    document.getElementById('go').textContent = now ? '등록하고 ERP 만들기' : '등록하고 라이선스 발급';
  };
  form.deployment.onchange = sync;
  form.querySelectorAll('input[name=install]').forEach((r) => (r.onchange = sync));
  sync();
  form.startsOn.onchange = () => { if (form.startsOn.value) form.expiresAt.value = oneYear(form.startsOn.value); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(form);
    const btn = document.getElementById('go');
    btn.disabled = true;
    let id;
    try {
      ({ id } = await api('/customers', { method: 'POST', json: f }));
      await api(`/customers/${id}/licenses`, { method: 'POST', json: { kind: 'NEW', maxUsers: Number(f.maxUsers), storageGB: Number(f.storageGB || 1), amount: Number(f.amount || 0), startsOn: f.startsOn, expiresAt: f.expiresAt, memo: f.licMemo || undefined } });
      if (f.deployment === 'HOSTED' && rw.connected && f.install === 'now') {
        btn.textContent = '서버 주소 만드는 중…';
        const j = await api(`/customers/${id}/server`, { method: 'POST', json: { adminId: f.adminId, companyCode: f.companyCode } });
        toast(j.url ? `등록했습니다 — 접속 주소 ${j.url} (설치 5~10분)` : '등록했습니다. 고객 서버를 만드는 중입니다');
      } else toast('고객 등록과 라이선스 발급을 마쳤습니다');
      location.hash = '#/customers/' + id;
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      if (id) location.hash = '#/customers/' + id;
    }
  };
}

// ── 고객 상세 ──────────────────────────────────────────────────
async function pageCustomer(id) {
  loading('customers');
  const [c, reqs] = await Promise.all([api('/customers/' + id), api('/requests?customerId=' + id)]);
  const cur = c.current;
  const suspended = c.state === 'SUSPENDED';
  shell('customers', `
    <div class="page-head"><div><h1>${esc(c.name)} ${badge(STATE[c.state])}</h1><p class="num">${biz(c.bizRegNo)} · ${DEPLOY[c.deployment]}</p></div>
      <div class="row">
        ${!cur ? `<button class="btn primary" data-issue="NEW">신규 라이선스 발급</button>` : suspended ? `<button class="btn primary" data-issue="RESUME">중지 해제</button>` : `
          <button class="btn primary" data-issue="RENEW">1년 연장</button>
          <button class="btn" data-issue="CHANGE">사용자 수·용량 변경</button>
          <button class="btn danger" data-issue="SUSPEND">사용 중지</button>`}
        <button class="btn primary" id="claudebtn" title="이 업체만 수정·업데이트하는 Claude 작업 창을 엽니다">Claude로 수정</button>
        <button class="btn" id="reqbtn">수정 요청</button>
      </div></div>

    <div class="grid cols-2">
      <section class="panel"><header><h2>현재 라이선스</h2></header><div class="body">
        ${cur ? `<dl class="dl">
          <div><dt>만료일</dt><dd class="num">${esc(cur.expiresAt)} <span class="muted">(${cur.daysLeft < 0 ? '만료' : cur.daysLeft + '일 남음'})</span></dd></div>
          <div><dt>사용자 수</dt><dd class="num">${cur.maxUsers}명</dd></div>
          <div><dt>데이터 사용량</dt><dd>${usage(c.usedMB, cur.storageMB)}${c.storageCheckedAt ? ` <span class="small muted">${dt(c.storageCheckedAt)} 기준</span>` : ''}</dd></div>
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

    ${serverPanel(c)}

    <section class="panel"><header><h2>수정 요청</h2><span class="muted small">GitHub 이슈로 기록 · 월요일 작업, 금요일 반영</span></header><div id="reqlist">${requestTable(reqs.rows, true)}</div></section>

    <section class="panel"><header><h2>발급 이력</h2><span class="muted small">${c.licenses.length}건</span></header>
      ${c.licenses.length ? `<div class="table-wrap"><table><thead><tr><th>발급일시</th><th>종류</th><th class="r">사용자</th><th>기간</th><th class="r">금액</th><th class="hide-sm">메모</th><th></th></tr></thead><tbody>
        ${c.licenses.map((l, i) => `<tr><td class="num small">${dt(l.issuedAt)}${i === 0 ? ' <span class="badge steel">현재</span>' : ''}</td><td>${badge(KIND[l.kind])}</td><td class="r num">${l.maxUsers}<div class="small muted">${gb(l.storageMB ?? 1024)}</div></td>
          <td class="num small">${esc(l.startsOn)} ~ ${esc(l.expiresAt)}</td><td class="r num">${l.amount ? won(l.amount) : '–'}</td><td class="hide-sm small">${esc(l.memo ?? '')}</td>
          <td class="r"><div class="row end"><button class="btn sm" data-copy="${l.id}">복사</button><a class="btn sm" href="/api/admin/licenses/${l.id}?download=1">파일</a></div></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">발급 이력이 없습니다</div>'}
    </section>

    <div id="crmcust"></div>

    <section class="panel"><header><h2>고객 정보</h2></header>
      <form id="ef"><div class="body">${customerForm(c)}</div><div class="body row end" style="border-top:1px solid var(--line)"><button class="btn primary">저장</button></div></form>
    </section>`);

  document.getElementById('copycode').onclick = () => copy(c.activationCode, '설치 코드를 복사했습니다');
  document.getElementById('reqbtn').onclick = () => { location.hash = `#/requests/new?customer=${c.id}`; };
  document.getElementById('claudebtn').onclick = () => claudeForCustomer(c, reqs.rows);
  bindServerPanel(c);
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
  await crmCustomer(c);
}

// ── 고객 서버 패널 ─────────────────────────────────────────────
let pollTimer = null;
function serverPanel(c) {
  if (c.deployment !== 'HOSTED') return '';
  const j = c.server;
  if (!j) {
    return `<section class="panel"><header><h2>고객 전용 서버</h2><span class="badge">미개설</span></header><div class="body">
      ${c.serverUrl ? `<p style="margin-top:0">등록된 접속 주소: <a href="${esc(c.serverUrl)}" target="_blank" rel="noopener">${esc(c.serverUrl)}</a> (직접 만든 서버)</p><div class="row" style="margin-bottom:12px"><button class="btn" id="srvaccess" title="고객 비밀번호 없이 공급사 지원 계정(ss-vendor)으로 들어갑니다. 고객 ERP 감사 로그에 남습니다">고객 ERP 접속</button></div>` : ''}
      ${c.current && c.state !== 'SUSPENDED' ? `<form id="srvf"><div class="form-grid">
        <label class="f">고객 관리자 아이디<input name="adminId" value="admin" required /></label>
        <label class="f">회사 코드<input name="companyCode" placeholder="예: HN" required /></label></div>
        <div class="row end" style="margin-top:12px"><button class="btn primary">서버 개설</button></div></form>`
        : '<div class="note">라이선스를 먼저 발급해 주세요.</div>'}
    </div></section>`;
  }
  const idx = j.steps.findIndex((s) => s.key === j.step);
  const list = j.steps.map((s, i) => {
    const done = j.status === 'DONE' || i < idx;
    const now = j.status !== 'DONE' && i === idx;
    const mark = done ? '✓' : now ? (j.status === 'FAILED' ? '✕' : '…') : '·';
    const color = done ? 'var(--ok)' : now ? (j.status === 'FAILED' ? 'var(--seal)' : 'var(--steel)') : 'var(--muted)';
    return `<li style="color:${color}"><span class="mono" style="display:inline-block;width:18px">${mark}</span>${esc(s.label)}</li>`;
  }).join('');
  const badgeT = { RUNNING: ['만드는 중', 'steel'], DONE: ['운영 중', 'ok'], FAILED: ['실패', 'seal'] }[j.status];
  return `<section class="panel"><header><h2>고객 전용 서버</h2>${badge(badgeT)}</header><div class="body">
    ${j.status === 'DONE' ? `<dl class="dl" style="margin-bottom:12px">
        <div><dt>접속 주소</dt><dd><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.url)}</a></dd></div>
        <div><dt>관리자 아이디</dt><dd class="mono">${esc(j.adminId)}</dd></div>
        <div><dt>개설 완료</dt><dd class="small">${dt(j.finishedAt)}</dd></div></dl>
      <div class="row"><a class="btn primary" href="#/customers/${c.id}/delivery">납품서 보기 · 인쇄</a><button class="btn" id="srvredeploy" title="sspower ss-erp 브랜치의 최신 코드로 이 고객 서버를 다시 배포합니다 (2~5분, 데이터는 그대로)">최신 코드로 재배포</button><button class="btn" id="srvaccess" title="고객 비밀번호 없이 공급사 지원 계정(ss-vendor)으로 들어갑니다. 고객 ERP 감사 로그에 남습니다">고객 ERP 접속</button></div>`
    : `${j.url && j.status === 'RUNNING' ? `<div class="addr"><span class="muted small">접속 주소 (설치 중 — 보통 5~10분 뒤 접속됨)</span><div class="row"><a class="mono" href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.url)}</a><button type="button" class="btn sm" id="cpurl">복사</button><a class="btn sm primary" href="#/customers/${c.id}/delivery">납품서</a></div><span class="small muted">관리자 아이디 <b class="mono">${esc(j.adminId)}</b></span></div>` : ''}
      <ul style="list-style:none;padding:0;margin:0 0 10px;display:grid;gap:4px">${list}</ul>
      ${j.status === 'RUNNING' ? '<p class="small muted" style="margin:0">처음 설치는 보통 5~10분 걸립니다. 이 화면을 닫아도 계속 진행됩니다.</p>' : ''}
      ${j.status === 'FAILED' ? `<div class="note seal" style="margin-bottom:10px">${esc(j.error)}</div><button class="btn" id="srvretry">실패한 단계부터 다시 시도</button>` : ''}`}
  </div></section>`;
}
function bindServerPanel(c) {
  clearTimeout(pollTimer);
  const f = document.getElementById('srvf');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/customers/${c.id}/server`, { method: 'POST', json: formData(f) }); toast('고객 서버를 만드는 중입니다'); pageCustomer(c.id); } catch (err) { toast(err.message, 'error'); }
  };
  const rd = document.getElementById('srvredeploy');
  if (rd) rd.onclick = async () => {
    if (!confirm(`${c.name} 서버를 최신 코드로 재배포할까요? 2~5분 동안 접속이 잠깐 끊길 수 있습니다.`)) return;
    try { await api(`/customers/${c.id}/redeploy`, { method: 'POST' }); toast('재배포를 시작했습니다. 끝나면 완료된 요청이 "반영"으로 바뀝니다'); } catch (err) { toast(err.message, 'error'); }
  };
  const a = document.getElementById('srvaccess');
  if (a) a.onclick = async () => {
    // 팝업 차단을 피하려고 클릭 즉시 창을 열고, 티켓을 받은 뒤 주소를 넣는다 (티켓은 2분, 1회용)
    const win = window.open('', '_blank');
    try { const r = await api(`/customers/${c.id}/access`, { method: 'POST' }); if (win) win.location = r.url; else location.assign(r.url); }
    catch (err) { if (win) win.close(); toast(err.message, 'error'); }
  };
  const r = document.getElementById('srvretry');
  if (r) r.onclick = async () => {
    try { await api(`/customers/${c.id}/server/retry`, { method: 'POST' }); pageCustomer(c.id); } catch (err) { toast(err.message, 'error'); }
  };
  const cu = document.getElementById('cpurl');
  if (cu) cu.onclick = () => copy(c.server.url, '접속 주소를 복사했습니다');
  if (c.server?.status === 'RUNNING') {
    pollTimer = setTimeout(() => { if (location.hash === '#/customers/' + c.id) pageCustomer(c.id); }, c.server.url ? 10_000 : 3_000);
  }
}

// ── 납품서 (인쇄용) ────────────────────────────────────────────
async function pageDelivery(id) {
  loading('customers');
  const d = await api(`/customers/${id}/delivery`);
  shell('customers', `
    <div class="page-head noprint"><div><h1>납품서</h1><p>고객에게 전달할 접속 정보입니다. 임시 비밀번호가 들어 있으니 담당자에게만 전달하세요.</p></div>
      <div class="row"><a class="btn" href="#/customers/${id}">돌아가기</a><button class="btn" id="cpall">문자로 복사</button><button class="btn primary" onclick="window.print()">인쇄 / PDF 저장</button></div></div>
    ${d.installing ? '<div class="note warn noprint" style="margin-bottom:12px">아직 설치 중입니다 (보통 5~10분). 주소와 계정은 그대로이니 미리 전달해도 되고, 설치가 끝나면 바로 접속됩니다.</div>' : ''}
    <article class="panel sheet"><div class="body">
      <h2 style="font-size:20px;margin-bottom:4px">이음ERP 사용 안내</h2>
      <p class="muted" style="margin:0 0 18px">${esc(d.name)} 귀중 · ${esc(d.issuedOn)}</p>
      <table class="kv"><tbody>
        <tr><th>접속 주소</th><td class="mono">${esc(d.url)}</td></tr>
        <tr><th>관리자 아이디</th><td class="mono">${esc(d.adminId)}</td></tr>
        <tr><th>임시 비밀번호</th><td class="mono">${esc(d.tempPassword)}</td></tr>
        <tr><th>사용 회사</th><td>${esc(d.name)} (${biz(d.bizRegNo)})</td></tr>
        <tr><th>라이선스</th><td>사용자 ${d.license.maxUsers}명 · 저장 용량 ${gb(d.license.storageMB ?? 1024)} · ${esc(d.license.expiresAt)}까지</td></tr>
      </tbody></table>
      <h3 style="font-size:15px;margin:20px 0 6px">처음 사용하실 때</h3>
      <ol style="margin:0;padding-left:20px;line-height:1.9">
        <li>접속 주소로 들어가 관리자 아이디와 임시 비밀번호로 로그인합니다.</li>
        <li>비밀번호를 새로 정하라는 화면이 나오면 본인만 아는 비밀번호로 바꿉니다.</li>
        <li><b>관리 &gt; 회사 정보</b>에서 대표자·주소 등을 확인하고, <b>관리 &gt; 사용자</b>에서 직원 계정을 만듭니다.</li>
        <li>라이선스는 이미 등록되어 있으며, 연간 계약을 연장하면 자동으로 갱신됩니다.</li>
      </ol>
      <p class="small muted" style="margin-top:20px">문의: 주식회사 이음소프트 · 이 안내서는 보안을 위해 첫 로그인 후 폐기해 주세요.</p>
    </div></article>`);
  document.getElementById('cpall').onclick = () => copy(`[이음ERP 사용 안내] ${d.name}\n접속 주소: ${d.url}\n관리자 아이디: ${d.adminId}\n임시 비밀번호: ${d.tempPassword}\n첫 로그인 후 비밀번호를 바꿔 주세요.`, '납품 정보를 복사했습니다');
}

// ── 발급 대화상자 ──────────────────────────────────────────────
function addDays(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function oneYear(ymd) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }

function issueDialog(c, kind) {
  const cur = c.current;
  const T = { NEW: '신규 라이선스 발급', RENEW: '1년 연장', CHANGE: '사용자 수·용량 변경', SUSPEND: '사용 중지', RESUME: '중지 해제' }[kind];
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
      <label class="f">저장 용량 (GB) *<input name="storageGB" type="number" min="0.25" max="1024" step="0.25" required value="${+((cur?.storageMB ?? 1024) / 1024).toFixed(2)}" /><span class="hint">현재 사용 ${c.usedMB != null ? gb(c.usedMB) : '확인 전'}</span></label>
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
    if (f.storageGB) json.storageGB = Number(f.storageGB);
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

// ── Claude로 수정 — 이 업체 전용 작업 창 ─────────────────────────
async function claudeForCustomer(c, reqs) {
  const j = c.server;
  const open = (reqs ?? []).filter((r) => r.status === 'REQUESTED');
  const msg = [
    `이음ERP 고객 맞춤 수정 — ${c.name} (사업자번호 ${biz(c.bizRegNo)}).`,
    `sspower 저장소(ss-erp 브랜치)에서 CLAUDE.md 운영 규칙대로 해.`,
    `규칙: 이 업체만 달라지게 — ① 회사 설정값 ② 양식 파일 ③ 라이선스 모듈 스위치 순으로 고르고, 다른 고객에게는 아무것도 바뀌지 않아야 해. 고객 전용 브랜치·고객 서버 직접 수정 금지.`,
    j?.status === 'DONE'
      ? `이 업체 서버: Railway 프로젝트 ${j.projectName ?? ''} (${j.url}). 작업이 끝나면 테스트 통과 → ss-erp push → 우리 ERP 배포 확인 → 이 업체 서버만 재배포 → 이 업체 화면에 반영됐는지 확인까지 해.`
      : `이 업체는 ${c.deployment === 'ONPREM' ? '설치형(고객사 서버)' : '아직 서버가 없음'}이라 코드 반영까지만 하고, 고객 서버 반영 방법을 알려줘.`,
    c.current ? `라이선스: 사용자 ${c.current.maxUsers}명, 저장 용량 ${gb(c.current.storageMB ?? 1024)}, ${c.current.expiresAt}까지. 모듈을 새로 켜야 하면 모듈 이름을 알려줘 — 발급 사이트에서 이 업체 라이선스를 재발급할게.` : '',
    open.length ? `이 업체의 열린 수정 요청: ${open.map((r) => `#${r.issueNumber} ${r.title.replace(/^(\[[^\]]+\])+\s*/, '')}`).join(', ')} — 필요하면 gh issue view 로 읽어.` : '',
    `무엇을 바꿀지는 지금부터 내가 말할게. 모호하면 먼저 질문해.`,
  ].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(msg); toast(`${c.name} 작업 메시지를 복사했습니다 — 새 대화에 붙여 넣으세요`); } catch { prompt('복사해서 새 대화에 붙여 넣으세요', msg); }
  window.open('https://claude.ai/code', '_blank', 'noopener');
}

// ── 수정 요청 대장 ─────────────────────────────────────────────
const RSTATUS = { REQUESTED: ['요청', 'warn'], DONE: ['완료 · 반영 대기', 'steel'], DEPLOYED: ['반영됨', 'ok'] };
function requestTable(rows, forCustomer = false) {
  if (!rows.length) return '<div class="empty">요청이 없습니다</div>';
  return `<div class="table-wrap"><table><thead><tr><th>요청일</th>${forCustomer ? '' : '<th>고객</th>'}<th>내용</th><th class="hide-sm">화면</th><th>상태</th><th class="hide-sm">반영</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="num small">${dt(r.createdAt)}</td>${forCustomer ? '' : `<td>${r.kind === 'GLOBAL' ? '<span class="badge">전체</span>' : esc(r.customerName ?? '')}</td>`}
      <td><a href="#/requests/${r.id}">${esc(r.title.replace(/^(\[[^\]]+\])+\s*/, ''))}</a>${r.priority && r.priority !== '보통' ? ` <span class="badge seal">${esc(r.priority)}</span>` : ''}${r.fileCount ? ` <span class="muted small">📎${r.fileCount}</span>` : ''}${r.type ? `<div class="small muted">${esc(r.type)}</div>` : ''}</td><td class="hide-sm small">${esc(r.screen ?? '')}</td><td>${badge(RSTATUS[r.status])}</td>
      <td class="hide-sm small num">${r.deployedAt ? dt(r.deployedAt) : r.closedAt ? '완료 ' + dt(r.closedAt) : '—'}</td>
      <td class="r"><a class="btn sm" href="#/requests/${r.id}">열기</a></td></tr>`).join('')}
  </tbody></table></div>`;
}
// 첨부 — 파일 선택·끌어다 놓기·스크린샷 붙여넣기(Ctrl+V)
const MAX_FILE_MB = 10;
function attachBox(host) {
  const files = [];
  host.innerHTML = `<div class="drop" tabindex="0">파일을 끌어다 놓거나 <label class="link-like">선택<input type="file" multiple hidden accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.xlsx,.xls,.xlsm,.csv,.docx,.doc,.hwp,.hwpx,.pptx,.ppt,.txt,.zip,.dwg,.dxf" /></label>하세요. 화면 캡처는 이 페이지에서 <b>Ctrl+V</b>로 붙여 넣을 수 있습니다.<div class="small muted">그림·PDF·엑셀·한글·워드·도면·압축 · 파일당 10MB, 합계 25MB, 10개까지</div></div><div class="files"></div>`;
  const list = host.querySelector('.files');
  const draw = () => {
    list.innerHTML = files.map((f, i) => `<div class="file">${f.type.startsWith('image/') ? `<img src="${f.url}" alt="" />` : '<span class="ext">' + esc(f.name.split('.').pop().toUpperCase()) + '</span>'}<span class="nm">${esc(f.name)}<small>${Math.ceil(f.size / 1024)}KB</small></span><button type="button" class="x" data-i="${i}" aria-label="빼기">×</button></div>`).join('');
    list.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { files.splice(Number(b.dataset.i), 1); draw(); }));
  };
  const add = (fl) => {
    for (const f of fl) {
      if (f.size > MAX_FILE_MB * 1048576) { toast(`${f.name}: 10MB를 넘습니다`, 'error'); continue; }
      if (files.length >= 10) { toast('첨부는 10개까지입니다', 'error'); break; }
      const name = f.name && f.name !== 'image.png' ? f.name : `캡처-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.png`;
      files.push({ file: f, name, size: f.size, type: f.type || '', url: f.type.startsWith('image/') ? URL.createObjectURL(f) : '' });
    }
    draw();
  };
  host.querySelector('input[type=file]').onchange = (e) => { add(e.target.files); e.target.value = ''; };
  const drop = host.querySelector('.drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('on'); };
  drop.ondragleave = () => drop.classList.remove('on');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('on'); add(e.dataTransfer.files); };
  const onPaste = (e) => { const fl = [...(e.clipboardData?.files ?? [])]; if (fl.length) { e.preventDefault(); add(fl); } };
  document.addEventListener('paste', onPaste);
  return {
    detach: () => document.removeEventListener('paste', onPaste),
    payload: () => Promise.all(files.map((f) => new Promise((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok({ name: f.name, data: String(r.result).split(',')[1] });
      r.onerror = no;
      r.readAsDataURL(f.file);
    }))),
  };
}
let pasteBox = null;

const REQ_TYPES = ['화면·기능 수정', '출력 양식', '새 기능', '계산·업무 규칙', '데이터 이관·정리', '오류 신고', '기타'];
async function pageRequestNew() {
  const cid = new URLSearchParams(location.hash.split('?')[1] ?? '').get('customer');
  loading('requests');
  const [c, gh] = await Promise.all([cid ? api('/customers/' + cid) : null, api('/github')]);
  shell('requests', `
    <div class="page-head"><div><h1>${c ? `수정 요청 — ${esc(c.name)}` : '전체 업데이트 요청'}</h1>
      <p>${c ? '이 고객만 달라지는 수정입니다. 다른 고객에게는 영향이 없도록 설정·양식·모듈 스위치로 반영합니다.' : '모든 고객이 받게 되는 기능 추가·수정입니다.'} 등록하면 GitHub 이슈가 되고, Claude가 이 내용과 첨부를 그대로 읽고 작업합니다.</p></div></div>
    ${gh.connected ? '' : '<div class="note warn" style="margin-bottom:12px">먼저 <a href="#/settings">설정 &gt; GitHub 연결</a>을 마쳐 주세요.</div>'}
    <form id="rqf" class="panel"><div class="body">
      <div class="form-grid">
        <label class="f wide">제목<input name="title" maxlength="80" placeholder="비우면 '원하는 것' 첫 줄로 만듭니다 · 예: 발주서에 현장소장 확인란 추가" /></label>
        <label class="f">유형<select name="type">${REQ_TYPES.map((t) => `<option>${t}</option>`).join('')}</select></label>
        <label class="f">우선순위<select name="priority"><option>보통</option><option>급함</option><option>긴급(당일)</option></select><span class="hint">긴급은 금요 배포를 기다리지 않고 당일 반영</span></label>
        <label class="f">희망 반영일<input name="dueOn" type="date" /></label>
        <label class="f">배포 범위<select name="deploy">${(c ? ['고객 서버까지', '코드만'] : ['우리 ERP까지', '고객 서버 전체', '코드만']).map((o) => `<option>${o}</option>`).join('')}</select></label>
        <label class="f wide">화면<input name="screen" maxlength="200" placeholder="예: 발주 › 발주서 출력 / 현장관리 › 작업일보 / 회계 › 손익계산서" /></label>
        <label class="f wide">지금은 어떤가<textarea name="now" rows="3" placeholder="지금 화면·출력이 어떻게 되어 있는지. 캡처를 붙이면 더 정확합니다"></textarea></label>
        <label class="f wide">원하는 것 *<textarea name="want" rows="12" required placeholder="항목별로 줄을 나눠 적으세요. 계산식·규칙·예시 숫자가 있으면 그대로 적어 주세요.&#10;&#10;예)&#10;1. 발주서 결재란에 '현장소장 확인' 칸을 대표이사 왼쪽에 추가&#10;2. 현장소장 칸은 그 현장 담당 소장 이름이 자동으로 들어감&#10;3. 금액 500만원 이상만 대표이사 결재, 미만은 현장소장 확인으로 끝&#10;4. 출력 양식은 첨부한 엑셀(삼우전선_발주서.xlsx)과 똑같이"></textarea><span class="hint">마크다운 사용 가능 (표, 목록, **굵게**)</span></label>
        <label class="f wide">완료 기준 — 이렇게 되면 끝<textarea name="criteria" rows="4" placeholder="예)&#10;- 600만원 발주서: 현장소장 → 대표이사 순으로 결재&#10;- 300만원 발주서: 현장소장 확인만으로 승인&#10;- 출력물이 첨부 엑셀과 칸·글꼴·위치가 같음"></textarea></label>
        <div class="f wide"><span>첨부 — 고객 양식, 화면 캡처, 계산 예시 엑셀, 공문 등</span><div id="att"></div></div>
      </div>
    </div><div class="body row end" style="border-top:1px solid var(--line)">
      <a class="btn" href="${c ? `#/customers/${c.id}` : '#/requests'}">취소</a><button class="btn primary" id="rqsend">요청 등록</button>
    </div></form>`);
  pasteBox?.detach();
  pasteBox = attachBox(document.getElementById('att'));
  document.getElementById('rqf').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('rqsend');
    btn.disabled = true; btn.textContent = '올리는 중…';
    try {
      const json = { ...formData(e.target), files: await pasteBox.payload() };
      const r = await api(c ? `/customers/${c.id}/requests` : '/requests', { method: 'POST', json });
      pasteBox.detach(); pasteBox = null;
      toast(`이슈 #${r.issueNumber} 로 등록했습니다`);
      location.hash = `#/requests/${r.id}`;
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = '요청 등록'; }
  };
}

// 이슈 본문·댓글을 읽기 좋게 — 제목(###), 굵게, 표, 목록, 링크 정도만 (나머지는 그대로 글자)
function miniMd(md) {
  const lines = esc(md).split('\n');
  let out = '', table = null;
  const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/!\[([^\]]*)\]\([^)]*\)/g, '🖼 $1').replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const flush = () => { if (table) { out += `<table class="md">${table.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join('')}</tr>`).join('')}</table>`; table = null; } };
  for (const l of lines) {
    if (/^\|.*\|$/.test(l.trim())) { if (/^\|[\s|:-]+\|$/.test(l.trim())) continue; (table ??= []).push(l.trim().slice(1, -1).split('|').map((x) => x.trim())); continue; }
    flush();
    if (/^#{1,4}\s/.test(l)) out += `<h4>${inline(l.replace(/^#+\s/, ''))}</h4>`;
    else if (/^-{3,}$/.test(l.trim())) out += '<hr />';
    else if (/^&gt;\s?/.test(l)) out += `<div class="small muted">${inline(l.replace(/^&gt;\s?/, ''))}</div>`;
    else if (l.trim()) out += `<div>${inline(l)}</div>`;
    else out += '<div class="sp"></div>';
  }
  flush();
  return out;
}

async function pageRequest(id) {
  loading('requests');
  const r = await api('/requests/' + id);
  const fileUrl = (f, dl) => `/api/admin/requests/${r.id}/file?path=${encodeURIComponent(f.path)}${dl ? '&download=1' : ''}`;
  const img = (f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name);
  shell('requests', `
    <div class="page-head"><div><h1>${esc(r.title)}</h1>
      <p>${badge(RSTATUS[r.status])} ${r.customerName ? `<a href="#/customers/${r.customerId}">${esc(r.customerName)}</a>` : '전체 업데이트'} · ${esc(r.type ?? '')} · 우선순위 ${esc(r.priority ?? '보통')}${r.dueOn ? ` · 희망 ${esc(r.dueOn)}` : ''} · ${dt(r.createdAt)} 요청</p></div>
      <div class="row"><button class="btn primary" id="talk" title="첫 메시지를 복사하고 Claude를 엽니다. 새 대화에 붙여 넣고 sspower 저장소를 연결하세요">Claude와 대화로 진행</button><a class="btn" href="${esc(r.issueUrl)}" target="_blank" rel="noopener">GitHub #${r.issueNumber}</a></div></div>
    <div class="grid cols-2 req">
      <section class="panel"><header><h2>요청 내용</h2></header><div class="body md-body">${miniMd(r.issue.body.split('\n---\n규칙')[0])}</div></section>
      <section class="panel"><header><h2>첨부</h2><span class="muted small">${r.files.length}개</span></header><div class="body">
        ${r.files.length ? `<div class="gallery">${r.files.map((f) => `<a class="file" href="${fileUrl(f, !img(f))}" ${img(f) ? 'target="_blank"' : ''}>${img(f) ? `<img src="${fileUrl(f)}" alt="" loading="lazy" />` : `<span class="ext">${esc(f.name.split('.').pop().toUpperCase())}</span>`}<span class="nm">${esc(f.name)}<small>${Math.ceil(f.size / 1024)}KB · ${dt(f.at)}</small></span></a>`).join('')}</div>` : '<div class="empty">첨부가 없습니다</div>'}
      </div></section>
    </div>
    <section class="panel"><header><h2>주고받은 내용</h2><span class="muted small">Claude의 질문·결과 보고가 여기 올라옵니다</span></header><div class="body">
      ${r.comments.length ? r.comments.map((m) => `<div class="msg"><div class="who">${esc(m.author)} <span class="muted small">${dt(m.createdAt)}</span></div><div class="md-body">${miniMd(m.body)}</div></div>`).join('') : '<div class="empty">아직 답변이 없습니다. 월요일 작업 때 Claude가 처리하거나 질문을 남깁니다.</div>'}
      <form id="cmf" style="margin-top:16px;border-top:1px solid var(--line);padding-top:16px">
        <label class="f">답변·추가 요청<textarea name="text" rows="5" placeholder="Claude 질문에 대한 답, 빠진 내용, 고객이 추가로 말한 것"></textarea></label>
        <div id="att2" style="margin-top:10px"></div>
        <div class="row end" style="margin-top:12px">
          ${r.status !== 'REQUESTED' ? '<label class="small" style="display:flex;gap:6px;align-items:center;margin-right:auto"><input type="checkbox" name="reopen" style="width:auto;min-height:0" /> 다시 작업 요청 (완료된 요청을 되돌림)</label>' : ''}
          <button class="btn primary" id="cmsend">보내기</button></div>
      </form>
    </div></section>`);
  document.getElementById('talk').onclick = async () => {
    const msg = `sspower 저장소 작업. 수정 요청 이슈 #${r.issueNumber} (${r.customerName ? `고객 맞춤 — ${r.customerName}` : '전체 업데이트'}: ${r.title.replace(/^(\[[^\]]+\])+\s*/, '')}) 을 같이 진행하자.
CLAUDE.md 운영 규칙대로 해. 먼저 이슈·댓글과 첨부(requests 브랜치)를 읽고, 모호한 건 나한테 질문부터 해. 결정된 건 이슈에 정리해 두고, 내가 "마무리"라고 하면 결과 댓글 남기고 닫아.`;
    try { await navigator.clipboard.writeText(msg); toast('첫 메시지를 복사했습니다 — 새 대화에 붙여 넣으세요'); } catch { prompt('복사해서 새 대화에 붙여 넣으세요', msg); }
    window.open('https://claude.ai/code', '_blank', 'noopener');
  };
  pasteBox?.detach();
  pasteBox = attachBox(document.getElementById('att2'));
  document.getElementById('cmf').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('cmsend');
    btn.disabled = true; btn.textContent = '보내는 중…';
    try {
      const f = e.target;
      await api(`/requests/${r.id}/comments`, { method: 'POST', json: { text: f.text.value, reopen: !!f.reopen?.checked, files: await pasteBox.payload() } });
      toast('보냈습니다'); pageRequest(r.id);
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = '보내기'; }
  };
}
let rolloutTimer = null;
async function pageRequests() {
  clearTimeout(rolloutTimer);
  loading('requests');
  const [rq, ro, gh] = await Promise.all([api('/requests'), api('/rollouts'), api('/github')]);
  const last = ro.rows[0];
  const ok = (r) => r.results.filter((x) => x.status === 'SUCCESS').length;
  shell('requests', `
    <div class="page-head"><div><h1>요청 대장</h1><p>고객 수정 요청과 전체 업데이트 요청, 그리고 고객 서버 반영 상태입니다. 요청은 GitHub 이슈로, 반영은 금요 배포로.</p></div>
      <div class="row"><button class="btn" id="greq">전체 업데이트 요청</button><button class="btn primary" id="rollout" ${ro.running ? 'disabled' : ''}>${ro.running ? '전체 재배포 진행 중…' : '고객 서버 전체 재배포'}</button></div></div>
    ${gh.connected ? '' : '<div class="note warn" style="margin-bottom:12px">요청을 이슈로 남기려면 <a href="#/settings">설정 &gt; GitHub 연결</a>이 필요합니다.</div>'}
    <section class="panel"><header><h2>요청</h2><span class="muted small">${rq.rows.length}건</span></header>${requestTable(rq.rows)}</section>
    <section class="panel"><header><h2>전체 재배포 기록</h2><span class="muted small">${ro.rows.length}회</span></header>
      ${last ? `<div class="body"><p style="margin:0 0 8px"><b>${dt(last.startedAt)}</b> ${last.finishedAt ? `끝남 — 성공 ${ok(last)}/${last.results.length}` : '<span class="badge steel">진행 중</span>'}</p>
        <div class="table-wrap"><table><thead><tr><th>고객</th><th>결과</th><th class="hide-sm">시각</th></tr></thead><tbody>
        ${last.results.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.status === 'SUCCESS' ? '<span class="badge ok">성공</span>' : x.status === 'QUEUED' ? '<span class="badge">대기</span>' : `<span class="badge seal">${esc(x.status)}</span>`}</td><td class="hide-sm small num">${x.at ? dt(x.at) : ''}</td></tr>`).join('')}
        </tbody></table></div>
        ${ro.rows.length > 1 ? `<p class="small muted" style="margin:10px 0 0">이전: ${ro.rows.slice(1, 6).map((r) => `${dt(r.startedAt)} (${ok(r)}/${r.results.length})`).join(' · ')}</p>` : ''}</div>` : '<div class="empty">아직 전체 재배포를 한 적이 없습니다</div>'}
    </section>`);
  document.getElementById('greq').onclick = () => { location.hash = '#/requests/new'; };
  document.getElementById('rollout').onclick = async () => {
    if (!confirm('개설된 고객 서버 전부를 최신 코드로 하나씩 재배포합니다. 고객당 2~5분, 그동안 그 고객은 잠깐 접속이 끊길 수 있습니다. 계속할까요?')) return;
    try { await api('/rollouts', { method: 'POST' }); toast('전체 재배포를 시작했습니다'); pageRequests(); } catch (err) { toast(err.message, 'error'); }
  };
  if (ro.running) rolloutTimer = setTimeout(() => { if (location.hash === '#/requests') pageRequests(); }, 15_000);
}

// ── 설정 ───────────────────────────────────────────────────────
async function pageSettings() {
  loading('settings');
  const [me, rw, gh, fs, bk] = await Promise.all([api('/me'), api('/railway'), api('/github'), api('/files-storage'), api('/backup-status')]);
  shell('settings', `
    <div class="page-head"><div><h1>설정</h1><p>관리자 비밀번호와 판매자 서명키 정보입니다.</p></div></div>
    <section class="panel"><header><h2>관리자 비밀번호 변경</h2><span class="muted small">${me.passwordChangedAt ? '마지막 변경 ' + dt(me.passwordChangedAt) : '처음 받은 비밀번호 사용 중'}</span></header>
      <form id="pwf" class="body" autocomplete="off">
        <div class="form-grid">
          <label class="f wide">현재 비밀번호<input type="password" name="current" autocomplete="current-password" required /></label>
          <label class="f">새 비밀번호<input type="password" name="next" autocomplete="new-password" minlength="12" required /><span class="hint">12자 이상, 영문 대·소문자·숫자·특수문자 중 3가지 이상</span></label>
          <label class="f">새 비밀번호 확인<input type="password" name="confirm" autocomplete="new-password" minlength="12" required /></label>
        </div>
        <p class="small muted" style="margin:12px 0 0">바꾸면 이 화면을 뺀 다른 PC·휴대폰의 로그인은 모두 끊깁니다.</p>
        <div class="row end" style="margin-top:12px"><button class="btn primary">비밀번호 변경</button></div>
      </form>
    </section>
    <section class="panel"><header><h2>Railway 연결 (고객 서버 자동 개설)</h2>${rw.connected ? `<span class="badge ok">연결됨${rw.source === 'env' ? ' · 환경변수' : ''}</span>` : '<span class="badge warn">연결 안 됨</span>'}</header>
      <form id="rwf" class="body" autocomplete="off">
        <p class="muted" style="margin-top:0">호스팅형 고객의 서버를 이 사이트에서 바로 만들려면 Railway 토큰이 필요합니다. Railway 대시보드 → 계정 설정 → <b>Tokens</b>에서 워크스페이스를 선택해 토큰을 만든 뒤 아래에 붙여 넣으세요. 토큰은 암호화되어 저장되고 다시 화면에 나오지 않습니다.</p>
        <div class="form-grid">
          <label class="f">Railway 토큰<input type="password" name="token" placeholder="${rw.connected ? '바꿀 때만 입력' : '토큰 붙여 넣기'}" autocomplete="off" ${rw.connected ? '' : 'required'} /></label>
          <label class="f">워크스페이스 ID<input name="workspaceId" value="${esc(rw.workspaceId ?? 'aa4da206-c537-4674-8bed-aac1be15cb20')}" required /><span class="hint">서버를 만들 Railway 워크스페이스</span></label>
        </div>
        <p class="small muted" style="margin:10px 0 0">서버 위치: 싱가포르 (${esc(rw.region)}) · 고객 서버 비용(고객당 월 약 $5~15)은 이 Railway 계정으로 청구됩니다.</p>
        <div class="row end" style="margin-top:12px"><button class="btn primary">연결 확인 후 저장</button></div>
      </form>
    </section>
    <section class="panel"><header><h2>백업</h2>${bk.configured ? (bk.last?.ok ? '<span class="badge ok">정상</span>' : bk.last ? '<span class="badge seal">실패</span>' : '<span class="badge">첫 백업 대기</span>') : '<span class="badge warn">외부 백업 저장소 없음</span>'}</header><div class="body">
      <p class="muted" style="margin-top:0">이 사이트(고객·라이선스·계약·청구·요청 대장)는 매일 새벽 4시에 다른 지역(암스테르담) 저장소로 백업되고 60일 보관됩니다. 새로 개설하는 호스팅 고객 서버도 매일 DB와 첨부파일 사본이 같은 저장소의 고객별 폴더로 복사됩니다.</p>
      ${bk.last ? `<p style="margin:0 0 10px" class="${bk.last.ok ? '' : 'tone-seal'}">${dt(bk.last.at)} — ${esc(bk.last.message)}</p>` : ''}
      <div class="row end"><button class="btn" id="bknow" ${bk.configured ? '' : 'disabled'}>지금 백업</button></div>
    </div></section>
    <section class="panel"><header><h2>고객 파일 저장소 (사진·첨부)</h2>${fs.connected ? `<span class="badge ok">연결됨 · ${esc(fs.bucket)}${fs.source === 'env' ? ' · 자동' : ''}</span>` : '<span class="badge warn">연결 안 됨 — 고객 서버 디스크에 저장</span>'}</header>
      <form id="fsf" class="body" autocomplete="off">
        <p class="muted" style="margin-top:0">새로 개설하는 호스팅형 고객 서버의 사진·첨부파일을 이 저장소(S3 호환 버킷)에 고객별 폴더(<span class="mono">customers/사업자번호/</span>)로 저장합니다. 기본은 발급 사이트 프로젝트의 버킷이 자동으로 연결되어 있고, 다른 저장소(Cloudflare R2 등)로 바꿀 때만 아래에 입력하세요. 키는 암호화되어 저장되고 다시 화면에 나오지 않습니다.</p>
        <div class="form-grid">
          <label class="f">Endpoint<input name="endpoint" value="${esc(fs.endpoint ?? 'https://t3.storageapi.dev')}" required /></label>
          <label class="f">Bucket Name<input name="bucket" value="${esc(fs.bucket ?? '')}" placeholder="eum-files-…" required /></label>
          <label class="f">Access Key ID<input type="password" name="accessKeyId" autocomplete="off" required /></label>
          <label class="f">Secret Access Key<input type="password" name="secretAccessKey" autocomplete="off" required /></label>
        </div>
        <div class="row end" style="margin-top:12px"><button class="btn primary">저장</button></div>
      </form>
    </section>
    <section class="panel"><header><h2>GitHub 연결 (수정 요청 → 이슈)</h2>${gh.connected ? `<span class="badge ok">연결됨${gh.source === 'env' ? ' · 환경변수' : ''}</span>` : '<span class="badge warn">연결 안 됨</span>'}</header>
      <form id="ghf" class="body" autocomplete="off">
        <p class="muted" style="margin-top:0">고객 수정 요청을 <span class="mono">${esc(gh.repo)}</span> 저장소 이슈로 남깁니다. GitHub → Settings → Developer settings → <b>Fine-grained tokens</b>에서 이 저장소만 선택하고 권한은 <b>Issues: Read and write</b>, <b>Contents: Read and write</b>(첨부 파일을 <span class="mono">requests</span> 브랜치에 올림) 두 가지만 준 토큰을 만들어 붙여 넣으세요.</p>
        <div class="form-grid"><label class="f wide">GitHub 토큰<input type="password" name="token" placeholder="${gh.connected ? '바꿀 때만 입력' : 'github_pat_…'}" autocomplete="off" required /></label></div>
        <div class="row end" style="margin-top:12px"><button class="btn primary">연결 확인 후 저장</button></div>
      </form>
    </section>
    <section class="panel"><header><h2>판매자 공개키</h2><button class="btn sm" id="cp">복사</button></header><div class="body">
      <p class="muted" style="margin-top:0">이음ERP에 들어 있는 공개키와 같아야 이 사이트에서 발급한 라이선스가 인정됩니다. 공개키는 알려져도 괜찮습니다.</p>
      <div class="lic-text">${esc(me.publicKey)}</div>
      <div class="note warn" style="margin-top:12px">비밀키(서명키)는 이 서버의 환경변수에만 있고 화면에는 나오지 않습니다. 따로 보관한 백업 파일을 잃어버리지 마세요. 비밀키가 유출되면 누구나 라이선스를 만들 수 있으니 즉시 키를 교체해야 합니다.</div>
    </div></section>`);
  document.getElementById('cp').onclick = () => copy(me.publicKey, '공개키를 복사했습니다');
  document.getElementById('bknow').onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = '백업 중…';
    try { const r = await api('/backup-now', { method: 'POST' }); toast(r.message); pageSettings(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; e.target.textContent = '지금 백업'; }
  };
  document.getElementById('fsf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/files-storage', { method: 'PUT', json: formData(e.target) }); toast('파일 저장소를 연결했습니다'); pageSettings(); } catch (err) { toast(err.message, 'error'); }
  };
  document.getElementById('ghf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/github', { method: 'PUT', json: formData(e.target) }); toast('GitHub에 연결했습니다'); pageSettings(); } catch (err) { toast(err.message, 'error'); }
  };
  document.getElementById('rwf').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/railway', { method: 'PUT', json: formData(e.target) }); toast('Railway에 연결했습니다'); pageSettings(); } catch (err) { toast(err.message, 'error'); }
  };
  document.getElementById('pwf').onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    if (f.next !== f.confirm) return toast('새 비밀번호가 서로 다릅니다', 'error');
    try {
      await api('/password', { method: 'POST', json: { current: f.current, next: f.next } });
      toast('비밀번호를 바꿨습니다');
      pageSettings();
    } catch (err) { toast(err.message, 'error'); }
  };
}

// ── 라우팅 ─────────────────────────────────────────────────────
async function route() {
  const h = location.hash.split('?')[0] || '#/';
  if (pasteBox && !h.startsWith('#/requests/')) { pasteBox.detach(); pasteBox = null; }
  try {
    if (h === '#/' || h === '#') await pageHome();
    else if (h === '#/customers') await pageCustomers();
    else if (h === '#/customers/new') await pageNewCustomer();
    else if (/^#\/customers\/[^/]+\/delivery$/.test(h)) await pageDelivery(h.split('/')[2]);
    else if (h.startsWith('#/customers/')) await pageCustomer(h.slice('#/customers/'.length));
    else if (h === '#/contracts') await pageContracts();
    else if (h === '#/contracts/new') await pageContractForm(null);
    else if (/^#\/contracts\/[^/]+\/edit$/.test(h)) await pageContractForm(h.split('/')[2]);
    else if (h.startsWith('#/contracts/')) await pageContract(h.slice('#/contracts/'.length));
    else if (h === '#/billing') await pageBilling();
    else if (h === '#/support') await pageSupport();
    else if (h === '#/pricing') await pagePricing();
    else if (h === '#/licenses') await pageLicenses();
    else if (h === '#/requests') await pageRequests();
    else if (h === '#/requests/new') await pageRequestNew();
    else if (h.startsWith('#/requests/')) await pageRequest(h.slice('#/requests/'.length));
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
