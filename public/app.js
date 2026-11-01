// 이음사인 직원 화면 (해시 라우팅 단일 페이지)
let ME = null, ORG = null;
const MODE = { remote: '비대면', inperson: '대면', link: '링크', bulk: '대량' };
const KIND = { external: '외부', internal: '직원', seal: '직인' };
const can = (p) => ME?.user.perms.includes(p);
const view = () => $('#view');

async function boot() {
  try { ME = await api('/me'); } catch (e) { if (e.status === 401) return loginPage(); if (e.status === 423) return lockPage(); throw e; }
  ORG = await api('/org');
  shell(); route();
}
window.addEventListener('hashchange', () => route());

// 대면 서명 중 잠긴 세션: 담당자 비밀번호로만 푼다 (서버가 다른 요청을 모두 막는다)
function lockPage() {
  $('#app').innerHTML = `<div class="lock"><form class="card" id="ul"><h2>담당자 화면 잠금</h2><p class="small muted">서명자에게 기기를 넘긴 동안 담당자 화면이 잠겼습니다. 담당자 비밀번호를 입력하세요.</p><input class="inp" type="password" name="pw" autocomplete="current-password" required><button class="btn primary" style="margin-top:8px">잠금 해제</button></form></div>`;
  $('#ul').addEventListener('submit', async (e) => { e.preventDefault(); await guard(() => api('/me/verify-password', { method: 'POST', body: { password: new FormData(e.target).get('pw') } })); boot(); });
}
function loginPage() {
  $('#app').innerHTML = `<div class="login"><form class="card" id="lf">
    <div class="logo" style="color:var(--ink);padding:0 0 12px"><i>이</i><div>이음사인<small style="color:var(--muted)">전자문서·전자서명</small></div></div>
    <label class="f"><span>이메일</span><input class="inp" name="email" type="email" autocomplete="username" required></label>
    <label class="f"><span>비밀번호</span><input class="inp" name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn primary" style="width:100%;justify-content:center">로그인</button></form></div>`;
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    await guard(() => api('/login', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }));
    boot();
  });
}

function shell() {
  const n = (h, t, cnt) => `<a href="#${h}" data-nav="${h}">${t}${cnt ? `<span class="cnt">${cnt}</span>` : ''}</a>`;
  $('#app').innerHTML = `<div class="shell"><nav class="side" aria-label="주 메뉴">
    <div class="logo"><i>이</i><div>이음사인<small>${esc(ME.company.name)}</small></div></div>
    ${n('/', '홈')}${n('/new', '＋ 새 계약')}${n('/docs', '문서함')}${n('/approvals', '결재함', ME.approvalsWaiting)}${n('/schedules', '일정')}
    <div class="sec">계약 방식</div>${can('link.manage') ? n('/links', '링크계약·QR') : ''}${can('bulk.send') ? n('/bulk', '대량계약') : ''}${n('/templates', '템플릿')}${n('/tools', '부동산 도구')}
    <div class="sec">관리</div>${n('/settings', '설정')}${n('/inbox', '알림', ME.unread)}
    <div class="me"><b>${esc(ME.user.name)}</b>${esc(ME.user.email)}<br><a href="#" id="logout" style="padding:0;color:var(--ink-muted)">로그아웃</a></div>
  </nav><main class="main" id="view" tabindex="-1"></main></div>`;
  $('#logout').addEventListener('click', async (e) => { e.preventDefault(); await api('/logout', { method: 'POST' }); location.hash = ''; location.reload(); });
}
async function refreshMe() { ME = await api('/me'); const a = $$('[data-nav]'); a.forEach((x) => { const c = x.querySelector('.cnt'); if (x.dataset.nav === '/approvals') x.innerHTML = `결재함${ME.approvalsWaiting ? `<span class="cnt">${ME.approvalsWaiting}</span>` : ''}`; if (x.dataset.nav === '/inbox') x.innerHTML = `알림${ME.unread ? `<span class="cnt">${ME.unread}</span>` : ''}`; void c; }); }

async function route() {
  if (!ME) return;
  const h = location.hash.slice(1) || '/';
  const parts = h.split('?')[0].split('/').filter(Boolean);
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === '/' + (parts[0] || '') || (a.dataset.nav === '/' && !parts.length)));
  view().innerHTML = '<div class="empty">불러오는 중…</div>';
  const P = {
    '': pageHome, new: pageNew, docs: pageDocs, doc: pageDoc, approvals: pageApprovals, schedules: pageSchedules, links: pageLinks, bulk: pageBulk,
    templates: pageTemplates, tools: pageTools, settings: pageSettings, inbox: pageInbox, inperson: pageInperson,
  }[parts[0] || ''];
  try { await (P || pageHome)(...parts.slice(1)); view().focus({ preventScroll: true }); } catch (e) { view().innerHTML = `<div class="note bad">${esc(e.message)}</div>`; }
}
const go = (h) => { if (location.hash === '#' + h) route(); else location.hash = h; };
const userName = (id) => ORG.users.find((u) => u.id === id)?.name || '-';
const userOpts = (sel, filter = (u) => u.status === 'active') => ORG.users.filter(filter).map((u) => `<option value="${u.id}"${u.id === sel ? ' selected' : ''}>${esc(u.name)} (${esc(u.email)})</option>`).join('');

// ── 홈
async function pageHome() {
  const [s, ap] = await Promise.all([api('/stats'), api('/approvals')]);
  const by = Object.fromEntries(s.byStatus.map((x) => [x.status, x.n]));
  const k = (st, label) => `<a class="card kpi" href="#/docs?status=${st}"><b>${by[st] || 0}</b><span>${label}</span></a>`;
  const waiting = ap.filter((a) => a.actionable);
  view().innerHTML = `<div class="head"><div><h1>${esc(ME.user.name)}님, 안녕하세요</h1><p>${esc(ME.company.name)} 전자계약 현황</p></div><a class="btn primary" href="#/new">＋ 새 계약</a></div>
  <div class="grid g4">${k('draft', '작성 중')}${k('approval', '내부 결재 중')}${k('in_progress', '서명 진행 중')}${k('completed', '완료')}</div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h2>결재 대기 ${waiting.length ? `<span class="badge b-waiting">${waiting.length}건</span>` : ''}</h2>${waiting.length ? `<table class="t">${waiting.slice(0, 8).map((a) => `<tr class="click" data-h="${a.target_type === 'document' ? '/doc/' + a.target_id : '/bulk/' + a.target_id}"><td>${esc(a.title)}</td><td class="muted small nowrap">${a.round}차 ${a.step_no}단계</td></tr>`).join('')}</table>` : '<div class="empty">결재할 문서가 없습니다</div>'}</div>
    <div class="card"><h2>다가오는 일정 <a class="small" href="#/docs?renewal=30" style="float:right">갱신 검토 ${s.renewal}건 →</a></h2>${s.upcoming.length ? `<table class="t">${s.upcoming.map((x) => `<tr class="click" data-h="/doc/${x.document_id}"><td class="nowrap">${esc(x.date)}</td><td><span class="tag">${esc(x.title)}</span></td><td>${esc(x.doc_title)}</td></tr>`).join('')}</table>` : '<div class="empty">예정된 일정이 없습니다</div>'}</div>
  </div>`;
  view().querySelectorAll('[data-h]').forEach((r) => r.addEventListener('click', () => go(r.dataset.h)));
}
const docTitleCache = {};

// ── 새 계약: 네 가지 방식
async function pageNew(mode) {
  if (mode === 'remote' || mode === 'inperson') return newDocForm(mode);
  view().innerHTML = `<div class="head"><div><h1>새 계약 시작</h1><p>기업 간(B2B)·개인 고객(B2C)·부동산·건설 현장 계약을 같은 엔진으로 처리합니다. 네 방식은 참여자 확인 방법과 문서를 만드는 방법만 다릅니다.</p></div></div>
  <div class="modes">
    <button class="mode" data-go="/new/remote"><span class="n">① 비대면계약</span><b>링크 보내서 서명</b><p>담당자가 문서를 작성하고 수신자마다 개별 링크를 보냅니다.</p><ul><li>참여자 확인: 서명 링크 + 이메일·휴대폰 인증(선택)</li><li>내부 결재 후 발송</li></ul></button>
    <button class="mode" data-go="/new/inperson"><span class="n">② 대면계약</span><b>현장 기기 한 대로 차례 서명</b><p>태블릿·휴대폰 한 대로 참여자가 차례로 확인하고 서명합니다.</p><ul><li>참여자 확인: 담당자가 신분증 대조 등 기록</li><li>온라인 상태에서 사용</li></ul></button>
    <button class="mode" data-go="/links" ${can('link.manage') ? '' : 'disabled'}><span class="n">③ 링크계약</span><b>공통 URL·QR 접수</b><p>접속한 사람마다 별도 문서가 만들어집니다. 동의서·신청서 접수용.</p><ul><li>참여자 확인: 휴대폰 인증 또는 인증 없음</li><li>QR 접속만으로는 확인 처리 안 함</li></ul></button>
    <button class="mode" data-go="/bulk/new" ${can('bulk.send') ? '' : 'disabled'}><span class="n">④ 대량계약</span><b>엑셀로 여러 건 발송</b><p>템플릿 전용 엑셀 양식에 수신자별 값을 넣어 독립 계약을 만듭니다.</p><ul><li>오류 행 검증 · 미리보기 · 큐 발송</li><li>실패 건만 재시도</li></ul></button>
  </div>
  <div class="card" style="margin-top:16px"><h2>업종별 예시 서식 <span class="small muted">(모두 회사 검토용 예시입니다. 기관 승인·법정 서식이 아닙니다)</span></h2>
    <div class="grid g3">
      <div><h3>기업 간(B2B) · 개인 고객(B2C)</h3><ul class="small" style="margin:0;padding-left:16px"><li>용역(업무위탁)·물품 공급 계약 — 상대 회사 상호·사업자번호 입력, 당사 직인</li><li>비밀유지계약(NDA)</li><li>서비스 이용 계약(개인 고객) — 약관·개인정보·마케팅 동의 분리</li><li>개인정보 수집·이용 동의서 — 링크·QR 접수에 적합</li></ul></div>
      <div><h3>부동산</h3><ul class="small" style="margin:0;padding-left:16px"><li>주택 임대차(전세·월세), 매매, 상가 임대차, 갱신·변경 합의, 확인·설명서 수령 확인</li><li>공동명의·대리 없이 공동 임대인/임차인, 당사·공동중개 중개사 선택 추가</li><li>계약금+중도금+잔금 합계 검증, 중도금·잔금일 일정</li><li>거래신고·임대차 신고 30일, 갱신 통지 기간 자동 일정 · <a href="#/tools">중개보수 계산</a></li></ul></div>
      <div><h3>건설·현장</h3><ul class="small" style="margin:0;padding-left:16px"><li>현장 근로계약(대면·대량)</li><li>자재 인수확인(사진 첨부)</li><li>검측 확인(사진대장 2×2·도면)</li><li>협력업체 계약(내부결재 → 외부 서명 → 직인)</li><li>현장 출입·안전교육 동의(QR)</li></ul></div>
    </div></div>`;
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

async function newDocForm(mode) {
  const tpls = (await api('/templates')).filter((t) => t.usable);
  const cloud = await api('/cloud/providers');
  const q = new URLSearchParams(location.hash.split('?')[1]);
  const tid = Number(q.get('t')) || (q.get('cat') && tpls.find((x) => x.category === q.get('cat'))?.id) || tpls[0]?.id;
  if (!tid) { view().innerHTML = '<div class="empty">사용할 수 있는 템플릿이 없습니다</div>'; return; }
  const t = await api('/templates/' + tid);
  const tv = t.version;
  const sender = tv.fields.filter((f) => (f.owner || 'sender') === 'sender');
  const lines = await api('/approval-lines');
  const optToggle = (r) => (r.optional ? `<label class="chk small" style="float:right"><input type="checkbox" data-use="${r.key}"> 이 참여자 추가</label>` : '');
  const rolesHtml = tv.roles.map((r) => {
    const box = (inner) => `<div class="card flat" data-role="${r.key}"${r.optional ? ' data-optional="1"' : ''}><h3>${esc(r.label)} <span class="tag">${KIND[r.kind]}${r.party === 'company' ? '·회사' : ''}</span>${r.optional ? ' <span class="faint small">선택</span>' : ''}${optToggle(r)}</h3><div class="rbody"${r.optional ? ' hidden' : ''}>${inner}</div></div>`;
    if (r.kind === 'internal') return box(`<select class="inp" name="p_${r.key}_user">${userOpts(ME.user.id)}</select>`);
    if (r.kind === 'seal') return box('<p class="muted small" style="margin:0">차례가 되면 직인 사용 권한자가 날인합니다. 회사가 승인한 사전날인 정책 범위 안이면 자동 날인됩니다.</p>');
    return box(`${r.party === 'company' ? `<div class="grid g2"><label class="f"><span>상호(회사명) <i>*</i></span><input class="inp" name="p_${r.key}_org"></label><label class="f"><span>사업자등록번호</span><input class="inp" name="p_${r.key}_orgno" placeholder="000-00-00000"></label></div>` : ''}
      <div class="grid g3"><label class="f"><span>${r.party === 'company' ? '대표자·담당자' : '이름'} <i>*</i></span><input class="inp" name="p_${r.key}_name"></label>
      <label class="f"><span>이메일</span><input class="inp" type="email" name="p_${r.key}_email"></label>
      <label class="f"><span>휴대폰</span><input class="inp" type="tel" name="p_${r.key}_phone" placeholder="010-0000-0000"></label></div>
      ${mode === 'remote' ? `<div class="grid g2"><label class="f"><span>본인 확인 방법</span><select class="inp" name="p_${r.key}_auth"><option value="link">서명 링크만</option><option value="email_otp">이메일 인증번호</option><option value="phone_otp">휴대폰 인증번호</option></select></label>` : '<div class="grid g2">'}
      <label class="f"><span>완료 문서 전달</span><select class="inp" name="p_${r.key}_delivery"><option value="email">이메일</option><option value="sms">문자</option><option value="none">전달 안 함(현장 출력)</option></select></label></div>`);
  }).join('');
  const checksHint = (tv.extra?.checks || []).map((c) => `<div class="note small" style="margin-bottom:8px">${esc(c.label || '금액 확인')}: ${c.parts.map((k) => esc(sender.find((f) => f.key === k)?.label || k)).join(' + ')} = ${esc(sender.find((f) => f.key === c.total)?.label || c.total)} <b id="sumchk"></b></div>`).join('');
  const dlHint = (tv.extra?.deadlines || []).length ? `<p class="small muted">자동 일정: ${tv.extra.deadlines.map((x) => esc(x.title)).join(' · ')}</p>` : '';
  view().innerHTML = `<div class="head"><div><h1>${mode === 'remote' ? '① 비대면계약' : '② 대면계약'} 작성</h1><p>${mode === 'remote' ? '발송하면 외부 참여자에게 개별 서명 링크가 갑니다.' : '발송(시작) 후 대면 진행 화면에서 참여자를 확인하고 한 사람씩 서명받습니다.'}</p></div></div>
  <form id="nf" class="split"><div>
    <div class="card"><label class="f"><span>템플릿</span><select class="inp" id="tsel">${[...new Set(tpls.map((x) => x.category))].map((c) => `<optgroup label="${esc(c)}">${tpls.filter((x) => x.category === c).map((x) => `<option value="${x.id}"${x.id === tid ? ' selected' : ''}>${esc(x.name)}${x.scope === 'company' ? '' : ' (개인)'}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <label class="f"><span>문서 제목</span><input class="inp" name="title" value="${esc(t.name.replace(/^\[예시\]\s*/, ''))}"></label>
      <h2 style="margin-top:6px">작성자 입력 항목</h2>${checksHint}${sender.map((f) => fieldBlock(f, '')).join('') || '<p class="muted">없음</p>'}${dlHint}</div>
    <div class="card"><h2>참여자 <span class="small muted">(서명 순서대로)</span></h2>${rolesHtml}</div>
    <div class="card"><h2>첨부 ${tv.attachments?.photo ? '<span class="tag">사진대장 2×2</span>' : ''}${tv.attachments?.drawing ? '<span class="tag">도면</span>' : ''}</h2>
      <div class="row"><select class="inp" id="akind" style="width:auto"><option value="photo">사진</option><option value="drawing">도면</option><option value="other">기타(PDF 등)</option></select>
      <input type="file" id="afile" multiple accept="image/png,image/jpeg,application/pdf"></div>
      <div class="thumbs" id="athumbs" style="margin-top:10px"></div>
      <hr class="sep"><h3>원본 파일 (선택)</h3><p class="small muted" style="margin:0 0 6px">올린 순간의 파일을 복사해 고정합니다. 원본이 나중에 바뀌어도 이 계약은 바뀌지 않습니다.</p>
      <div class="row"><input type="file" id="bfile" accept="application/pdf,image/png,image/jpeg"> ${cloud.map((c) => `<button type="button" class="btn sm" data-cloud="${c.key}" ${c.connected ? '' : 'title="미연동"'}>${esc(c.name)} ${c.connected ? '' : '<span class="badge b-not_connected">미연동</span>'}</button>`).join('')}</div><div id="binfo" class="small muted"></div></div>
  </div><aside>
    <div class="card"><h2>내부 결재</h2><select class="inp" name="line"><option value="">결재 없이(회사 규칙에 해당하면 결재 필요)</option>${lines.map((l) => `<option value="${l.id}">${esc(l.name)} — ${l.steps.map((s) => esc(s.name) + (s.kind === 'reference' ? '(참조)' : '')).join(' → ')}</option>`).join('')}</select>
      <p class="small muted">결재 완료 뒤 내용이나 서명 대상이 바뀌면 같은 결재선으로 재결재를 받습니다.</p></div>
    <div class="card"><button class="btn primary" style="width:100%;justify-content:center">문서 저장</button><p class="small muted" style="margin:8px 0 0">저장 후 문서 화면에서 결재 요청·발송합니다.</p></div>
  </aside></form>`;
  $('#tsel').addEventListener('change', (e) => go(`/new/${mode}?t=${e.target.value}`));
  $$('[data-use]').forEach((c) => c.addEventListener('change', () => { c.closest('[data-role]').querySelector('.rbody').hidden = !c.checked; }));
  const sumCheck = () => { const c = tv.extra?.checks?.[0]; if (!c || !$('#sumchk')) return; const v = readFields($('#nf'), sender); const n = (k) => Number(String(v[k] || 0).replace(/,/g, '')) || 0;
    const parts = c.parts.reduce((a, k) => a + n(k), 0), total = n(c.total); $('#sumchk').textContent = total ? (parts === total ? '✓ 맞음' : `차이 ${(total - parts).toLocaleString('ko-KR')}원`) : ''; $('#sumchk').style.color = parts === total ? 'var(--ok)' : 'var(--bad)'; };
  $('#nf').addEventListener('input', sumCheck);
  const atts = []; let baseId = null;
  const drawThumbs = () => { $('#athumbs').innerHTML = atts.map((a, i) => `<figure>${a.mime === 'application/pdf' ? '<div style="height:80px;display:grid;place-items:center;background:#f3f1ea">PDF</div>' : `<img src="${a.preview}" alt="">`}<figcaption><span>${esc({ photo: '사진', drawing: '도면', other: '기타' }[a.kind])} ${i + 1}</span><button type="button" class="btn ghost sm" data-del="${i}" aria-label="삭제">✕</button></figcaption></figure>`).join(''); $$('[data-del]').forEach((b) => b.addEventListener('click', () => { atts.splice(b.dataset.del, 1); drawThumbs(); })); };
  $('#afile').addEventListener('change', async (e) => {
    for (const f of e.target.files) {
      const url = await shrinkImage(f);
      const r = await guard(() => api('/files', { method: 'POST', body: { dataUrl: url, name: f.name } }));
      atts.push({ file_id: r.id, kind: $('#akind').value, caption: f.name.replace(/\.\w+$/, ''), preview: url, mime: r.mime });
    }
    e.target.value = ''; drawThumbs();
  });
  $('#bfile').addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; const r = await guard(async () => api('/files', { method: 'POST', body: { dataUrl: await fileToDataUrl(f), name: f.name } })); baseId = r.id; $('#binfo').textContent = `고정본 ${r.name} · SHA-256 ${r.sha256.slice(0, 16)}…`; });
  $$('[data-cloud]').forEach((b) => b.addEventListener('click', () => guard(() => api(`/cloud/${b.dataset.cloud}/import`, { method: 'POST', body: {} }))));
  $('#nf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const used = tv.roles.filter((r) => !r.optional || $(`[data-use="${r.key}"]`)?.checked);
    const participants = used.map((r) => (r.kind === 'internal' ? { role_key: r.key, user_id: Number(fd.get(`p_${r.key}_user`)) } : r.kind === 'seal' ? { role_key: r.key }
      : { role_key: r.key, name: fd.get(`p_${r.key}_name`), email: fd.get(`p_${r.key}_email`) || null, phone: fd.get(`p_${r.key}_phone`) || null, auth_method: fd.get(`p_${r.key}_auth`) || 'link', delivery: fd.get(`p_${r.key}_delivery`), org_name: fd.get(`p_${r.key}_org`) || null, org_no: fd.get(`p_${r.key}_orgno`) || null }));
    if (mode === 'remote' && participants.some((p, i) => used[i].kind === 'external' && !p.email && !p.phone)) return toast('비대면계약은 외부 참여자의 이메일이나 휴대폰이 필요합니다', true);
    const r = await guard(() => api('/documents', { method: 'POST', body: { mode, template_id: tid, title: fd.get('title'), vals: readFields(e.target, sender), participants, attachments: atts.map(({ file_id, kind, caption }) => ({ file_id, kind, caption })), base_file_id: baseId } }));
    if (fd.get('line')) await guard(() => api(`/documents/${r.id}/approval`, { method: 'POST', body: { line_id: Number(fd.get('line')) } }));
    toast('저장했습니다'); go('/doc/' + r.id);
  });
}

