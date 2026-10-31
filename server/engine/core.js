// Generic line-slot engine. A game is a config object (see server/games/*/math.js).
// All amounts returned are multiples of the TOTAL bet.
'use strict';
const features = require('./features');

function buildStrip(weights, seedBase) {
  const pool = [];
  weights.forEach((c, s) => { for (let k = 0; k < c; k++) pool.push(s); });
  let seed = seedBase >>> 0;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// Prepare a game config once: index symbols, build fixed reel strips.
function compile(cfg) {
  const symIndex = {};
  cfg.symbols.forEach((s, i) => { symIndex[s.id] = i; });
  const strips = {};
  for (const [key, set] of Object.entries(cfg.reelSets)) {
    strips[key] = set.map((w, r) => (Array.isArray(w[0]) ? w : buildStrip(w, 1234567 + r * 7919 + key.length * 31)));
  }
  const wild = cfg.symbols.findIndex((s) => s.wild);
  const scatter = cfg.symbols.findIndex((s) => s.scatter);
  const g = { ...cfg, symIndex, strips, wild, scatter };
  g.featureImpls = (cfg.features || []).map((f) => ({ cfg: f, impl: features.get(f.type) }));
  return g;
}

function randInt(rng, n) {
  const lim = Math.floor(4294967296 / n) * n;
  let x;
  do { x = rng(); } while (x >= lim);
  return x % n;
}
function pickWeighted(rng, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = randInt(rng, total);
  for (let i = 0; i < weights.length; i++) { if (x < weights[i]) return i; x -= weights[i]; }
  return weights.length - 1;
}

function spinGrid(g, rng, set = 'base') {
  const stops = [];
  const grid = g.strips[set].map((strip) => {
    const p = randInt(rng, strip.length);
    stops.push(p);
    const col = [];
    for (let k = 0; k < g.rows; k++) col.push(strip[(p + k) % strip.length]);
    return col;
  });
  return { grid, stops };
}

// Left-to-right line wins; wild substitutes for everything except scatter.
// Returns wins with mult in LINE-bet multiples.
function evalLines(g, grid) {
  const wins = [];
  g.lines.forEach((line, li) => {
    const cells = line.map((row, reel) => grid[reel][row]);
    let best = null;
    const consider = (sym) => {
      let n = 0;
      while (n < g.reels && (cells[n] === sym || (cells[n] === g.wild && g.wild >= 0 && sym !== g.scatter))) n++;
      const pays = g.symbols[sym].pays || [];
      const m = n >= 1 ? pays[n - 1] || 0 : 0;
      if (m > 0 && (!best || m > best.mult)) best = { line: li, sym, count: n, mult: m };
    };
    const first = cells.find((c) => c !== g.wild);
    if (first !== undefined && first !== g.scatter) consider(first);
    if (g.wild >= 0 && !g.symbols[g.wild].scatter && cells[0] === g.wild) consider(g.wild);
    if (best) wins.push(best);
  });
  return wins;
}

function countSym(grid, s) { let n = 0; for (const col of grid) for (const c of col) if (c === s) n++; return n; }

function evalScatter(g, grid) {
  if (g.scatter < 0) return { count: 0, multTotal: 0 };
  const n = countSym(grid, g.scatter);
  const pays = g.symbols[g.scatter].scatterPays || [];
  return { count: n, multTotal: pays[Math.min(n, pays.length) - 1] || 0 };
}

// Evaluate one grid into a spin record (amounts in TOTAL-bet multiples)
function evalSpin(g, grid, stops) {
  const lineWins = evalLines(g, grid);
  const scatter = evalScatter(g, grid);
  const lineSum = lineWins.reduce((a, w) => a + w.mult, 0) / g.lines.length;
  return { grid, stops, lineWins, scatter, win: lineSum + scatter.multTotal };
}

// One paid round: base spin plus any triggered features.
function play(g, rng, opts = {}) {
  const s = spinGrid(g, rng);
  const base = evalSpin(g, s.grid, s.stops);
  const round = { base, feature: null, total: base.win };
  for (const { cfg, impl } of opts.features === false ? [] : g.featureImpls) {
    const f = impl.trigger(g, cfg, base, rng, { spinGrid, evalSpin, pickWeighted, countSym });
    if (f) { round.feature = f; round.total += f.win; break; }
  }
  round.total = Math.round(round.total * 1e6) / 1e6;
  return round;
}

module.exports = { compile, play, spinGrid, evalSpin, evalLines, evalScatter, randInt, pickWeighted, countSym };
