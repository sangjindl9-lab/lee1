// Feature plugin registry. Each plugin exports:
//   type: string
//   trigger(game, featureCfg, baseSpin, rng, helpers) -> null | { type, win, ...data }
// Add new mechanics (cascades, hold & win, multipliers...) as new files here.
'use strict';
const registry = {};
function register(p) { registry[p.type] = p; }
function get(type) {
  const p = registry[type];
  if (!p) throw new Error(`Unknown feature type: ${type}`);
  return p;
}
register(require('./expandingFreeSpins'));
module.exports = { register, get, registry };
