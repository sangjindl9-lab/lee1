import { charLength, truncate } from '../util.ts';

export interface CompetitorInput {
  packageId: string;
  rank: number | null;
  title: string | null;
  developer?: string | null;
  score?: number | null;
  summary?: string | null;
  description?: string | null;
  installs?: string | null;
}

export interface AppTextInput {
  title: string | null;
  summary: string | null;
  description: string | null;
}

export interface KeywordWeight {
  keyword: string;
  weight: number;
  titleHits: number;
  summaryHits: number;
  descriptionHits: number;
  competitors: string[];
  covered: boolean;
}

const STOPWORDS = new Set([
  '그리고', '하지만', '그래서', '때문에', '위해', '대한', '대해', '에서', '으로', '로는', '하는', '있는', '없는',
  '합니다', '입니다', '됩니다', '있습니다', '없습니다', '하는데', '하면', '해서', '부터', '까지', '보다', '처럼',
  '모든', '여러', '다양한', '사용', '사용자', '기능', '앱', '어플', '다운로드', '설치', '가능', '지원', '제공',
  '경우', '때문', '이제', '더욱', '아주', '매우', '정말', '바로', '함께', '누구나', '쉽게', '빠르게', '간편하게',
  'the', 'and', 'for', 'with', 'your', 'you', 'this', 'that', 'app', 'apps', 'free', 'new', 'all',
]);

/** 서술형 어미로 끝나는 단어는 키워드 후보에서 뺍니다. */
const VERB_SUFFIXES = [
  '합니다', '됩니다', '입니다', '습니다', '하세요', '해주세요', '해요', '이며', '하고', '해서',
  '에서', '으로', '까지', '부터', '보다', '처럼', '라고', '라는', '에는', '에도', '만든',
  '있어요', '없어요', '하지만', '그리고', '는데', '으니', '면서',
];

function looksLikeSentenceWord(word: string): boolean {
  return VERB_SUFFIXES.some((suffix) => word.length > suffix.length && word.endsWith(suffix));
}

/** 한국어/영문 혼합 텍스트를 비교용 단어 목록으로 */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  const cleaned = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
    .replace(/[^0-9a-z가-힣\s]/g, ' ');
  const tokens: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    const word = raw.trim();
    if (word.length < 2) continue;
    if (STOPWORDS.has(word)) continue;
    if (/^\d+$/.test(word)) continue;
    if (looksLikeSentenceWord(word)) continue;
    tokens.push(word);
  }
  return tokens;
}

/** 제목·요약에서 두 단어짜리 검색어 후보를 뽑습니다 (예: "cad 뷰어", "압축 풀기"). */
export function bigrams(text: string | null | undefined): string[] {
  const words = tokenize(text);
  const out: string[] = [];
  for (let i = 0; i < words.length - 1; i += 1) {
    out.push(`${words[i]} ${words[i + 1]}`);
  }
  return out;
}

/** 'DWG 뷰어' 처럼 띄어쓴 복합 키워드가 텍스트에 있는지 */
export function containsKeyword(text: string | null | undefined, keyword: string): boolean {
  if (!text) return false;
  const haystack = text.toLowerCase().replace(/\s+/g, ' ');
  const needle = keyword.toLowerCase().replace(/\s+/g, ' ');
  if (haystack.includes(needle)) return true;
  const compactHaystack = haystack.replace(/\s+/g, '');
  const compactNeedle = needle.replace(/\s+/g, '');
  return compactNeedle.length >= 3 && compactHaystack.includes(compactNeedle);
}

