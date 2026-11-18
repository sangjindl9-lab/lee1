// Google Play 결제 (Play 스토어에서 설치한 앱 안에서만 동작하는 Digital Goods API)
const PLAY = 'https://play.google.com/billing';

export async function playService() {
  if (!('getDigitalGoodsService' in window)) return null;
  try { return await window.getDigitalGoodsService(PLAY); } catch { return null; }
}

// Play 에 등록된 현지화 가격을 { sku: '₩1,100' } 형태로 가져온다.
export async function playPrices(service, skus) {
  try {
    const out = {};
    for (const d of await service.getDetails(skus)) {
      out[d.itemId] = new Intl.NumberFormat(navigator.language, { style: 'currency', currency: d.price.currency }).format(d.price.value);
    }
    return out;
  } catch { return {}; }
}

// 결제창을 띄우고 { token, finish } 를 돌려준다. 사용자가 닫으면 null.
export async function buy(sku) {
  const req = new PaymentRequest([{ supportedMethods: PLAY, data: { sku } }], { total: { label: 'Total', amount: { currency: 'KRW', value: '0' } } });
  let res;
  try { res = await req.show(); } catch { return null; }
  return { token: res.details.purchaseToken, finish: (ok) => res.complete(ok ? 'success' : 'fail').catch(() => {}) };
}

// 결제는 됐는데 충전 전에 앱이 꺼진 건: [{ sku, token }]
export async function pending(service) {
  try { return (await service.listPurchases()).map((p) => ({ sku: p.itemId, token: p.purchaseToken })); } catch { return []; }
}
export const consume = (service, token) => service?.consume(token).catch(() => {});
