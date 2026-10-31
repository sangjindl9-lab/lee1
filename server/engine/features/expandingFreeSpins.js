// Free spins with one randomly chosen expanding symbol.
// Trigger: >= cfg.minScatters scatters. During free spins, if the expanding symbol
// lands on enough reels to pay, those reels fill and it pays on ALL lines.
'use strict';
module.exports = {
  type: 'expandingFreeSpins',
  trigger(g, cfg, base, rng, h) {
    if (base.scatter.count < cfg.minScatters) return null;
    const es = h.pickWeighted(rng, cfg.expandWeights);
    let left = cfg.spins, played = 0, win = 0, retriggers = 0;
    const spins = [];
    while (left > 0 && played < (cfg.maxSpins || 500)) {
      left--; played++;
      const s = h.spinGrid(g, rng, cfg.reelSet || 'base');
      const sp = h.evalSpin(g, s.grid, s.stops);
      const reels = [];
      s.grid.forEach((col, r) => { if (col.includes(es)) reels.push(r); });
      const pays = g.symbols[es].pays;
      const m = reels.length >= 1 ? pays[reels.length - 1] || 0 : 0;
      sp.expand = m > 0 ? { sym: es, reels, multLine: m * g.lines.length } : null;
      if (sp.expand) sp.win += m; // m per line * lines / lines(total-bet units)
      if (sp.scatter.count >= cfg.minScatters) { left += cfg.retrigger; retriggers++; sp.retrigger = cfg.retrigger; }
      win += sp.win;
      spins.push(sp);
    }
    return { type: 'expandingFreeSpins', expandSym: es, awarded: cfg.spins, spins, retriggers, win };
  },
};
