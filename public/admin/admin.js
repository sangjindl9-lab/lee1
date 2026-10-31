(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR') + '원';
const lim = (v) => (v ? fmt(v) : '없음');
const pct = (v) => (v == null ? '—' : (v * 100).toFixed(2) + '%');
const sign = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2400); }
async function api(path, opt = {}) {
  const r = await fetch('/admin/api' + path, { method: opt.method || (opt.body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' }, body: opt.body ? JSON.stringify(opt.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== '/login') { showLogin(); throw new Error(j.error); }
  if (!r.ok) throw new Error(j.error || '요청을 처리하지 못했습니다.');
  return j;
}
function showLogin() { $('login').hidden = false; $('appA').hidden = true; }
function modal(html) { $('mbody').innerHTML = html; $('modal').hidden = false; }
$('mclose').onclick = () => { $('modal').hidden = true; };
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('modal').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('modal').hidden = true; });

/* ---------- auth ---------- */
$('lf').addEventListener('submit', async (e) => {
  e.preventDefault(); $('lerr').textContent = '';
  try { await api('/login', { body: { username: $('lu').value, password: $('lp').value } }); boot(); } catch (err) { $('lerr').textContent = err.message; }
});
$('logout').onclick = async () => { await api('/logout', { body: {} }).catch(() => {}); showLogin(); };
async function boot() {
  try { const me = await api('/me'); $('meName').textContent = me.username; } catch (e) { return; }
  $('login').hidden = true; $('appA').hidden = false; route();
}

/* ---------- routing ---------- */
const VIEWS = { dash: loadDash, players: loadPlayers, rounds: () => loadRounds(true), games: loadGames, audit: loadAudit, account: () => {} };
function route() {
  const v = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'dash';
  document.querySelectorAll('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== v; });
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === v));
  Promise.resolve().then(VIEWS[v]).catch((e) => toast(e.message || '화면을 불러오지 못했습니다. 새로고침해 주세요.'));
}
addEventListener('hashchange', route);

/* ---------- dashboard ---------- */
let range = 'today';
$('range').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; range = b.dataset.r; $('range').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); loadDash(); });
function rtpChip(actual, theo, rounds) {
  if (actual == null) return '<span class="chip mute">—</span>';
  const d = actual - theo; const cls = rounds < 5000 ? 'mute' : Math.abs(d) < .03 ? 'ok' : Math.abs(d) < .08 ? 'warn' : 'bad';
  return `<span class="chip ${cls}" title="${rounds < 5000 ? '표본이 적어 편차가 큽니다' : '이론값 대비 ' + (d * 100).toFixed(2) + '%p'}">${pct(actual)}</span>`;
}
async function loadDash() {
  const s = await api('/stats?range=' + range);
  const t = s.totals;
  const k = [
    ['총 베팅', fmt(t.bet), `${t.rounds.toLocaleString()}회차`],
    ['총 지급', fmt(t.win), `보너스 ${t.features || 0}회`],
    ['GGR (베팅−지급)', fmt(t.ggr), t.bet ? `마진 ${pct(t.ggr / t.bet)}` : '', 'hl'],
    ['실제 RTP', pct(t.rtp), '선택 기간 전체'],
    ['플레이한 인원', t.players.toLocaleString(), `활성 계정 ${s.playersActive} / 전체 ${s.playersTotal}`],
    ['보유 잔액 합계', fmt(s.liability), '모든 플레이어 잔액'],
    ['한도 적용 회차', (t.capped || 0).toLocaleString(), `미지급 초과분 ${fmt(t.capSaved)}`],
  ];
  $('kpis').innerHTML = k.map(([a, b, c, cls]) => `<div class="kpi ${cls || ''}"><span>${a}</span><b>${b}</b><small>${c}</small></div>`).join('');
  $('byGame').innerHTML = s.byGame.map((g) => `<tr><td>${esc(g.name)}</td><td class="n">${g.rounds.toLocaleString()}</td><td class="n">${fmt(g.bet)}</td><td class="n">${fmt(g.win)}</td>
    <td class="n ${sign(g.ggr)}">${fmt(g.ggr)}</td><td class="n">${rtpChip(g.rtp, g.theoretical, g.rounds)}</td><td class="n">${pct(g.theoretical)}</td><td class="n">${g.features}</td><td class="n">${fmt(g.maxWin)}</td></tr>`).join('')
    || '<tr><td colspan="9">이 기간에 플레이 기록이 없습니다.</td></tr>';
  const max = Math.max(1, ...s.daily.map((d) => Math.abs(d.ggr)));
  $('daily').innerHTML = s.daily.slice().reverse().map((d) => `<tr><td>${d.day}</td><td class="n">${d.rounds.toLocaleString()}</td><td class="n">${fmt(d.bet)}</td><td class="n">${fmt(d.win)}</td>
    <td class="n ${sign(d.ggr)}">${fmt(d.ggr)}</td><td><div class="barc"><i class="${d.ggr < 0 ? 'neg' : ''}" style="width:${(Math.abs(d.ggr) / max * 100).toFixed(1)}%"></i></div></td></tr>`).join('')
    || '<tr><td colspan="6">최근 14일 기록이 없습니다.</td></tr>';
}

