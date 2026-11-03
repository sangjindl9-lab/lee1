/* 장비 심볼 기본도형 (화면 SVG와 PDF가 같은 모양을 쓰도록 정의). 단위: 심볼 크기 1 = 한 변 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'));
  else root.CCTVSymbols = factory(root.CCTVCatalog);
})(typeof self !== 'undefined' ? self : this, function (CAT) {
  'use strict';
  const R = (x, y, w, h, fill) => ({ t: 'rect', x, y, w, h, fill });
  const Ci = (x, y, r, fill) => ({ t: 'circle', x, y, r, fill });
  const Pl = (p, close, fill) => ({ t: 'poly', p, close, fill });
  const Tx = (x, y, s, size) => ({ t: 'text', x, y, s, size: size || 0.32 });
  // 사용자 정의 심볼: 프로젝트 설정 custom_symbols[{id,label,prefix,prims}]의 도형을 사용
  function attach(dev, settings) {
    if (dev.type !== 'custom') return dev;
    const list = (settings && settings.custom_symbols) || [];
    const sid = (dev.props || {}).symbol_id; const def = list.find(x => x.id === sid) || list.find(x => x.label === (dev.props || {}).custom_label);
    return def ? Object.assign({}, dev, { _symdef: def }) : dev;
  }
  function prims(dev) {
    const T = CAT.DEVICE_TYPES[dev.type] || {}; const p = dev.props || {};
    if (dev._symdef && (dev._symdef.prims || []).length) return { rotate: false, prims: dev._symdef.prims.map(q => Object.assign({}, q, q.t === 'poly' && typeof q.p === 'string' ? { p: q.p.split(/\s+/).filter(Boolean).map(xy => xy.split(',').map(Number)) } : {}, q.t === 'text' ? { size: +q.size || 0.3 } : {})) };
    const sym = T.sym;
    if (dev.type === 'camera') {
      const letter = p.system === 'IP' ? 'IP' : p.system === '동축' ? 'A' : '?';
      // 방향은 렌더러에서 direction 회전 적용 (0°=위쪽)
      if (p.form === '돔형') return { rotate: true, prims: [Ci(0, 0, 0.42, 'w'), Pl([[-0.42, 0], [0.42, 0]]), Pl([[0, -0.42], [0, -0.62]]), Tx(0, 0.2, letter, 0.26)] };
      if (p.form === 'PTZ') return { rotate: true, prims: [Ci(0, 0, 0.45, 'w'), Ci(0, 0, 0.3), Pl([[0, -0.45], [0, -0.66]]), Tx(0, 0.05, 'P', 0.3)] };
      if (p.form === '어안') return { rotate: false, prims: [Ci(0, 0, 0.45, 'w'), Pl([[-0.45, 0], [0.45, 0]]), Pl([[0, -0.45], [0, 0.45]]), Ci(0, 0, 0.15, 'k')] };
      if (p.form === '불릿형') return { rotate: true, prims: [R(-0.22, -0.5, 0.44, 0.9, 'w'), Pl([[-0.3, -0.5], [0.3, -0.5], [0.22, -0.62], [-0.22, -0.62]], true, 'k'), Tx(0, 0.1, letter, 0.24)] };
      return { rotate: true, prims: [R(-0.3, -0.35, 0.6, 0.75, 'w'), Pl([[-0.3, -0.35], [0, -0.62], [0.3, -0.35]], true, 'k'), Tx(0, 0.12, letter, 0.26)] };
    }
    const label = { rec: (T.prefix || 'REC'), sw: dev.type === 'poe_switch' ? 'PoE' : dev.type === 'fiber_switch' ? 'F-SW' : 'SW', psu: 'PS', mc: 'MC', conv: dev.type === 'encoder' ? 'ENC' : 'VC', rep: 'R', spd: 'SPD' }[sym];
    switch (sym) {
      case 'rec': return { prims: [R(-0.6, -0.35, 1.2, 0.7, 'w'), Pl([[-0.6, 0.2], [0.6, 0.2]]), Tx(0, -0.02, label, 0.28)] };
      case 'sw': return { prims: [R(-0.6, -0.3, 1.2, 0.6, 'w'), Pl([[-0.45, 0.18], [-0.45, 0.3]]), Pl([[-0.15, 0.18], [-0.15, 0.3]]), Pl([[0.15, 0.18], [0.15, 0.3]]), Pl([[0.45, 0.18], [0.45, 0.3]]), Tx(0, -0.04, label, 0.26)] };
      case 'psu': return { prims: [R(-0.4, -0.4, 0.8, 0.8, 'w'), Tx(0, 0.02, label, 0.3), Pl([[-0.4, 0.4], [0.4, -0.4]])] };
      case 'mc': case 'conv': return { prims: [R(-0.45, -0.3, 0.9, 0.6, 'w'), Tx(0, 0.02, label, 0.24)] };
      case 'rep': return { prims: [Pl([[0, -0.45], [0.45, 0], [0, 0.45], [-0.45, 0]], true, 'w'), Tx(0, 0.04, 'R', 0.3)] };
      case 'spd': return { prims: [Pl([[-0.4, 0.35], [0.4, 0.35], [0, -0.4]], true, 'w'), Pl([[0.05, -0.15], [-0.08, 0.08], [0.08, 0.05], [-0.05, 0.28]])] };
      case 'joint': return { prims: [Ci(0, 0, 0.22, 'k')] };
      case 'mh': return { prims: [R(-0.4, -0.4, 0.8, 0.8, 'w'), Pl([[-0.4, -0.4], [0.4, 0.4]]), Pl([[-0.4, 0.4], [0.4, -0.4]])] };
      case 'ref': return { prims: [Pl([[-0.5, -0.3], [0.3, -0.3], [0.55, 0], [0.3, 0.3], [-0.5, 0.3]], true, 'w'), Tx(-0.05, 0.03, (p.link_ref || '?').slice(0, 4), 0.24)] };
      case 'pole': return { prims: [Ci(0, 0, 0.3, 'w'), Ci(0, 0, 0.1, 'k')] };
      case 'mon': return { prims: [R(-0.5, -0.35, 1, 0.55, 'w'), Pl([[0, 0.2], [0, 0.35]]), Pl([[-0.25, 0.35], [0.25, 0.35]])] };
      case 'small': return { prims: [R(-0.3, -0.2, 0.6, 0.4, 'w'), Tx(0, 0.02, (T.prefix || '').slice(0, 3), 0.18)] };
      default: return { prims: [R(-0.45, -0.45, 0.9, 0.9, 'w'), Tx(0, 0.02, String(p.prefix || (dev.type === 'custom' && p.custom_label) || T.prefix || 'EQ').slice(0, 4), 0.24)] };
    }
  }
  return { prims, attach };
});