export function analyzeCompetitorKeywords(
  competitors: CompetitorInput[],
  app: AppTextInput,
  extraKeywords: string[] = [],
): KeywordWeight[] {
  const weights = new Map<string, KeywordWeight>();
  const bump = (word: string, field: 'titleHits' | 'summaryHits' | 'descriptionHits', weight: number, packageId: string) => {
    const entry =
      weights.get(word) ??
      ({
        keyword: word,
        weight: 0,
        titleHits: 0,
        summaryHits: 0,
        descriptionHits: 0,
        competitors: [],
        covered: false,
      } as KeywordWeight);
    entry.weight += weight;
    entry[field] += 1;
    if (!entry.competitors.includes(packageId)) entry.competitors.push(packageId);
    weights.set(word, entry);
  };

  for (const competitor of competitors) {
    const id = competitor.packageId;
    for (const word of new Set(tokenize(competitor.title))) bump(word, 'titleHits', 3, id);
    for (const word of new Set(bigrams(competitor.title))) bump(word, 'titleHits', 4, id);
    for (const word of new Set(tokenize(competitor.summary))) bump(word, 'summaryHits', 2, id);
    for (const word of new Set(bigrams(competitor.summary))) bump(word, 'summaryHits', 3, id);
    const descTokens = new Set(tokenize(competitor.description));
    for (const word of descTokens) bump(word, 'descriptionHits', 1, id);
  }

  // 내가 등록한 추적 키워드도 후보로 넣습니다.
  for (const keyword of extraKeywords) {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) continue;
    if (!weights.has(normalized)) {
      weights.set(normalized, {
        keyword: normalized,
        weight: 6,
        titleHits: 0,
        summaryHits: 0,
        descriptionHits: 0,
        competitors: competitors.map((c) => c.packageId),
        covered: false,
      });
    }
  }

  const brandTokens = new Set<string>();
  for (const competitor of competitors) {
    for (const word of tokenize(competitor.developer)) brandTokens.add(word);
    for (const segment of competitor.packageId.split('.')) {
      for (const word of tokenize(segment)) brandTokens.add(word);
    }
  }

  const myText = [app.title, app.summary, app.description].filter(Boolean).join(' ');
  const result = [...weights.values()]
    .map((entry) => ({
      ...entry,
      covered: containsKeyword(myText, entry.keyword),
    }))
    // 경쟁사 브랜드명·설명문 한 곳에만 나온 잡음 단어는 버립니다.
    .filter((entry) => !brandTokens.has(entry.keyword.split(' ')[0]) || entry.covered)
    .filter((entry) => !brandTokens.has(entry.keyword) || entry.covered)
    .filter(
      (entry) =>
        entry.covered ||
        entry.titleHits > 0 ||
        entry.summaryHits > 0 ||
        entry.weight >= 8,
    );

  result.sort((a, b) => b.weight - a.weight || a.keyword.localeCompare(b.keyword));
  return result;
}

export interface AsoSuggestion {
  missingKeywords: { keyword: string; weight: number; competitorCount: number }[];
  coveredKeywords: { keyword: string; weight: number }[];
  titleCandidates: { text: string; length: number; ok: boolean }[];
  shortDescriptionCandidates: { text: string; length: number; ok: boolean }[];
  descriptionOutline: string;
  competitorTitles: { packageId: string; rank: number | null; title: string | null }[];
  notes: string[];
}

