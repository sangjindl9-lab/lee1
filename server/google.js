// Google Play 결제 검증 — 서비스 계정으로 Android Publisher API 를 호출한다.
// 필요한 환경변수: GOOGLE_SERVICE_ACCOUNT_JSON (서비스 계정 키 JSON 전체), ANDROID_PACKAGE (앱 패키지명)
import crypto from 'node:crypto';

const PKG = process.env.ANDROID_PACKAGE || '';
let sa = null;
try { sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || 'null'); } catch { sa = null; }
export const googleReady = !!(sa?.client_email && sa?.private_key && PKG);

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
let cached = { token: '', exp: 0 };

async function accessToken() {
  if (cached.token && Date.now() < cached.exp - 60e3) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('Google 인증에 실패했습니다. 서비스 계정 설정을 확인해 주세요.');
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

const base = () => `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PKG)}/purchases`;

// 성공하면 { orderId, test } 를 돌려주고, 아니면 사용자에게 보여줄 메시지로 throw 한다.
export async function verifyPurchase({ sku, token }) {
  const auth = { authorization: `Bearer ${await accessToken()}` };
  const res = await fetch(`${base()}/productsv2/tokens/${encodeURIComponent(token)}`, { headers: auth });
  if (res.status === 404 || res.status === 400) throw new Error('확인되지 않는 결제입니다.');
  if (!res.ok) throw new Error('Google 결제 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  const j = await res.json();
  const state = j.purchaseStateContext?.purchaseState;
  if (state === 'PENDING') throw new Error('결제가 아직 완료되지 않았습니다. 완료되면 충전 화면을 다시 열어 주세요.');
  if (state !== 'PURCHASED') throw new Error('완료된 결제가 아닙니다.');
  const ids = (j.productLineItem || []).map((x) => x.productId);
  if (!ids.includes(sku)) throw new Error('결제한 상품이 일치하지 않습니다.');
  // 소모 처리: 같은 상품을 다시 살 수 있게 한다. 실패해도 앱 쪽에서 한 번 더 시도한다.
  fetch(`${base()}/products/${encodeURIComponent(sku)}/tokens/${encodeURIComponent(token)}:consume`, { method: 'POST', headers: auth }).catch(() => {});
  return { orderId: j.orderId || '', test: !!j.testPurchaseContext };
}
