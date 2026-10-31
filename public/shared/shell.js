// Generic slot client. Results always come from the server; this file only animates them.
(async () => {
'use strict';
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const Audio = window.SlotAudio, FX = window.SlotFX;
const fmt = (v) => Math.round(Number(v) || 0).toLocaleString('ko-KR') + '원';
const gameId = new URLSearchParams(location.search).get('g');

async function api(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = '/'; throw new Error('login'); }
  if (!r.ok) throw new Error(j.error || '서버와 통신하지 못했습니다.');
  return j;
}
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('불러오기 실패: ' + src)); document.head.appendChild(s); }); }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600); }

let data;
try { data = await api(`/api/games/${encodeURIComponent(gameId || '')}`); } catch (e) { if (e.message !== 'login') { toast(e.message); setTimeout(() => (location.href = '/lobby'), 1500); } return; }
const cfg = data.game;
await loadScript(`/games/${cfg.id}/theme.js?v=1793462911`);
for (const f of cfg.features) await loadScript(`/shared/features/${f.type}.js?v=1793462911`);
const theme = window.SlotThemes[cfg.id];

/* ---------- theme application ---------- */
document.title = cfg.name;
Object.entries(theme.vars || {}).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
document.documentElement.style.setProperty('--reels', cfg.reels);
document.documentElement.style.setProperty('--rows', cfg.rows);
if (theme.defs) $('defs').innerHTML = theme.defs;
$('gTitle').textContent = cfg.name; $('gSeal').textContent = theme.seal || '';
$('gSeal').hidden = !theme.seal;
const baseMode = theme.tagline || `${cfg.reels}릴 · ${cfg.lines.length}라인`;
$('mode').textContent = baseMode;
$('startTitle').textContent = cfg.name; $('startBody').innerHTML = theme.introHTML || '';
Audio.configure(theme.audio);
FX.start(theme);
const SPECIAL = cfg.symbols.findIndex((s) => s.scatter);
const symHTML = (i) => theme.symbol(cfg.symbols[i].id, i);

/* ---------- reels ---------- */
const reelsEl = $('reels'), linesEl = $('lines');
linesEl.setAttribute('viewBox', `0 0 ${cfg.reels} ${cfg.rows}`);
const reels = [];
for (let r = 0; r < cfg.reels; r++) {
  const el = document.createElement('div'); el.className = 'reel';
  const strip = document.createElement('div'); strip.className = 'strip'; el.appendChild(strip);
  reelsEl.insertBefore(el, linesEl); reels.push({ el, strip, cells: [] });
}
const fillerPool = []; cfg.symbols.forEach((s, i) => { const w = s.wild || s.scatter ? 1 : 2 + i; for (let k = 0; k < w; k++) fillerPool.push(i); });
const randSym = () => fillerPool[Math.floor(Math.random() * fillerPool.length)];
let grid = cfg.reels && Array.from({ length: cfg.reels }, () => Array.from({ length: cfg.rows }, randSym));
function setReel(r, col) { const R = reels[r]; R.strip.innerHTML = col.map((s) => `<div class="cell">${symHTML(s)}</div>`).join(''); R.strip.style.transform = 'translateY(0)'; R.cells = [...R.strip.children]; }
grid.forEach((c, r) => setReel(r, c));

let turbo = false;
const easeStop = (x) => { const c = 1.15, y = x - 1; return 1 + (c + 1) * y * y * y + c * y * y; };
const featNeed = cfg.features.length && SPECIAL >= 0 ? (cfg.features[0].minScatters || 3) : 0;

