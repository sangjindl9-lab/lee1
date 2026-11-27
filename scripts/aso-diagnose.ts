/**
 * 앱별 ASO 정밀 진단: 제목·간단 설명·상세 설명의 키워드 배치/밀도와
 * 전환 요소(스크린샷·평점·설치 수)를 실제 수집값으로 계산합니다.
 * 실행: node scripts/aso-diagnose.ts
 * 결과: docs/aso-diagnosis-<날짜>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config.ts';
import { fetchAppDetails } from '../src/playstore/appDetails.ts';
import { kstDateString } from '../src/util.ts';

const PLAN: Record<string, { brand: string; general: string[] }> = {
  'kr.eumsoft.viewer': { brand: '이음뷰어', general: ['DWG 뷰어', 'PDF 뷰어', '캐드 뷰어', '도면 뷰어', 'DXF 뷰어', 'CAD 뷰어'] },
  'kr.eumsoft.zip': { brand: '이음ZIP', general: ['압축 풀기', 'ZIP 풀기', '압축 해제', 'zip 파일 열기', '알집 대체', 'RAR 풀기'] },
  'kr.eumsoft.docs': { brand: '이음과 문서', general: ['한글 뷰어', 'HWP 편집', '한글 문서 편집', '엑셀 뷰어', '문서 작성', 'hwp 뷰어'] },
};

const norm = (text: string | null | undefined) => (text ?? '').toLowerCase().replace(/\s+/g, ' ');
const count = (haystack: string, needle: string) => {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle.toLowerCase(), i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
};

const config = loadConfig({ dataDir: path.resolve(process.cwd(), 'data') });
const db = new DatabaseSync(config.dbFile);
const out: Record<string, unknown> = { ranAt: new Date().toISOString(), kstDate: kstDateString(), apps: [] };

for (const packageId of Object.keys(PLAN)) {
  const app = db.prepare('SELECT id, package_id, label FROM apps WHERE package_id = ?').get(packageId) as
    | { id: number; package_id: string; label: string | null }
    | undefined;
  if (!app) continue;
  const snap = db.prepare('SELECT * FROM app_snapshots WHERE app_id = ? ORDER BY captured_date DESC LIMIT 1').get(app.id) as
    | Record<string, string | number | null>
    | undefined;
  const details = await fetchAppDetails(packageId, 'ko', 'KR');
  const title = String(snap?.title ?? details.title ?? '');
  const summary = String(snap?.summary ?? details.summary ?? '');
  const description = String(snap?.description ?? details.description ?? '');
  const descHead = description.slice(0, 160);
  const plan = PLAN[packageId];

  const keywords = [plan.brand, ...plan.general].map((term) => ({
    term,
    inTitle: count(norm(title), term) > 0,
    titleCount: count(norm(title), term),
    inSummary: count(norm(summary), term) > 0,
    summaryCount: count(norm(summary), term),
    inDescHead: count(norm(descHead), term) > 0,
    descCount: count(norm(description), term),
  }));

  const entry = {
    packageId,
    label: app.label,
    title,
    titleLength: Array.from(title).length,
    summary,
    summaryLength: Array.from(summary).length,
    descriptionLength: Array.from(description).length,
    installs: snap?.installs ?? details.installs,
    score: snap?.score ?? details.score,
    ratings: snap?.ratings ?? details.ratings,
    reviews: snap?.reviews ?? details.reviews,
    screenshotCount: details.screenshotCount,
    version: snap?.version ?? details.version,
    updatedTs: snap?.updated_ts ?? details.updatedTs,
    genre: snap?.genre ?? details.genre,
    keywords,
  };
  (out.apps as unknown[]).push(entry);

  console.log(`\n=== ${packageId} (${app.label}) ===`);
  console.log(`제목 ${entry.titleLength}/30자 · 간단 설명 ${entry.summaryLength}/80자 · 상세 ${entry.descriptionLength}자 · 스크린샷 ${details.screenshotCount}장`);
  console.log(`설치 ${entry.installs} · 평점 ${entry.score ?? '없음'} · 리뷰 ${entry.ratings ?? 0}건`);
  for (const k of keywords) {
    console.log(
      `  ${k.term.padEnd(10)} 제목 ${k.titleCount} · 간단 ${k.summaryCount} · 설명앞 ${k.inDescHead ? 'O' : 'X'} · 전체 ${k.descCount}`,
    );
  }
}

const outDir = path.resolve(import.meta.dirname, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `aso-diagnosis-${kstDateString()}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`\n저장: ${file}`);
