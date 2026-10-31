// 용의 비서 — 5x3, 10 lines, scroll = wild + scatter, expanding-symbol free spins.
// Theoretical RTP ~96.7% (run: npm run sim -- jade-scroll 10000000)
module.exports = {
  id: 'jade-scroll',
  name: '용의 비서',
  reels: 5,
  rows: 3,
  volatility: '중상',
  // default bet steps in KRW (admin can change them per game)
  bets: [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000],
  defaultBet: 1000,
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
  // RTP versions the operator can choose between (symbol counts per reel; strips built from these)
  defaultVariant: 'r967',
  variants: {
    r967: { label: '96.7%', rtp: 0.967, reelSets: { base: [
      [1, 1, 2, 3, 3, 8, 8, 12, 12, 12], [2, 1, 2, 3, 3, 8, 8, 11, 11, 11], [2, 1, 2, 3, 3, 8, 8, 11, 11, 11],
      [2, 1, 2, 3, 3, 8, 8, 11, 11, 11], [2, 1, 2, 3, 3, 8, 8, 11, 11, 12]] } },
    r937: { label: '93.7%', rtp: 0.937, reelSets: { base: [
      [1, 1, 2, 3, 3, 8, 8, 13, 13, 13], [2, 1, 2, 3, 3, 8, 8, 12, 12, 12], [2, 1, 2, 3, 3, 8, 8, 12, 12, 12],
      [2, 1, 2, 3, 3, 8, 8, 12, 12, 12], [2, 1, 2, 3, 3, 8, 8, 12, 12, 13]] } },
    r925: { label: '92.5%', rtp: 0.925, reelSets: { base: [
      [1, 1, 2, 3, 3, 8, 8, 14, 14, 14], [2, 1, 2, 3, 3, 8, 8, 13, 13, 13], [2, 1, 2, 3, 3, 8, 8, 13, 13, 13],
      [2, 1, 2, 3, 3, 8, 8, 13, 13, 13], [2, 1, 2, 3, 3, 8, 8, 13, 13, 14]] } },
  },
  features: [
    { type: 'expandingFreeSpins', minScatters: 3, spins: 10, retrigger: 10, expandWeights: [0, 1, 2, 3, 3, 5, 5, 6, 6, 6] },
  ],
};
