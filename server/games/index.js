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
  for (const [vid, v] of Object.entries(cfg.variants)) compiled[vid] = core.compile({ ...cfg, reelSets: v.reelSets, rtp: v.rtp });
  games[id] = { ...cfg, compiled };
}
function variant(id, vid) {
  const g = games[id];
  return g.compiled[vid] || g.compiled[g.defaultVariant];
}
function variantList(id) {
  return Object.entries(games[id].variants).map(([vid, v]) => ({ id: vid, label: v.label, rtp: v.rtp }));
}

// What the browser may see (no reel strips: those stay on the server)
function clientConfig(id, s) {
  const g = games[id], v = variant(id, s.variant);
  return {
    id: g.id, name: g.name, reels: g.reels, rows: g.rows, rtp: v.rtp, volatility: g.volatility,
    bets: s.bets, defaultBet: s.defaultBet, maxWin: s.maxWin, maxWinX: s.maxWinX, lines: g.lines,
    symbols: g.symbols.map((x) => ({ id: x.id, name: x.name, wild: !!x.wild, scatter: !!x.scatter, pays: x.pays, scatterPays: x.scatterPays || null })),
    features: s.featuresOn ? (g.features || []).map((f) => ({ type: f.type, minScatters: f.minScatters, spins: f.spins, retrigger: f.retrigger })) : [],
  };
}
module.exports = { games, ids: IDS, variant, variantList, clientConfig };