/* ---------- players ---------- */
let pqT;
$('pq').addEventListener('input', () => { clearTimeout(pqT); pqT = setTimeout(loadPlayers, 250); });
async function loadPlayers() {
  const list = await api('/players?q=' + encodeURIComponent($('pq').value));
  $('players').innerHTML = list.map((p) => {
    const pl = p.win - p.bet;
    return `<tr><td>${esc(p.username)}</td><td class="n">${fmt(p.balance)}</td>
      <td>${p.status === 'active' ? '<span class="chip ok">정상</span>' : '<span class="chip bad">정지</span>'}</td>
      <td class="n">${p.rounds.toLocaleString()}</td><td class="n">${fmt(p.bet)}</td><td class="n">${fmt(p.win)}</td><td class="n ${sign(pl)}">${fmt(pl)}</td>
      <td>${esc(p.last_login || '—')}</td><td class="lims">베팅 ${lim(p.max_bet)}<br>당첨 ${lim(p.max_win)}<br>일 손실 ${lim(p.daily_loss)}${p.daily_loss ? ` (오늘 ${fmt(p.loss_today)})` : ''}</td><td>${esc(p.note)}</td>
      <td><div class="act"><button class="btn sm" data-a="adj" data-id="${p.id}" data-u="${esc(p.username)}" data-b="${p.balance}">잔액 조정</button>
      <button class="btn sm" data-a="lim" data-id="${p.id}" data-u="${esc(p.username)}" data-mb="${p.max_bet}" data-mw="${p.max_win}" data-dl="${p.daily_loss}" data-note="${esc(p.note)}">한도·메모</button>
      <button class="btn sm" data-a="tx" data-id="${p.id}" data-u="${esc(p.username)}">거래 내역</button>
      <button class="btn sm" data-a="pw" data-id="${p.id}" data-u="${esc(p.username)}">비밀번호</button>
      <button class="btn sm ${p.status === 'active' ? 'danger' : ''}" data-a="st" data-id="${p.id}" data-s="${p.status === 'active' ? 'suspended' : 'active'}">${p.status === 'active' ? '정지' : '해제'}</button></div></td></tr>`;
  }).join('') || '<tr><td colspan="11">플레이어가 없습니다. 위에서 새 플레이어를 등록하세요.</td></tr>';
}
$('pf').addEventListener('submit', async (e) => {
  e.preventDefault(); $('perr').textContent = '';
  try {
    await api('/players', { body: { username: $('nu').value, password: $('np').value, balance: +$('nb').value || 0, note: $('nn').value } });
    toast(`${$('nu').value} 등록됨`); $('pf').reset(); $('nb').value = 1000; loadPlayers();
  } catch (err) { $('perr').textContent = err.message; }
});
$('players').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-a]'); if (!b) return;
  const id = b.dataset.id, u = b.dataset.u;
  if (b.dataset.a === 'st') {
    try { await api('/players/' + id, { method: 'PATCH', body: { status: b.dataset.s } }); toast(b.dataset.s === 'active' ? '정지 해제됨' : '정지됨 · 접속이 끊깁니다'); loadPlayers(); } catch (err) { toast(err.message); }
  } else if (b.dataset.a === 'adj') {
    modal(`<h3>${esc(u)} 잔액 조정</h3><p class="note">현재 잔액 ${fmt(b.dataset.b)}. 지급은 양수, 차감은 음수로 입력하세요. 모든 조정은 감사 로그에 남습니다.</p>
      <form id="adjF"><label for="aa">금액</label><input id="aa" type="number" step="0.01" required>
      <label for="ar">사유</label><input id="ar" required maxlength="200" placeholder="예: 입금 확인 #1234">
      <p class="err" id="aer"></p><button class="btn pri" type="submit">조정 적용</button></form>`);
    $('aa').focus();
    $('adjF').onsubmit = async (ev) => {
      ev.preventDefault();
      try { const r = await api(`/players/${id}/adjust`, { body: { amount: +$('aa').value, reason: $('ar').value } }); $('modal').hidden = true; toast(`조정 완료 · 잔액 ${fmt(r.balance)}`); loadPlayers(); }
      catch (err) { $('aer').textContent = err.message; }
    };
  } else if (b.dataset.a === 'lim') {
    modal(`<h3>${esc(u)} 한도·메모</h3><p class="note">0을 넣으면 제한이 없습니다. 게임 설정의 한도와 함께 적용되며 더 작은 쪽이 쓰입니다.</p>
      <form id="limF" class="grid2">
        <div><label for="lmb">1회 최대 베팅 (원)</label><input id="lmb" type="number" min="0" step="100" value="${b.dataset.mb}"></div>
        <div><label for="lmw">1회차 최대 당첨 (원)</label><input id="lmw" type="number" min="0" step="1000" value="${b.dataset.mw}"></div>
        <div><label for="ldl">하루 손실 한도 (원)</label><input id="ldl" type="number" min="0" step="1000" value="${b.dataset.dl}"></div>
        <div><label for="lnt">메모</label><input id="lnt" maxlength="200" value="${b.dataset.note}"></div>
        <div class="full"><p class="err" id="lme"></p><button class="btn pri" type="submit">저장</button></div></form>`);
    $('limF').onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api('/players/' + id, { method: 'PATCH', body: { maxBet: +$('lmb').value || 0, maxWin: +$('lmw').value || 0, dailyLoss: +$('ldl').value || 0, note: $('lnt').value } }); $('modal').hidden = true; toast('한도 저장됨'); loadPlayers(); }
      catch (err) { $('lme').textContent = err.message; }
    };
  } else if (b.dataset.a === 'pw') {
    modal(`<h3>${esc(u)} 비밀번호 재설정</h3><form id="pwF"><label for="pw1">새 비밀번호 (6자 이상)</label><input id="pw1" required minlength="6">
      <p class="err" id="pwe"></p><button class="btn pri" type="submit">변경</button></form>`);
    $('pwF').onsubmit = async (ev) => {
      ev.preventDefault();
      try { await api('/players/' + id, { method: 'PATCH', body: { password: $('pw1').value } }); $('modal').hidden = true; toast('비밀번호 변경됨 · 기존 접속 해제'); } catch (err) { $('pwe').textContent = err.message; }
    };
  } else if (b.dataset.a === 'tx') {
    const rows = await api(`/players/${id}/tx`);
    const T = { bet: '베팅', win: '당첨', adjust: '조정' };
    modal(`<h3>${esc(u)} 거래 내역 (최근 200건)</h3><div class="tbl"><table><thead><tr><th>시간</th><th>구분</th><th class="n">금액</th><th class="n">잔액</th><th class="n">회차</th><th>메모</th><th>처리자</th></tr></thead><tbody>
      ${rows.map((t) => `<tr><td>${esc(t.created_at)}</td><td>${T[t.type] || esc(t.type)}</td><td class="n ${sign(t.amount)}">${fmt(t.amount)}</td><td class="n">${fmt(t.balance_after)}</td>
      <td class="n">${t.round_id ? `<button class="link" data-round="${t.round_id}">#${t.round_id}</button>` : ''}</td><td>${esc(t.note || '')}</td><td>${esc(t.actor || '')}</td></tr>`).join('') || '<tr><td colspan="7">내역이 없습니다.</td></tr>'}
      </tbody></table></div>`);
  }
});

