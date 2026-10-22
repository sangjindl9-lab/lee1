/**
 * 사업자등록번호 검증 (국세청 체크섬 규칙)
 * 가중치 1,3,7,1,3,7,1,3,5 — 9번째 자리는 ×5 결과의 십의 자리를 추가로 더한다.
 */
export function normalizeBizNo(v: string): string {
  return (v ?? '').replace(/[^0-9]/g, '');
}

export function isValidBizNo(v: string): boolean {
  const n = normalizeBizNo(v);
  if (!/^\d{10}$/.test(n)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(n[i]) * w[i];
  sum += Math.floor((Number(n[8]) * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(n[9]);
}

export function formatBizNo(v: string): string {
  const n = normalizeBizNo(v);
  return n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : v;
}
