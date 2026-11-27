/**
 * 이음소프트웨어 전체 출시 앱 실측 감사 스크립트.
 * - Play 개발자 페이지에서 공개 앱 전수 확인
 * - 앱 정보 새로고침 · 키워드(브랜드 1 + 일반 5) 등록 · 한국 스토어 실제 순위 점검
 * - 대표 키워드의 상위 경쟁 앱 상세(제목·요약·평점·설치 수) 수집
 * 결과: docs/full-audit-<날짜>.json
 *
 * 실행: node scripts/full-audit.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../src/server.ts';
import { fetchDeveloperApps } from '../src/playstore/developer.ts';
import { kstDateString } from '../src/util.ts';

const PORT = Number(process.env.AUDIT_PORT ?? 3210);
const outDir = path.resolve(import.meta.dirname, '..', 'docs');

/** 앱별 키워드 계획 — 브랜드 1 + 일반 유입 5 */
const KEYWORD_PLAN: Record<string, { brand: string; general: string[] }> = {
  'kr.eumsoft.viewer': {
    brand: '이음뷰어',
    general: ['DWG 뷰어', 'PDF 뷰어', '캐드 뷰어', '도면 뷰어', 'DXF 뷰어'],
  },
  'kr.eumsoft.zip': {
    brand: '이음ZIP',
    general: ['압축 풀기', 'ZIP 풀기', '압축 해제', 'zip 파일 열기', '알집 대체'],
  },
  'kr.eumsoft.docs': {
    brand: '이음과 문서',
    general: ['한글 뷰어', 'HWP 편집', '한글 문서 편집', '엑셀 뷰어', '문서 작성'],
  },
};

/** 경쟁사 상세를 수집할 대표 키워드 */
const REPRESENTATIVE: Record<string, string[]> = {
  'kr.eumsoft.viewer': ['DWG 뷰어', 'PDF 뷰어', '캐드 뷰어'],
  'kr.eumsoft.zip': ['압축 풀기', 'ZIP 풀기', '압축 해제'],
  'kr.eumsoft.docs': ['한글 뷰어', 'HWP 편집', '한글 문서 편집'],
};

const startedAt = new Date();
const evidence: Record<string, unknown> = {
  ranAt: startedAt.toISOString(),
  kstDate: kstDateString(startedAt),
  developerPage: null,
  developerProbe: [],
  apps: [],
  keywords: [],
  ranks: [],
  representative: [],
  errors: [],
};

const created = createServer({ dataDir: path.resolve(process.cwd(), 'data'), enableScheduler: false, seedDemoData: true });
const server = created.app.listen(PORT, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', () => resolve()));
const base = `http://127.0.0.1:${PORT}`;
const errors = evidence.errors as string[];

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(`${base}${url}`);
  const body = await res.json();
  if (!res.ok) throw new Error(`${url} → ${res.status} ${JSON.stringify(body)}`);
  return body as T;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const res = await fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${url} → ${res.status} ${JSON.stringify(body)}`);
  return body as T;
}

try {
  console.log(`서버: ${base}`);

  // 1) 개발자 페이지 전수 확인
  const devPageApps = await fetchDeveloperApps('이음소프트웨어', 'ko', 'KR').catch((err) => {
    errors.push(`개발자 페이지: ${(err as Error).message}`);
    return [];
  });
  evidence.developerPage = devPageApps;

  // 2) 앱 목록·정보 새로고침
  const list = await getJson<{ apps: { id: number; package_id: string }[] }>('/api/apps');
  console.log(`등록 앱 ${list.apps.length}개`);
  const appIds: Record<string, number> = {};
  for (const app of list.apps) {
    appIds[app.package_id] = app.id;
    try {
      const refreshed = await postJson<{ snapshot: Record<string, unknown> }>(`/api/apps/${app.id}/refresh`, {});
      (evidence.apps as unknown[]).push({ packageId: app.package_id, snapshot: refreshed.snapshot });
      console.log(`[앱] ${app.package_id} · ${refreshed.snapshot?.title} · 설치 ${refreshed.snapshot?.installs} · 버전 ${refreshed.snapshot?.version} · 스크린샷 ${refreshed.snapshot?.screenshotCount ?? '–'}`);
    } catch (err) {
      errors.push(`${app.package_id} 새로고침: ${(err as Error).message}`);
    }
  }

  // 3) 키워드 등록 (브랜드 1 + 일반 5)
  for (const [packageId, plan] of Object.entries(KEYWORD_PLAN)) {
    const appId = appIds[packageId];
    if (!appId) {
      errors.push(`앱 미등록: ${packageId}`);
      continue;
    }
    const terms = [plan.brand, ...plan.general];
    try {
      const saved = await postJson<{ all: unknown[] }>(`/api/apps/${appId}/keywords`, { terms });
      (evidence.keywords as unknown[]).push({ packageId, terms, total: saved.all.length });
      console.log(`[키워드] ${packageId} ← ${terms.join(', ')} (총 ${saved.all.length})`);
    } catch (err) {
      errors.push(`${packageId} 키워드: ${(err as Error).message}`);
    }
  }

  // 4) 순위 실측
  for (const [packageId, plan] of Object.entries(KEYWORD_PLAN)) {
    const appId = appIds[packageId];
    if (!appId) continue;
    try {
      const result = await postJson<{ outcomes: { items: { term: string; rank: number | null; status: string; scanned: number; competitors: unknown[] }[] }[] }>(
        `/api/apps/${appId}/check-ranks`,
        {},
      );
      const items = result.outcomes.flatMap((o) => o.items);
      (evidence.ranks as unknown[]).push({ packageId, items });
      for (const item of items) {
        console.log(`[순위] ${packageId} "${item.term}" → ${item.rank ? `${item.rank}위` : '권 밖'} (${item.scanned}개 확인)`);
      }
    } catch (err) {
      errors.push(`${packageId} 순위 점검: ${(err as Error).message}`);
    }
    void plan;
  }

  // 5) 대표 키워드 경쟁 앱 상세 수집
  for (const [packageId, terms] of Object.entries(REPRESENTATIVE)) {
    const appId = appIds[packageId];
    if (!appId) continue;
    const detail = await getJson<{ keywords: { keyword: { id: number; term: string } }[] }>(`/api/apps/${appId}`);
    for (const term of terms) {
      const kw = detail.keywords.find((k) => k.keyword.term === term);
      if (!kw) {
        errors.push(`키워드 없음: ${packageId} / ${term}`);
        continue;
      }
      try {
        const aso = await getJson<{ competitors: unknown[]; missingKeywords: unknown[]; titleCandidates: unknown[] }>(
          `/api/apps/${appId}/aso?keywordId=${kw.keyword.id}`,
        );
        (evidence.representative as unknown[]).push({
          packageId,
          term,
          competitors: aso.competitors,
          missingKeywords: aso.missingKeywords,
          titleCandidates: aso.titleCandidates,
        });
        console.log(`[경쟁] ${packageId} "${term}" → 상위 ${aso.competitors.length}개 상세 수집`);
      } catch (err) {
        errors.push(`경쟁 수집 ${packageId}/${term}: ${(err as Error).message}`);
      }
    }
  }
} finally {
  const outFile = path.join(outDir, `full-audit-${kstDateString(startedAt)}.json`);
  fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2));
  console.log(`\n증빙 저장: ${outFile}`);
  console.log(`오류 ${(evidence.errors as string[]).length}건`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await created.close();
}
