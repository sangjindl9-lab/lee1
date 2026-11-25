/**
 * Google Play 페이지에 내장된 `AF_initDataCallback({key:'ds:N', data:[...]})` 블록을
 * JSON 으로 파싱합니다. Play 스토어가 화면을 그릴 때 쓰는 원본 데이터 구조입니다.
 */
export type ScriptData = Record<string, unknown>;

const SCRIPT_REGEX = />AF_initDataCallback[\s\S]*?<\/script/g;
const KEY_REGEX = /(ds:.*?)'/;
const VALUE_REGEX = /data:([\s\S]*?), sideChannel: {}}\);<\//;

export function parseScriptData(html: string): ScriptData {
  const out: ScriptData = {};
  const blocks = html.match(SCRIPT_REGEX) ?? [];
  for (const block of blocks) {
    const keyMatch = block.match(KEY_REGEX);
    const valueMatch = block.match(VALUE_REGEX);
    if (!keyMatch || !valueMatch) continue;
    try {
      out[keyMatch[1]] = JSON.parse(valueMatch[1]);
    } catch {
      // 일부 블록은 JSON 이 아니므로 건너뜁니다.
    }
  }
  return out;
}

/** 경로 탐색 (없으면 undefined) */
export function pick(path: (string | number)[], data: unknown): unknown {
  let cur: unknown = data;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof key === 'number' && Array.isArray(cur)) {
      const idx = key < 0 ? cur.length + key : key;
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string | number, unknown>)[key as string];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function pickString(path: (string | number)[], data: unknown): string | null {
  const value = pick(path, data);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function pickNumber(path: (string | number)[], data: unknown): number | null {
  const value = pick(path, data);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.]/g, '');
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Play 설명문의 HTML 을 사람이 읽는 텍스트로 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