function spinReels(target) {
  return new Promise((resolve) => {
    clearWins();
    const speed = turbo ? .5 : 1, now = performance.now();
    const plans = reels.map((R, r) => {
      const n = 22 + r * 5, filler = []; for (let k = 0; k < n; k++) filler.push(randSym());
      R.strip.innerHTML = target[r].concat(filler).map((s) => `<div class="cell">${symHTML(s)}</div>`).join('');
      const dist = n * (R.el.clientHeight / cfg.rows);
      R.strip.style.transform = `translateY(${-dist}px)`;
      return { r, dist, start: now, dur: (900 + r * 260) * speed, done: false, extra: 0 };
    });
    // anticipation planned from the result: one special short of the feature with reels left
    let acc = 0, anticFrom = 99;
    if (featNeed) for (let r = 0; r < cfg.reels - 1; r++) { acc += target[r].filter((s) => s === SPECIAL).length; if (acc >= featNeed - 1) { anticFrom = r + 1; break; } }
    plans.forEach((Q) => { if (Q.r >= anticFrom) Q.extra = (1500 + (Q.r - anticFrom) * 1100) * speed; });
    Audio.spin();
    let stopped = 0, specials = 0;
    function frame(t) {
      for (const P of plans) {
        if (P.done) continue;
        const R = reels[P.r], x = Math.max(0, (t - P.start) / (P.dur + P.extra));
        if (x >= 1) {
          P.done = true; R.strip.style.transform = 'translateY(0)'; R.strip.classList.remove('blur');
          while (R.strip.children.length > cfg.rows) R.strip.lastChild.remove();
          R.cells = [...R.strip.children]; R.el.classList.remove('anticip'); stopped++;
          const nS = target[P.r].filter((s) => s === SPECIAL).length;
          R.cells.forEach((c, i) => c.classList.add(target[P.r][i] === SPECIAL ? 'special' : 'land'));
          Audio.stop(P.r);
          if (nS) { specials += nS; Audio.special(specials); const bb = R.el.getBoundingClientRect(); FX.burst(bb.left + bb.width / 2, bb.top + bb.height / 2, 26, 'accent', 1, theme.accentHue || 155); }
          if (P.r + 1 >= anticFrom && stopped < cfg.reels) { const nx = plans.find((Q) => !Q.done); if (nx) reels[nx.r].el.classList.add('anticip'); Audio.anticip(); }
          continue;
        }
        R.strip.style.transform = `translateY(${-P.dist * (1 - easeStop(x))}px)`;
        R.strip.classList.toggle('blur', x > .05 && x < .82);
      }
      if (stopped < cfg.reels) requestAnimationFrame(frame); else resolve();
    }
    requestAnimationFrame(frame);
  });
}

/* ---------- win presentation ---------- */
const LINE_COLORS = theme.lineColors || ['#e9c46a', '#3fbf8f', '#e2482d', '#9fd2f0', '#f28bb0', '#ffb347', '#7ff0c3', '#ff7a5c', '#c9b6ff', '#fff1c1'];
const lineColor = (i) => LINE_COLORS[i % LINE_COLORS.length];
const winbar = $('winbar');
let cycleId = 0, curWin = 0;
function clearWins() {
  reelsEl.classList.remove('dim'); linesEl.innerHTML = '';
  reels.forEach((R) => { R.cells.forEach((c) => c.classList.remove('win', 'land', 'special')); R.el.querySelectorAll('.expand').forEach((e) => e.remove()); });
  winbar.classList.remove('on'); cycleId++;
}
function softClear() { reelsEl.classList.remove('dim'); linesEl.innerHTML = ''; reels.forEach((R) => R.cells.forEach((c) => c.classList.remove('win'))); cycleId++; }
function drawLine(li) {
  const L = cfg.lines[li], pts = L.map((row, r) => `${r + .5},${row + .5}`).join(' '), c = lineColor(li);
  const all = `-0.05,${L[0] + .5} ${pts} ${cfg.reels + .05},${L[L.length - 1] + .5}`;
  linesEl.insertAdjacentHTML('beforeend', `<polyline points="${all}" stroke="${c}" stroke-width="10" opacity=".25" style="filter:blur(3px)"/><polyline points="${all}" stroke="${c}" stroke-width="4"/>`);
}
function markLine(w) { cfg.lines[w.line].forEach((row, r) => { if (r < w.count) reels[r].cells[row].classList.add('win'); }); }
function cellCenter(r, row) { const bb = reels[r].cells[row].getBoundingClientRect(); return [bb.left + bb.width / 2, bb.top + bb.height / 2]; }
function showWinbar(label, amt) { winbar.innerHTML = `<small>${label}</small>${fmt(amt)}`; winbar.classList.add('on'); }
function countUp(el, from, to, ms) {
  return new Promise((res) => {
    const st = performance.now(); let lastTick = 0;
    (function f(t) { const x = Math.min(1, (t - st) / ms); el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - x, 3)));
      if (t - lastTick > 70 && x < 1) { Audio.tick(); lastTick = t; } if (x < 1) requestAnimationFrame(f); else res(); })(st);
  });
}
function shake() { if (FX.REDUCED) return; const a = $('app'); a.classList.remove('shake'); void a.offsetWidth; a.classList.add('shake'); }

