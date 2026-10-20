import * as mock from './mock.js';
import * as toss from './toss.js';

/**
 * 결제대행(PG) 어댑터
 * PAYMENT_PROVIDER 환경변수로 고른다. 비어 있으면 테스트 결제(mock).
 * 새 PG사를 붙일 때는 confirm / cancel 두 함수를 가진 파일을 만들어 여기에 등록하면 된다.
 */
const providers = { mock, toss };

export function current() {
  const name = (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
  const p = providers[name];
  if (!p) throw new Error('지원하지 않는 PAYMENT_PROVIDER: ' + name);
  return { name, ...p };
}

/** 결제 당시의 PG 로 취소해야 하므로 이름으로도 찾는다 */
export function byName(name) {
  const p = providers[name];
  if (!p) throw new Error('알 수 없는 결제 제공자: ' + name);
  return { name, ...p };
}

/** 고객 화면에 알려줄 공개 설정 (비밀키는 절대 포함하지 않음) */
export function publicConfig() {
  const p = current();
  return { provider: p.name, test: p.name === 'mock' || p.isTest(), clientKey: p.clientKey ? p.clientKey() : '', ready: p.ready() };
}
