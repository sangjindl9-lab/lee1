import { PLAY_BASE, buildSearchUrl, fetchPlayText, PlayFetchError } from './http.ts';
import { parseScriptData, pick, pickNumber, pickString } from './scriptData.ts';

export interface SearchResultItem {
  rank: number;
  packageId: string;
  title: string | null;
  developer: string | null;
  score: number | null;
}

export interface ParsedSearchPage {
  results: Omit<SearchResultItem, 'rank'>[];
  nextToken: string | null;
}

function readAppEntry(entry: unknown): { packageId: string | null; title: string | null; developer: string | null; score: number | null } {
  const rawId = pick([0, 0], entry);
  let packageId: string | null = null;
  if (typeof rawId === 'string') packageId = rawId;
  else if (Array.isArray(rawId) && typeof rawId[0] === 'string') packageId = rawId[0];
  return {
    packageId,
    title: pickString([0, 3, 0], entry) ?? pickString([0, 3], entry),
    developer: pickString([0, 14], entry),
    score: pickNumber([0, 4, 1], entry),
  };
}

/**
 * 검색 결과 HTML 을 파싱합니다. Play 스토어 웹은 한 페이지에 보통 30개를 내려줍니다.
 */
export function parseSearchHtml(html: string): ParsedSearchPage {
  const data = parseScriptData(html);
  const sections = pick(['ds:4', 0, 1], data);
  if (!Array.isArray(sections)) return { results: [], nextToken: null };

  for (const section of sections) {
    const apps = pick([22, 0], section);
    if (Array.isArray(apps) && apps.length > 0) {
      const results = apps
        .map(readAppEntry)
        .filter((item) => Boolean(item.packageId))
        .map((item) => ({ ...item, packageId: item.packageId as string }));
      const token = pick([22, 1, 3, 1], section);
      return { results, nextToken: typeof token === 'string' && token.length > 0 ? token : null };
    }
  }
  return { results: [], nextToken: null };
}

function buildBatchExecuteBody(numberOfApps: number, token: string): string {
  const inner = `[[null,[[10,[10,${numberOfApps}]]],true,null,[96,27,4,8,57,30,110,79,11,16,49,1,3,9,12,104,55,56,51,10,34,77]],null,\\"${token}\\"]`;
  const freq = `[[["qnKhOb","${inner.replace(/"/g, '\\"')}",null,"generic"]]]`;
  return `f.req=${encodeURIComponent(freq)}`;
}

async function fetchNextPage(
  token: string,
  numberOfApps: number,
  hl: string,
  gl: string,
): Promise<ParsedSearchPage> {
  const url = `${PLAY_BASE}/_/PlayStoreUi/data/batchexecute?rpcids=qnKhOb&hl=${hl}&gl=${gl}&authuser&soc-app=121&soc-platform=1&soc-device=1`;
  const { status, text } = await fetchPlayText(url, {
    hl,
    gl,
    method: 'POST',
    body: buildBatchExecuteBody(numberOfApps, token),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
  });
  if (status !== 200) return { results: [], nextToken: null };
  try {
    const payload = JSON.parse(text.substring(5));
    const data = JSON.parse(payload[0][2]);
    if (!data) return { results: [], nextToken: null };
    const apps = pick([0, 0, 0], data);
    const next = pick([0, 0, 7, 1], data);
    const results = Array.isArray(apps)
      ? apps
          .map(readAppEntry)
          .filter((item) => Boolean(item.packageId))
          .map((item) => ({ ...item, packageId: item.packageId as string }))
      : [];
    return { results, nextToken: typeof next === 'string' && next.length > 0 ? next : null };
  } catch {
    return { results: [], nextToken: null };
  }
}

export interface KeywordSearchOutcome {
  term: string;
  results: SearchResultItem[];
  pagesFetched: number;
  depth: number;
  tokenAvailable: boolean;
  fetchedAt: string;
}

/**
 * 키워드로 한국 스토어 검색 결과를 최대 `depth` 위까지 수집합니다.
 * Play 웹 검색은 기본 30개를 내려주고, 다음 페이지 토큰이 있을 때만 이어서 가져옵니다.
 */
export async function searchKeyword(
  term: string,
  options: { depth?: number; hl?: string; gl?: string } = {},
): Promise<KeywordSearchOutcome> {
  const depth = Math.min(50, Math.max(5, options.depth ?? 30));
  const hl = options.hl ?? 'ko';
  const gl = options.gl ?? 'KR';
  const url = buildSearchUrl(term, hl, gl);
  const first = await fetchPlayText(url, { hl, gl });
  if (first.status !== 200) throw new PlayFetchError(`검색 응답 ${first.status}`, first.status, url);

  const page = parseSearchHtml(first.text);
  const collected = [...page.results];
  let token = page.nextToken;
  let pagesFetched = 1;

  while (token && collected.length < depth && pagesFetched < 4) {
    const next = await fetchNextPage(token, depth, hl, gl);
    if (next.results.length === 0) break;
    collected.push(...next.results);
    token = next.nextToken;
    pagesFetched += 1;
  }

  const results = collected.slice(0, depth).map((item, index) => ({ ...item, rank: index + 1 }));
  return {
    term,
    results,
    pagesFetched,
    depth,
    tokenAvailable: Boolean(page.nextToken),
    fetchedAt: new Date().toISOString(),
  };
}

export function findAppRank(results: SearchResultItem[], packageId: string): number | null {
  const hit = results.find((item) => item.packageId === packageId);
  return hit ? hit.rank : null;
}
