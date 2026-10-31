// 용의 비서 — 5x3, 10 lines, scroll = wild + scatter, expanding-symbol free spins.
// Theoretical RTP ~96.7% (run: npm run sim -- jade-scroll 10000000)
module.exports = {
  id: 'jade-scroll',
  name: '용의 비서',
  reels: 5,
  rows: 3,
  rtp: 0.967,
  volatility: '중상',
  bets: [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100],
  defaultBet: 1,
  // pays[count-1] in multiples of LINE bet
  symbols: [
    { id: 'SCR', name: '용의 비서', wild: true, scatter: true, pays: [], scatterPays: [0, 0, 2, 20, 200] },
    { id: 'DRG', name: '청룡', pays: [0, 10, 100, 1000, 5000] },
    { id: 'PHX', name: '주작', pays: [0, 5, 40, 400, 2000] },
    { id: 'TGR', name: '백호', pays: [0, 5, 30, 100, 750] },
    { id: 'TRT', name: '현무', pays: [0, 5, 30, 100, 750] },
    { id: 'KOI', name: '금잉어', pays: [0, 0, 5, 40, 150] },
    { id: 'LTN', name: '등롱', pays: [0, 0, 5, 40, 150] },
    { id: 'LOT', name: '연꽃', pays: [0, 0, 5, 25, 100] },
    { id: 'COI', name: '엽전', pays: [0, 0, 5, 25, 100] },
    { id: 'FAN', name: '부채', pays: [0, 0, 5, 25, 100] },
  ],
  lines: [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [1, 2, 2, 2, 1], [1, 0, 0, 0, 1], [2, 2, 1, 0, 0], [0, 0, 1, 2, 2], [2, 1, 1, 1, 0],
  ],
  // symbol counts per reel (strip is built deterministically from these)
  reelSets: {
    base: [
      [1, 1, 2, 3, 3, 8, 8, 12, 12, 12],
      [2, 1, 2, 3, 3, 8, 8, 11, 11, 11],
      [2, 1, 2, 3, 3, 8, 8, 11, 11, 11],
      [2, 1, 2, 3, 3, 8, 8, 11, 11, 11],
      [2, 1, 2, 3, 3, 8, 8, 11, 11, 12],
    ],
  },
  features: [
    { type: 'expandingFreeSpins', minScatters: 3, spins: 10, retrigger: 10, expandWeights: [0, 1, 2, 3, 3, 5, 5, 6, 6, 6] },
  ],
};
