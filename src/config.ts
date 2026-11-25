import path from 'node:path';

/** 앱 전역 설정. 모든 값은 환경 변수로 덮어쓸 수 있습니다. */
export interface AppConfig {
  port: number;
  dataDir: string;
  dbFile: string;
  adminPassword: string | null;
  authSecret: string;
  rankDepth: number;
  userAgent: string;
  locale: { hl: string; gl: string };
  requestTimeoutMs: number;
  openaiApiKey: string | null;
  openaiModel: string;
  seedDemoData: boolean;
  enableScheduler: boolean;
  kstOffsetMinutes: number;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = overrides.dataDir ?? process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
  const rankDepth = Math.min(50, Math.max(5, overrides.rankDepth ?? envInt('RANK_DEPTH', 30)));
  const adminPassword = overrides.adminPassword ?? (process.env.ADMIN_PASSWORD || null);

  const config: AppConfig = {
    port: overrides.port ?? envInt('PORT', 3100),
    dataDir,
    dbFile: overrides.dbFile ?? path.join(dataDir, 'eum-promo.db'),
    adminPassword,
    authSecret:
      overrides.authSecret ?? process.env.AUTH_SECRET ?? adminPassword ?? 'eum-promo-local-secret',
    rankDepth,
    userAgent:
      overrides.userAgent ??
      process.env.PLAY_USER_AGENT ??
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: overrides.locale ?? { hl: process.env.PLAY_LANG ?? 'ko', gl: process.env.PLAY_COUNTRY ?? 'KR' },
    requestTimeoutMs: overrides.requestTimeoutMs ?? envInt('PLAY_TIMEOUT_MS', 20000),
    openaiApiKey: overrides.openaiApiKey ?? (process.env.OPENAI_API_KEY || null),
    openaiModel: overrides.openaiModel ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    seedDemoData: overrides.seedDemoData ?? process.env.SEED_DEMO !== '0',
    enableScheduler: overrides.enableScheduler ?? process.env.SCHEDULER !== '0',
    kstOffsetMinutes: 9 * 60,
  };
  return config;
}

/** 기본 시드 앱 — 실제로 Google Play에 공개된 이음소프트웨어 앱만 넣습니다. */
export const SEED_APPS: { packageId: string; name: string; note: string }[] = [
  { packageId: 'kr.eumsoft.viewer', name: '이음뷰어', note: 'PDF·캐드(DWG·DXF) 뷰어 — 생산성' },
  { packageId: 'kr.eumsoft.zip', name: '이음ZIP', note: '압축 파일 관리 — 도구' },
  { packageId: 'kr.eumsoft.docs', name: '이음과 문서', note: '문서 작성·관리 — 생산성' },
];

export const DEFAULT_KEYWORDS: Record<string, string[]> = {
  'kr.eumsoft.viewer': ['DWG 뷰어', 'PDF 뷰어', '캐드 뷰어', '도면 뷰어'],
  'kr.eumsoft.zip': ['압축 풀기', 'zip 파일 열기', '압축 파일 관리'],
  'kr.eumsoft.docs': ['문서 작성', '한글 문서 편집'],
};