/* ---------- rounds ---------- */
let lastRoundId = 0, gameList = [];
$('rf').addEventListener('submit', (e) => { e.preventDefault(); loadRounds(true); });
$('rmore').onclick = () => loadRounds(false);
async function loadRounds(reset) {
  if (!gameList.length) { gameList = await api('/games'); $('rg').innerHTML = '<option value="">전체 게임</option>' + gameList.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join(''); }
  if (reset) lastRoundId = 0;
  const q = new URLSearchParams({ player: $('rp').value, game: $('rg').value, minWin: $('rw').value, feature: $('rfe').checked ? '1' : '', capped: $('rca').checked ? '1' : '' });
  if (lastRoundId) q.set('before', lastRoundId);
  const rows = await api('/rounds?' + q);
  const html = rows.map((r) => `<tr><td class="n">${r.id}</td><td>${esc(r.created_at)}</td><td>${esc(r.username)}</td><td>${esc(r.game)}${r.feature ? ' <span class="chip warn">보너스</span>' : ''}</td>
    <td class="n">${fmt(r.bet)}</td><td class="n ${r.win > 0 ? 'pos' : ''}">${fmt(r.win)}${r.raw_win > r.win ? ` <span class="chip bad" title="한도 적용 전 ${fmt(r.raw_win)}">한도</span>` : ''}</td><td class="n">${r.bet ? (r.win / r.bet).toFixed(1) + '×' : ''}</td><td class="n">${fmt(r.balance_after)}</td>
    <td><button class="btn sm" data-round="${r.id}">상세</button></td></tr>`).join('');
  if (reset) $('rounds').innerHTML = html || '<tr><td colspan="9">조건에 맞는 회차가 없습니다.</td></tr>'; else $('rounds').insertAdjacentHTML('beforeend', html);
  if (rows.length) lastRoundId = rows[rows.length - 1].id;
  $('rmore').hidden = rows.length < 100;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-round]'); if (!b) return;
  const r = await api('/rounds/' + b.dataset.round);
  const sym = (i) => (r.symbols[i] ? r.symbols[i].name : i);
  const gridHTML = (sp) => {
    const cols = sp.grid.length, rows = sp.grid[0].length, win = new Set();
    sp.lineWins.forEach((w) => r.lines[w.line].forEach((row, c) => { if (c < w.count) win.add(c + ':' + row); }));
    if (sp.expand) sp.expand.reels.forEach((c) => { for (let k = 0; k < rows; k++) win.add(c + ':' + k); });
    let h = `<div class="gridview" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">`;
    for (let row = 0; row < rows; row++) for (let c = 0; c < cols; c++) h += `<div class="${win.has(c + ':' + row) ? 'w' : ''}">${esc(sym(sp.grid[c][row]))}</div>`;
    return h + '</div>';
  };
  const winsList = (sp) => sp.lineWins.map((w) => `${w.line + 1}번 라인 ${esc(sym(w.sym))}×${w.count} (라인 ${w.mult}배)`).concat(sp.scatter && sp.scatter.multTotal ? [`스캐터 ${sp.scatter.count}개 (총 베팅 ${sp.scatter.multTotal}배)`] : [])
    .concat(sp.expand ? [`확장 ${esc(sym(sp.expand.sym))} 릴 ${sp.expand.reels.map((x) => x + 1).join('·')}`] : []).join('<br>') || '당첨 없음';
  const R = r.result, F = R.feature;
  modal(`<h3>회차 #${r.id} · ${esc(r.game)}</h3>
    <p class="note">${esc(r.created_at)} · 플레이어 ${esc(r.username)} · RTP ${esc(r.variantLabel || '—')} · 베팅 ${fmt(r.bet)} · 당첨 ${fmt(r.win)} (${(R.total).toFixed(2)}배)${R.capped ? ` · <b class="neg">한도 적용: 원래 ${fmt(R.capped.raw)} → ${fmt(R.capped.cap)}</b>` : ''} · 잔액 ${fmt(r.balance_after)}</p>
    <h3>기본 스핀 · 릴 정지 위치 ${R.base.stops ? R.base.stops.join(', ') : ''}</h3>${gridHTML(R.base)}<p class="note">${winsList(R.base)}</p>
    ${F ? `<h3>보너스 · ${F.type === 'expandingFreeSpins' ? `확장 무료 회전 (${esc(sym(F.expandSym))}) ${F.spins.length}회 · 보너스 ${F.win.toFixed(2)}배` : esc(F.type)}</h3>
      <div class="spins">${F.spins.map((sp, i) => `<div class="sp"><b>${i + 1}회</b> · ${(sp.win).toFixed(2)}배${sp.retrigger ? ' · 재트리거' : ''}${gridHTML(sp)}<div class="note" style="margin:0">${winsList(sp)}</div></div>`).join('')}</div>` : ''}`);
});

