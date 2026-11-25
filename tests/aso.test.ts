import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeCompetitorKeywords,
  buildAsoSuggestions,
  containsKeyword,
  extractFeatureBullets,
  tokenize,
  type CompetitorInput,
} from '../src/aso/analysis.ts';

const competitors: CompetitorInput[] = [
  {
    packageId: 'com.alphainventor.filemanager',
    rank: 1,
    title: '파일 관리자 - 파일 탐색기, 압축 풀기',
    developer: 'File Manager Plus',
    score: 4.85,
    summary: '파일 관리와 압축 풀기, 클라우드 연결까지 한 번에.',
    description: '파일 관리자 · 파일 탐색기 · ZIP 압축 풀기 · 클라우드 연결 · FTP 서버',
  },
  {
    packageId: 'com.cxinventor.file.explorer',
    rank: 2,
    title: 'X-plore 파일 관리자',
    developer: 'Lonely Cat Games',
    score: 4.63,
    summary: '듀얼 패널 파일 관리자, 압축 파일 열기.',
    description: '루트 탐색 · 압축 파일 열기 · 클라우드 · FTP · SFTP 지원',
  },
];

const myApp = {
  title: 'PDF·캐드 뷰어(DWG·DXF) - 이음뷰어',
  summary: '현장에서 받은 DWG·DXF 도면을 휴대폰으로 열고 치수·면적을 확인하세요.',
  description: 'DWG 뷰어 · DXF 뷰어 · 레이어 · 거리 측정 · 면적 측정 · PDF 편집',
};

test('tokenize: 조사·불용어를 걸러낸다', () => {
  const tokens = tokenize('파일 관리자와 압축 풀기 기능을 지원합니다. 사용자 편의를 위해');
  assert.ok(tokens.includes('파일'));
  assert.ok(tokens.includes('관리자와'));
  assert.ok(tokens.includes('압축'));
  assert.ok(!tokens.includes('지원합니다'));
  assert.ok(!tokens.includes('사용자'));
});

test('containsKeyword: 띄어쓰기가 달라도 찾는다', () => {
  assert.equal(containsKeyword('DWG 뷰어 앱', 'dwg뷰어'), true);
  assert.equal(containsKeyword('PDF 편집 지원', '캐드 뷰어'), false);
});

test('analyzeCompetitorKeywords: 경쟁 앱 가중치와 내 앱 반영 여부', () => {
  const weights = analyzeCompetitorKeywords(competitors, myApp, ['DWG 뷰어']);
  const fileManager = weights.find((w) => w.keyword === '관리자');
  assert.ok(fileManager);
  assert.ok(fileManager.weight >= 3, '제목에 있으면 가중치 3 이상');
  const zip = weights.find((w) => w.keyword === '압축');
  assert.ok(zip);
  assert.equal(zip.covered, false, '내 앱 설명에는 압축이 없음');
  const dwg = weights.find((w) => w.keyword === 'dwg 뷰어');
  assert.equal(dwg?.covered, true);
});

test('buildAsoSuggestions: 제목·간단 설명 길이 제한을 지킨다', () => {
  const suggestion = buildAsoSuggestions(
    { ...myApp, name: '이음뷰어', packageId: 'kr.eumsoft.viewer' },
    competitors,
    ['DWG 뷰어', 'PDF 뷰어'],
  );
  assert.ok(suggestion.missingKeywords.length > 0);
  for (const candidate of suggestion.titleCandidates) {
    assert.equal(candidate.length, [...candidate.text].length);
    assert.equal(candidate.ok, candidate.length <= 30);
  }
  for (const candidate of suggestion.shortDescriptionCandidates) {
    assert.ok(candidate.length <= 80);
    assert.equal(candidate.ok, true);
  }
  assert.ok(suggestion.descriptionOutline.includes('첫 문단'));
  assert.equal(suggestion.competitorTitles.length, 2);
  assert.ok(suggestion.notes.some((note) => note.includes('정책')));
});

test('buildAsoSuggestions: 경쟁 앱이 없어도 동작한다', () => {
  const suggestion = buildAsoSuggestions({ ...myApp, name: '이음뷰어' }, [], ['DWG 뷰어']);
  assert.ok(suggestion.titleCandidates.length > 0);
  assert.ok(suggestion.shortDescriptionCandidates.length > 0);
});

test('extractFeatureBullets: 불릿 우선, 없으면 문장', () => {
  const bullets = extractFeatureBullets('소개 문장\n• 첫 기능\n• 두 번째 기능');
  assert.deepEqual(bullets, ['첫 기능', '두 번째 기능']);
  const sentences = extractFeatureBullets('현장에서 도면을 열 수 있습니다. 면적을 바로 계산합니다.');
  assert.ok(sentences.length >= 2);
});