// Present one spin's normal wins. Returns credits won by this spin.
async function present(sp, bet, opts = {}) {
  const lineBet = bet / cfg.lines.length, total = sp.win * bet;
  if (total <= 0) return 0;
  const wins = sp.lineWins.map((w) => ({ ...w, amt: w.mult * lineBet }));
  reelsEl.classList.add('dim');
  wins.forEach((w) => { drawLine(w.line); markLine(w); for (let r = 0; r < w.count; r++) { const [x, y] = cellCenter(r, cfg.lines[w.line][r]); FX.burst(x, y, 6); } });
  if (sp.scatter && sp.scatter.multTotal > 0) reels.forEach((R, r) => R.cells.forEach((c, row) => { if (grid[r][row] === SPECIAL) c.classList.add('win'); }));
  if (total < bet * 2) Audio.small(); else Audio.lineWin(Math.min(6, Math.floor(total / bet)));
  showWinbar(opts.label || '당첨', total);
  await countUp($('win'), curWin, curWin + total, Math.min(1600, 300 + total / bet * 40));
  curWin += total; addBalance(total);
  if (opts.after) await opts.after();
  else if (wins.length > 1 && !auto.on && total < bet * 15) cycle(wins, total);
  return total;
}
async function cycle(wins, total) {
  const my = ++cycleId; await sleep(1200);
  while (my === cycleId) {
    for (const w of wins) {
      if (my !== cycleId) return;
      linesEl.innerHTML = ''; reels.forEach((R) => R.cells.forEach((c) => c.classList.remove('win')));
      drawLine(w.line); markLine(w); showWinbar(`${w.line + 1}번 라인 · ${cfg.symbols[w.sym].name} ×${w.count}`, w.amt);
      await sleep(1100);
    }
    if (my !== cycleId) return; showWinbar('당첨', total); await sleep(1100);
  }
}

/* ---------- overlays ---------- */
function waitButton(btn, autoDelay) {
  btn.hidden = false; btn.focus();
  return new Promise((r) => { let t; const done = () => { clearTimeout(t); btn.removeEventListener('click', done); r(); }; btn.addEventListener('click', done); if (auto.on && autoDelay) t = setTimeout(done, autoDelay); });
}
async function bigWin(total, bet) {
  const x = total / bet; if (x < 15) return;
  const tiers = (theme.tiers || [[15, '대승'], [40, '거대한 승리'], [100, '전설의 승리']]).filter((t) => x >= t[0]);
  const ov = $('ovBig'), tierEl = $('tier'), amt = $('bigAmt'), go = $('bigGo');
  ov.hidden = false; go.hidden = true; $('bigSub').textContent = `베팅의 ${x.toFixed(1)}배`; tierEl.textContent = tiers[0][1];
  Audio.fanfare(); shake();
  const coinTimer = setInterval(() => { FX.rain(4); Audio.coin(); }, 120);
  let shown = 0;
  for (let i = 0; i < tiers.length; i++) {
    const target = i === tiers.length - 1 ? total : Math.min(total, tiers[i + 1][0] * bet);
    if (i > 0) { tierEl.textContent = tiers[i][1]; tierEl.style.animation = 'none'; void tierEl.offsetWidth; tierEl.style.animation = ''; Audio.gong(.7); shake(); FX.burst(FX.W / 2, FX.H / 2, 80, 'coin', 1.4); }
    await countUp(amt, shown, target, turbo ? 900 : 2200); shown = target;
  }
  clearInterval(coinTimer); FX.burst(FX.W / 2, FX.H * .4, 60);
  await waitButton(go, 2500); ov.hidden = true;
}

