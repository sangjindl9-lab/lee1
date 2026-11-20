// Google Play 결제
// 1) 이음챗 앱(네이티브 웹뷰): 앱이 넣어 준 window.EumNative 로 Play 결제 라이브러리를 호출한다.
// 2) 예전 TWA 앱: Digital Goods API + PaymentRequest.
const PLAY = 'https://play.google.com/billing';
const native = typeof window !== 'undefined' ? window.EumNative : null;
let seq = 0; const waits = {};
if (native) {
  window.__eumNative = (id, ok, res) => { const w = waits[id]; if (!w) return; delete waits[id]; if (ok) w[0](res); else w[1](new Error(res)); };
}
const call = (method, arg = {}) => new Promise((ok, no) => { const id = `c${++seq}`; waits[id] = [ok, no]; native.call(id, method, JSON.stringify(arg)); });
export const isNativeApp = !!native;

export async function playService() {
  if (native) return { native: true };
  if (!('getDigitalGoodsService' in window)) return null;
  try { return await window.getDigitalGoodsService(PLAY); } catch { return null; }
}

// Play 에 등록된 현지화 가격을 { sku: '₩1,100' } 형태로 가져온다.
export async function playPrices(service, skus) {
  try {
    if (service?.native) return (await call('prices', { skus })) || {};
    const out = {};
    for (const d of await service.getDetails(skus)) {
      out[d.itemId] = new Intl.NumberFormat(navigator.language, { style: 'currency', currency: d.price.currency }).format(d.price.value);
    }
    return out;
  } catch { return {}; }
}

// 결제창을 띄우고 { token, finish } 를 돌려준다. 사용자가 닫으면 null. 오류는 메시지로 throw.
export async function buy(sku) {
  if (native) {
    const r = await call('buy', { sku });
    return r ? { token: r.token, finish: () => {} } : null;
  }
  const req = new PaymentRequest([{ supportedMethods: PLAY, data: { sku } }], { total: { label: 'Total', amount: { currency: 'KRW', value: '0' } } });
  let res;
  try { res = await req.show(); } catch { return null; }
  return { token: res.details.purchaseToken, finish: (ok) => res.complete(ok ? 'success' : 'fail').catch(() => {}) };
}

// 결제는 됐는데 충전 전에 앱이 꺼진 건: [{ sku, token }]
export async function pending(service) {
  try {
    if (service?.native) return (await call('pending')) || [];
    return (await service.listPurchases()).map((p) => ({ sku: p.itemId, token: p.purchaseToken }));
  } catch { return []; }
}
export const consume = (service, token) => {
  if (service?.native) return call('consume', { token }).catch(() => {});
  return service?.consume(token).catch(() => {});
};
