// RTP simulator: node server/sim.js <gameId> [spins]
'use strict';
const crypto = require('crypto');
const core = require('./engine/core');
const { games } = require('./games');

const id = process.argv[2] || 'jade-scroll';
const n = +process.argv[3] || 2000000;
const g = games[id];
if (!g) { console.error('unknown game', id); process.exit(1); }

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
  game: id, spins: n, rtp: +(rtp * 100).toFixed(3), baseRtp: +(base / n * 100).toFixed(3), featureRtp: +(feat / n * 100).toFixed(3),
  hitRate: +(hits / n * 100).toFixed(2), featureEvery: trig ? Math.round(n / trig) : null, maxWinX: max, stdDev: +Math.sqrt(sq / n - rtp * rtp).toFixed(3),
}));
