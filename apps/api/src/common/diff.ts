/** 변경된 필드만 추려 감사로그에 남긴다 */
export function diffOnly<T extends Record<string, unknown>>(a: T, b: T) {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const k of Object.keys(b)) {
    if (['updatedAt', 'version', 'updatedById'].includes(k)) continue;
    const x = a[k] instanceof Date ? (a[k] as Date).toISOString() : a[k];
    const y = b[k] instanceof Date ? (b[k] as Date).toISOString() : b[k];
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      before[k] = x;
      after[k] = y;
    }
  }
  return { before, after };
}