/* ---------- state & controls ---------- */
let bets = cfg.bets, betI = Math.max(0, bets.indexOf(cfg.defaultBet)), balance = data.balance, shownBal = balance, busy = false;
const auto = { on: false, left: 0 };
const bet = () => bets[betI];
function renderBal() { $('bal').textContent = fmt(shownBal); }
function addBalance(v) { shownBal += v; renderBal(); }
function renderBet() { $('bet').innerHTML = `<small>베팅</small>${fmt(bet())}`; $('betDn').disabled = busy || betI === 0; $('betUp').disabled = busy || betI === bets.length - 1; renderPay(); }
function setBusy(b) { busy = b; $('spin').classList.toggle('busy', b); renderBet(); }
function renderAuto() { const n = $('autoN'); n.hidden = !auto.on; $('spin').querySelector('svg').style.visibility = auto.on ? 'hidden' : ''; n.textContent = auto.left; $('auto').classList.toggle('on', auto.on); $('auto').textContent = auto.on ? '자동 중지' : '자동'; }
function stopAuto() { auto.on = false; auto.left = 0; renderAuto(); }
function setMode(html) { $('mode').innerHTML = html || baseMode; }

const shell = {
  cfg, theme, Audio, FX, sleep, fmt, symHTML, spinReels, present, softClear, showWinbar, shake, toast, waitButton, setMode, countUp, cellCenter,
  get reels() { return reels; }, get turbo() { return turbo; }, get auto() { return auto.on; },
  setGrid(g) { grid = g; },
  setFeature(on) { $('cab').classList.toggle('feature', on); FX.state.feature = on ? 1 : 0; Audio.music(on ? 'feature' : 'base'); },
  markSpecial() { reels.forEach((R, r) => R.cells.forEach((c, row) => { if (grid[r][row] === SPECIAL) { c.classList.add('win'); const [x, y] = cellCenter(r, row); FX.burst(x, y, 30, 'accent', 1, theme.accentHue || 155); } })); reelsEl.classList.add('dim'); },
  setWinLabel(t) { $('winLbl').textContent = t; },
};

async function play() {
  if (busy) return;
  const b = bet();
  if (shownBal < b) { toast('잔액이 부족합니다. 베팅을 낮추세요.'); stopAuto(); return; }
  setBusy(true); clearWins();
  let res;
  try { res = await api(`/api/games/${cfg.id}/spin`, { bet: b }); }
  catch (e) { if (e.message !== 'login') toast(e.message); stopAuto(); setBusy(false); return; }
  shownBal = res.balance - res.win; renderBal();
  curWin = 0; $('win').textContent = fmt(0); shell.setWinLabel('당첨');
  const R = res.round;
  grid = R.base.grid;
  await spinReels(grid);
  await present(R.base, b);
  if (R.feature) {
    const plugin = window.SlotFeatures[R.feature.type];
    await sleep(700);
    await plugin.run(shell, R.feature, b);
    shell.setWinLabel('총 당첨'); $('win').textContent = fmt(res.win);
  }
  if (res.capped) { shell.setWinLabel('당첨 · 한도 적용'); $('win').textContent = fmt(res.win); toast(`최대 당첨 한도 적용 · ${fmt(res.rawWin)} → ${fmt(res.win)}`); }
  shownBal = res.balance; renderBal();
  await bigWin(res.win, b);
  if (R.feature) stopAuto();
  setBusy(false);
  if (auto.on) { auto.left--; renderAuto(); if (auto.left > 0) { await sleep(turbo ? 250 : (res.win > 0 ? 900 : 400)); if (auto.on) play(); } else stopAuto(); }
}

$('spin').addEventListener('click', () => { Audio.init(); if (auto.on) { stopAuto(); return; } play(); });
$('betUp').addEventListener('click', () => { if (busy) return; betI = Math.min(bets.length - 1, betI + 1); Audio.init(); Audio.tick(); renderBet(); });
$('betDn').addEventListener('click', () => { if (busy) return; betI = Math.max(0, betI - 1); Audio.init(); Audio.tick(); renderBet(); });
$('turbo').addEventListener('click', () => { turbo = !turbo; $('turbo').classList.toggle('on', turbo); toast(turbo ? '터보 켜짐' : '터보 꺼짐'); });
$('snd').textContent = Audio.on ? '🔊' : '🔇';
$('snd').addEventListener('click', () => { Audio.init(); $('snd').textContent = Audio.toggle() ? '🔊' : '🔇'; });
$('auto').addEventListener('click', () => { Audio.init(); if (auto.on) { stopAuto(); return; } auto.on = true; auto.left = 50; renderAuto(); toast('자동 스핀 50회 · 보너스 진입 시 정지'); if (!busy) play(); });
$('info').addEventListener('click', () => { $('ovInfo').hidden = false; });
$('infoClose').addEventListener('click', () => { $('ovInfo').hidden = true; });
$('go').addEventListener('click', () => { Audio.init(); Audio.music('base'); Audio.gong(.4); $('ovStart').hidden = true; FX.burst(FX.W / 2, FX.H / 2, 50, 'accent', 1, theme.accentHue || 155); });
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return; e.preventDefault();
  const open = [...document.querySelectorAll('.ov')].find((o) => !o.hidden);
  if (open) { const btn = open.querySelector('.cta:not([hidden])'); if (btn) btn.click(); return; }
  $('spin').click();
});

