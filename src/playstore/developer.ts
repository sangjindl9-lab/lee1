import { PLAY_BASE, fetchPlayText } from './http.ts';
import { parseScriptData, pick, pickString } from './scriptData.ts';

export interface DeveloperAppItem {
  packageId: string;
  title: string | null;
  developer: string | null;
  score: number | null;
}

/**
 * 개발자 페이지(`store/apps/developer?id=...`)에서 공개 앱 목록을 뽑습니다.
 * 앱을 한 번에 등록하고 싶을 때 사용합니다.
 */
export function parseDeveloperHtml(html: string): DeveloperAppItem[] {
  const data = parseScriptData(html);
  const found = new Map<string, DeveloperAppItem>();

  const inspect = (entry: unknown): void => {
    if (!Array.isArray(entry)) return;
    const head = entry[0];
    if (!Array.isArray(head) || typeof head[0] !== 'string') return;
    if (!/^[a-zA-Z][\w]*(\.[\w]+)+$/.test(head[0])) return;
    const packageId = head[0];
    const title = typeof head[3] === 'string' ? head[3] : null;
    const developer = typeof head[14] === 'string' ? head[14] : null;
    const scoreNode = entry[4];
    const score = Array.isArray(scoreNode) && typeof scoreNode[1] === 'number' ? scoreNode[1] : null;
    if (!found.has(packageId)) found.set(packageId, { packageId, title, developer, score });
  };

  const walk = (value: unknown, depth: number): void => {
    if (depth > 14 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      inspect(value);
      for (const child of value) walk(child, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const child of Object.values(value as Record<string, unknown>)) walk(child, depth + 1);
    }
  };

  walk(data, 0);
  // ds 블록 밖의 앵커 기준 백업 파싱 (구조가 바뀌어도 앱 목록은 얻을 수 있게)
  if (found.size === 0) {
    for (const m of html.matchAll(/\/store\/apps\/details\?id=([a-zA-Z][\w.]*)/g)) {
      if (!found.has(m[1])) found.set(m[1], { packageId: m[1], title: null, developer: null, score: null });
    }
  }
  return [...found.values()];
}

export async function fetchDeveloperApps(developerQuery: string, hl = 'ko', gl = 'KR'): Promise<DeveloperAppItem[]> {
  const qs = new URLSearchParams({ id: developerQuery, hl, gl });
  const url = `${PLAY_BASE}/store/apps/developer?${qs.toString()}`;
  const { status, text } = await fetchPlayText(url, { hl, gl });
  if (status !== 200) return [];
  const items = parseDeveloperHtml(text);
  return items;
}

export function developerNameFromHtml(html: string): string | null {
  const data = parseScriptData(html);
  return pickString([1, 0], pick(['ds:5', 0], data) ?? {}) ?? null;
}
