import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { AppNotFoundError, parseAppDetailsHtml } from '../src/playstore/appDetails.ts';
import { parseDeveloperHtml } from '../src/playstore/developer.ts';
import { findAppRank, parseSearchHtml } from '../src/playstore/search.ts';
import { htmlToText, parseScriptData, pick } from '../src/playstore/scriptData.ts';

const fixtures = path.resolve(import.meta.dirname, 'fixtures');
const read = (name: string) => fs.readFileSync(path.join(fixtures, name), 'utf8');

test('parseScriptData: ds 블록을 JSON 으로 읽는다', () => {
  const data = parseScriptData(read('details-viewer.html'));
  assert.ok(data['ds:5']);
  assert.equal(pick(['ds:5', 1, 2, 0, 0], data), 'PDF·캐드 뷰어(DWG·DXF) - 이음뷰어');
});

test('parseScriptData: 블록이 없으면 빈 객체', () => {
  assert.deepEqual(parseScriptData('<html><body>no data</body></html>'), {});
});

test('htmlToText: <br> 과 엔티티를 텍스트로 바꾼다', () => {
  const text = htmlToText('첫 줄<br>둘째 줄 &quot;인용&quot; &amp; 기호<ul><li>항목</li></ul>');
  assert.match(text, /첫 줄\n둘째 줄 "인용" & 기호/);
  assert.match(text, /• 항목/);
});

test('parseAppDetailsHtml: 이음뷰어 상세 정보를 파싱한다', () => {
  const details = parseAppDetailsHtml(read('details-viewer.html'), 'kr.eumsoft.viewer');
  assert.equal(details.packageId, 'kr.eumsoft.viewer');
  assert.equal(details.title, 'PDF·캐드 뷰어(DWG·DXF) - 이음뷰어');
  assert.equal(details.developer, '이음소프트웨어');
  assert.equal(details.genre, '생산성');
  assert.equal(details.installs, '1+');
  assert.equal(details.minInstalls, 1);
  assert.equal(details.version, '1.4.2');
  assert.equal(details.updatedTs, 1795409955 * 1000);
  assert.match(details.summary ?? '', /DWG·DXF/);
  assert.match(details.description ?? '', /DWG 뷰어/);
  assert.equal(details.score, null, '평점이 없는 앱은 null');
  assert.equal(details.screenshotCount, 2);
  assert.equal(details.priceText, '무료');
});

test('parseAppDetailsHtml: 평점·리뷰가 있는 경쟁 앱', () => {
  const details = parseAppDetailsHtml(read('details-competitor.html'), 'com.alphainventor.filemanager');
  assert.equal(details.title, '파일 관리자');
  assert.equal(details.score, 4.858362);
  assert.equal(details.ratings, 1718333);
  assert.equal(details.reviews, 10024);
  assert.equal(details.installs, '100M+');
  assert.equal(details.genre, '도구');
});

test('parseAppDetailsHtml: 없는 앱은 AppNotFoundError', () => {
  assert.throws(() => parseAppDetailsHtml(read('details-missing.html'), 'kr.eumsoft.nope'), AppNotFoundError);
});

test('parseSearchHtml: 검색 결과 30개를 순서대로 읽는다', () => {
  const page = parseSearchHtml(read('search-filemanager.html'));
  assert.equal(page.results.length, 7);
  assert.equal(page.results[0].packageId, 'com.alphainventor.filemanager');
  assert.equal(page.results[0].title, '파일 관리자');
  assert.equal(page.results[0].developer, 'File Manager Plus');
  assert.equal(page.nextToken, null);
});

test('findAppRank: 패키지명으로 순위를 찾는다', () => {
  const page = parseSearchHtml(read('search-filemanager.html'));
  const ranked = page.results.map((item, index) => ({ ...item, rank: index + 1 }));
  assert.equal(findAppRank(ranked, 'kr.eumsoft.viewer'), 6);
  assert.equal(findAppRank(ranked, 'kr.eumsoft.nothere'), null);
});

test('parseSearchHtml: 다음 페이지 토큰을 읽는다', () => {
  const page = parseSearchHtml(read('search-with-token.html'));
  assert.equal(page.nextToken, 'AO_JYtTOKEN_example_token_value');
  assert.equal(page.results.length, 3);
});

test('parseSearchHtml: 결과가 없으면 빈 배열', () => {
  const page = parseSearchHtml(read('search-empty.html'));
  assert.deepEqual(page.results, []);
});

test('parseDeveloperHtml: 개발자 앱 목록', () => {
  const apps = parseDeveloperHtml(read('developer.html'));
  const ids = apps.map((a) => a.packageId).sort();
  assert.deepEqual(ids, ['kr.eumsoft.docs', 'kr.eumsoft.viewer', 'kr.eumsoft.zip']);
  const docs = apps.find((a) => a.packageId === 'kr.eumsoft.docs');
  assert.equal(docs?.title, '이음과 문서');
});
