/**
 * 숫자 표시 — 금액은 문자열로 받아 문자열로만 다룬다 (부동소수점 오차 방지).
 * 음수는 한국 장부 관례대로 △ 표기.
 */
function splitInt(v: string) {
  const neg = v.trim().startsWith('-');
  const [i] = v.replace('-', '').split('.');
  return { neg, int: (i || '0').replace(/^0+(?=\d)/, '') };
}

export function won(v: string | number | null | undefined, opts: { blankZero?: boolean } = {}): string {
  if (v === null || v === undefined || v === '') return '';
  const s = typeof v === 'number' ? String(Math.trunc(v)) : v;
  const { neg, int } = splitInt(s);
  if (opts.blankZero && /^0*$/.test(int)) return '';
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg && !/^0*$/.test(int) ? '△' : '') + grouped;
}

export const isNegative = (v: string | null | undefined) => !!v && v.trim().startsWith('-') && !/^-0*(\.0*)?$/.test(v.trim());

/** 큰 금액 요약: 1,234,500,000 → 12.3억 */
export function wonShort(v: string | null | undefined): string {
  if (!v) return '0';
  const { neg, int } = splitInt(v);
  const n = int.length;
  let out: string;
  if (n > 12) out = `${(Number(int.slice(0, n - 11)) / 10).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}조`;
  else if (n > 8) out = `${(Number(int.slice(0, n - 7)) / 10).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
  else if (n > 4) out = `${Number(int.slice(0, n - 4)).toLocaleString('ko-KR')}만`;
  else out = Number(int).toLocaleString('ko-KR');
  return (neg ? '△' : '') + out;
}

export function pct(rate: string | number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined || rate === '') return '–';
  return `${(Number(rate) * 100).toFixed(digits)}%`;
}

/** 입력 중 금액 표시: 숫자만 남기고 천 단위 구분 */
export function formatMoneyInput(raw: string): string {
  const d = raw.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export const unformat = (v: string) => v.replace(/[^0-9]/g, '');

export function bizNo(v: string | null | undefined) {
  if (!v) return '';
  const d = v.replace(/[^0-9]/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v;
}

export function date(v: string | null | undefined) {
  if (!v) return '';
  return v.slice(0, 10);
}

export function dateTime(v: string | null | undefined) {
  if (!v) return '';
  const k = new Date(new Date(v).getTime() + 9 * 3600000).toISOString();
  return `${k.slice(0, 10)} ${k.slice(11, 16)}`;
}

export function relative(v: string | null | undefined) {
  if (!v) return '';
  const diff = Date.now() - new Date(v).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}일 전`;
  return date(v);
}

/** 오늘부터 남은 일수 (KST) */
export function daysUntil(v: string | null | undefined): number | null {
  if (!v) return null;
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  return Math.round((Date.parse(v) - Date.parse(today)) / 86400000);
}

/** 원 단위 부가세 계산 (화면 미리보기용 — 확정값은 서버가 계산) */
export function previewVat(supplyDigits: string, rate = 0.1): string {
  if (!supplyDigits) return '';
  try {
    const s = BigInt(supplyDigits);
    const r = BigInt(Math.round(rate * 10000));
    return ((s * r) / 10000n).toString();
  } catch {
    return '';
  }
}
export function addDigits(a: string, b: string): string {
  try {
    return (BigInt(a || '0') + BigInt(b || '0')).toString();
  } catch {
    return '';
  }
}
