import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markdownToHtml, markdownToPlainText } from '../src/content/markdown.ts';
import { generateWithAi } from '../src/content/openai.ts';
import {
  CHANNELS,
  buildHashtags,
  buildUtmLink,
  defaultUtm,
  generateTemplateContent,
  type Channel,
  type GenerateInput,
} from '../src/content/templates.ts';

const app = {
  packageId: 'kr.eumsoft.viewer',
  name: '이음뷰어',
  title: 'PDF·캐드 뷰어(DWG·DXF) - 이음뷰어',
  summary: '현장에서 받은 DWG·DXF 도면을 휴대폰으로 열고 치수·면적을 확인하세요.',
  description: 'DWG 뷰어\n• 레이어 켜고 끄기\n• 거리·면적 측정\n• PDF 편집',
  genre: '생산성',
  score: 4.6,
  installs: '1천+',
  developer: '이음소프트웨어',
};

function inputFor(channel: Channel): GenerateInput {
  return {
    app,
    keywords: ['DWG 뷰어', 'PDF 뷰어', '도면 뷰어'],
    channel,
    link: buildUtmLink(app.packageId, defaultUtm(channel)),
    featureBullets: ['레이어 켜고 끄기', '거리·면적 측정', 'PDF 편집'],
    variantSeed: 'test-seed',
  };
}

test('buildUtmLink: Play 링크에 UTM 을 붙인다', () => {
  const link = buildUtmLink('kr.eumsoft.viewer', { source: 'naver_blog', medium: 'blog', campaign: 'launch', content: 'post1' });
  assert.ok(link.startsWith('https://play.google.com/store/apps/details?id=kr.eumsoft.viewer&'));
  const url = new URL(link);
  assert.equal(url.searchParams.get('utm_source'), 'naver_blog');
  assert.equal(url.searchParams.get('utm_medium'), 'blog');
  assert.equal(url.searchParams.get('utm_campaign'), 'launch');
  assert.equal(url.searchParams.get('utm_content'), 'post1');
});