/** Play 스토어 제목 30자, 간단한 설명 80자 제한 안에서 개선안을 만듭니다. */
export function buildAsoSuggestions(
  app: AppTextInput & { name?: string | null; packageId?: string },
  competitors: CompetitorInput[],
  trackedKeywords: string[],
): AsoSuggestion {
  const analysis = analyzeCompetitorKeywords(competitors, app, trackedKeywords);
  const missing = analysis.filter((item) => !item.covered);
  const covered = analysis.filter((item) => item.covered);

  const baseTitle = (app.title ?? app.name ?? '').trim();
  const coreName = baseTitle.includes(' - ') ? baseTitle.split(' - ').slice(1).join(' - ').trim() : baseTitle;
  const shortName = coreName.length > 18 ? truncate(coreName, 18) : coreName;

  // 경쟁사 상호로 보이는 단어(한 앱에서만 나온 라틴 표기)는 제목 후보에서 제외합니다.
  const suspectBrands = new Set(
    missing
      .filter((item) => !item.keyword.includes(' ') && /^[a-z]{4,}$/.test(item.keyword) && item.competitors.length <= 1)
      .map((item) => item.keyword),
  );
  const usable = missing.filter((item) => !item.keyword.split(' ').some((word) => suspectBrands.has(word)));

  const titleText = `${app.title ?? ''} ${app.name ?? ''}`.toLowerCase();
  const phraseIdeas = usable.filter((item) => {
    if (!item.keyword.includes(' ') || item.keyword.length > 16) return false;
    const words = item.keyword.split(' ');
    // 이미 제목에 있는 단어만으로 이루어진 조합은 새로 얻을 게 없습니다.
    const bothInTitle = words.every((word) => titleText.includes(word));
    return !bothInTitle;
  });
  const wordIdeas = usable.filter((item) => !item.keyword.includes(' ') && item.competitors.length >= 3 && item.keyword.length <= 10);
  const titleIdeas = new Set<string>();
  const titleKeywords = [...phraseIdeas.slice(0, 5), ...wordIdeas.slice(0, 3)];
  for (const item of titleKeywords) {
    const keyword = capitalizeKeyword(item.keyword);
    titleIdeas.add(`${keyword} - ${shortName}`);
    titleIdeas.add(`${shortName} ${keyword}`);
  }
  if (baseTitle) titleIdeas.add(baseTitle);

  const titleCandidates = [...titleIdeas]
    .filter((text) => text.length > 0)
    .map((text) => ({ text, length: charLength(text), ok: charLength(text) <= 30 }))
    .filter((item, index, all) => all.findIndex((x) => x.text === item.text) === index)
    .sort((a, b) => Number(b.ok) - Number(a.ok) || a.length - b.length)
    .slice(0, 6);

  const summaryBase = app.summary ?? '';
  const summaryIdeas = new Set<string>();
  for (const item of titleKeywords.slice(0, 5)) {
    const keyword = capitalizeKeyword(item.keyword);
    summaryIdeas.add(`${keyword}까지 한 번에. ${summaryBase}`.trim());
    summaryIdeas.add(`${summaryBase} ${keyword} 지원.`.trim());
  }
  summaryIdeas.add(summaryBase);

  const shortDescriptionCandidates = [...summaryIdeas]
    .filter(Boolean)
    .map((text) => {
      const normalized = text.length > 80 ? truncate(text, 80) : text;
      return { text: normalized, length: charLength(normalized), ok: charLength(normalized) <= 80 };
    })
    .filter((item, index, all) => all.findIndex((x) => x.text === item.text) === index)
    .slice(0, 5);

  const outlineKeywords = [...new Set([...trackedKeywords.map((k) => k.trim()), ...missing.slice(0, 8).map((m) => capitalizeKeyword(m.keyword))])].filter(Boolean);
  const descriptionOutline = [
    `[첫 문단 · 핵심 키워드] ${outlineKeywords.slice(0, 3).join(', ') || '주요 기능'}을(를) 첫 두 문장에 넣어 검색 매칭을 높입니다.`,
    `[기능 목록] ${outlineKeywords.slice(3, 8).join(' · ') || '핵심 기능 4~6개'}를 불릿(•)으로 정리합니다.`,
    '[사용 장면] "현장에서", "출장 중", "카톡으로 받은 파일" 같은 실제 상황 문장을 2개 넣습니다.',
    '[신뢰 요소] 광고 없음·개인정보 미수집·오프라인 동작 등 실제 사실만 적습니다.',
    '[마무리] 업데이트 날짜와 문의 채널을 안내합니다.',
  ].join('\n');

  const notes: string[] = [];
  if (missing.length === 0) notes.push('경쟁 앱 대비 빠진 핵심 키워드가 없습니다. 제목·설명 문구의 순서만 다듬어 보세요.');
  else notes.push(`경쟁 상위 앱들이 쓰는데 내 앱에는 없는 단어 ${missing.length}개를 찾았습니다. 상위 3개부터 제목/간단 설명에 넣어 보세요.`);
  if (titleCandidates.every((c) => !c.ok)) notes.push('제목 후보가 30자를 넘습니다. 브랜드명을 줄여야 합니다.');
  notes.push('경쟁 앱에만 있는 기능 단어는 우리 앱이 실제로 지원하는지 먼저 확인하세요. 없는 기능을 쓰면 정책 위반·환불 요청으로 이어집니다.');
  notes.push('Play 정책상 키워드 반복·타사 상호 사용은 제재 대상입니다. 실제 기능과 일치하는 단어만 사용하세요.');

  return {
    missingKeywords: missing.slice(0, 20).map((item) => ({
      keyword: item.keyword,
      weight: item.weight,
      competitorCount: item.competitors.length,
    })),
    coveredKeywords: covered.slice(0, 15).map((item) => ({ keyword: item.keyword, weight: item.weight })),
    titleCandidates,
    shortDescriptionCandidates,
    descriptionOutline,
    competitorTitles: competitors
      .slice(0, 5)
      .map((c) => ({ packageId: c.packageId, rank: c.rank, title: c.title })),
    notes,
  };
}

const ACRONYMS: Record<string, string> = {
  dwg: 'DWG',
  dxf: 'DXF',
  pdf: 'PDF',
  cad: 'CAD',
  hwp: 'HWP',
  zip: 'ZIP',
  rar: 'RAR',
  ppt: 'PPT',
  ai: 'AI',
  ocr: 'OCR',
  ftp: 'FTP',
  api: 'API',
  '2d': '2D',
  '3d': '3D',
  usb: 'USB',
  gif: 'GIF',
  png: 'PNG',
  jpg: 'JPG',
};

function capitalizeKeyword(keyword: string): string {
  return keyword
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      return word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word;
    })
    .join(' ');
}

/** 설명문에서 기능 불릿을 뽑아 홍보 글 재료로 사용 */
export function extractFeatureBullets(description: string | null | undefined, limit = 6): string[] {
  if (!description) return [];
  const lines = description.split('\n').map((line) => line.trim());
  const bullets = lines
    .filter((line) => /^[•·\-*▪]/.test(line))
    .map((line) => line.replace(/^[•·\-*▪]\s*/, '').trim())
    .filter((line) => line.length >= 4 && line.length <= 80);
  if (bullets.length > 0) return bullets.slice(0, limit);
  // 불릿이 없으면 마침표 기준 문장에서 고릅니다.
  return description
    .split(/[.\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 60)
    .slice(0, limit);
}
