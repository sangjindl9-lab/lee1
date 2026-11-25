/** 날짜·문자열 공용 도우미 (KST 기준) */

export const KST_OFFSET_MIN = 9 * 60;

/** KST 기준 YYYY-MM-DD */
export function kstDateString(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + KST_OFFSET_MIN * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** KST 기준 YYYY-MM-DD HH:MM */
export function kstDateTimeString(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + KST_OFFSET_MIN * 60_000);
  return `${shifted.toISOString().slice(0, 10)} ${shifted.toISOString().slice(11, 16)}`;
}

/** 'HH:MM' 문자열을 KST 시각으로 해석해 UTC Date 로 */
export function kstTimeToUtc(date: Date, hhmm: string): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`잘못된 시각 형식입니다: ${hhmm}`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) throw new Error(`잘못된 시각입니다: ${hhmm}`);
  const base = new Date(kstDateString(date) + 'T00:00:00Z');
  // KST 자정 = UTC 전날 15:00
  return new Date(base.getTime() - KST_OFFSET_MIN * 60_000 + hour * 3_600_000 + minute * 60_000);
}

/** 초 단위 재시도 대기 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function round1(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

export function truncate(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : chars.slice(0, Math.max(0, max - 1)).join('') + '…';
}

export function charLength(text: string): number {
  return [...text].length;
}

/** 유효한 Play 패키지명인지 */
export function isValidPackageId(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*){1,}$/.test(value.trim()) && value.length <= 150;
}

/** 패키지명으로 Play 스토어 URL 생성 */
export function storeUrl(packageId: string, hl = 'ko', gl = 'KR'): string {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageId)}&hl=${hl}&gl=${gl}`;
}

export function playStoreShareUrl(packageId: string): string {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageId)}`;
}

/** 결정적 난수 (같은 seed 는 같은 문구 조합) */
export function seededPick<T>(items: T[], seed: string, offset = 0): T {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = Math.abs(h + offset * 2654435761) % items.length;
  return items[idx];
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