test('buildHashtags: 앱 이름과 키워드를 태그로', () => {
  const tags = buildHashtags(app, ['DWG 뷰어', 'PDF 뷰어']);
  assert.match(tags, /#이음뷰어/);
  assert.match(tags, /#DWG뷰어/);
  assert.ok(tags.split(' ').length <= 12);
});

test('모든 채널의 템플릿 글이 앱 이름·링크·키워드를 포함한다', () => {
  for (const channel of CHANNELS) {
    const content = generateTemplateContent(inputFor(channel.id));
    assert.equal(content.channel, channel.id);
    assert.ok(content.title.length > 0, `${channel.id} 제목`);
    assert.match(content.bodyMd, /이음뷰어/, `${channel.id} 앱 이름`);
    assert.ok(content.bodyMd.includes('utm_source='), `${channel.id} UTM 링크`);
    assert.ok(content.bodyMd.includes('DWG 뷰어'), `${channel.id} 키워드`);
    assert.ok(content.hashtags.startsWith('#'), `${channel.id} 해시태그`);
    assert.equal(content.generator, 'template');
  }
});

test('블로그: 제목 5안과 본문 구조(문제·기능·순서·FAQ)', () => {
  const content = generateTemplateContent(inputFor('naver_blog'));
  assert.equal(content.titleOptions.length, 5);
  assert.match(content.bodyMd, /## .*왜 번거로웠을까/);
  assert.match(content.bodyMd, /## 실제 사용 순서/);
  assert.match(content.bodyMd, /## 자주 묻는 질문/);
  assert.match(content.bodyMd, /같이 쓸 수 있는 제목 후보/);
  const firstLine = content.bodyMd.split('\n')[0];
  assert.match(firstLine, /DWG 뷰어/, '도입 첫 줄에 핵심 키워드');
});

test('커뮤니티: 광고 표시와 피드백 요청', () => {
  const content = generateTemplateContent(inputFor('community'));
  assert.match(content.bodyMd, /직접 만든 앱/);
  assert.match(content.bodyMd, /댓글로 알려주세요/);
  assert.match(content.bodyMd, /솔직한 한계/);
});

test('쇼츠: 30초 타임코드 대본과 표', () => {
  const content = generateTemplateContent(inputFor('shorts'));
  assert.match(content.bodyMd, /00:00–00:03/);
  assert.match(content.bodyMd, /00:27–00:30/);
  assert.match(content.bodyMd, /\| 구간 \| 화면\(컷\) \| 내레이션 \| 자막 \|/);
  assert.match(content.bodyMd, /내레이션 대본/);
});

test('인스타: 5컷 구성과 해시태그 15개', () => {
  const content = generateTemplateContent(inputFor('instagram'));
  assert.match(content.bodyMd, /5컷|5\. \(25–30초\)/);
  const tagLine = content.bodyMd.split('\n').filter((line) => line.startsWith('#')).pop();
  assert.ok(tagLine);
  assert.ok(tagLine.split(' ').filter((tag) => tag.startsWith('#')).length >= 15);
  assert.ok(content.bodyMd.includes('(25–30초)'));
});

test('같은 seed 는 같은 결과, 다른 seed 는 다른 도입부', () => {
  const a = generateTemplateContent({ ...inputFor('naver_blog'), variantSeed: 'same' });
  const b = generateTemplateContent({ ...inputFor('naver_blog'), variantSeed: 'same' });
  assert.equal(a.bodyMd, b.bodyMd);
});

test('markdownToHtml: 제목·불릿·링크·굵게', () => {
  const html = markdownToHtml('## 소제목\n\n- 항목 **하나**\n- 항목 [링크](https://play.google.com/store/apps/details?id=kr.eumsoft.viewer)\n\n1. 첫째\n2. 둘째');
  assert.match(html, /<h2>소제목<\/h2>/);
  assert.match(html, /<li>항목 <strong>하나<\/strong><\/li>/);
  assert.match(html, /<a href="https:\/\/play.google.com/);
  assert.match(html, /<ol>/);
});

test('markdownToHtml: HTML 을 이스케이프한다', () => {
  const html = markdownToHtml('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('markdownToPlainText: 마크다운 기호 제거', () => {
  const text = markdownToPlainText('## 제목\n- 항목 **강조**\n[링크](https://a.bc)');
  assert.ok(!text.includes('##'));
  assert.match(text, /항목 강조/);
  assert.match(text, /링크 \(https:\/\/a.bc\)/);
});

test('generateWithAi: 키가 없으면 템플릿 + 경고', async () => {
  const result = await generateWithAi(inputFor('naver_blog'), { apiKey: '' });
  assert.equal(result.content.generator, 'template');
  assert.match(result.warning ?? '', /API 키/);
});

test('generateWithAi: OpenAI 응답을 파싱한다', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'AI 제목',
                titleOptions: ['AI 제목', 'AI 제목 2'],
                bodyMarkdown: '## 본문\n\nAI 가 쓴 본문입니다. https://play.google.com/store/apps/details?id=kr.eumsoft.viewer?utm_source=test',
                hashtags: '#이음뷰어 #DWG',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
  try {
    const result = await generateWithAi(inputFor('naver_blog'), { apiKey: 'sk-test' });
    assert.equal(result.content.generator, 'openai');
    assert.equal(result.content.title, 'AI 제목');
    assert.equal(result.content.model, 'gpt-4o-mini');
  } finally {
    globalThis.fetch = original;
  }
});

test('generateWithAi: API 오류면 템플릿으로 폴백', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('quota exceeded', { status: 429 })) as typeof fetch;
  try {
    const result = await generateWithAi(inputFor('community'), { apiKey: 'sk-test' });
    assert.equal(result.content.generator, 'template');
    assert.match(result.warning ?? '', /429/);
  } finally {
    globalThis.fetch = original;
  }
});
