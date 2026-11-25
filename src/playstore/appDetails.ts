import { buildDetailsUrl, fetchPlayText, PlayFetchError } from './http.ts';
import { htmlToText, parseScriptData, pick, pickNumber, pickString } from './scriptData.ts';

export interface AppDetails {
  packageId: string;
  title: string | null;
  developer: string | null;
  genre: string | null;
  score: number | null;
  ratings: number | null;
  reviews: number | null;
  installs: string | null;
  minInstalls: number | null;
  maxInstalls: number | null;
  updatedTs: number | null;
  version: string | null;
  summary: string | null;
  description: string | null;
  descriptionHtml: string | null;
  icon: string | null;
  priceText: string | null;
  contentRating: string | null;
  released: string | null;
  screenshotCount: number;
  storeUrl: string;
  fetchedAt: string;
}

export class AppNotFoundError extends Error {
  readonly packageId: string;

  constructor(packageId: string) {
    super(`Google Play에서 앱을 찾을 수 없습니다: ${packageId}`);
    this.name = 'AppNotFoundError';
    this.packageId = packageId;
  }
}

/**
 * 스토어 상세 페이지 HTML 을 파싱합니다. (네트워크 없이 단위 테스트 가능)
 */
export function parseAppDetailsHtml(html: string, packageId: string): AppDetails {
  const data = parseScriptData(html);
  const node = pick(['ds:5', 1, 2], data);
  if (!node) {
    if (/찾을 수 없음|Not found|We're sorry/i.test(html)) throw new AppNotFoundError(packageId);
    throw new PlayFetchError('Google Play 상세 페이지 구조를 해석하지 못했습니다');
  }

  const updatedRaw =
    pickNumber([145, 0, 1, 0], node) ?? pickNumber([-1, '146', 0, 1, 0], node) ?? pickNumber([10, 1, 0], node);
  const descriptionHtml = pickString([72, 0, 1], node);
  const icon = pickString([95, 0, 3, 2], node) ?? pickString([95, 2], node);
  const screenshots = pick([78, 0], node);

  return {
    packageId,
    title: pickString([0, 0], node),
    developer: pickString([68, 0], node),
    genre: pickString([79, 0, 0, 0], node),
    score: pickNumber([51, 0, 1], node),
    ratings: pickNumber([51, 2, 1], node),
    reviews: pickNumber([51, 3, 1], node),
    installs: pickString([13, 0], node),
    minInstalls: pickNumber([13, 1], node),
    maxInstalls: pickNumber([13, 2], node),
    updatedTs: updatedRaw ? updatedRaw * 1000 : null,
    version:
      pickString([140, 0, 0, 0], node) ?? pickString([-1, '141', 0, 0, 0], node) ?? null,
    summary: pickString([73, 0, 1], node),
    description: descriptionHtml ? htmlToText(descriptionHtml) : null,
    descriptionHtml,
    icon,
    priceText: pickString([57, 0, 0, 0, 0, 1, 0, 2], node),
    contentRating: pickString([9, 0], node),
    released: pickString([10, 0], node),
    screenshotCount: Array.isArray(screenshots) ? screenshots.length : 0,
    storeUrl: buildDetailsUrl(packageId).split('?')[0] + `?id=${packageId}`,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchAppDetails(packageId: string, hl = 'ko', gl = 'KR'): Promise<AppDetails> {
  const url = buildDetailsUrl(packageId, hl, gl);
  const { status, text } = await fetchPlayText(url, { hl, gl });
  if (status === 404) throw new AppNotFoundError(packageId);
  if (status !== 200) throw new PlayFetchError(`상세 페이지 응답 ${status}`, status, url);
  return parseAppDetailsHtml(text, packageId);
}