// ── 문서함
async function pageDocs() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const [list, fc] = await Promise.all([api('/documents?' + q.toString()), api('/documents/facets')]);
  const opt = (arr, cur) => arr.map((v) => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  view().innerHTML = `<div class="head"><div><h1>문서함</h1><p>폴더·태그·자동분류는 보는 방법만 바꿉니다. 볼 수 있는 문서만 나옵니다.</p></div><a class="btn primary" href="#/new">＋ 새 계약</a></div>
  <div class="split" style="grid-template-columns:220px minmax(0,1fr)"><aside class="card"><h3>폴더</h3>${fc.folders.map((f) => `<a class="row" style="justify-content:space-between;padding:3px 0" href="#/docs?folder=${f.id}">${esc(f.name)}<span class="faint small">${f.n}</span></a>`).join('') || '<div class="faint small">없음</div>'}
    <hr class="sep"><h3>태그</h3>${fc.tags.map((t) => `<a class="tag" href="#/docs?tag=${encodeURIComponent(t.tag)}">${esc(t.tag)} ${t.n}</a>`).join('') || '<div class="faint small">없음</div>'}
    <hr class="sep"><a href="#/docs?renewal=30">갱신 검토 (30일 이내)</a></aside>
  <div><form class="card" id="flt"><div class="grid g4">
    <input class="inp" name="q" placeholder="제목·거래처·현장·참여자" value="${esc(q.get('q') || '')}">
    <select class="inp" name="status"><option value="">상태 전체</option>${Object.entries(ME.status).map(([k, v]) => `<option value="${k}"${q.get('status') === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <select class="inp" name="mode"><option value="">방식 전체</option>${Object.entries(MODE).map(([k, v]) => `<option value="${k}"${q.get('mode') === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
    <select class="inp" name="doc_type"><option value="">문서 종류</option>${opt(fc.doc_types, q.get('doc_type'))}</select>
    <select class="inp" name="site"><option value="">현장·소재지</option>${opt(fc.sites, q.get('site'))}</select>
    <select class="inp" name="partner"><option value="">거래처</option>${opt(fc.partners, q.get('partner'))}</select>
    <select class="inp" name="owner"><option value="">계약 담당자</option>${userOpts(Number(q.get('owner')), () => true)}</select>
    <select class="inp" name="dept_id"><option value="">부서</option>${ORG.depts.map((d) => `<option value="${d.id}"${String(d.id) === q.get('dept_id') ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
    <input class="inp" name="amin" inputmode="numeric" placeholder="금액 이상" value="${esc(q.get('amin') || '')}"><input class="inp" name="amax" inputmode="numeric" placeholder="금액 이하" value="${esc(q.get('amax') || '')}">
    <input class="inp" type="date" name="from" title="계약기간 시작" value="${esc(q.get('from') || '')}"><input class="inp" type="date" name="to" title="계약기간 끝" value="${esc(q.get('to') || '')}">
    </div><div class="row" style="margin-top:10px"><button class="btn primary">검색</button><a class="btn ghost" href="#/docs">초기화</a><span class="muted small">총 ${list.total}건</span></div></form>
  <div class="card tbl-wrap">${list.rows.length ? `<table class="t"><tr><th>번호</th><th>제목</th><th>방식</th><th>상태</th><th>현장·소재지</th><th>거래처·참여자</th><th class="num">금액</th><th>기간</th><th>담당</th></tr>
    ${list.rows.map((d) => `<tr class="click" data-id="${d.id}"><td class="faint">${d.id}</td><td><b>${esc(d.title)}</b><div>${(d.tags || '').split(',').filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></td><td>${MODE[d.mode]}</td><td>${badge(d.status, ME.status[d.status])}</td><td>${esc(d.site || '')}</td><td>${esc(d.partner || d.parties || '')}</td><td class="num">${d.amount != null ? won(d.amount) : ''}</td><td class="small nowrap">${esc(d.start_date || '')}${d.end_date ? ' ~ ' + esc(d.end_date) : ''}</td><td>${esc(d.creator_name || '')}</td></tr>`).join('')}</table>` : '<div class="empty">조건에 맞는 문서가 없습니다</div>'}</div></div></div>`;
  $('#flt').addEventListener('submit', (e) => { e.preventDefault(); const p = new URLSearchParams(); for (const [k, v] of new FormData(e.target)) if (v) p.set(k, v); go('/docs?' + p); });
  $$('tr[data-id]').forEach((r) => r.addEventListener('click', () => go('/doc/' + r.dataset.id)));
}

// ── 문서 상세
async function pageDoc(id) {
  const D = await api('/documents/' + id);
  const d = D.doc;
  docTitleCache[d.id] = d.title;
  const cur = D.participants.find((p) => p.status === 'current');
  const myTurn = D.participants.filter((p) => p.status === 'current' && ((p.kind === 'internal' && p.user_id === ME.user.id) || (p.kind === 'seal' && can('seal.use'))));
  const myAppr = D.approvals.find((a) => a.user_id === ME.user.id && a.status === 'waiting' && a.round === D.approval.round && a.kind === 'approve' && a.step_no === Math.min(...D.approvals.filter((x) => x.round === D.approval.round && x.status === 'waiting' && x.kind === 'approve').map((x) => x.step_no)));
  const vals = { ...D.sys, ...d.vals }; D.participants.forEach((p) => Object.assign(vals, p.vals));
  const CL = D.template.extra?.checklist || [];
  const flow = [...(D.approvals.length ? [...new Map(D.approvals.filter((a) => a.round === D.approval.round && a.kind === 'approve').map((a) => [a.id, a])).values()].map((a) => `<span class="st in ${a.status === 'approved' ? 'done' : a.status === 'waiting' && d.status === 'approval' ? 'now' : ''}">결재 ${esc(a.user_name)}</span>`) : []),
    ...D.participants.map((p) => `<span class="st ${p.kind === 'external' ? 'ex' : 'in'} ${p.status === 'signed' ? 'done' : p.status === 'current' ? 'now' : ''}">${esc(p.role_label)} ${esc(p.name)}</span>`), `<span class="st ${d.status === 'completed' ? 'done' : ''}">완료</span>`].join('<span class="ar">→</span>');
  view().innerHTML = `<div class="head"><div><div class="row"><h1>${esc(d.title)}</h1>${badge(d.status, d.status_label)}<span class="tag">${MODE[d.mode]}계약</span><span class="faint small">#${d.id} · v${d.version}</span></div>
    <p>${esc(D.template.name)} v${D.template.version} · 담당 ${esc(D.creator?.name || '-')} · 작성 ${dt(d.created_at)}</p></div>
    <div class="row">${D.can.submitApproval ? '<button class="btn" id="b-appr">결재 요청</button>' : ''}${D.can.send ? `<button class="btn primary" id="b-send">${d.mode === 'inperson' ? '대면 서명 시작' : '발송'}</button>` : ''}
      ${d.mode === 'inperson' && d.status === 'in_progress' ? `<a class="btn primary" href="#/inperson/${d.id}">대면 진행 화면</a>` : ''}
      ${d.status === 'review' ? '<button class="btn primary" id="b-review">담당자 확인 완료</button>' : ''}
      <a class="btn" href="/api/documents/${d.id}/pdf" target="_blank" rel="noopener">${d.pdf_file_id ? '완료 PDF' : 'PDF 미리보기'}</a>${D.can.cancel ? '<button class="btn danger" id="b-cancel">계약 취소</button>' : ''}</div></div>
  <div class="card" style="margin-bottom:14px"><div class="flow">${flow}</div>
    ${D.approval.ruleRequired ? '<div class="note warn" style="margin-top:10px">회사 결재 규칙에 해당합니다. 발송 전에 결재를 받아야 합니다.</div>' : ''}
    ${d.status === 'approval' && D.approvals.some((a) => a.round > 1 && a.round === D.approval.round) ? '<div class="note warn" style="margin-top:10px">결재 후 내용이나 서명 대상이 바뀌어 다시 결재를 받는 중입니다.</div>' : ''}
    ${d.cancelled_reason ? `<div class="note bad" style="margin-top:10px">취소 사유: ${esc(d.cancelled_reason)}</div>` : ''}</div>
  ${myAppr ? `<div class="card" style="border-color:var(--warn)"><h2>내 결재 차례</h2><textarea class="inp" id="ap-c" placeholder="의견(반려 시 필수)"></textarea><div class="row" style="margin-top:8px"><button class="btn primary" id="ap-ok">승인</button><button class="btn danger" id="ap-no">반려</button></div></div>` : ''}
  ${myTurn.length ? `<div class="card" style="border-color:var(--info)" id="mysign"></div>` : ''}
  <div class="split"><div>
    <div class="tabs" role="tablist"><button class="on" data-tab="body">본문</button><button data-tab="att">첨부 ${D.attachments.length}</button><button data-tab="cm">메모·의견</button><button data-tab="audit">처리 이력</button></div>
    <div id="tab"></div></div>
  <aside>
    <div class="card"><h2>계약 정보</h2><table class="t small">${[['현장·소재지', d.site], ['거래처', d.partner], ['문서 종류', d.doc_type], ['계약금액', d.amount != null ? won(d.amount) : null], ['계약기간', d.start_date || d.end_date ? `${d.start_date || ''} ~ ${d.end_date || ''}` : null], ['서명 마감', d.sign_deadline], ['내용 해시', `<span class="mono">${esc(String(d.content_hash).slice(0, 20))}…</span>`]].filter((x) => x[1]).map(([k, v]) => `<tr><td class="muted nowrap">${k}</td><td>${k === '내용 해시' ? v : esc(v)}</td></tr>`).join('')}</table>
      <div style="margin-top:8px">${D.folders.map((f) => `<span class="tag ${f.source === 'rule' ? 'rule' : ''}">📁 ${esc(f.name)}</span>`).join('')}${D.tags.map((t) => `<span class="tag ${t.source === 'rule' ? 'rule' : ''}">${esc(t.tag)}</span>`).join('')}</div>
      <div class="row" style="margin-top:8px"><button class="btn sm" id="b-tag">태그</button><button class="btn sm" id="b-folder">폴더</button></div></div>
    ${CL.length ? `<div class="card" id="clbox"><h2>계약 전 확인 <span class="small muted">${CL.filter((_, i) => D.checklist[i]).length}/${CL.length}</span></h2>${CL.map((t, i) => `<label class="chk small" style="display:flex;align-items:flex-start;margin-bottom:6px"><input type="checkbox" data-cl="${i}"${D.checklist[i] ? ' checked' : ''}${D.doc.creator_id === ME.user.id && !['completed', 'cancelled'].includes(d.status) ? '' : ' disabled'}> <span>${esc(t)}</span></label>`).join('')}<p class="small faint" style="margin:4px 0 0">체크 기록은 처리 이력과 완료 PDF 확인서에 남습니다. 법률 자문이 아닌 점검용 목록입니다.</p></div>` : ''}
    <div class="card"><h2>참여자</h2><ul class="tl">${D.participants.map((p) => `<li class="${p.status === 'signed' ? 'ok' : p.status === 'current' ? 'now' : p.status === 'rejected' ? 'bad' : ''}"><b>${esc(p.role_label)}</b> ${p.org_name ? esc(p.org_name) + ' · ' : ''}${esc(p.name)} <span class="faint small">${KIND[p.kind]}</span><br><span class="small muted">${p.signed_at ? `${dt(p.signed_at)} · ${esc(p.confirm_method || (p.kind === 'external' ? (p.verified_at ? p.auth_method : '서명 링크') : '로그인 직원'))}` : p.status === 'current' ? '서명 차례' : p.status === 'rejected' ? '거절: ' + esc(p.reject_reason) : '대기'}${p.viewed_at && !p.signed_at ? ' · 열람함' : ''}</span></li>`).join('')}</ul></div>
    ${D.approvals.length ? `<div class="card"><h2>결재 타임라인</h2><ul class="tl">${D.approvals.map((a) => `<li class="${a.status === 'approved' ? 'ok' : a.status === 'rejected' ? 'bad' : a.status === 'waiting' && a.round === D.approval.round ? 'now' : ''}"><span class="faint small">${a.round}차 ${a.kind === 'reference' ? '참조' : a.step_no + '단계'}</span> ${esc(a.user_name)} ${badge(a.status, { waiting: '대기', approved: '승인', rejected: '반려', void: '무효', reference: '참조' }[a.status])}${a.comment ? `<br><span class="small">${esc(a.comment)}</span>` : ''}${a.acted_at ? `<br><span class="faint small">${dt(a.acted_at)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
    <div class="card"><h2>일정</h2>${D.schedules.length ? `<table class="t small">${D.schedules.map((s) => `<tr><td>${esc(s.title)}${s.source === 'manual' ? ' <span class="faint">수정됨</span>' : ''}</td><td class="nowrap">${esc(s.date)}</td><td>${s.done ? '처리' : `${s.remind_days.join('·')}일 전`}</td><td><button class="btn ghost sm" data-sch="${s.id}">수정</button></td></tr>`).join('')}</table>` : '<div class="faint small">계약 날짜가 없습니다</div>'}
      <button class="btn sm" id="b-sch" style="margin-top:8px">＋ 사용자 일정</button></div>
    ${D.seal_usages.length ? `<div class="card"><h2>직인 사용 기록</h2>${D.seal_usages.map((u) => `<div class="small">${esc(u.seal_name)} · ${u.kind === 'preseal' ? '사전날인 정책' : '수동 날인'} · ${esc(u.user_name || '')} · ${dt(u.at)}<br><span class="faint">${esc(u.note || '')}</span></div>`).join('<hr class="sep">')}</div>` : ''}
  </aside></div>`;
  // 탭
  const tabs = {
    body: () => `<div class="card"><div class="preview-body">${renderBody(D.template.body, vals)}</div>${D.can.edit ? '<div class="row" style="margin-top:10px"><button class="btn" id="b-edit">내용·참여자 수정</button><span class="small muted">결재 뒤 수정하면 재결재가 필요합니다</span></div>' : ''}</div>`,
    att: () => `<div class="card">${D.base_file ? `<p class="small">원본 파일(고정본): <a href="/api/documents/${d.id}/base" target="_blank">${esc(D.base_file.name)}</a> <span class="mono faint">${D.base_file.sha256.slice(0, 16)}…</span></p>` : ''}
      <div class="thumbs">${D.attachments.map((a) => `<figure><a href="/api/documents/${d.id}/attachments/${a.id}" target="_blank">${a.mime.startsWith('image/') ? `<img src="/api/documents/${d.id}/attachments/${a.id}" alt="" loading="lazy">` : '<div style="height:80px;display:grid;place-items:center;background:#f3f1ea">PDF</div>'}</a><figcaption><span>${esc({ photo: '사진', drawing: '도면', other: '기타' }[a.kind])} · ${esc(a.caption || a.name)}</span>${D.can.edit ? `<button class="btn ghost sm" data-adel="${a.id}" aria-label="삭제">✕</button>` : ''}</figcaption></figure>`).join('') || '<div class="faint">첨부 없음</div>'}</div>
      ${D.can.edit ? `<div class="row" style="margin-top:10px"><select class="inp" id="akind2" style="width:auto"><option value="photo">사진</option><option value="drawing">도면</option><option value="other">기타</option></select><input type="file" id="afile2" multiple accept="image/png,image/jpeg,application/pdf"></div><p class="small muted">사진은 완료 PDF에서 한 장에 가로 2장 × 세로 2장으로 들어갑니다.</p>` : ''}</div>`,
    cm: () => '<div class="card" id="cmbox">불러오는 중…</div>',
    audit: () => `<div class="card"><ul class="tl">${D.audit.map((l) => `<li><b>${esc(l.action)}</b> · ${esc(l.actor_name || l.actor_type)} <span class="faint small">${dt(l.at)}${l.ip ? ' · ' + esc(l.ip) : ''}</span>${l.detail ? `<br><span class="small mono" style="word-break:break-all">${esc(l.detail).slice(0, 300)}</span>` : ''}</li>`).join('')}</ul></div>`,
  };
  const showTab = (k) => {
    $$('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    $('#tab').innerHTML = tabs[k]();
    if (k === 'cm') comments(d.id);
    if (k === 'body' && $('#b-edit')) $('#b-edit').addEventListener('click', () => editDoc(D));
    if (k === 'att') {
      $$('[data-adel]').forEach((b) => b.addEventListener('click', async () => { const r = await guard(() => api(`/documents/${d.id}/attachments/${b.dataset.adel}`, { method: 'DELETE' })); if (r.reapproval) toast('첨부가 바뀌어 재결재가 필요합니다'); route(); }));
      $('#afile2')?.addEventListener('change', async (e) => { for (const f of e.target.files) { const r = await guard(async () => api(`/documents/${d.id}/attachments`, { method: 'POST', body: { dataUrl: await shrinkImage(f), name: f.name, kind: $('#akind2').value, caption: f.name.replace(/\.\w+$/, '') } })); if (r.reapproval) toast('첨부가 바뀌어 재결재가 필요합니다'); } route(); });
    }
  };
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  showTab('body');
  // 버튼
  $('#b-appr')?.addEventListener('click', async () => {
    const lines = await api('/approval-lines');
    const v = await dialog('결재 요청', `<label class="f"><span>저장된 결재선</span><select class="inp" id="ln"><option value="">회사 조건부 규칙 자동 적용</option>${lines.map((l) => `<option value="${l.id}">${esc(l.name)} — ${l.steps.map((s) => esc(s.name)).join(' → ')}</option>`).join('')}</select></label>`, [{ label: '결재 요청', cls: 'primary', value: (dd) => $('#ln', dd).value }]);
    if (v === null) return; await guard(() => api(`/documents/${d.id}/approval`, { method: 'POST', body: v ? { line_id: Number(v) } : {} })); toast('결재를 요청했습니다'); route();
  });
  $('#b-send')?.addEventListener('click', async () => {
    const ext = D.participants.filter((p) => p.kind === 'external');
    const msg = d.mode === 'inperson' ? '대면 서명을 시작합니다. 시작 후에는 내용을 고칠 수 없습니다.' : `외부 참여자 ${ext.length}명에게 서명 요청을 보냅니다:<br>${ext.map((p) => `· ${esc(p.role_label)} ${esc(p.name)} (${esc(p.email || p.phone || '')})`).join('<br>')}<br><br>발송 후에는 내용을 고칠 수 없습니다.`;
    if (!await confirmDlg('발송 확인', msg, d.mode === 'inperson' ? '시작' : '발송')) return;
    await guard(() => api(`/documents/${d.id}/send`, { method: 'POST' })); toast(d.mode === 'inperson' ? '대면 서명을 시작했습니다' : '발송했습니다');
    if (d.mode === 'inperson') go('/inperson/' + d.id); else route();
  });
  $('#b-cancel')?.addEventListener('click', async () => {
    const r = await dialog('계약 취소', '<label class="f"><span>취소 사유</span><textarea class="inp" id="cr"></textarea></label><p class="small muted">서명 링크가 모두 닫힙니다. 되돌릴 수 없습니다.</p>', [{ label: '취소 처리', cls: 'danger', value: (dd) => $('#cr', dd).value }]);
    if (r === null) return; await guard(() => api(`/documents/${d.id}/cancel`, { method: 'POST', body: { reason: r } })); route();
  });
  $('#b-review')?.addEventListener('click', async () => { await guard(() => api(`/documents/${d.id}/review-confirm`, { method: 'POST' })); toast('확인 처리했습니다'); route(); });
  const act = async (decision) => { await guard(() => api(`/approvals/${myAppr.id}`, { method: 'POST', body: { decision, comment: $('#ap-c').value } })); toast(decision === 'approve' ? '승인했습니다' : '반려했습니다'); await refreshMe(); route(); };
  $('#ap-ok')?.addEventListener('click', () => act('approve')); $('#ap-no')?.addEventListener('click', () => act('reject'));
  $('#b-tag').addEventListener('click', async () => { const v = await dialog('태그 붙이기', '<input class="inp" id="tg" placeholder="예: 중요계약">', [{ label: '붙이기', cls: 'primary', value: (dd) => $('#tg', dd).value }]); if (v) { await guard(() => api(`/documents/${d.id}/tags`, { method: 'POST', body: { tag: v } })); route(); } });
  $('#b-folder').addEventListener('click', async () => { const v = await dialog('폴더에 넣기', '<input class="inp" id="fd" placeholder="예: A현장">', [{ label: '넣기', cls: 'primary', value: (dd) => $('#fd', dd).value }]); if (v) { await guard(() => api(`/documents/${d.id}/folders`, { method: 'POST', body: { name: v } })); route(); } });
  $('#b-sch').addEventListener('click', () => schedDialog(d.id));
  $$('[data-cl]').forEach((c) => c.addEventListener('change', () => guard(() => api(`/documents/${d.id}/checklist`, { method: 'POST', body: { index: Number(c.dataset.cl), checked: c.checked } }))));
  $$('[data-sch]').forEach((b) => b.addEventListener('click', () => schedDialog(d.id, D.schedules.find((s) => s.id === Number(b.dataset.sch)))));
  if (myTurn.length) internalSign(D, myTurn[0]);
  void cur;
}

async function internalSign(D, p) {
  const box = $('#mysign');
  if (p.kind === 'seal') {
    const s = await api('/seals');
    const act = s.seals.filter((x) => x.status === 'active');
    box.innerHTML = `<h2>직인 날인 차례 — ${esc(p.role_label)}</h2><p class="small muted">날인 사실은 기록되며, 대표자의 개별 계약 승인과는 구분해 남습니다.</p>${act.length ? `<div class="row">${act.map((x) => `<label class="chk" style="border:1px solid var(--line);border-radius:6px;padding:6px"><input type="radio" name="seal" value="${x.id}"><img src="${x.image}" alt="" style="height:48px">${esc(x.name)}</label>`).join('')}</div>
      <label class="chk" style="margin-top:8px"><input type="checkbox" id="sag"> 문서 전체 내용을 확인했습니다</label><div style="margin-top:8px"><button class="btn primary" id="sgo">직인 날인</button></div>` : '<div class="note warn">승인된 직인이 없습니다. 설정 › 직인에서 등록·승인하세요.</div>'}`;
    $('#sgo')?.addEventListener('click', async () => {
      const sid = $('input[name=seal]:checked')?.value; if (!sid) return toast('직인을 고르세요', true);
      await guard(() => api(`/documents/${D.doc.id}/sign`, { method: 'POST', body: { participant_id: p.id, seal_id: Number(sid), agree: $('#sag').checked } })); toast('날인했습니다'); route();
    });
    return;
  }
  const fields = D.template.fields.filter((f) => f.owner === p.role_key);
  box.innerHTML = `<h2>내 서명 차례 — ${esc(p.role_label)}</h2>${fields.map((f) => fieldBlock(f, p.vals[f.key])).join('')}
    <p class="small muted">아래에 서명하세요.</p><canvas class="pad" id="pad"></canvas><div class="row" style="margin-top:8px"><button class="btn sm" id="pclr">다시 쓰기</button>
    <label class="chk"><input type="checkbox" id="pag"> 문서 전체 내용을 확인했습니다</label><button class="btn primary" id="pgo">서명 제출</button></div>`;
  const pad = signPad($('#pad'));
  $('#pclr').addEventListener('click', () => pad.clear());
  $('#pgo').addEventListener('click', async () => {
    if (pad.empty()) return toast('서명해 주세요', true);
    await guard(() => api(`/documents/${D.doc.id}/sign`, { method: 'POST', body: { participant_id: p.id, vals: readFields(box, fields), image: pad.png(), agree: $('#pag').checked } }));
    toast('서명했습니다'); route();
  });
}

async function editDoc(D) {
  const sender = D.template.fields.filter((f) => (f.owner || 'sender') === 'sender');
  const html = `<label class="f"><span>제목</span><input class="inp" id="et" value="${esc(D.doc.title)}"></label>${sender.map((f) => fieldBlock(f, D.doc.vals[f.key], 'e_' + f.key)).join('')}
    <h3>외부 참여자</h3>${D.participants.filter((p) => p.kind === 'external').map((p) => `<div class="grid g3"><input class="inp" data-pn="${p.role_key}" value="${esc(p.name)}"><input class="inp" data-pe="${p.role_key}" value="${esc(p.email || '')}" placeholder="이메일"><input class="inp" data-pp="${p.role_key}" value="${esc(p.phone || '')}" placeholder="휴대폰"></div>`).join('')}`;
  const v = await dialog('내용·참여자 수정', html, [{ label: '저장', cls: 'primary', value: (dd) => dd.cloneNode(true) }], null);
  if (!v) return;
  const participants = D.participants.map((p) => (p.kind === 'external' ? { role_key: p.role_key, name: $(`[data-pn="${p.role_key}"]`, v).value, email: $(`[data-pe="${p.role_key}"]`, v).value || null, phone: $(`[data-pp="${p.role_key}"]`, v).value || null, auth_method: p.auth_method, delivery: p.delivery, org_name: p.org_name, org_no: p.org_no } : p.kind === 'internal' ? { role_key: p.role_key, user_id: p.user_id } : { role_key: p.role_key }));
  const r = await guard(() => api('/documents/' + D.doc.id, { method: 'PUT', body: { title: $('#et', v).value, vals: readFields(v, sender, 'e_'), participants } }));
  if (r.version !== D.doc.version) toast('결재 후 변경되어 재결재를 요청했습니다'); else toast('저장했습니다');
  route();
}

async function schedDialog(docId, s) {
  const html = `<label class="f"><span>제목</span><input class="inp" id="st" value="${esc(s?.title || '')}" ${s && s.kind !== 'custom' ? 'readonly' : ''}></label>
    <label class="f"><span>날짜</span><input class="inp" type="date" id="sd" value="${esc(s?.date || '')}"></label>
    <label class="f"><span>며칠 전 알림 (쉼표로)</span><input class="inp" id="sr" value="${esc((s?.remind_days || [7, 1]).join(','))}"></label>
    <div class="row"><label class="chk"><input type="checkbox" id="c-in" ${!s || s.channels.includes('inapp') ? 'checked' : ''}> 앱 알림</label><label class="chk"><input type="checkbox" id="c-em" ${s?.channels.includes('email') ? 'checked' : ''}> 이메일</label><label class="chk"><input type="checkbox" id="c-sm" ${s?.channels.includes('sms') ? 'checked' : ''}> 문자</label></div>
    <div class="row" style="margin-top:8px"><label class="chk"><input type="checkbox" id="r-ow" ${!s || s.recipients.includes('owner') ? 'checked' : ''}> 담당자</label><label class="chk"><input type="checkbox" id="r-pa" ${s?.recipients.includes('participants') ? 'checked' : ''}> 외부 참여자</label>
    <select class="inp" id="rp" style="width:auto"><option value="none">반복 안 함</option><option value="monthly"${s?.repeat === 'monthly' ? ' selected' : ''}>매월</option><option value="yearly"${s?.repeat === 'yearly' ? ' selected' : ''}>매년</option></select>
    ${s ? `<label class="chk"><input type="checkbox" id="dn" ${s.done ? 'checked' : ''}> 처리 완료</label>` : ''}</div>
    ${s ? '<div id="sh" class="small muted" style="margin-top:10px"></div>' : ''}`;
  const v = await dialog(s ? '일정 수정' : '사용자 일정 추가', html, [{ label: '저장', cls: 'primary', value: (dd) => ({
    title: $('#st', dd).value, date: $('#sd', dd).value, remind_days: $('#sr', dd).value.split(',').map((x) => Number(x.trim())).filter((x) => !isNaN(x)),
    channels: [['#c-in', 'inapp'], ['#c-em', 'email'], ['#c-sm', 'sms']].filter(([k]) => $(k, dd).checked).map((x) => x[1]), recipients: [['#r-ow', 'owner'], ['#r-pa', 'participants']].filter(([k]) => $(k, dd).checked).map((x) => x[1]),
    repeat: $('#rp', dd).value, done: $('#dn', dd)?.checked }) }], async (dd) => {
    if (!s) return; const h = await api(`/schedules/${s.id}/history`);
    $('#sh', dd).innerHTML = h.length ? '변경 이력<br>' + h.map((x) => `${dt(x.at)} ${esc(x.by_name || '자동')}: ${esc(x.before_v)} → ${esc(x.after_v)}`).join('<br>') : '변경 이력 없음 (계약 데이터에서 자동으로 가져온 값)';
  });
  if (!v) return;
  await guard(() => (s ? api('/schedules/' + s.id, { method: 'PUT', body: v }) : api(`/documents/${docId}/schedules`, { method: 'POST', body: v })));
  route();
}

async function comments(docId) {
  const list = await api(`/documents/${docId}/comments`);
  const box = $('#cmbox');
  const one = (c) => `<div class="cm ${c.visibility} ${c.parent_id ? 'reply' : ''} ${c.is_read ? '' : 'unread'}"><div class="meta"><span class="vis ${c.visibility}">${c.visibility === 'internal' ? '내부 메모' : '공유 의견'}</span><b>${esc(c.author_name)}</b>${c.author_type === 'participant' ? '<span class="tag">외부 참여자</span>' : ''}<span>${dt(c.created_at)}</span>${c.edited_at ? '<span>수정됨</span>' : ''}${c.is_read ? '' : '<span style="color:var(--accent)">새 글</span>'}</div>
    <div>${c.deleted_at ? '<i class="faint">삭제된 글</i>' : esc(c.body).replace(/@(\S+)/g, '<b>@$1</b>')}</div>${c.attachments.map((f) => `<a class="small" href="/api/comments/${c.id}/file/${f}" target="_blank">첨부 ${f}</a>`).join(' ')}
    <div class="row">${!c.deleted_at && !c.parent_id ? `<button class="btn ghost sm" data-reply="${c.id}" data-vis="${c.visibility}">답글</button>` : ''}${c.author_type === 'user' && c.author_id === ME.user.id && !c.deleted_at ? `<button class="btn ghost sm" data-edit="${c.id}">수정</button><button class="btn ghost sm" data-delc="${c.id}">삭제</button>` : ''}${c.revisions.length > 1 ? `<span class="faint small">이력 ${c.revisions.map((r) => ({ create: '작성', edit: '수정', delete: '삭제' }[r.action])).join('·')}</span>` : ''}</div></div>`;
  const roots = list.filter((c) => !c.parent_id);
  box.innerHTML = `<div class="note" style="margin-bottom:10px"><b>내부 메모</b>는 회사 직원(이 문서를 볼 수 있는 사람)만 봅니다. <b>공유 의견</b>은 외부 참여자 서명 화면에도 보입니다. 메모를 써도 계약 본문·상태는 바뀌지 않습니다.</div>
    ${roots.map((c) => one(c) + list.filter((x) => x.parent_id === c.id).map(one).join('')).join('') || '<div class="faint">아직 글이 없습니다</div>'}
    <hr class="sep"><form id="cf"><input type="hidden" name="parent"><div class="row" style="margin-bottom:6px"><label class="chk"><input type="radio" name="vis" value="internal" checked> 내부 메모</label><label class="chk"><input type="radio" name="vis" value="shared"> 참여자 공유 의견</label><span id="rto" class="small muted"></span></div>
    <textarea class="inp" name="body" placeholder="@이름 으로 직원을 언급할 수 있습니다"></textarea><div class="row" style="margin-top:6px"><input type="file" id="cfile" accept="image/png,image/jpeg,application/pdf"><button class="btn primary">등록</button></div></form>`;
  api(`/documents/${docId}/comments/read`, { method: 'POST' });
  $$('[data-reply]', box).forEach((b) => b.addEventListener('click', () => { $('#cf [name=parent]').value = b.dataset.reply; $$('#cf [name=vis]').forEach((r) => { r.checked = r.value === b.dataset.vis; r.disabled = true; }); $('#rto').textContent = `#${b.dataset.reply}에 답글`; $('#cf textarea').focus(); }));
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', async () => { const c = list.find((x) => x.id === Number(b.dataset.edit)); const v = await dialog('글 수정', `<textarea class="inp" id="eb">${esc(c.body)}</textarea>`, [{ label: '저장', cls: 'primary', value: (dd) => $('#eb', dd).value }]); if (v) { await guard(() => api('/comments/' + c.id, { method: 'PUT', body: { body: v } })); comments(docId); } }));
  $$('[data-delc]', box).forEach((b) => b.addEventListener('click', async () => { if (await confirmDlg('삭제', '글을 삭제할까요? 삭제 이력은 남습니다.', '삭제', 'danger')) { await guard(() => api('/comments/' + b.dataset.delc, { method: 'DELETE' })); comments(docId); } }));
  $('#cf').addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const atts = [];
    const f = $('#cfile').files[0]; if (f) atts.push((await guard(async () => api('/files', { method: 'POST', body: { dataUrl: await shrinkImage(f), name: f.name } }))).id);
    const vis = $$('#cf [name=vis]').find((r) => r.checked).value;
    await guard(() => api(`/documents/${docId}/comments`, { method: 'POST', body: { visibility: vis, body: fd.get('body'), parent_id: Number(fd.get('parent')) || null, attachments: atts } }));
    comments(docId);
  });
}

// ── 대면 진행 (담당자 화면). 기기를 넘긴 뒤 돌아오면 비밀번호로 잠금 해제.
async function pageInperson(id) {
  const D = await api('/documents/' + id);
  const methods = await api('/inperson/confirm-methods');
  const cur = D.participants.find((p) => p.status === 'current' && p.kind === 'external');
  view().innerHTML = `<div class="head"><div><h1>대면 진행 — ${esc(D.doc.title)}</h1><p>담당자 문서 준비 → 참여자 확인 → 문서 전체 열람 → 본인 입력 → 서명 → 제출 → 다음 참여자</p></div><a class="btn" href="#/doc/${id}">문서 화면</a></div>
  <div class="note warn" style="margin-bottom:14px">온라인 상태에서만 씁니다. 서명자는 자기 입력 항목만 쓰고, 다른 참여자의 개인정보는 가려져 보입니다. 담당자(로그인 직원)는 서명자로 기록되지 않고 "확인 담당자"로 따로 기록됩니다.</div>
  <div class="split"><div class="card"><h2>참여자 차례</h2><table class="t">${D.participants.map((p) => `<tr${p.id === cur?.id ? ' style="background:var(--warn-soft)"' : ''}><td>${p.order_no}</td><td><b>${esc(p.role_label)}</b> ${esc(p.name)}</td><td>${badge(p.status === 'signed' ? 'signed' : p.status, { signed: '서명 완료', current: '지금 차례', waiting: '대기', rejected: '거절' }[p.status])}</td><td class="small muted">${p.signed_at ? dt(p.signed_at) + ' · ' + esc(p.confirm_method || '') : ''}</td></tr>`).join('')}</table>
    ${D.doc.status === 'completed' ? `<div class="note ok" style="margin-top:12px">모든 서명이 끝났습니다. <a href="/api/documents/${id}/pdf" target="_blank">완료 PDF</a> · 완료 후에는 담당자도 수정할 수 없습니다.</div>` : ''}</div>
  <aside>${cur ? `<form class="card" id="ks" style="border-color:var(--warn)"><h2>지금 서명할 사람</h2><p style="font-size:20px;margin:4px 0"><b>${esc(cur.name)}</b> <span class="muted" style="font-size:14px">${esc(cur.role_label)}</span></p>
    <label class="f"><span>참여자 확인 방법 <i>*</i></span><select class="inp" name="m" required><option value="">고르세요</option>${methods.map((m) => `<option>${esc(m)}</option>`).join('')}</select></label>
    <label class="f"><span>확인 메모 (선택)</span><input class="inp" name="note" placeholder="예: 신분증 뒷자리 대조"></label>
    <button class="btn primary" style="width:100%;justify-content:center">서명 화면 열기 → 기기 넘기기</button></form>` : D.doc.status === 'in_progress' ? '<div class="card"><div class="note">외부 참여자 차례가 아닙니다 (직원 서명·직인 대기). 문서 화면에서 처리하세요.</div></div>' : ''}</aside></div>`;
  $('#ks')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const r = await guard(() => api(`/documents/${id}/inperson/start`, { method: 'POST', body: { participant_id: cur.id, confirm_method: fd.get('m'), note: fd.get('note') } }));
    location.replace(`${r.url}&back=${encodeURIComponent('/#/inperson/' + id)}`);
  });
}

// ── 결재함
async function pageApprovals() {
  const list = await api('/approvals');
  view().innerHTML = `<div class="head"><div><h1>결재함</h1><p>내 차례인 결재만 처리할 수 있습니다. 결재 요청 뒤 문서가 바뀌면 새 차수로 다시 옵니다.</p></div></div>
  <div class="card tbl-wrap">${list.length ? `<table class="t"><tr><th>문서</th><th>차수·단계</th><th>상태</th><th>의견</th><th>처리</th></tr>${list.map((a) => `<tr class="click" data-h="${a.target_type === 'document' ? '/doc/' + a.target_id : '/bulk/' + a.target_id}"><td><b>${esc(a.title)}</b></td><td>${a.round}차 ${a.kind === 'reference' ? '참조' : a.step_no + '단계'}</td><td>${a.actionable ? badge('waiting', '내 차례') : badge(a.status, { waiting: '앞 단계 대기', approved: '승인', rejected: '반려', void: '무효', reference: '참조' }[a.status])}</td><td class="small">${esc(a.comment || '')}</td><td class="small muted">${dt(a.acted_at)}</td></tr>`).join('')}</table>` : '<div class="empty">결재 내역이 없습니다</div>'}</div>`;
  $$('[data-h]').forEach((r) => r.addEventListener('click', () => go(r.dataset.h)));
}

// ── 일정
async function pageSchedules() {
  const from = new Date(); from.setDate(1);
  const list = await api(`/schedules?from=${from.toISOString().slice(0, 10)}&to=2099-12-31`);
  const K = { sign_deadline: '서명 마감', start: '계약 시작', end: '계약 종료', renewal: '갱신 검토', custom: '사용자 일정' };
  view().innerHTML = `<div class="head"><div><h1>계약 일정</h1><p>서명 기한과 계약 유효기간을 따로 관리합니다. 완료된 계약도 종료일·갱신일 알림을 받습니다.</p></div></div>
  <div class="card tbl-wrap">${list.length ? `<table class="t"><tr><th>날짜</th><th>종류</th><th>문서</th><th>알림</th><th>상태</th></tr>${list.map((s) => `<tr class="click" data-h="/doc/${s.document_id}"><td class="nowrap"><b>${esc(s.date)}</b></td><td><span class="tag">${esc(K[s.kind] || s.title)}</span>${s.kind === 'custom' ? ' ' + esc(s.title) : ''}${s.source === 'manual' ? ' <span class="faint small">수정됨</span>' : ''}</td><td>${esc(s.doc_title)} <span class="faint small">#${s.document_id} · ${esc(ME.status[s.dstatus])}</span></td><td class="small">${s.remind_days.join('·')}일 전 · ${s.channels.map((c) => ({ inapp: '앱', email: '메일', sms: '문자' }[c])).join('/')}${s.repeat !== 'none' ? ' · ' + ({ monthly: '매월', yearly: '매년' }[s.repeat]) : ''}</td><td>${s.done ? badge('completed', '처리') : ''}</td></tr>`).join('')}</table>` : '<div class="empty">일정이 없습니다</div>'}</div>`;
  $$('[data-h]').forEach((r) => r.addEventListener('click', () => go(r.dataset.h)));
}

// ── 링크계약
async function pageLinks(id) {
  if (id === 'new') return linkForm();
  if (id) return linkDetail(Number(id));
  const list = await api('/links');
  view().innerHTML = `<div class="head"><div><h1>③ 링크계약 · QR</h1><p>공개 링크는 접수 창구입니다. 접속한 사람마다 별도 문서가 생기고, 그 문서는 제출자 본인과 권한 있는 직원만 봅니다.</p></div><a class="btn primary" href="#/links/new">＋ 접수 링크 만들기</a></div>
  <div class="card tbl-wrap">${list.length ? `<table class="t"><tr><th>제목</th><th>현장</th><th>상태</th><th>접수 기간</th><th class="num">제출</th><th class="num">검토 대기</th><th class="num">완료</th></tr>${list.map((c) => `<tr class="click" data-id="${c.id}"><td><b>${esc(c.title)}</b><div class="small faint mono">${esc(c.url)}</div></td><td>${esc(c.site || '')}</td><td>${badge(c.status, { active: '접수 중', paused: '일시 중지', closed: '종료' }[c.status])}</td><td class="small">${esc(c.starts_at || '즉시')} ~ ${esc(c.ends_at || '제한 없음')}</td><td class="num">${c.submitted}${c.max_count ? ' / ' + c.max_count : ''}</td><td class="num">${c.review}</td><td class="num">${c.completed}</td></tr>`).join('')}</table>` : '<div class="empty">만든 접수 링크가 없습니다</div>'}</div>`;
  $$('tr[data-id]').forEach((r) => r.addEventListener('click', () => go('/links/' + r.dataset.id)));
}
async function linkForm(c) {
  const tpls = (await api('/templates')).filter((t) => t.usable);
  view().innerHTML = `<div class="head"><div><h1>${c ? '접수 링크 수정' : '접수 링크 만들기'}</h1><p>외부 참여자 1명(+직인)인 템플릿을 씁니다. 예: [예시] 현장 출입·안전교육 동의서</p></div></div>
  <form class="card" id="lf" style="max-width:760px">${c ? '' : `<label class="f"><span>연결할 템플릿</span><select class="inp" name="template_id">${tpls.map((t) => `<option value="${t.id}"${t.doc_type === '현장동의서' ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>`}
    <div class="grid g2"><label class="f"><span>제목 <i>*</i></span><input class="inp" name="title" required value="${esc(c?.title || '')}"></label><label class="f"><span>현장명 (문서의 '현장' 항목에 들어감)</span><input class="inp" name="site" value="${esc(c?.site || '')}"></label></div>
    <label class="f"><span>안내문</span><textarea class="inp" name="intro">${esc(c?.intro || '')}</textarea></label>
    <div class="grid g3"><label class="f"><span>접수 시작</span><input class="inp" type="datetime-local" name="starts_at" value="${esc(c?.starts_at || '')}"></label><label class="f"><span>접수 종료</span><input class="inp" type="datetime-local" name="ends_at" value="${esc(c?.ends_at || '')}"></label><label class="f"><span>접수 건수 제한</span><input class="inp" name="max_count" inputmode="numeric" value="${esc(c?.max_count || '')}" placeholder="제한 없음"></label></div>
    <div class="grid g2"><label class="f"><span>필요한 인증</span><select class="inp" name="auth"><option value="phone_otp">휴대폰 인증번호</option><option value="none"${c?.auth === 'none' ? ' selected' : ''}>인증 없음 (본인 입력만)</option></select></label>
      <label class="f"><span>중복 제출</span><select class="inp" name="dup_policy"><option value="once_per_phone">전화번호당 1회</option><option value="allow"${c?.dup_policy === 'allow' ? ' selected' : ''}>여러 번 허용</option></select></label></div>
    <label class="f"><span>개인정보 동의 항목 (한 줄에 하나, 필수)</span><textarea class="inp" name="privacy">${esc((c?.privacy || [{ text: '현장 출입 관리 목적의 이름·전화번호 수집·이용에 동의합니다 (보유: 공사 종료 후 1년)' }]).map((x) => x.text).join('\n'))}</textarea></label>
    <label class="f"><span>제출 후 안내문</span><input class="inp" name="after_msg" value="${esc(c?.after_msg || '제출되었습니다. 현장 담당자가 확인합니다.')}"></label>
    <label class="chk"><input type="checkbox" name="review_required" ${c?.review_required ? 'checked' : ''}> 내부 검토 단계 사용 (담당자가 확인해야 완료)</label>
    <div class="note warn" style="margin:12px 0">QR 접속이나 링크 제출만으로 교육 참석·본인확인이 끝난 것으로 처리하지 않습니다. 필요한 확인은 담당자가 따로 기록하세요.</div>
    <button class="btn primary">${c ? '저장' : '만들기'}</button></form>`;
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
    const body = { ...fd, template_id: Number(fd.template_id), max_count: fd.max_count || null, review_required: !!fd.review_required, privacy: fd.privacy.split('\n').map((x) => x.trim()).filter(Boolean).map((text) => ({ text, required: true })) };
    const r = await guard(() => (c ? api('/links/' + c.id, { method: 'PUT', body }) : api('/links', { method: 'POST', body })));
    go('/links/' + (c ? c.id : r.id));
  });
}
async function linkDetail(id) {
  const c = (await api('/links')).find((x) => x.id === id);
  if (!c) throw new Error('없는 링크입니다');
  const docs = await api(`/documents?link=${id}&limit=500`);
  view().innerHTML = `<div class="head"><div><div class="row"><h1>${esc(c.title)}</h1>${badge(c.status, { active: '접수 중', paused: '일시 중지', closed: '종료' }[c.status])}</div><p>제출 ${c.submitted}${c.max_count ? '/' + c.max_count : ''}건 · 검토 대기 ${c.review} · 완료 ${c.completed}</p></div>
    <div class="row">${c.status === 'active' ? '<button class="btn" data-st="pause">일시 중지</button>' : ''}${c.status === 'paused' ? '<button class="btn" data-st="resume">재개</button>' : ''}${c.status !== 'closed' ? '<button class="btn danger" data-st="close">종료</button>' : ''}<button class="btn" id="ed">설정 수정</button></div></div>
  <div class="split"><div class="card tbl-wrap"><h2>제출 문서</h2>${docs.rows.length ? `<table class="t"><tr><th>번호</th><th>제출자</th><th>상태</th><th>접수</th></tr>${docs.rows.map((d) => `<tr class="click" data-id="${d.id}"><td>${d.id}</td><td>${esc(d.parties || '')}</td><td>${badge(d.status, ME.status[d.status])}</td><td class="small">${dt(d.created_at)}</td></tr>`).join('')}</table>` : '<div class="empty">아직 제출이 없습니다</div>'}</div>
  <aside class="card"><h2>배포</h2><input class="inp mono" readonly value="${esc(c.url)}" id="lu"><div class="row" style="margin-top:8px"><button class="btn sm" id="cp">주소 복사</button><a class="btn sm" href="/api/links/${id}/qr.png">QR 내려받기</a><a class="btn sm" href="${esc(c.url)}" target="_blank">열어 보기</a></div>
    <img src="/api/links/${id}/qr.png" alt="접수 QR코드" style="width:100%;max-width:220px;margin-top:10px;border:1px solid var(--line);border-radius:6px">
    <hr class="sep"><h3>접수 데이터 내보내기</h3><div class="row"><a class="btn sm" href="/api/links/${id}/export?format=xlsx">Excel</a><a class="btn sm" href="/api/links/${id}/export?format=csv">CSV</a></div></aside></div>`;
  $$('[data-st]').forEach((b) => b.addEventListener('click', async () => { if (b.dataset.st === 'close' && !await confirmDlg('접수 종료', '종료하면 다시 열 수 없습니다.', '종료', 'danger')) return; await guard(() => api('/links/' + id, { method: 'PUT', body: { status: b.dataset.st } })); route(); }));
  $('#cp').addEventListener('click', () => { navigator.clipboard?.writeText(c.url); toast('복사했습니다'); });
  $('#ed').addEventListener('click', () => linkForm(c));
  $$('tr[data-id]').forEach((r) => r.addEventListener('click', () => go('/doc/' + r.dataset.id)));
}

// ── 대량계약
async function pageBulk(id) {
  if (id === 'new') return bulkNew();
  if (id) return bulkJob(Number(id));
  const list = await api('/bulk');
  view().innerHTML = `<div class="head"><div><h1>④ 대량계약</h1><p>템플릿 → 엑셀 양식 → 업로드·오류 검증 → 미리보기 → 발송 확인 → 큐 발송</p></div><a class="btn primary" href="#/bulk/new">＋ 새 대량계약</a></div>
  <div class="card tbl-wrap">${list.length ? `<table class="t"><tr><th>작업</th><th>상태</th><th class="num">전체</th><th class="num">발송</th><th class="num">실패</th><th class="num">서명 대기</th><th class="num">완료</th><th>만든 날</th></tr>${list.map((j) => `<tr class="click" data-id="${j.id}"><td><b>${esc(j.title)}</b></td><td>${badge(j.status, BULK_ST[j.status])}</td><td class="num">${j.total}</td><td class="num">${j.summary.sent}</td><td class="num">${j.summary.failed}</td><td class="num">${j.summary.signing}</td><td class="num">${j.summary.completed}</td><td class="small">${dt(j.created_at)}</td></tr>`).join('')}</table>` : '<div class="empty">대량계약 작업이 없습니다</div>'}</div>`;
  $$('tr[data-id]').forEach((r) => r.addEventListener('click', () => go('/bulk/' + r.dataset.id)));
}
const BULK_ST = { uploaded: '오류 확인 필요', validated: '발송 준비', approval: '결재 중', approved: '결재 완료', running: '발송 중', done: '발송 끝' };
async function bulkNew() {
  const tpls = (await api('/templates')).filter((t) => t.usable);
  view().innerHTML = `<div class="head"><div><h1>새 대량계약</h1></div></div>
  <form class="card" id="bf" style="max-width:720px"><label class="f"><span>1. 템플릿</span><select class="inp" name="template_id" id="bt">${tpls.map((t) => `<option value="${t.id}"${t.doc_type === '근로계약서' ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
    <p>2. <a id="dl" class="btn sm" href="#">전용 엑셀 양식 내려받기</a> <span class="small muted">템플릿의 입력 항목으로 열이 만들어집니다. '공통값' 시트에는 모든 계약에 같이 들어갈 값을 적습니다.</span></p>
    <label class="f"><span>3. 작업 이름</span><input class="inp" name="title" placeholder="예: C현장 12월 근로계약"></label>
    <label class="f"><span>4. 작성한 엑셀 올리기</span><input type="file" name="file" accept=".xlsx" required></label>
    <button class="btn primary">업로드 · 오류 검증</button></form>`;
  const dlh = () => { $('#dl').href = `/api/bulk/form.xlsx?template_id=${$('#bt').value}`; }; dlh(); $('#bt').addEventListener('change', dlh);
  $('#bf').addEventListener('submit', async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const r = await guard(async () => api('/bulk', { method: 'POST', body: { template_id: Number(fd.get('template_id')), title: fd.get('title'), fileDataUrl: await fileToDataUrl(fd.get('file')) } }));
    go('/bulk/' + r.id);
  });
}
async function bulkJob(id) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const J = await api(`/bulk/${id}?only=${q.get('only') || ''}`);
  const j = J.job, s = J.summary;
  const lines = await api('/approval-lines');
  const pv = await api(`/bulk/${id}/preview`).catch(() => null);
  view().innerHTML = `<div class="head"><div><div class="row"><h1>${esc(j.title)}</h1>${badge(j.status, BULK_ST[j.status])}</div><p>${esc(J.template.name)} v${J.template.version} · ${j.total}행</p></div>
    <div class="row">${j.status === 'uploaded' ? '<button class="btn" id="ex">오류 행 빼고 진행</button>' : ''}${j.status === 'validated' ? '<button class="btn" id="ap">결재 요청</button>' : ''}
    ${['validated', 'approved'].includes(j.status) ? '<button class="btn primary" id="go">발송</button>' : ''}${s.failed ? `<button class="btn accent" id="rt">실패 ${s.failed}건 재시도</button>` : ''}
    <a class="btn" href="/api/bulk/${id}/export.xlsx">진행 현황 Excel</a>${s.completed ? `<a class="btn" href="/api/bulk/${id}/zip">완료 PDF ZIP (${s.completed})</a>` : ''}</div></div>
  <div class="grid g4" style="grid-template-columns:repeat(6,1fr)">${[['오류', s.invalid], ['발송 대기', s.queued + (s.rows.ready || 0)], ['발송 성공', s.sent], ['실패', s.failed], ['서명 대기', s.signing], ['완료', s.completed]].map(([k, v]) => `<div class="card kpi"><b>${v}</b><span>${k}</span></div>`).join('')}</div>
  ${j.status === 'running' ? '<div class="note" style="margin-top:12px">발송 중입니다. 잠시 뒤 새로고침하세요.</div>' : ''}
  ${J.approvals.length ? `<div class="card" style="margin-top:14px"><h3>결재</h3><div class="flow">${J.approvals.filter((a) => a.round === J.approval.round).map((a) => `<span class="st in ${a.status === 'approved' ? 'done' : a.status === 'waiting' ? 'now' : ''}">${esc(a.user_name)} ${({ approved: '승인', waiting: '대기', rejected: '반려', reference: '참조', void: '무효' })[a.status]}</span>`).join('<span class="ar">→</span>')}</div></div>` : ''}
  <div class="split" style="margin-top:14px"><div class="card tbl-wrap"><div class="row" style="justify-content:space-between"><h2>행별 결과</h2><div class="row"><a class="btn sm ${q.get('only') ? '' : 'primary'}" href="#/bulk/${id}">전체</a><a class="btn sm ${q.get('only') === 'errors' ? 'primary' : ''}" href="#/bulk/${id}?only=errors">오류·경고</a><a class="btn sm ${q.get('only') === 'failed' ? 'primary' : ''}" href="#/bulk/${id}?only=failed">실패</a></div></div>
    <table class="t"><tr><th>행</th><th>수신자</th><th>처리</th><th>문서</th><th>오류·경고</th><th></th></tr>${J.rows.map((r) => { const p = r.data.participants.find((x) => x.name) || {}; return `<tr><td>${r.row_no}</td><td>${esc(p.name || '')}<div class="small faint">${esc(p.email || p.phone || '')}</div></td><td>${badge(r.status, { ready: '대기', queued: '발송 중', sent: '발송', failed: '실패', invalid: '오류', skipped: '제외' }[r.status])}</td><td>${r.document_id ? `<a href="#/doc/${r.document_id}">#${r.document_id}</a> ${r.doc_status ? badge(r.doc_status, ME.status[r.doc_status]) : ''}` : ''}</td><td class="small">${r.errors.map((e) => `<div style="color:var(--bad)">${esc(e)}</div>`).join('')}${r.warnings.map((e) => `<div style="color:var(--warn)">${esc(e)}</div>`).join('')}${r.last_error ? `<div style="color:var(--bad)">${esc(r.last_error)}</div>` : ''}</td><td><button class="btn ghost sm" data-pv="${r.row_no}">미리보기</button></td></tr>`; }).join('')}</table></div>
  <aside><div class="card"><h2>공통값</h2>${J.template.common.map((f) => `<div class="small"><span class="muted">${esc(f.label)}</span> <b>${esc(j.common[f.key] ?? '(비어 있음)')}</b></div>`).join('') || '<div class="faint small">없음</div>'}</div>
    <div class="card"><h2 id="pvt">대표 문서 미리보기${pv ? ` (${pv.row_no}행)` : ''}</h2><div id="pvp">${pv ? pvHtml(pv) : '<div class="faint">미리볼 행이 없습니다</div>'}</div></div></aside></div>`;
  $$('[data-pv]').forEach((b) => b.addEventListener('click', async () => { const p = await guard(() => api(`/bulk/${id}/preview?row=${b.dataset.pv}`)); $('#pvt').textContent = `개별 문서 미리보기 (${p.row_no}행)`; $('#pvp').innerHTML = pvHtml(p); $('#pvt').scrollIntoView({ behavior: 'smooth' }); }));
  $('#ex')?.addEventListener('click', async () => { if (!await confirmDlg('오류 행 제외', `오류 ${s.invalid}행을 빼고 나머지로 진행합니다.`)) return; await guard(() => api(`/bulk/${id}/exclude-invalid`, { method: 'POST' })); route(); });
  $('#ap')?.addEventListener('click', async () => { const v = await dialog('대량계약 결재 요청', `<select class="inp" id="ln">${lines.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select><p class="small muted">결재는 이 작업 전체(행 데이터·공통값)를 대상으로 합니다.</p>`, [{ label: '요청', cls: 'primary', value: (dd) => $('#ln', dd).value }]); if (v) { await guard(() => api(`/bulk/${id}/approval`, { method: 'POST', body: { line_id: Number(v) } })); route(); } });
  $('#go')?.addEventListener('click', async () => {
    const n = (s.rows.ready || 0);
    if (!await confirmDlg('발송 확인', `<b>${n}건</b>의 독립된 계약을 만들고 서명 요청을 보냅니다.<br>대표 문서와 개별 문서 미리보기를 확인했나요?<br><span class="small muted">다시 눌러도 계약·알림이 중복으로 생기지 않습니다.</span>`, `${n}건 발송`)) return;
    await guard(() => api(`/bulk/${id}/start`, { method: 'POST', body: { confirm: true } })); toast('발송을 시작했습니다'); setTimeout(route, 1500);
  });
  $('#rt')?.addEventListener('click', async () => { await guard(() => api(`/bulk/${id}/retry-failed`, { method: 'POST' })); toast('실패 건만 다시 보냅니다'); setTimeout(route, 1500); });
}
const pvHtml = (p) => `<div class="small">${p.participants.map((x) => `${esc(x.role)}: <b>${esc(x.name || '')}</b> ${esc(x.email || x.phone || '')}`).join('<br>')}</div>${[...p.errors, ...p.warnings].map((e) => `<div class="small" style="color:var(--warn)">${esc(e)}</div>`).join('')}<div class="preview-body" style="margin-top:8px">${esc(p.body).replace(/^##\s*(.*)$/gm, '<b>$1</b>')}</div>`;

// ── 템플릿
async function pageTemplates(id) {
  if (id) return templateEditor(id === 'new' ? null : Number(id));
  const list = await api('/templates');
  view().innerHTML = `<div class="head"><div><h1>템플릿</h1><p>개인 서식과 회사 공용 서식. 고치면 새 버전이 생기고, 이미 쓴 문서는 예전 버전 그대로입니다.</p></div>${can('template.edit') ? '<a class="btn primary" href="#/templates/new">＋ 새 템플릿</a>' : ''}</div>
  <div class="card tbl-wrap"><table class="t"><tr><th>분류</th><th>이름</th><th>종류</th><th>범위</th><th>버전</th><th>소유</th><th></th></tr>${list.map((t) => `<tr><td><span class="tag">${esc(t.category)}</span></td><td><b>${esc(t.name)}</b>${t.usable ? '' : ' <span class="faint small">(공유 안 됨)</span>'}</td><td>${esc(t.doc_type || '')}</td><td>${t.scope === 'company' ? `회사 공용${t.shares.length ? ` · 공유 ${t.shares.length}곳` : ' · 전체'}` : '개인'}</td><td>v${t.current_version}</td><td>${esc(t.owner)}</td><td class="nowrap">${t.usable ? `<a class="btn sm" href="#/new/remote?t=${t.id}">비대면</a> <a class="btn sm" href="#/new/inperson?t=${t.id}">대면</a> ` : ''}<a class="btn sm" href="#/templates/${t.id}">편집</a></td></tr>`).join('')}</table></div>`;
}
async function templateEditor(id) {
  const t = id ? await api('/templates/' + id) : { name: '', doc_type: '', category: '일반', scope: 'personal', shares: [], version: { roles: [{ key: 'party', label: '상대방', kind: 'external', party: 'company' }, { key: 'company', label: '당사 직인', kind: 'seal' }], fields: [], body: '## 1. 당사자\n{{@company}} 와 {{@party.org}} 는 다음과 같이 계약한다.\n', attachments: {}, extra: { checks: [], deadlines: [], checklist: [] } } };
  const tv = t.version;
  view().innerHTML = `<div class="head"><div><h1>${id ? '템플릿 편집' : '새 템플릿'}</h1><p>${id ? `현재 v${t.current_version} · 저장하면 v${t.current_version + 1}` : ''}</p></div><div class="row">${id && can('template.share') ? '<button class="btn" id="sh">공유 설정</button>' : ''}<button class="btn primary" id="sv">저장</button></div></div>
  <div class="split"><div>
    <div class="card"><div class="grid g2"><label class="f"><span>이름</span><input class="inp" id="tn" value="${esc(t.name)}"></label><label class="f"><span>문서 종류 (분류·결재 규칙에 쓰임)</span><input class="inp" id="td" value="${esc(t.doc_type || '')}" placeholder="예: 근로계약서"></label></div>
      <label class="f"><span>업종 분류</span><select class="inp" id="tc">${['일반', '부동산', '건설', '인사·노무'].map((c) => `<option${(t.category || '일반') === c ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="f"><span>본문 — {{항목키}} 자리에 값이 들어갑니다. {{금액키|한글}}은 "일금 ○○원정", {{@company}} 요청 회사, {{@date}} 계약일, {{@역할키.name}}·{{@역할키.org}}·{{@역할키.orgno}}. "## 제목" 줄은 소제목.</span><textarea class="inp code" id="tb" style="min-height:320px">${esc(tv.body)}</textarea></label>
      <div class="row small"><span class="muted">항목 넣기:</span><span id="ins"></span></div></div>
    <div class="card"><h2>미리보기</h2><div class="preview-body" id="tp"></div></div></div>
  <aside><div class="card"><h2>참여자 역할 <span class="small muted">(서명 순서)</span></h2><div id="rl"></div><button class="btn sm" id="ra">＋ 역할</button></div>
    <div class="card"><h2>입력 항목</h2><div id="fl"></div><button class="btn sm" id="fa">＋ 항목</button>
      <p class="small muted">작성자=문서 만드는 직원이 입력, 역할=그 참여자가 서명 화면에서 입력. 개인정보 표시 항목은 다른 참여자에게 가려 보입니다. 대량계약에서 '공통'은 모든 행에 같은 값입니다.</p></div>
    <div class="card"><h2>첨부</h2><label class="chk"><input type="checkbox" id="ap" ${tv.attachments?.photo ? 'checked' : ''}> 사진대장(2×2)</label> <label class="chk"><input type="checkbox" id="ad" ${tv.attachments?.drawing ? 'checked' : ''}> 도면</label></div>
    <div class="card"><h2>부가 규칙 <span class="small muted">(고급)</span></h2><p class="small muted">금액 합계 검증(checks), 기한 일정(deadlines: 기준 "@contract"=계약 완료일 또는 날짜 항목키 ± 일수), 계약 전 확인 목록(checklist). 정해진 형식만 저장됩니다.</p>
      <textarea class="inp code" id="tx" style="min-height:160px">${esc(JSON.stringify(tv.extra || { checks: [], deadlines: [], checklist: [] }, null, 1))}</textarea></div></aside></div>`;
  let roles = tv.roles.map((r) => ({ ...r })), fields = tv.fields.map((f) => ({ ...f }));
  const drawR = () => {
    $('#rl').innerHTML = roles.map((r, i) => `<div class="row" style="margin-bottom:6px"><input class="inp" style="width:90px" value="${esc(r.key)}" data-rk="${i}" aria-label="역할 키"><input class="inp" style="flex:1;min-width:80px" value="${esc(r.label)}" data-rl="${i}" aria-label="이름"><select class="inp" style="width:auto" data-rkind="${i}">${Object.entries(KIND).map(([k, v]) => `<option value="${k}"${r.kind === k ? ' selected' : ''}>${v}</option>`).join('')}</select><button class="btn ghost sm" data-rdel="${i}" aria-label="삭제">✕</button></div>
      <div class="row small" style="margin:-2px 0 8px"><label class="chk"><input type="checkbox" data-ropt="${i}"${r.optional ? ' checked' : ''}> 선택 참여자</label><label class="chk"><input type="checkbox" data-rparty="${i}"${r.party === 'company' ? ' checked' : ''}> 회사(상호·사업자번호)</label><span class="faint">순서</span><input class="inp" style="width:56px" data-rord="${i}" value="${r.order || i + 1}"></div>`).join('');
    $$('[data-ropt]').forEach((e) => e.addEventListener('change', () => { roles[e.dataset.ropt].optional = e.checked; }));
    $$('[data-rparty]').forEach((e) => e.addEventListener('change', () => { roles[e.dataset.rparty].party = e.checked ? 'company' : undefined; }));
    $$('[data-rord]').forEach((e) => e.addEventListener('input', () => { roles[e.dataset.rord].order = Number(e.value) || 1; }));
    $$('[data-rk]').forEach((e) => e.addEventListener('input', () => { roles[e.dataset.rk].key = e.value.trim(); drawF(); }));
    $$('[data-rl]').forEach((e) => e.addEventListener('input', () => { roles[e.dataset.rl].label = e.value; }));
    $$('[data-rkind]').forEach((e) => e.addEventListener('change', () => { roles[e.dataset.rkind].kind = e.value; }));
    $$('[data-rdel]').forEach((e) => e.addEventListener('click', () => { roles.splice(e.dataset.rdel, 1); drawR(); drawF(); }));
  };
  const drawF = () => {
    $('#fl').innerHTML = fields.map((f, i) => `<div style="border:1px solid var(--line2);border-radius:6px;padding:6px;margin-bottom:6px"><div class="row"><input class="inp" style="width:100px" value="${esc(f.key)}" data-fk="${i}" placeholder="키(영문)"><input class="inp" style="flex:1;min-width:90px" value="${esc(f.label)}" data-fl="${i}" placeholder="이름"><button class="btn ghost sm" data-fdel="${i}" aria-label="삭제">✕</button></div>
      <div class="row small" style="margin-top:4px"><select class="inp" style="width:auto" data-ft="${i}">${Object.entries({ text: '글', textarea: '긴 글', number: '숫자·금액', date: '날짜', email: '이메일', phone: '전화', check: '확인(체크)', select: '선택 목록' }).map(([x, l]) => `<option value="${x}"${f.type === x ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="inp" style="width:auto" data-fo="${i}"><option value="sender">작성자</option>${roles.map((r) => `<option value="${esc(r.key)}"${f.owner === r.key ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" data-fr="${i}" ${f.required ? 'checked' : ''}>필수</label><label class="chk"><input type="checkbox" data-fp="${i}" ${f.pii ? 'checked' : ''}>개인정보</label><label class="chk"><input type="checkbox" data-fc="${i}" ${f.scope === 'common' ? 'checked' : ''}>공통</label></div>
      ${f.type === 'select' ? `<input class="inp small" style="margin-top:4px" data-fopt="${i}" value="${esc((f.options || []).join(', '))}" placeholder="선택지 (쉼표로 구분)">` : ''}${f.type === 'date' ? `<input class="inp small" style="margin-top:4px" data-fsch="${i}" value="${esc(f.schedule || '')}" placeholder="일정으로 등록할 이름 (예: 잔금 지급일, 비우면 등록 안 함)">` : ''}</div>`).join('');
    const bind = (a, fn, ev = 'input') => $$(`[${a}]`).forEach((e) => e.addEventListener(ev, () => { fn(fields[e.getAttribute(a)], e); preview(); }));
    bind('data-fk', (f, e) => { f.key = e.value.trim(); }); bind('data-fl', (f, e) => { f.label = e.value; });
    bind('data-ft', (f, e) => { f.type = e.value; }, 'change'); bind('data-fo', (f, e) => { f.owner = e.value; }, 'change');
    bind('data-fr', (f, e) => { f.required = e.checked; }, 'change');
    bind('data-fopt', (f, e) => { f.options = e.value.split(',').map((x) => x.trim()).filter(Boolean); });
    bind('data-fsch', (f, e) => { f.schedule = e.value.trim() || undefined; });
    $$('[data-ft]').forEach((e) => e.addEventListener('change', () => drawF())); bind('data-fp', (f, e) => { f.pii = e.checked; }, 'change'); bind('data-fc', (f, e) => { f.scope = e.checked ? 'common' : 'each'; }, 'change');
    $$('[data-fdel]').forEach((e) => e.addEventListener('click', () => { fields.splice(e.dataset.fdel, 1); drawF(); }));
    $('#ins').innerHTML = fields.map((f) => `<button class="btn ghost sm" data-ins="${esc(f.key)}">{{${esc(f.key)}}}</button>`).join('');
    $$('[data-ins]').forEach((b) => b.addEventListener('click', () => { const ta = $('#tb'); const p = ta.selectionStart; ta.value = ta.value.slice(0, p) + `{{${b.dataset.ins}}}` + ta.value.slice(p); preview(); }));
    preview();
  };
  const preview = () => { const sv = { '@company': ME.company.name, '@date': '(계약일)', '@company_bizno': '(사업자번호)' }; roles.forEach((r) => { sv[`@${r.key}.name`] = `[${r.label} 이름]`; sv[`@${r.key}.org`] = `[${r.label} 상호]`; sv[`@${r.key}.orgno`] = `[${r.label} 사업자번호]`; });
    $('#tp').innerHTML = renderBody($('#tb').value.replace(/\|\s*한글/g, ''), { ...sv, ...Object.fromEntries(fields.map((f) => [f.key, `[${f.label}]`])) }); };
  drawR(); drawF(); $('#tb').addEventListener('input', preview);
  $('#ra').addEventListener('click', () => { roles.push({ key: 'r' + (roles.length + 1), label: '참여자', kind: 'external' }); drawR(); drawF(); });
  $('#fa').addEventListener('click', () => { fields.push({ key: 'f' + (fields.length + 1), label: '항목', type: 'text', owner: 'sender', required: false, scope: 'each' }); drawF(); });
  $('#sv').addEventListener('click', async () => {
    let extra; try { extra = JSON.parse($('#tx').value || '{}'); } catch { return toast('부가 규칙의 형식(JSON)이 올바르지 않습니다', true); }
    const body = { name: $('#tn').value, doc_type: $('#td').value, category: $('#tc').value, body: $('#tb').value, roles: roles.map((r, i) => ({ ...r, order: r.order || i + 1 })), fields, extra, attachments: { photo: $('#ap').checked, drawing: $('#ad').checked } };
    const r = await guard(() => (id ? api('/templates/' + id, { method: 'PUT', body }) : api('/templates', { method: 'POST', body })));
    toast('저장했습니다'); go('/templates/' + (id || r.id));
  });
  $('#sh')?.addEventListener('click', async () => {
    const has = (tt, i) => t.shares.some((s) => s.target_type === tt && s.target_id === i) ? ' checked' : '';
    const html = `<label class="chk"><input type="radio" name="sc" value="personal"${t.scope !== 'company' ? ' checked' : ''}> 개인 서식</label> <label class="chk"><input type="radio" name="sc" value="company"${t.scope === 'company' ? ' checked' : ''}> 회사 공용</label>
      <p class="small muted">회사 공용에서 공유 대상을 고르지 않으면 회사 전체가 씁니다.</p><h3>부서</h3>${ORG.depts.map((d) => `<label class="chk"><input type="checkbox" data-sd="${d.id}"${has('dept', d.id)}> ${esc(d.name)}</label> `).join('')}
      <h3 style="margin-top:8px">그룹</h3>${ORG.groups.map((g) => `<label class="chk"><input type="checkbox" data-sg="${g.id}"${has('group', g.id)}> ${esc(g.name)}</label> `).join('') || '<span class="faint small">없음</span>'}
      <h3 style="margin-top:8px">사용자</h3>${ORG.users.filter((u) => u.status === 'active').map((u) => `<label class="chk"><input type="checkbox" data-su="${u.id}"${has('user', u.id)}> ${esc(u.name)}</label> `).join('')}`;
    const v = await dialog('공유 설정', html, [{ label: '저장', cls: 'primary', value: (dd) => ({ scope: $('input[name=sc]:checked', dd).value, shares: [...$$('[data-sd]:checked', dd).map((e) => ({ target_type: 'dept', target_id: Number(e.dataset.sd) })), ...$$('[data-sg]:checked', dd).map((e) => ({ target_type: 'group', target_id: Number(e.dataset.sg) })), ...$$('[data-su]:checked', dd).map((e) => ({ target_type: 'user', target_id: Number(e.dataset.su) }))] }) }]);
    if (v) { await guard(() => api(`/templates/${id}/share`, { method: 'POST', body: v })); toast('공유 설정을 저장했습니다'); route(); }
  });
}

// ── 부동산 도구: 중개보수 상한 계산 · 계약 후 기한 안내
async function pageTools() {
  const guide = await api('/tools/realestate-guide');
  view().innerHTML = `<div class="head"><div><h1>부동산 도구</h1><p>중개보수 상한 계산과 계약 후 챙길 기한. 일반 안내이며 법률 자문이 아닙니다.</p></div><a class="btn primary" href="#/new/remote?cat=부동산">＋ 부동산 계약 작성</a></div>
  <div class="split"><form class="card" id="fee"><h2>중개보수 상한 계산</h2>
    <div class="grid g2"><label class="f"><span>물건 종류</span><select class="inp" name="property"><option value="house">주택(분양권 포함)</option><option value="officetel">오피스텔</option><option value="other">주택 외(토지·상가 등)</option></select></label>
    <label class="f"><span>거래 유형</span><select class="inp" name="deal"><option value="sale">매매·교환</option><option value="lease">임대차(전세·월세)</option></select></label></div>
    <div class="grid g3"><label class="f"><span>매매대금(원)</span><input class="inp" name="price" inputmode="numeric"></label><label class="f"><span>보증금(원)</span><input class="inp" name="deposit" inputmode="numeric"></label><label class="f"><span>월차임(원)</span><input class="inp" name="rent" inputmode="numeric"></label></div>
    <label class="chk"><input type="checkbox" name="oq" checked> 오피스텔: 전용 85㎡ 이하, 부엌·화장실·목욕시설을 갖춤</label>
    <div style="margin-top:10px"><button class="btn primary">계산</button></div><div id="fr" style="margin-top:14px"></div></form>
  <aside class="card"><h2>계약 후 챙길 일</h2>${guide.map((g) => `<div style="margin-bottom:10px"><b>${esc(g.title)}</b><div class="small">${esc(g.body)}</div></div>`).join('')}
    <p class="small faint">부동산 서식으로 계약하면 거래신고·임대차 신고 30일, 갱신 통지 기간이 계약 일정에 자동으로 들어갑니다. 이음사인은 국토교통부 부동산 전자계약시스템·신고 시스템과 연결되어 있지 않으므로 신고는 따로 해야 합니다.</p></aside></div>`;
  $('#fee').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    const q = new URLSearchParams({ property: f.property, deal: f.deal, price: f.price.replace(/,/g, ''), deposit: f.deposit.replace(/,/g, ''), rent: f.rent.replace(/,/g, ''), officetelQualified: f.oq ? '1' : '0' });
    const r = await guard(() => api('/tools/broker-fee?' + q));
    $('#fr').innerHTML = `<div class="note ok"><b style="font-size:18px">상한 ${won(r.fee)}</b> (부가세 별도, 10%면 ${won(r.vat)})</div>
      <table class="t small" style="margin-top:8px"><tr><td class="muted">거래금액</td><td>${won(r.base)}${r.baseNote ? ` <span class="faint">(${esc(r.baseNote)})</span>` : ''}</td></tr><tr><td class="muted">상한요율</td><td>${r.rate}%</td></tr><tr><td class="muted">한도액</td><td>${r.cap ? won(r.cap) : '없음'}</td></tr><tr><td class="muted">근거</td><td>${esc(r.basis)}</td></tr></table>
      <ul class="small muted">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
  });
}

// ── 알림
async function pageInbox() {
  const list = await api('/inbox');
  view().innerHTML = `<div class="head"><div><h1>알림</h1></div><button class="btn" id="rd">모두 읽음</button></div><div class="card">${list.map((n) => `<div class="row" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line2)"><a href="${esc(n.link || '#')}" style="${n.read_at ? 'color:var(--muted)' : 'font-weight:600'}">${esc(n.title)}</a><span class="small faint">${dt(n.created_at)}</span></div>`).join('') || '<div class="empty">알림이 없습니다</div>'}</div>`;
  $('#rd').addEventListener('click', async () => { await api('/inbox/read', { method: 'POST' }); await refreshMe(); route(); });
}

// ── 설정
async function pageSettings(tab = 'org') {
  const T = [['org', '조직·권한'], ['lines', '결재선·규칙'], ['seals', '직인'], ['rules', '자동 분류'], ['brand', '브랜딩'], ['api', 'API·Webhook'], ['outbox', '발송함'], ['audit', '감사 이력']];
  view().innerHTML = `<div class="head"><div><h1>설정</h1></div></div><div class="tabs">${T.map(([k, v]) => `<button data-st="${k}" class="${k === tab ? 'on' : ''}">${v}</button>`).join('')}</div><div id="sb"></div>`;
  $$('[data-st]').forEach((b) => b.addEventListener('click', () => go('/settings/' + b.dataset.st)));
  await ({ org: setOrg, lines: setLines, seals: setSeals, rules: setRules, brand: setBrand, api: setApi, outbox: setOutbox, audit: setAudit }[tab] || setOrg)($('#sb'));
}
async function setOrg(el) {
  ORG = await api('/org');
  const m = can('org.manage');
  el.innerHTML = `<div class="card tbl-wrap"><div class="row" style="justify-content:space-between"><h2>멤버</h2>${m ? '<div class="row"><button class="btn sm" id="nd">＋ 부서</button><button class="btn sm" id="ng">＋ 그룹</button><button class="btn sm primary" id="nu">＋ 멤버</button></div>' : ''}</div>
    <table class="t"><tr><th>이름</th><th>이메일</th><th>부서</th><th>역할</th><th>권한</th><th>상태</th><th></th></tr>${ORG.users.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.email)}</td><td>${esc(ORG.depts.find((d) => d.id === u.dept_id)?.name || '-')}</td><td>${esc({ admin: '관리자', manager: '매니저', member: '멤버' }[u.role])}${u.custom ? ' <span class="tag">개별</span>' : ''}</td><td class="small">${u.perms.map((p) => esc(ME.perms[p])).join(', ')}</td><td>${badge(u.status, u.status === 'active' ? '재직' : '퇴사')}</td><td class="nowrap">${m && u.status === 'active' ? `<button class="btn sm" data-pe="${u.id}">권한</button>${u.id !== ME.user.id ? ` <button class="btn sm danger" data-rt="${u.id}">퇴사</button>` : ''}` : ''}</td></tr>`).join('')}</table>
    <p class="small muted">그룹: ${ORG.groups.map((g) => `${esc(g.name)}(${g.members.length})`).join(', ') || '없음'}</p></div>`;
  $('#nu')?.addEventListener('click', async () => {
    const v = await dialog('멤버 추가', `<label class="f"><span>이름</span><input class="inp" id="un"></label><label class="f"><span>이메일</span><input class="inp" id="ue" type="email"></label><label class="f"><span>초기 비밀번호 (8자 이상)</span><input class="inp" id="up" type="text"></label>
      <div class="grid g2"><label class="f"><span>역할</span><select class="inp" id="ur"><option value="member">멤버</option><option value="manager">매니저</option><option value="admin">관리자</option></select></label><label class="f"><span>부서</span><select class="inp" id="ud">${ORG.depts.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label></div>`,
    [{ label: '추가', cls: 'primary', value: (dd) => ({ name: $('#un', dd).value, email: $('#ue', dd).value, password: $('#up', dd).value, role: $('#ur', dd).value, dept_id: Number($('#ud', dd).value) }) }]);
    if (v) { await guard(() => api('/users', { method: 'POST', body: v })); setOrg(el); }
  });
  $('#nd')?.addEventListener('click', async () => { const v = await dialog('부서 추가', '<input class="inp" id="dn">', [{ label: '추가', cls: 'primary', value: (dd) => $('#dn', dd).value }]); if (v) { await guard(() => api('/depts', { method: 'POST', body: { name: v } })); setOrg(el); } });
  $('#ng')?.addEventListener('click', async () => { const v = await dialog('그룹 추가', `<label class="f"><span>그룹명</span><input class="inp" id="gn"></label>${ORG.users.filter((u) => u.status === 'active').map((u) => `<label class="chk"><input type="checkbox" data-gm="${u.id}"> ${esc(u.name)}</label> `).join('')}`, [{ label: '추가', cls: 'primary', value: (dd) => ({ name: $('#gn', dd).value, members: $$('[data-gm]:checked', dd).map((e) => Number(e.dataset.gm)) }) }]); if (v) { await guard(() => api('/groups', { method: 'POST', body: v })); setOrg(el); } });
  $$('[data-pe]').forEach((b) => b.addEventListener('click', async () => {
    const u = ORG.users.find((x) => x.id === Number(b.dataset.pe));
    const v = await dialog(`${u.name} 권한`, `<label class="f"><span>역할(기본 권한 묶음)</span><select class="inp" id="pr">${['member', 'manager', 'admin'].map((r) => `<option value="${r}"${u.role === r ? ' selected' : ''}>${({ admin: '관리자', manager: '매니저', member: '멤버' })[r]}</option>`).join('')}</select></label>
      <label class="f"><span>부서</span><select class="inp" id="pd"><option value="">없음</option>${ORG.depts.map((d) => `<option value="${d.id}"${u.dept_id === d.id ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
      <h3>업무 권한 (개별 지정)</h3><div class="grid g2">${Object.entries(ME.perms).map(([k, l]) => `<label class="chk"><input type="checkbox" data-pp="${k}"${u.perms.includes(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>
      <label class="chk" style="margin-top:8px"><input type="checkbox" id="prs"> 개별 지정 지우고 역할 기본값 사용</label>`,
    [{ label: '저장', cls: 'primary', value: (dd) => ({ role: $('#pr', dd).value, dept_id: $('#pd', dd).value || null, perms: $$('[data-pp]:checked', dd).map((e) => e.dataset.pp), resetPerms: $('#prs', dd).checked }) }]);
    if (v) { await guard(() => api('/users/' + u.id, { method: 'PUT', body: v })); setOrg(el); }
  }));
  $$('[data-rt]').forEach((b) => b.addEventListener('click', async () => {
    const u = ORG.users.find((x) => x.id === Number(b.dataset.rt));
    const v = await dialog(`${u.name} 퇴사 처리`, `<p>로그인과 이 사람이 만든 API 키가 막힙니다. 회사 문서와 처리 이력은 그대로 남고, 담당 문서·서식·대기 중 결재·서명 차례는 아래 직원에게 넘어갑니다.</p><label class="f"><span>인계받을 직원</span><select class="inp" id="ho">${userOpts(ME.user.id, (x) => x.status === 'active' && x.id !== u.id)}</select></label>`, [{ label: '퇴사 처리', cls: 'danger', value: (dd) => Number($('#ho', dd).value) }]);
    if (v) { const r = await guard(() => api(`/users/${u.id}/retire`, { method: 'POST', body: { handover_to: v } })); toast(`인계: 문서 ${r.docs} · 서식 ${r.tpls} · 결재 ${r.appr}`); setOrg(el); }
  }));
}
async function setLines(el) {
  const [lines, rules] = await Promise.all([api('/approval-lines'), api('/approval-rules')]);
  const FN = { amount: '계약금액', site: '현장', doc_type: '문서 종류', partner: '거래처', mode: '계약 방식', template_id: '템플릿 번호' };
  el.innerHTML = `<div class="grid g2"><div class="card"><div class="row" style="justify-content:space-between"><h2>저장된 결재선</h2><button class="btn sm primary" id="nl">＋ 결재선</button></div>${lines.map((l) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line2)"><div><b>${esc(l.name)}</b><div class="flow">${l.steps.map((s) => `<span class="st in">${esc(s.name)}${s.kind === 'reference' ? ' (참조)' : ''}</span>`).join('<span class="ar">→</span>')}</div></div><button class="btn ghost sm" data-dl="${l.id}">삭제</button></div>`).join('') || '<div class="faint">없음</div>'}</div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2>조건부 결재 규칙</h2>${can('org.manage') ? '<button class="btn sm primary" id="nr">＋ 규칙</button>' : ''}</div><p class="small muted">정해진 항목·비교 방법만 고르는 제한된 규칙입니다. 위에서부터 처음 맞는 규칙의 결재선을 씁니다. 해당 문서는 결재 없이 발송할 수 없습니다.</p>
    ${rules.rules.map((r) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line2)"><div><b>${esc(r.name)}</b><div class="small">${r.conditions.map((c) => `${FN[c.field]} ${c.op} ${esc(c.value)}`).join(' 그리고 ')} → ${esc(lines.find((l) => l.id === r.line_id)?.name || '')}</div></div>${can('org.manage') ? `<button class="btn ghost sm" data-dr="${r.id}">삭제</button>` : ''}</div>`).join('') || '<div class="faint">없음</div>'}</div></div>`;
  $('#nl').addEventListener('click', async () => {
    const v = await dialog('결재선 만들기', `<label class="f"><span>이름</span><input class="inp" id="ln" placeholder="예: 현장소장 → 본사"></label><div id="steps"></div><button class="btn sm" id="as" type="button">＋ 단계</button>`,
      [{ label: '저장', cls: 'primary', value: (dd) => ({ name: $('#ln', dd).value, steps: $$('.stp', dd).map((s) => ({ user_id: Number($('select', s).value), kind: $('.k', s).value })) }) }],
      (dd) => { const add = () => { const d2 = document.createElement('div'); d2.className = 'row stp'; d2.style.marginBottom = '6px'; d2.innerHTML = `<select class="inp" style="flex:1">${userOpts(null)}</select><select class="inp k" style="width:auto"><option value="approve">결재</option><option value="reference">참조</option></select>`; $('#steps', dd).appendChild(d2); }; add(); add(); $('#as', dd).addEventListener('click', add); });
    if (v) { await guard(() => api('/approval-lines', { method: 'POST', body: v })); setLines(el); }
  });
  $('#nr')?.addEventListener('click', async () => {
    const v = await dialog('조건부 결재 규칙', `<label class="f"><span>이름</span><input class="inp" id="rn" placeholder="예: 1억 이상 협력업체 계약"></label>
      <div class="row"><select class="inp" id="cf" style="width:auto">${Object.entries(FN).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><select class="inp" id="co" style="width:auto">${rules.ops.map((o) => `<option>${esc(o)}</option>`).join('')}</select><input class="inp" id="cv" style="flex:1" placeholder="값"></div>
      <label class="f" style="margin-top:8px"><span>적용할 결재선</span><select class="inp" id="rl">${lines.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>`,
    [{ label: '저장', cls: 'primary', value: (dd) => ({ name: $('#rn', dd).value, conditions: [{ field: $('#cf', dd).value, op: $('#co', dd).value, value: $('#cv', dd).value }], line_id: Number($('#rl', dd).value) }) }]);
    if (v) { await guard(() => api('/approval-rules', { method: 'POST', body: v })); setLines(el); }
  });
  $$('[data-dl]').forEach((b) => b.addEventListener('click', async () => { await guard(() => api('/approval-lines/' + b.dataset.dl, { method: 'DELETE' })); setLines(el); }));
  $$('[data-dr]').forEach((b) => b.addEventListener('click', async () => { await guard(() => api('/approval-rules/' + b.dataset.dr, { method: 'DELETE' })); setLines(el); }));
}
async function setSeals(el) {
  const [S, tpls] = await Promise.all([api('/seals'), api('/templates')]);
  const PS = { pending: '승인 대기', approved: '승인', revoked: '폐기' };
  el.innerHTML = `<div class="note" style="margin-bottom:12px">직인은 등록·승인·사용·폐기 권한이 따로입니다. 날인했다는 기록과 대표자가 그 계약을 승인했다는 기록은 구분해서 남깁니다.</div>
  <div class="grid g2"><div class="card"><div class="row" style="justify-content:space-between"><h2>직인</h2>${can('seal.register') ? '<label class="btn sm primary">＋ 등록 (투명 PNG)<input type="file" id="sf" accept="image/png" hidden></label>' : ''}</div>
    ${S.seals.map((s) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line2)"><div class="row"><img src="${s.image}" alt="" style="height:48px;width:48px;object-fit:contain"><div><b>${esc(s.name)}</b> ${badge(s.status, { pending: '승인 대기', active: '사용 중', retired: '폐기' }[s.status])}<div class="small faint">등록 ${esc(s.reg_name || '')}${s.appr_name ? ' · 승인 ' + esc(s.appr_name) : ''}</div></div></div><div class="row">${s.status === 'pending' && can('seal.approve') ? `<button class="btn sm" data-sa="${s.id}">승인</button>` : ''}${s.status !== 'retired' && can('seal.retire') ? `<button class="btn sm danger" data-sr="${s.id}">폐기</button>` : ''}</div></div>`).join('') || '<div class="faint">없음</div>'}</div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2>사전 날인 정책</h2>${can('seal.use') ? '<button class="btn sm primary" id="np">＋ 정책</button>' : ''}</div><p class="small muted">승인된 서식·버전·사용자·금액 한도 안에서만 직인 차례에 자동 날인합니다. 정책을 만든 사람과 승인하는 사람은 달라야 합니다.</p>
    ${S.policies.map((p) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line2)"><div><b>${esc(p.template_name)}</b> v${p.template_version} · ${esc(p.seal_name)} ${badge(p.status === 'approved' ? 'approved' : p.status, PS[p.status])}<div class="small">사용자 ${p.user_ids.map(userName).join(', ')} · 한도 ${p.max_amount ? won(p.max_amount) : '없음'}</div></div><div class="row">${p.status === 'pending' && can('seal.approve') ? `<button class="btn sm" data-pa="${p.id}">승인</button>` : ''}${p.status !== 'revoked' && can('seal.approve') ? `<button class="btn sm danger" data-pr="${p.id}">폐기</button>` : ''}</div></div>`).join('') || '<div class="faint">없음</div>'}</div></div>
  <div class="card"><h2>직인 사용 이력</h2><table class="t small"><tr><th>시각</th><th>직인</th><th>문서</th><th>방식</th><th>처리자</th><th>대표자 승인</th><th>비고</th></tr>${S.usages.map((u) => `<tr><td class="nowrap">${dt(u.at)}</td><td>${esc(u.seal_name)}</td><td><a href="#/doc/${u.document_id}">${esc(u.doc_title || '#' + u.document_id)}</a></td><td>${u.kind === 'preseal' ? '사전날인' : '수동 날인'}</td><td>${esc(u.user_name || '')}</td><td>${u.representative_approved ? '예' : '별도(기록 없음)'}</td><td>${esc(u.note || '')}</td></tr>`).join('')}</table></div>`;
  $('#sf')?.addEventListener('change', async (e) => { const f = e.target.files[0]; if (!f) return; const name = (await dialog('직인 이름', '<input class="inp" id="sn" value="법인 직인">', [{ label: '등록', cls: 'primary', value: (dd) => $('#sn', dd).value }])); if (!name) return; await guard(async () => api('/seals', { method: 'POST', body: { name, image: await fileToDataUrl(f) } })); setSeals(el); });
  $$('[data-sa]').forEach((b) => b.addEventListener('click', async () => { await guard(() => api(`/seals/${b.dataset.sa}/approve`, { method: 'POST' })); setSeals(el); }));
  $$('[data-sr]').forEach((b) => b.addEventListener('click', async () => { if (await confirmDlg('직인 폐기', '폐기하면 관련 사전날인 정책도 함께 폐기됩니다.', '폐기', 'danger')) { await guard(() => api(`/seals/${b.dataset.sr}/retire`, { method: 'POST' })); setSeals(el); } }));
  $$('[data-pa]').forEach((b) => b.addEventListener('click', async () => { await guard(() => api(`/seal-policies/${b.dataset.pa}/approve`, { method: 'POST' })); setSeals(el); }));
  $$('[data-pr]').forEach((b) => b.addEventListener('click', async () => { await guard(() => api(`/seal-policies/${b.dataset.pr}/revoke`, { method: 'POST' })); setSeals(el); }));
  $('#np')?.addEventListener('click', async () => {
    const v = await dialog('사전 날인 정책', `<label class="f"><span>직인</span><select class="inp" id="ps">${S.seals.filter((s) => s.status === 'active').map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><label class="f"><span>서식 (현재 버전에만 적용)</span><select class="inp" id="pt">${tpls.map((t) => `<option value="${t.id}">${esc(t.name)} v${t.current_version}</option>`).join('')}</select></label>
      <label class="f"><span>금액 한도 (원, 비우면 없음)</span><input class="inp" id="pm" inputmode="numeric"></label><h3>쓸 수 있는 사용자</h3>${ORG.users.filter((u) => u.status === 'active').map((u) => `<label class="chk"><input type="checkbox" data-pu="${u.id}"> ${esc(u.name)}</label> `).join('')}`,
    [{ label: '저장(승인 대기)', cls: 'primary', value: (dd) => ({ seal_id: Number($('#ps', dd).value), template_id: Number($('#pt', dd).value), max_amount: $('#pm', dd).value || null, user_ids: $$('[data-pu]:checked', dd).map((e) => Number(e.dataset.pu)) }) }]);
    if (v) { await guard(() => api('/seal-policies', { method: 'POST', body: v })); setSeals(el); }
  });
}
async function setRules(el) {
  const R = await api('/class-rules');
  const FN = { site: '현장', doc_type: '문서 종류', partner: '거래처', amount: '계약금액', status: '상태', end_within_days: '종료까지 남은 일수(이하)', title: '제목' };
  el.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2>자동 분류 규칙</h2>${can('rule.manage') ? '<button class="btn sm primary" id="nr">＋ 규칙</button>' : ''}</div>
    <div class="note" style="margin-bottom:10px">자동 분류는 문서를 보는 방법만 바꿉니다. 같은 계약이 여러 폴더·태그에 보여도 원본은 하나이고, 분류됐다고 볼 권한이 새로 생기지 않습니다.</div>
    ${R.rules.map((r) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line2)"><div><b>${esc(r.name)}</b><div class="small">${r.cond.map((c) => `${FN[c.field]} ${c.field === 'end_within_days' ? '≤' : c.op} ${esc(c.value)}`).join(' 그리고 ')} → ${r.action.folder ? '📁 ' + esc(r.action.folder) : ''} ${r.action.tag ? '태그 ' + esc(r.action.tag) : ''}</div></div>${can('rule.manage') ? `<button class="btn ghost sm" data-d="${r.id}">삭제</button>` : ''}</div>`).join('') || '<div class="faint">없음</div>'}</div>`;
  $('#nr')?.addEventListener('click', async () => {
    const v = await dialog('자동 분류 규칙', `<label class="f"><span>이름</span><input class="inp" id="rn"></label><div class="row"><select class="inp" id="cf" style="width:auto">${Object.entries(FN).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select><select class="inp" id="co" style="width:auto">${R.ops.map((o) => `<option>${esc(o)}</option>`).join('')}</select><input class="inp" id="cv" style="flex:1" placeholder="값"></div>
      <div class="grid g2" style="margin-top:8px"><label class="f"><span>폴더에 연결</span><input class="inp" id="af" placeholder="예: A현장"></label><label class="f"><span>태그 붙이기</span><input class="inp" id="at" placeholder="예: 중요계약 / 갱신검토"></label></div>`,
    [{ label: '저장', cls: 'primary', value: (dd) => ({ name: $('#rn', dd).value, cond: [{ field: $('#cf', dd).value, op: $('#co', dd).value, value: $('#cv', dd).value }], action: { folder: $('#af', dd).value, tag: $('#at', dd).value } }) }]);
    if (v) { await guard(() => api('/class-rules', { method: 'POST', body: v })); setRules(el); }
  });
  $$('[data-d]').forEach((b) => b.addEventListener('click', async () => { await guard(() => api('/class-rules/' + b.dataset.d, { method: 'DELETE' })); setRules(el); }));
}
async function setBrand(el) {
  const c = await api('/company'); const b = c.brand;
  el.innerHTML = `<form class="card" id="bf" style="max-width:720px"><div class="grid g2"><label class="f"><span>회사명</span><input class="inp" name="name" value="${esc(c.name)}"></label><label class="f"><span>사업자등록번호</span><input class="inp" name="biz_no" value="${esc(c.biz_no || '')}"></label></div>
    <div class="grid g2"><label class="f"><span>발신 표시 이름</span><input class="inp" name="sender_name" value="${esc(b.sender_name || '')}"></label><label class="f"><span>기본 색상</span><input class="inp" type="color" name="color" value="${esc(b.color || '#1f4e79')}"></label></div>
    <label class="f"><span>로고 (PNG/JPG 200KB 이하)</span><input type="file" id="lg" accept="image/png,image/jpeg"> ${b.logo ? `<img src="${b.logo}" alt="" style="height:36px;vertical-align:middle">` : ''}</label>
    <label class="f"><span>서명 요청 안내문</span><textarea class="inp" name="request_msg">${esc(b.request_msg || '')}</textarea></label><label class="f"><span>완료 안내문</span><textarea class="inp" name="done_msg">${esc(b.done_msg || '')}</textarea></label>
    <div class="grid g2"><label class="f"><span>고객 문의 연락처</span><input class="inp" name="contact" value="${esc(b.contact || '')}"></label><label class="f"><span>갱신 검토일 (종료일 며칠 전)</span><input class="inp" name="renewal_days" inputmode="numeric" value="${esc(c.settings.renewal_days ?? 30)}"></label></div>
    <p class="small muted">외부 서명 화면에는 이 회사명·로고·색상과 "요청 회사" 표시가 나옵니다.</p><button class="btn primary">저장</button></form>`;
  let logo = b.logo || null;
  $('#lg').addEventListener('change', async (e) => { logo = await fileToDataUrl(e.target.files[0]); });
  $('#bf').addEventListener('submit', async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); await guard(() => api('/company', { method: 'PUT', body: { name: f.name, biz_no: f.biz_no, brand: { ...f, logo }, settings: { renewal_days: f.renewal_days } } })); toast('저장했습니다'); });
}
async function setApi(el) {
  if (!can('api.manage')) { el.innerHTML = '<div class="note">API 관리 권한이 없습니다</div>'; return; }
  const [keys, wh] = await Promise.all([api('/api-keys'), api('/webhooks')]);
  const SC = ['templates:read', 'documents:read', 'documents:write', 'documents:send', 'documents:cancel', 'files:read'];
  el.innerHTML = `<div class="grid g2"><div class="card"><div class="row" style="justify-content:space-between"><h2>API 키</h2><button class="btn sm primary" id="nk">＋ 키 발급</button></div><p class="small muted">키는 만든 직원의 권한 안에서만 동작하고, 그 직원이 퇴사하면 폐기됩니다. 연동 방법은 docs/API_연동가이드.md 를 보세요.</p>
    <table class="t small"><tr><th>이름</th><th>앞자리</th><th>범위</th><th>분당</th><th>상태</th><th></th></tr>${keys.map((k) => `<tr><td>${esc(k.name)}<div class="faint">${esc(k.by_name || '')}</div></td><td class="mono">${esc(k.prefix)}…</td><td>${k.scopes.map(esc).join('<br>')}</td><td>${k.rate_per_min}</td><td>${k.revoked_at ? badge('void', '폐기') : badge('active', '사용')}</td><td class="nowrap">${k.revoked_at ? '' : `<button class="btn sm" data-kr="${k.id}">재발급</button> <button class="btn sm danger" data-kx="${k.id}">폐기</button>`}</td></tr>`).join('')}</table></div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2>Webhook</h2><button class="btn sm primary" id="nw">＋ 주소 등록</button></div>${wh.hooks.filter((h) => h.active).map((h) => `<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line2);padding:6px 0"><div><span class="mono">${esc(h.url)}</span><div class="small muted">${h.events.join(', ')}</div></div><button class="btn sm danger" data-wd="${h.id}">끄기</button></div>`).join('') || '<div class="faint">없음</div>'}
    <h3 style="margin-top:12px">전송 이력</h3><table class="t small"><tr><th>이벤트</th><th>상태</th><th>시도</th><th>응답</th><th></th></tr>${wh.deliveries.map((d) => `<tr><td>${esc(d.type)}<div class="mono faint">${esc(d.event_id)}</div></td><td>${badge(d.status, d.status)}</td><td>${d.attempts}</td><td>${esc(d.last_code || d.last_error || '')}</td><td>${d.status !== 'delivered' ? `<button class="btn sm" data-rs="${d.id}">재전송</button>` : ''}</td></tr>`).join('')}</table></div></div>`;
  $('#nk').addEventListener('click', async () => {
    const v = await dialog('API 키 발급', `<label class="f"><span>이름</span><input class="inp" id="kn" placeholder="예: 이음ERP 연동"></label>${SC.map((s) => `<label class="chk"><input type="checkbox" data-sc="${s}" checked> ${s}</label><br>`).join('')}<label class="f" style="margin-top:8px"><span>분당 요청 수</span><input class="inp" id="kr" value="60"></label>`, [{ label: '발급', cls: 'primary', value: (dd) => ({ name: $('#kn', dd).value, scopes: $$('[data-sc]:checked', dd).map((e) => e.dataset.sc), rate_per_min: Number($('#kr', dd).value) }) }]);
    if (!v) return; const r = await guard(() => api('/api-keys', { method: 'POST', body: v }));
    await dialog('발급된 키', `<p>${esc(r.notice)}</p><input class="inp mono" readonly value="${esc(r.key)}" onclick="this.select()">`, [{ label: '보관했습니다', cls: 'primary', value: true }]); setApi(el);
  });
  $$('[data-kx]').forEach((b) => b.addEventListener('click', async () => { if (await confirmDlg('키 폐기', '이 키로 오는 요청이 바로 막힙니다.', '폐기', 'danger')) { await guard(() => api(`/api-keys/${b.dataset.kx}/revoke`, { method: 'POST' })); setApi(el); } }));
  $$('[data-kr]').forEach((b) => b.addEventListener('click', async () => { if (!await confirmDlg('키 재발급', '지금 키는 폐기되고 같은 범위의 새 키가 나옵니다.', '재발급')) return; const r = await guard(() => api(`/api-keys/${b.dataset.kr}/rotate`, { method: 'POST' })); await dialog('새 키', `<input class="inp mono" readonly value="${esc(r.key)}" onclick="this.select()">`); setApi(el); }));
  $('#nw').addEventListener('click', async () => {
    const v = await dialog('Webhook 등록', `<label class="f"><span>받을 주소 (https)</span><input class="inp" id="wu" placeholder="https://erp.example.com/ieumsign/webhook"></label>${wh.events.map((e) => `<label class="chk"><input type="checkbox" data-ev="${e}" checked> ${e}</label><br>`).join('')}`, [{ label: '등록', cls: 'primary', value: (dd) => ({ url: $('#wu', dd).value, events: $$('[data-ev]:checked', dd).map((e) => e.dataset.ev) }) }]);
    if (!v) return; const r = await guard(() => api('/webhooks', { method: 'POST', body: v }));
    await dialog('서명 비밀값', `<p>${esc(r.notice)} 받는 쪽에서 서명을 검증할 때 씁니다.</p><input class="inp mono" readonly value="${esc(r.secret)}" onclick="this.select()">`); setApi(el);
  });
  $$('[data-wd]').forEach((b) => b.addEventListener('click', async () => { await guard(() => api('/webhooks/' + b.dataset.wd, { method: 'DELETE' })); setApi(el); }));
  $$('[data-rs]').forEach((b) => b.addEventListener('click', async () => { await guard(() => api(`/webhook-deliveries/${b.dataset.rs}/resend`, { method: 'POST' })); toast('재전송 대기열에 넣었습니다'); }));
}
async function setOutbox(el) {
  const list = await api('/outbox');
  el.innerHTML = `<div class="note warn" style="margin-bottom:12px">메일·문자 발송 업체가 연결되지 않으면 "미연결" 상태로 여기에만 기록됩니다 (SMTP_URL·SMS_API_URL 설정 필요). 앱 알림은 바로 전달됩니다.</div>
  <div class="card tbl-wrap"><table class="t small"><tr><th>시각</th><th>채널</th><th>받는 사람</th><th>제목</th><th>상태</th></tr>${list.map((o) => `<tr><td class="nowrap">${dt(o.created_at)}</td><td>${({ email: '메일', sms: '문자', inapp: '앱' })[o.channel]}</td><td>${esc(o.to_addr || userName(o.user_id))}</td><td>${esc(o.subject)}<details><summary class="faint">내용</summary><pre style="white-space:pre-wrap;margin:4px 0">${esc(o.body)}</pre></details></td><td>${badge(o.status, { sent: '전달', not_connected: '미연결', queued: '대기', failed: '실패' }[o.status])}</td></tr>`).join('')}</table></div>`;
}
async function setAudit(el) {
  if (!can('org.manage')) { el.innerHTML = '<div class="note">조직 관리 권한이 필요합니다</div>'; return; }
  const a = await api('/audit');
  el.innerHTML = `<div class="note ${a.chain.ok ? 'ok' : 'bad'}" style="margin-bottom:12px">감사 이력 해시 체인: ${a.chain.ok ? '정상 (중간 기록 변경 없음)' : '불일치 — 기록 #' + a.chain.brokenAt + ' 부터 맞지 않습니다'}</div>
  <div class="card tbl-wrap"><table class="t small"><tr><th>시각</th><th>행위</th><th>행위자</th><th>문서</th><th>내용</th></tr>${a.logs.map((l) => `<tr><td class="nowrap">${dt(l.at)}</td><td>${esc(l.action)}</td><td>${esc(l.actor_name || l.actor_type)}</td><td>${l.document_id ? `<a href="#/doc/${l.document_id}">#${l.document_id}</a>` : ''}</td><td class="mono" style="word-break:break-all">${esc(l.detail || '').slice(0, 200)}</td></tr>`).join('')}</table></div>`;
}

boot();
