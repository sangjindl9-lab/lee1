/**
 * 실제 Google Play 를 상대로 파서가 동작하는지 확인하는 실측 스크립트.
 * 실행: npm run live-check
 * 결과는 docs/live-check-<날짜>.json 에 저장됩니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchAppDetails, AppNotFoundError } from '../src/playstore/appDetails.ts';
import { searchKeyword } from '../src/playstore/search.ts';
import { fetchDeveloperApps } from '../src/playstore/developer.ts';
import { kstDateString } from '../src/util.ts';

const seeds = ['kr.eumsoft.viewer', 'kr.eumsoft.zip', 'kr.eumsoft.docs'];
const keywordPlan: { packageId: string; terms: string[] }[] = [
  { packageId: 'kr.eumsoft.viewer', terms: ['DWG 뷰어', 'PDF 뷰어', '캐드 뷰어', '도면 뷰어', '이음뷰어'] },
  { packageId: 'kr.eumsoft.zip', terms: ['압축 풀기', 'zip 파일 열기', '압축 파일 관리'] },
  { packageId: 'kr.eumsoft.docs', terms: ['문서 작성', '한글 문서 편집'] },
];

const startedAt = new Date();
const evidence: Record<string, unknown> = {
  ranAt: startedAt.toISOString(),
  kstDate: kstDateString(startedAt),
  details: [] as unknown[],
  search: [] as unknown[],
  developer: null as unknown,
  errors: [] as string[],
};

console.log(`\n=== Google Play 실측 (${kstDateString(startedAt)} KST) ===\n`);

for (const packageId of seeds) {
  try {
    const details = await fetchAppDetails(packageId, 'ko', 'KR');
    (evidence.details as unknown[]).push(details);
    console.log(`[앱] ${packageId}`);
    console.log(`  제목       : ${details.title}`);
    console.log(`  개발자     : ${details.developer}`);
    console.log(`  카테고리   : ${details.genre}`);
    console.log(`  평점/리뷰  : ${details.score ?? '–'} / ${details.ratings?.toLocaleString('ko-KR') ?? '–'}`);
    console.log(`  설치       : ${details.installs}`);
    console.log(`  버전       : ${details.version}`);
    console.log(`  업데이트   : ${details.updatedTs ? new Date(details.updatedTs).toISOString().slice(0, 10) : '–'}`);
    console.log(`  한줄 소개  : ${(details.summary ?? '').slice(0, 60)}`);
    console.log('');
  } catch (err) {
    const message = err instanceof AppNotFoundError ? `앱 없음: ${packageId}` : `실패: ${(err as Error).message}`;
    (evidence.errors as string[]).push(message);
    console.log(`[앱] ${message}\n`);
  }
}

for (const plan of keywordPlan) {
  for (const term of plan.terms) {
    try {
      const outcome = await searchKeyword(term, { depth: 30, hl: 'ko', gl: 'KR' });
      const mine = outcome.results.find((item) => item.packageId === plan.packageId) ?? null;
      const entry = {
        packageId: plan.packageId,
        term,
        rank: mine ? mine.rank : null,
        scanned: outcome.results.length,
        pagesFetched: outcome.pagesFetched,
        tokenAvailable: outcome.tokenAvailable,
        top5: outcome.results.slice(0, 5).map((item) => ({
          rank: item.rank,
          packageId: item.packageId,
          title: item.title,
          developer: item.developer,
          score: item.score,
        })),
        fetchedAt: outcome.fetchedAt,
      };
      (evidence.search as unknown[]).push(entry);
      console.log(`[검색] "${term}" → ${outcome.results.length}개 확인, 내 앱 ${mine ? `${mine.rank}위` : '30위 안에 없음'} (페이지 ${outcome.pagesFetched})`);
      console.log(
        `       1위 ${outcome.results[0]?.title ?? '–'} (${outcome.results[0]?.developer ?? '–'}) · 2위 ${outcome.results[1]?.title ?? '–'} · 3위 ${outcome.results[2]?.title ?? '–'}`,
      );
    } catch (err) {
      const message = `검색 실패 "${term}": ${(err as Error).message}`;
      (evidence.errors as string[]).push(message);
      console.log(`[검색] ${message}`);
    }
  }
}

try {
  const devApps = await fetchDeveloperApps('이음소프트웨어', 'ko', 'KR');
  evidence.developer = devApps;
  console.log(`\n[개발자] 이음소프트웨어 공개 앱 ${devApps.length}개: ${devApps.map((a) => a.packageId).join(', ')}`);
} catch (err) {
  (evidence.errors as string[]).push(`개발자 페이지: ${(err as Error).message}`);
}

const outDir = path.resolve(import.meta.dirname, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `live-check-${kstDateString(startedAt)}.json`);
fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2));

const summary = {
  detailsOk: (evidence.details as unknown[]).length,
  searches: (evidence.search as unknown[]).length,
  errors: (evidence.errors as string[]).length,
};
console.log(`\n=== 결과: 앱 ${summary.detailsOk}건 · 검색 ${summary.searches}건 · 오류 ${summary.errors}건 ===`);
console.log(`증빙 저장: ${outFile}`);

if (summary.errors > 0) process.exitCode = 1;
