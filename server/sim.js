// RTP simulator: node server/sim.js <gameId> [spins]
'use strict';
const crypto = require('crypto');
const core = require('./engine/core');
const { games, variant } = require('./games');

const id = process.argv[2] || 'jade-scroll';
if (!games[id]) { console.error('unknown game', id); process.exit(1); }
const vid = process.argv[3] && isNaN(+process.argv[3]) ? process.argv[3] : games[id].defaultVariant;
const n = +process.argv[process.argv[3] && isNaN(+process.argv[3]) ? 4 : 3] || 2000000;
const g = variant(id, vid);

let a = crypto.randomBytes(4).readUInt32LE() || 1, b = 362436069, c = 521288629, d = 88675123;
const rng = () => { const t = a ^ (a << 11); a = b; b = c; c = d; d = (d ^ (d >>> 19) ^ (t ^ (t >>> 8))) >>> 0; return d; };

let total = 0, base = 0, feat = 0, hits = 0, trig = 0, max = 0, sq = 0;
for (let i = 0; i < n; i++) {
  const r = core.play(g, rng);
  total += r.total; sq += r.total * r.total; base += r.base.win;
  if (r.feature) { trig++; feat += r.feature.win; }
  if (r.total > 0) hits++;
  if (r.total > max) max = r.total;
}
const rtp = total / n;
console.log(JSON.stringify({
  game: id, variant: vid, spins: n, rtp: +(rtp * 100).toFixed(3), baseRtp: +(base / n * 100).toFixed(3), featureRtp: +(feat / n * 100).toFixed(3),
  hitRate: +(hits / n * 100).toFixed(2), featureEvery: trig ? Math.round(n / trig) : null, maxWinX: max, stdDev: +Math.sqrt(sq / n - rtp * rtp).toFixed(3),
}));
