// 황금 등롱 — classic 3x3, 5 lines, lantern wild, no bonus feature (low volatility).
module.exports = {
  id: 'golden-lantern',
  name: '황금 등롱',
  reels: 3,
  rows: 3,
  rtp: 0.9647, // exact (full cycle enumeration)
  volatility: '낮음',
  bets: [0.1, 0.2, 0.5, 1, 2, 5, 10, 25, 50],
  defaultBet: 1,
  symbols: [
    { id: 'WLD', name: '황금 등롱', wild: true, pays: [0, 0, 250] },
    { id: 'SVN', name: '칠복패', pays: [0, 0, 100] },
    { id: 'ING', name: '금괴', pays: [0, 0, 40] },
    { id: 'BAG', name: '복주머니', pays: [0, 0, 20] },
    { id: 'TAN', name: '귤', pays: [0, 0, 10] },
    { id: 'PCH', name: '복숭아', pays: [0, 0, 4] },
  ],
  lines: [[1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0]],
  reelSets: {
    base: [
      [1, 2, 3, 4, 7, 9],
      [1, 2, 3, 4, 7, 9],
      [1, 2, 3, 4, 7, 9],
    ],
  },
  features: [],
};