/* ---------- games ---------- */
async function loadGames() {
  gameList = await api('/games');
  $('gcards').innerHTML = gameList.map((g) => {
    const s = g.settings, id = esc(g.id);
    return `<article class="gcard" data-id="${id}">
      <header><h4>${esc(g.name)}</h4>
        <label class="switch"><input type="checkbox" data-k="enabled" ${g.enabled ? 'checked' : ''}> ${g.enabled ? '공개 중' : '숨김'}</label></header>
      <dl><dt>구성</dt><dd>${esc(g.layout)} · 변동성 ${esc(g.volatility)}</dd>
        <dt>설정 RTP</dt><dd>${pct(g.theoretical)}</dd>
        <dt>누적 실제 RTP</dt><dd>${rtpChip(g.actual, g.theoretical, g.rounds)} · ${g.rounds.toLocaleString()}회차</dd>
        <dt>누적 GGR</dt><dd class="${sign(g.ggr)}">${fmt(g.ggr)}</dd></dl>
      <div class="fields">
        <div class="full"><label for="bt-${id}">베팅 단계 (원, 쉼표로 구분 · 라인 수의 배수)</label><input id="bt-${id}" data-k="bets" value="${s.bets.join(', ')}"></div>
        <div><label for="db-${id}">기본 베팅</label><select id="db-${id}" data-k="defaultBet">${s.bets.map((b) => `<option value="${b}" ${b === s.defaultBet ? 'selected' : ''}>${fmt(b)}</option>`).join('')}</select></div>
        <div><label for="rv-${id}">RTP (%)</label><input id="rv-${id}" data-k="rtp" type="number" min="1" max="200" step="0.1" value="${s.rtp}"></div>
        <div><label for="mw-${id}">회차당 최대 당첨 (원, 0=없음)</label><input id="mw-${id}" data-k="maxWin" type="number" min="0" step="1000" value="${s.maxWin}"></div>
        <div><label for="mx-${id}">최대 당첨 배수 (베팅의 N배, 0=없음)</label><input id="mx-${id}" data-k="maxWinX" type="number" min="0" step="100" value="${s.maxWinX}"></div>
        ${g.features.length ? `<div class="full"><label class="switch"><input type="checkbox" data-k="featuresOn" ${s.featuresOn ? 'checked' : ''}> 보너스 기능 사용 (켜고 끄도 설정 RTP는 유지됩니다)</label></div>` : ''}
        <div class="full"><label for="mt-${id}">점검 안내 (입력하면 점검 모드, 비우면 해제)</label><input id="mt-${id}" data-k="maintenance" maxlength="120" value="${esc(s.maintenance)}" placeholder="예: 오후 3시까지 점검"></div>
      </div>
      <div class="act"><button class="btn pri" data-save>저장</button><button class="btn" data-reset>기본값으로</button></div></article>`;
  }).join('');
}
$('gcards').addEventListener('click', async (e) => {
  const card = e.target.closest('.gcard'); if (!card) return;
  const id = card.dataset.id, q = (k) => card.querySelector(`[data-k="${k}"]`);
  try {
    if (e.target.matches('[data-k="enabled"]')) { await api('/games/' + id, { method: 'PATCH', body: { enabled: e.target.checked } }); toast(e.target.checked ? '게임 공개됨' : '게임 숨김'); }
    else if (e.target.matches('[data-reset]')) { await api(`/games/${id}/reset`, { body: {} }); toast('기본값으로 되돌림'); }
    else if (e.target.matches('[data-save]')) {
      const body = { bets: q('bets').value, defaultBet: +q('defaultBet').value, rtp: +q('rtp').value, maxWin: +q('maxWin').value || 0, maxWinX: +q('maxWinX').value || 0, maintenance: q('maintenance').value };
      if (q('featuresOn')) body.featuresOn = q('featuresOn').checked;
      await api('/games/' + id, { method: 'PATCH', body }); toast('게임 설정 저장됨');
    } else return;
    loadGames();
  } catch (err) { toast(err.message); loadGames(); }
});

/* ---------- audit & account ---------- */
const ACT = { login: '로그인', 'player.create': '플레이어 등록', 'player.update': '플레이어 수정', 'player.adjust': '잔액 조정', 'game.update': '게임 설정 변경', 'game.reset': '게임 설정 초기화', 'admin.password': '비밀번호 변경' };
async function loadAudit() {
  const rows = await api('/audit');
  $('audit').innerHTML = rows.map((a) => `<tr><td>${esc(a.created_at)}</td><td>${esc(a.actor)}</td><td>${esc(ACT[a.action] || a.action)}</td><td style="white-space:normal;font-family:var(--mono);font-size:12px">${esc(a.detail)}</td></tr>`).join('') || '<tr><td colspan="4">기록이 없습니다.</td></tr>';
}
$('af').addEventListener('submit', async (e) => {
  e.preventDefault(); $('aerr').textContent = '';
  try { await api('/password', { body: { current: $('ac').value, next: $('an').value } }); $('af').reset(); toast('비밀번호 변경됨'); } catch (err) { $('aerr').textContent = err.message; }
});

boot().then(() => { if ($('appA').hidden) showLogin(); });
})();
