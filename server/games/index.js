// Game registry. To add a slot: create server/games/<id>/math.js and public/games/<id>/theme.js,
// then add the id below. Run `npm run sim -- <id>` to verify RTP before enabling.
'use strict';
const core = require('../engine/core');
const IDS = ['jade-scroll', 'golden-lantern'];

const games = {};
for (const id of IDS) games[id] = core.compile(require(`./${id}/math.js`));

// What the browser is allowed to see (no reel strips: those stay on the server)
function clientConfig(g) {
  return {
    id: g.id, name: g.name, reels: g.reels, rows: g.rows, rtp: g.rtp, volatility: g.volatility,
    bets: g.bets, defaultBet: g.defaultBet, lines: g.lines,
    symbols: g.symbols.map((s) => ({ id: s.id, name: s.name, wild: !!s.wild, scatter: !!s.scatter, pays: s.pays, scatterPays: s.scatterPays || null })),
    features: (g.features || []).map((f) => ({ type: f.type, minScatters: f.minScatters, spins: f.spins, retrigger: f.retrigger })),
  };
}
module.exports = { games, ids: IDS, clientConfig };
