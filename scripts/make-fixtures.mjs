/**
 * 테스트용 Google Play HTML 픽스처 생성기.
 * 실제 페이지 구조(AF_initDataCallback / ds:N)만 그대로 흉내 내고 값은 최소한으로 채웁니다.
 * 실행: node scripts/make-fixtures.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(import.meta.dirname, '..', 'tests', 'fixtures');
fs.mkdirSync(outDir, { recursive: true });

function setPath(root, keys, value) {
  let cur = root;
  keys.forEach((key, index) => {
    const isLast = index === keys.length - 1;
    if (isLast) {
      cur[key] = value;
      return;
    }
    if (cur[key] === undefined || cur[key] === null || typeof cur[key] !== 'object') {
      cur[key] = typeof keys[index + 1] === 'number' ? [] : {};
    }
    cur = cur[key];
  });
}

function htmlWithScripts(blocks) {
  const scripts = blocks
    .map(
      ([key, data]) =>
        `<script nonce="test">AF_initDataCallback({key: '${key}', hash: '1', data:${JSON.stringify(data)}, sideChannel: {}});</script>`,
    )
    .join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Google Play</title></head><body>${scripts}</body></html>`;
}

function detailData({
  title,
  developer,
  genre,
  genreId,
  scoreText,
  score,
  ratings,
  reviews,
  installs,
  minInstalls,
  maxInstalls,
  updatedTs,
  version,
  summary,
  descriptionHtml,
  icon,
  priceText = '무료',
  contentRating = '전체이용가',
  released = '2025. 3. 11.',
}) {
  const data = [];
  data[1] = [];
  const node = [];
  data[1][2] = node;
  setPath(node, [0, 0], title);
  setPath(node, [9, 0], contentRating);
  setPath(node, [10, 0], released);
  setPath(node, [10, 1, 0], updatedTs);
  setPath(node, [13, 0], installs);
  setPath(node, [13, 1], minInstalls);
  setPath(node, [13, 2], maxInstalls);
  if (score) {
    setPath(node, [51, 0, 0], scoreText);
    setPath(node, [51, 0, 1], score);
    setPath(node, [51, 2, 1], ratings);
    setPath(node, [51, 3, 1], reviews);
  }
  setPath(node, [68, 0], developer);
  setPath(node, [68, 1, 4, 2], `/store/apps/developer?id=${encodeURIComponent(developer)}`);
  setPath(node, [72, 0, 1], descriptionHtml);
  setPath(node, [73, 0, 1], summary);
  setPath(node, [78, 0], [[3, 2, 'https://play-lh.googleusercontent.com/shot1'], [3, 2, 'https://play-lh.googleusercontent.com/shot2']]);
  setPath(node, [79, 0, 0, 0], genre);
  setPath(node, [79, 0, 0, 2], genreId);
  setPath(node, [95, 0, 3, 2], icon);
  setPath(node, [57, 0, 0, 0, 0, 1, 0, 0], 0);
  setPath(node, [57, 0, 0, 0, 0, 1, 0, 1], 'KRW');
  setPath(node, [57, 0, 0, 0, 0, 1, 0, 2], priceText);
  setPath(node, [140, 0, 0, 0], version);
  setPath(node, [145, 0, 1, 0], updatedTs);
  return htmlWithScripts([['ds:5', data]]);
}

const viewerDescription = [
  '현장에서 받은 DWG·DXF 도면, 이제 휴대폰으로 열고 거리와 면적을 확인하세요.',
  '',
  '■ 캐드 도면 (DWG · DXF)',
  '• DWG 뷰어 · DXF 뷰어 — AutoCAD 도면 열기',
  '• 레이어 켜고 끄기 — 필요한 레이어만 골라 보기',
  '• 거리·면적 측정 — 선 끝점에 자동으로 붙어 정확하게',
  '',
  '■ PDF 보기 · 편집',
  '• 펜, 형광펜, 글 넣기, 도장·서명 이미지 넣기',
  '• 양식(폼) 입력 — 글 칸, 체크박스, 선택 목록',
  '',
  '• 개인정보를 수집하지 않습니다. 회원 가입·광고가 없습니다.',
].join('<br>');

fs.writeFileSync(
  path.join(outDir, 'details-viewer.html'),
  detailData({
    title: 'PDF·캐드 뷰어(DWG·DXF) - 이음뷰어',
    developer: '이음소프트웨어',
    genre: '생산성',
    genreId: 'PRODUCTIVITY',
    scoreText: null,
    score: null,
    ratings: 0,
    reviews: 0,
    installs: '1+',
    minInstalls: 1,
    maxInstalls: 2,
    updatedTs: 1795409955,
    version: '1.4.2',
    summary: '현장에서 받은 DWG·DXF 도면을 휴대폰으로 열고 치수·면적을 확인하세요.',
    descriptionHtml: viewerDescription,
    icon: 'https://play-lh.googleusercontent.com/eumviewer=w240-h480',
  }),
);

fs.writeFileSync(
  path.join(outDir, 'details-competitor.html'),
  detailData({
    title: '파일 관리자',
    developer: 'File Manager Plus',
    genre: '도구',
    genreId: 'TOOLS',
    scoreText: '4.9',
    score: 4.858362,
    ratings: 1718333,
    reviews: 10024,
    installs: '100M+',
    minInstalls: 100000000,
    maxInstalls: 500000000,
    updatedTs: 1793000000,
    version: '3.4.1',
    summary: '파일 관리, 압축 풀기, 클라우드 연결까지 한 번에.',
    descriptionHtml: '• 파일 관리자 · 파일 탐색기<br>• 압축 풀기 · ZIP 압축<br>• 클라우드 연결<br>• FTP 서버',
    icon: 'https://play-lh.googleusercontent.com/fmplus=w240-h480',
  }),
);

fs.writeFileSync(
  path.join(outDir, 'details-missing.html'),
  '<!doctype html><html><head><title>찾을 수 없음</title></head><body><h1>찾을 수 없음</h1><p>요청한 URL을 찾을 수 없습니다.</p></body></html>',
);

function searchData(items, token = null) {
  const apps = items.map((item) => {
    const entry = [];
    entry[0] = [item.packageId, 7, null, item.title, null, null, null, null, null, null, null, null, null, null, item.developer];
    entry[4] = [item.score ? item.score.toFixed(1) : null, item.score ?? null];
    return entry;
  });
  const section = [];
  section[22] = [apps, [null, null, null, [null, token]]];
  const data = [];
  data[0] = [null, [section]];
  return htmlWithScripts([['ds:4', data]]);
}

const competitorItems = [
  { packageId: 'com.alphainventor.filemanager', title: '파일 관리자', developer: 'File Manager Plus', score: 4.85 },
  { packageId: 'files.fileexplorer.filemanager', title: '파일관리자', developer: 'InShot Inc.', score: 4.81 },
  { packageId: 'com.google.android.apps.nbu.files', title: 'Files by Google', developer: 'Google LLC', score: 4.41 },
  { packageId: 'com.cxinventor.file.explorer', title: 'X-plore 파일 관리자', developer: 'Lonely Cat Games', score: 4.63 },
  { packageId: 'com.sec.android.app.myfiles', title: '내 파일', developer: 'Samsung Electronics Co., Ltd.', score: 4.09 },
  { packageId: 'kr.eumsoft.viewer', title: 'PDF·캐드 뷰어(DWG·DXF) - 이음뷰어', developer: '이음소프트웨어', score: null },
  { packageId: 'com.metago.astro', title: 'ASTRO 파일 관리자', developer: 'MetaCtrl', score: 4.32 },
];

fs.writeFileSync(path.join(outDir, 'search-filemanager.html'), searchData(competitorItems));
fs.writeFileSync(
  path.join(outDir, 'search-with-token.html'),
  searchData(competitorItems.slice(0, 3), 'AO_JYtTOKEN_example_token_value'),
);
fs.writeFileSync(path.join(outDir, 'search-empty.html'), searchData([]));

// 개발자 페이지 픽스처
const devData = [];
const devApps = [
  ['kr.eumsoft.zip', '이음ZIP', '이음소프트웨어', 4.6],
  ['kr.eumsoft.viewer', 'PDF·캐드 뷰어(DWG·DXF) - 이음뷰어', '이음소프트웨어', null],
  ['kr.eumsoft.docs', '이음과 문서', '이음소프트웨어', 4.8],
].map(([packageId, title, developer, score]) => {
  const entry = [];
  entry[0] = [packageId, 7, null, title, null, null, null, null, null, null, null, null, null, null, developer];
  entry[4] = [score ? String(score) : null, score ?? null];
  return entry;
});
devData[0] = [null, devApps];
fs.writeFileSync(path.join(outDir, 'developer.html'), htmlWithScripts([['ds:5', devData]]));

console.log('fixtures written to', outDir);
