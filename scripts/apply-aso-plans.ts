/**
 * 실측 진단을 반영한 앱별 ASO 개편안을 eum-promo 에 저장하고,
 * 네이버 블로그·커뮤니티 홍보 초안을 생성합니다.
 * 실행: node scripts/apply-aso-plans.ts
 */
import path from 'node:path';
import { createServer } from '../src/server.ts';

const PORT = Number(process.env.APPLY_PORT ?? 3211);

interface Plan {
  packageId: string;
  keywords: string[];
  title: string;
  summary: string;
  descriptionHead: string;
  rationale: string;
}

const PLANS: Plan[] = [
  {
    packageId: 'kr.eumsoft.viewer',
    keywords: ['캐드 도면 뷰어', 'DWG 뷰어', 'DXF 뷰어', 'CAD 뷰어', 'PDF 뷰어', '도면 측정'],
    title: '캐드 CAD 도면 뷰어 DWG·DXF - 이음뷰어',
    summary: '캐드 도면 뷰어 이음뷰어. DWG·DXF·PDF 도면을 열어 치수·면적을 재고, PDF 보기·편집까지 오프라인으로.',
    descriptionHead:
      '캐드 도면 뷰어 이음뷰어는 DWG·DXF 도면과 PDF를 휴대폰에서 바로 열고 측정하는 CAD 뷰어입니다. 현장에서 메신저로 받은 도면을 열어 거리·면적을 재고, 필요한 레이어만 골라 볼 수 있습니다. PDF 뷰어·편집 기능도 한 앱에 있어 계약서·매뉴얼을 오프라인에서 확인하고 서명할 수 있습니다. 파일은 서버로 보내지 않고 기기에서만 처리합니다.',
    rationale:
      '현재 제목은 캐드·도면·DWG·DXF 토큰은 있으나 영문 CAD 와 "캐드 뷰어" 연속 문구가 없어 CAD 검색 유입이 약함. 30자 안에서 CAD 를 추가하고, 간단 설명에 브랜드와 PDF 도면을 넣어 브랜드·일반 검색을 동시에 잡음. 상세 설명 첫 160자에 "캐드 도면 뷰어·CAD 뷰어·PDF 뷰어·편집"을 자연 문장으로 배치.',
  },
  {
    packageId: 'kr.eumsoft.zip',
    keywords: ['압축 풀기', 'ZIP 풀기', '압축 해제', 'RAR 풀기', '7Z 압축', '한글 파일명'],
    title: '이음ZIP - 압축 풀기 ZIP·RAR·7Z 해제',
    summary: '광고·권한 없는 압축 풀기 앱. ZIP·RAR·7Z 해제, 비밀번호 압축 풀기, 깨진 한글 파일명 자동 복구.',
    descriptionHead:
      '이음ZIP은 ZIP·RAR·7Z·TAR 압축 파일을 푸는 압축 해제 앱입니다. 카카오톡·메일로 받은 ZIP 풀기, RAR 풀기, 7Z 압축 풀기를 한 화면에서 처리하고 비밀번호가 걸린 압축 파일도 열 수 있습니다. 윈도우에서 만든 ZIP의 깨진 한글 파일명은 자동으로 바로잡습니다. 광고와 불필요한 권한 요청이 없고 파일은 기기 안에서만 처리합니다.',
    rationale:
      '"압축 풀기" 머리 키워드는 알집·RAR·ZArchiver 등 5백만~1억 설치 앱이 독점. 제목에 ZIP·RAR·7Z 를 넣어 "ZIP 풀기"·"RAR 풀기"·"7Z 압축" 롱테일과 포맷 검색을 확보하고, 간단 설명에 "광고·권한 없음"과 "한글 파일명 복구"라는 차별점을 전면 배치.',
  },
  {
    packageId: 'kr.eumsoft.docs',
    keywords: ['한글 뷰어', 'HWP 편집', '한글 문서 편집', 'hwp 뷰어', '엑셀 뷰어', 'PDF 저장'],
    title: '이음과 문서 - 한글 hwp 뷰어·편집, 엑셀 워드',
    summary: '한글 hwp 뷰어·편집 앱. HWP·HWPX·엑셀·워드·PPT를 열고 고쳐 같은 형식이나 PDF로 저장.',
    descriptionHead:
      '이음과 문서는 한글(hwp)·엑셀·워드·파워포인트 문서를 휴대폰에서 열고 편집하는 문서 앱입니다. 한글 뷰어로 hwp·hwpx 파일을 확인하고, HWP 편집 모드에서 글자·문단·표·그림을 고칠 수 있습니다. 엑셀은 셀 값과 수식을, 워드·PPT는 문단과 슬라이드 글자를 수정합니다. 보기 모드에서는 실수로 내용이 바뀌지 않으며, 편집한 문서는 같은 형식이나 PDF로 저장합니다.',
    rationale:
      '가장 큰 검색어인 "한글 뷰어"가 현재 제목·간단 설명·상세 설명 어디에도 연속 문구로 없음(토큰 한글만 존재). 제목에 "한글 hwp 뷰어·편집"을 넣어 뷰어·편집 검색을 모두 잡고, 간단 설명과 상세 첫 문단에 HWP·HWPX·엑셀·워드·PDF 저장을 배치.',
  },
];

const created = createServer({ dataDir: path.resolve(process.cwd(), 'data'), enableScheduler: false, seedDemoData: true });
const server = created.app.listen(PORT, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', () => resolve()));
const base = `http://127.0.0.1:${PORT}`;

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
  const list = await getJson<{ apps: { id: number; package_id: string; label: string | null }[] }>('/api/apps');
  const idByPackage = new Map(list.apps.map((a) => [a.package_id, a.id]));

  for (const plan of PLANS) {
    const appId = idByPackage.get(plan.packageId);
    if (!appId) {
      console.warn(`앱 없음: ${plan.packageId}`);
      continue;
    }
    const saved = await postJson<{ plan: { id: number; titleLength: number; summaryLength: number } }>(`/api/apps/${appId}/aso-plans`, {
      title: plan.title,
      summary: plan.summary,
      descriptionHead: plan.descriptionHead,
      keywords: plan.keywords,
      rationale: plan.rationale,
    });
    console.log(
      `[ASO 저장] ${plan.packageId} #${saved.plan.id} · 제목 ${saved.plan.titleLength}/30자 · 간단 설명 ${saved.plan.summaryLength}/80자`,
    );
  }

  for (const plan of PLANS) {
    const appId = idByPackage.get(plan.packageId);
    if (!appId) continue;
    const channels = plan.packageId === 'kr.eumsoft.viewer' ? ['naver_blog', 'community', 'shorts'] : ['naver_blog', 'community'];
    for (const channel of channels) {
      const result = await postJson<{ draftId: number; title: string; generator: string; warning: string | null }>(
        `/api/apps/${appId}/content`,
        { channel },
      );
      console.log(`[초안] ${plan.packageId} ${channel} #${result.draftId} · ${result.title} (${result.generator})${result.warning ? ` ⚠ ${result.warning}` : ''}`);
    }
  }

  const drafts = await getJson<{ drafts: { id: number; app_id: number; channel: string; title: string }[] }>('/api/drafts?limit=50');
  console.log(`\n보관함 초안 ${drafts.drafts.length}건`);
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await created.close();
}
