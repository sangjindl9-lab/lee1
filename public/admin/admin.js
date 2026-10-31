(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v) => Number(v || 0).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  VIEWS[v]();
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
    ['보유 크레딧 합계', fmt(s.liability), '모든 플레이어 잔액'],
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
      <td>${esc(p.last_login || '—')}</td><td>${esc(p.note)}</td>
      <td><div class="act"><button class="btn sm" data-a="adj" data-id="${p.id}" data-u="${esc(p.username)}" data-b="${p.balance}">잔액 조정</button>
      <button class="btn sm" data-a="tx" data-id="${p.id}" data-u="${esc(p.username)}">거래 내역</button>
      <button class="btn sm" data-a="pw" data-id="${p.id}" data-u="${esc(p.username)}">비밀번호</button>
      <button class="btn sm ${p.status === 'active' ? 'danger' : ''}" data-a="st" data-id="${p.id}" data-s="${p.status === 'active' ? 'suspended' : 'active'}">${p.status === 'active' ? '정지' : '해제'}</button></div></td></tr>`;
  }).join('') || '<tr><td colspan="10">플레이어가 없습니다. 위에서 새 플레이어를 등록하세요.</td></tr>';
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
  const q = new URLSearchParams({ player: $('rp').value, game: $('rg').value, minWin: $('rw').value, feature: $('rfe').checked ? '1' : '' });
  if (lastRoundId) q.set('before', lastRoundId);
  const rows = await api('/rounds?' + q);
  const html = rows.map((r) => `<tr><td class="n">${r.id}</td><td>${esc(r.created_at)}</td><td>${esc(r.username)}</td><td>${esc(r.game)}${r.feature ? ' <span class="chip warn">보너스</span>' : ''}</td>
    <td class="n">${fmt(r.bet)}</td><td class="n ${r.win > 0 ? 'pos' : ''}">${fmt(r.win)}</td><td class="n">${r.bet ? (r.win / r.bet).toFixed(1) + '×' : ''}</td><td class="n">${fmt(r.balance_after)}</td>
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
    <p class="note">${esc(r.created_at)} · 플레이어 ${esc(r.username)} · 베팅 ${fmt(r.bet)} · 당첨 ${fmt(r.win)} (${(R.total).toFixed(2)}배) · 잔액 ${fmt(r.balance_after)}</p>
    <h3>기본 스핀 · 릴 정지 위치 ${R.base.stops ? R.base.stops.join(', ') : ''}</h3>${gridHTML(R.base)}<p class="note">${winsList(R.base)}</p>
    ${F ? `<h3>보너스 · ${F.type === 'expandingFreeSpins' ? `확장 무료 회전 (${esc(sym(F.expandSym))}) ${F.spins.length}회 · 보너스 ${F.win.toFixed(2)}배` : esc(F.type)}</h3>
      <div class="spins">${F.spins.map((sp, i) => `<div class="sp"><b>${i + 1}회</b> · ${(sp.win).toFixed(2)}배${sp.retrigger ? ' · 재트리거' : ''}${gridHTML(sp)}<div class="note" style="margin:0">${winsList(sp)}</div></div>`).join('')}</div>` : ''}`);
});

/* ---------- games ---------- */
async function loadGames() {
  gameList = await api('/games');
  $('gcards').innerHTML = gameList.map((g) => {
    const opts = (sel) => g.bets.map((b) => `<option value="${b}" ${b === sel ? 'selected' : ''}>${fmt(b)}</option>`).join('');
    return `<article class="gcard" data-id="${esc(g.id)}"><header><h4>${esc(g.name)}</h4>
      <label class="switch"><input type="checkbox" data-k="enabled" ${g.enabled ? 'checked' : ''} aria-label="${esc(g.name)} 공개"> ${g.enabled ? '공개 중' : '숨김'}</label></header>
      <dl><dt>구성</dt><dd>${esc(g.layout)}</dd><dt>변동성</dt><dd>${esc(g.volatility)}</dd><dt>기능</dt><dd>${g.features.map(esc).join(', ') || '없음'}</dd>
      <dt>이론 RTP</dt><dd>${pct(g.theoretical)}</dd><dt>누적 실제 RTP</dt><dd>${rtpChip(g.actual, g.theoretical, g.rounds)} · ${g.rounds.toLocaleString()}회차</dd><dt>누적 GGR</dt><dd class="${sign(g.ggr)}">${fmt(g.ggr)}</dd></dl>
      <div class="row"><div><label for="mn-${esc(g.id)}">최소 베팅</label><select id="mn-${esc(g.id)}" data-k="minBet">${opts(g.minBet)}</select></div>
      <div><label for="mx-${esc(g.id)}">최대 베팅</label><select id="mx-${esc(g.id)}" data-k="maxBet">${opts(g.maxBet)}</select></div>
      <button class="btn pri" data-save>저장</button></div></article>`;
  }).join('');
}
$('gcards').addEventListener('click', async (e) => {
  const card = e.target.closest('.gcard'); if (!card) return;
  const isToggle = e.target.matches('input[data-k="enabled"]'), isSave = e.target.matches('[data-save]');
  if (!isToggle && !isSave) return;
  const body = { enabled: card.querySelector('[data-k="enabled"]').checked, minBet: +card.querySelector('[data-k="minBet"]').value, maxBet: +card.querySelector('[data-k="maxBet"]').value };
  try { await api('/games/' + card.dataset.id, { method: 'PATCH', body }); toast(isToggle ? (body.enabled ? '게임 공개됨' : '게임 숨김') : '베팅 한도 저장됨'); loadGames(); }
  catch (err) { toast(err.message); loadGames(); }
});

/* ---------- audit & account ---------- */
const ACT = { login: '로그인', 'player.create': '플레이어 등록', 'player.update': '플레이어 수정', 'player.adjust': '잔액 조정', 'game.update': '게임 설정 변경', 'admin.password': '비밀번호 변경' };
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