/* ---------- paytable & rules ---------- */
function renderPay() {
  const lb = bet() / cfg.lines.length;
  $('payGrid').innerHTML = cfg.symbols.map((s, i) => {
    const rows = [];
    for (let n = cfg.reels; n >= 1; n--) { const m = (s.pays || [])[n - 1]; if (m) rows.push(`<b>${n}</b> ${fmt(m * lb)}`); }
    if (s.scatterPays) for (let n = s.scatterPays.length; n >= 1; n--) { const m = s.scatterPays[n - 1]; if (m) rows.push(`<b>${n}</b> ${fmt(m * bet())}`); }
    const tag = [s.wild && '와일드', s.scatter && '스캐터'].filter(Boolean).join('·');
    return `<div class="it"><div class="ico">${symHTML(i)}</div><div class="vals"><div style="color:var(--gold-hi);font-weight:700">${s.name}${tag ? ' · ' + tag : ''}</div>${rows.join('<br>') || '—'}</div></div>`;
  }).join('');
}
const featureRules = cfg.features.map((f) => (window.SlotFeatures[f.type].describe ? window.SlotFeatures[f.type].describe(f, cfg) : '')).join('');
$('rules').innerHTML = (theme.rulesHTML || '') + featureRules +
  `<h3>페이라인</h3><div class="lines-mini">${cfg.lines.map((L, i) => `<svg viewBox="0 0 ${cfg.reels * 10} ${cfg.rows * 10 + 4}"><g fill="rgba(255,255,255,.08)">${L.map((_, c) => Array.from({ length: cfg.rows }, (_, r) => `<rect x="${c * 10 + 1}" y="${r * 10 + 2}" width="8" height="8" rx="1"/>`).join('')).join('')}</g><polyline points="${L.map((r, c) => `${c * 10 + 5},${r * 10 + 6}`).join(' ')}" fill="none" stroke="${lineColor(i)}" stroke-width="2"/></svg>`).join('')}</div>` +
  `<h3>최대 당첨 한도</h3>${maxWinText()}` +
  `<h3>수학 정보</h3>이론 환수율(RTP) ${(cfg.rtp * 100).toFixed(1)}% · 변동성 ${cfg.volatility}. 당첨은 왼쪽 첫 릴부터 연속으로 계산하며 라인당 최고 당첨만 지급합니다. 모든 결과는 서버에서 결정되며, 오작동 시 해당 플레이와 지급은 무효입니다.`;

function maxWinText() {
  const parts = [];
  if (cfg.maxWinX) parts.push(`베팅의 ${cfg.maxWinX.toLocaleString('ko-KR')}배`);
  if (cfg.maxWin) parts.push(fmt(cfg.maxWin));
  return parts.length ? `한 회차(보너스 포함) 당첨금은 ${parts.join(' 또는 ')} 중 작은 금액을 넘지 않습니다. 초과분은 지급되지 않습니다.` : '한도가 없습니다.';
}

/* ---------- layout ---------- */
function fit() {
  const w = Math.min(innerWidth - 32, 940), h = innerHeight;
  const byW = (w - 16) / (cfg.reels * 1.06 + .44), byH = (h - 260) / (cfg.rows + .5);
  document.documentElement.style.setProperty('--cell', Math.max(52, Math.floor(Math.min(byW, byH, 150))) + 'px');
}
addEventListener('resize', fit); fit();
renderBet(); renderBal(); renderAuto();
$('ovStart').hidden = false;
})();
