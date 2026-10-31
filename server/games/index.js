// Game registry. To add a slot: create server/games/<id>/math.js and public/games/<id>/theme.js,
// then add the id below. Run `npm run sim -- <id> [variant]` to verify RTP before enabling.
'use strict';
const core = require('../engine/core');
const IDS = ['jade-scroll', 'golden-lantern'];

// games[id] = { ...math config, compiled: { [variantId]: compiled game } }
const games = {};
for (const id of IDS) {
  const cfg = require(`./${id}/math.js`);
  const compiled = {};
  for (const [vid, v] of Object.entries(cfg.variants)) compiled[vid] = core.compile({ ...cfg, reelSets: v.reelSets, rtp: v.rtp, baseRtp: v.baseRtp || v.rtp });
  games[id] = { ...cfg, compiled };
}
function variant(id, vid) {
  const g = games[id];
  return g.compiled[vid] || g.compiled[g.defaultVariant];
}
function variantList(id) {
  return Object.entries(games[id].variants).map(([vid, v]) => ({ id: vid, label: v.label, rtp: v.rtp }));
}

// Operator-set RTP: every pay value is multiplied by one factor, so RTP scales exactly with it.
function baseGame(id) { return games[id].compiled[games[id].defaultVariant]; }
function payScale(id, s) {
  const g = baseGame(id), from = s.featuresOn && (games[id].features || []).length ? g.rtp : g.baseRtp;
  return (s.rtp / 100) / from;
}
const r4 = (x) => Math.round(x * 1e4) / 1e4;
function scaleRound(r, k) {
  const spin = (sp) => {
    sp.win = r4(sp.win * k);
    sp.lineWins.forEach((w) => { w.mult = r4(w.mult * k); });
    if (sp.scatter) sp.scatter.multTotal = r4(sp.scatter.multTotal * k);
    if (sp.expand) sp.expand.multLine = r4(sp.expand.multLine * k);
  };
  spin(r.base);
  if (r.feature) { r.feature.spins.forEach(spin); r.feature.win = r4(r.feature.win * k); }
  r.total = r4(r.total * k);
  return r;
}

// What the browser may see (no reel strips: those stay on the server)
function clientConfig(id, s) {
  const g = games[id], k = payScale(id, s);
  return {
    id: g.id, name: g.name, reels: g.reels, rows: g.rows, rtp: s.rtp / 100, volatility: g.volatility,
    bets: s.bets, defaultBet: s.defaultBet, maxWin: s.maxWin, maxWinX: s.maxWinX, lines: g.lines,
    symbols: g.symbols.map((x) => ({ id: x.id, name: x.name, wild: !!x.wild, scatter: !!x.scatter, pays: x.pays.map((p) => r4(p * k)), scatterPays: x.scatterPays ? x.scatterPays.map((p) => r4(p * k)) : null })),
    features: s.featuresOn ? (g.features || []).map((f) => ({ type: f.type, minScatters: f.minScatters, spins: f.spins, retrigger: f.retrigger })) : [],
  };
}
module.exports = { games, ids: IDS, variant, variantList, clientConfig, baseGame, payScale, scaleRound };
