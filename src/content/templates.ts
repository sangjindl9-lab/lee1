import { playStoreShareUrl, truncate } from '../util.ts';

export type Channel = 'naver_blog' | 'community' | 'shorts' | 'instagram';

export const CHANNELS: { id: Channel; name: string; description: string }[] = [
  { id: 'naver_blog', name: '네이버 블로그', description: '검색 유입용 제목 5안 + 본문 + 해시태그' },
  { id: 'community', name: '커뮤니티·디스콰이엇', description: '자기소개형 소개글 + 피드백 요청' },
  { id: 'shorts', name: '유튜브 쇼츠', description: '30초 대본 (컷·내레이션·자막)' },
  { id: 'instagram', name: '인스타그램 릴스', description: '15~30초 릴스 캡션·해시태그' },
];

export interface UtmParams {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

/** Play 스토어 링크에 UTM 파라미터를 붙입니다. (Play 는 UTM 을 무시하지만 유입 분석 도구가 읽습니다) */
export function buildUtmLink(packageId: string, params: UtmParams = {}): string {
  const base = playStoreShareUrl(packageId);
  const query = new URLSearchParams();
  query.set('utm_source', params.source ?? 'eum_promo');
  query.set('utm_medium', params.medium ?? 'referral');
  query.set('utm_campaign', params.campaign ?? 'always_on');
  if (params.content) query.set('utm_content', params.content);
  return `${base}&${query.toString()}`;
}

export function defaultUtm(channel: Channel): UtmParams {
  switch (channel) {
    case 'naver_blog':
      return { source: 'naver_blog', medium: 'blog', campaign: 'always_on' };
    case 'community':
      return { source: 'community', medium: 'social', campaign: 'launch' };
    case 'shorts':
      return { source: 'youtube', medium: 'shorts', campaign: 'always_on' };
    case 'instagram':
      return { source: 'instagram', medium: 'reels', campaign: 'always_on' };
  }
}

export function channelLabel(channel: string): string {
  return CHANNELS.find((c) => c.id === channel)?.name ?? channel;
}

export interface ContentAppInput {
  packageId: string;
  name: string;
  title?: string | null;
  summary?: string | null;
  description?: string | null;
  genre?: string | null;
  score?: number | null;
  installs?: string | null;
  developer?: string | null;
}

export interface GenerateInput {
  app: ContentAppInput;
  keywords: string[];
  channel: Channel;
  link: string;
  featureBullets?: string[];
  date?: Date;
  variantSeed?: string;
  brand?: string;
}

export interface GeneratedContent {
  channel: Channel;
  title: string;
  titleOptions: string[];
  bodyMd: string;
  hashtags: string;
  link: string;
  generator: 'template' | 'openai';
  model?: string | null;
  warning?: string | null;
  meta: Record<string, unknown>;
}

const TONE_HOOKS = [
  (kw: string) => `${kw}, 아직도 PC 앞에서 헤매고 계신가요?`,
  (kw: string) => `${kw} 하려고 프로그램부터 찾고 계셨다면 이 글을 끝까지 보세요.`,
  (kw: string) => `현장에서 ${kw} 때문에 막혔던 경험, 한 번쯤 있으실 겁니다.`,
  (kw: string) => `${kw} — 검색은 많이 했는데 정작 쓸 만한 앱을 못 찾으셨다면.`,
];

const CLOSERS = [
  '필요할 때 바로 꺼내 쓰기 좋습니다. 아래 링크에서 설치해 보세요.',
  '한 번 설치해 두면 두고두고 씁니다. 설치 링크는 아래에 있습니다.',
  '지금 설치하고 다음 업무부터 바로 써 보세요.',
];

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pickVariant<T>(items: T[], seed: string, offset = 0): T {
  return items[hashSeed(seed + ':' + offset) % items.length];
}

function appName(app: ContentAppInput): string {
  if (app.name) return app.name;
  const title = app.title ?? app.packageId;
  return title.includes(' - ') ? title.split(' - ').slice(1).join(' - ') : title;
}

function shortTitle(app: ContentAppInput): string {
  const title = app.title ?? app.name;
  return truncate(title, 30);
}

function bulletList(items: string[], limit: number): string[] {
  return items.map((item) => item.replace(/^[•·\-*▪]\s*/, '').trim()).filter(Boolean).slice(0, limit);
}

function fallbackFeatures(app: ContentAppInput): string[] {
  const summary = app.summary?.trim();
  const features: string[] = [];
  if (summary) features.push(summary);
  if (app.genre) features.push(`${app.genre} 카테고리에서 필요한 기능만 담았습니다.`);
  features.push('광고 없이 필요한 기능만 사용할 수 있습니다.');
  features.push('설치는 Play 스토어에서 한 번이면 끝납니다.');
  return features;
}

export function buildHashtags(app: ContentAppInput, keywords: string[], limit = 12): string {
  const name = appName(app).replace(/\s+/g, '');
  const tags = new Set<string>([name]);
  for (const keyword of keywords) {
    const compact = keyword.replace(/\s+/g, '');
    if (compact.length >= 2) tags.add(compact);
  }
  if (app.genre) tags.add(app.genre.replace(/\s+/g, '') + '앱');
  tags.add('앱추천');
  tags.add('안드로이드앱');
  tags.add('무료앱');
  return [...tags]
    .slice(0, limit)
    .map((tag) => `#${tag}`)
    .join(' ');
}

function blogTitles(app: ContentAppInput, keywords: string[], seed: string): string[] {
  const name = appName(app);
  const primary = keywords[0] ?? app.genre ?? '업무 앱';
  const second = keywords[1] ?? keywords[0] ?? '모바일';
  const benefit = app.summary ? truncate(app.summary.split(/[.。]/)[0].trim(), 34) : '스마트폰으로 바로 처리';
  const templates = [
    `${primary} 앱 추천 — ${name}로 3분 만에 끝내는 방법`,
    `${primary} 어떻게 하지? ${name} 하나면 충분합니다`,
    `스마트폰으로 ${primary} 하는 법 (${name} 사용 후기)`,
    `${second} 필요한 분께 — ${name} 설치 전에 꼭 보세요`,
    `${name} 써봤습니다: ${benefit}`,
    `${primary} 무료 앱 비교해보고 ${name}로 정한 이유`,
  ];
  const start = hashSeed(seed) % templates.length;
  const ordered = [...templates.slice(start), ...templates.slice(0, start)];
  return ordered.slice(0, 5).map((t) => truncate(t, 60));
}

function blogBody(input: GenerateInput): { title: string; body: string; titles: string[] } {
  const { app, keywords, link } = input;
  const name = appName(app);
  const seed = input.variantSeed ?? `${app.packageId}:${new Date().toISOString().slice(0, 10)}`;
  const titles = blogTitles(app, keywords, seed);
  const primary = keywords[0] ?? app.genre ?? '이 기능';
  const secondary = keywords.slice(1, 4);
  const features = bulletList(input.featureBullets ?? [], 5);
  const featureLines = (features.length >= 3 ? features : fallbackFeatures(app)).slice(0, 5);
  const hook = pickVariant(TONE_HOOKS, seed, 1)(primary);
  const closer = pickVariant(CLOSERS, seed, 2);
  const scoreLine =
    app.score && app.installs
      ? `Play 스토어 평점 ${app.score.toFixed(1)}점, 설치 ${app.installs}을 기록 중입니다.`
      : 'Play 스토어에서 무료로 설치할 수 있습니다.';

  const body = [
    `${hook}`,
    '',
    `업무 중에 ${primary}이(가) 급하게 필요할 때, PC를 켜거나 다른 사람에게 부탁하는 대신 스마트폰에서 바로 처리할 수 있다면 어떨까요. **${name}**는 ${app.summary ? app.summary.replace(/\n/g, ' ') : `${primary}을(를) 위한 안드로이드 앱`} ${secondary.length ? `특히 ${secondary.join(', ')} 상황에서 유용합니다.` : ''}`,
    '',
    `## ${primary}, 왜 번거로웠을까`,
    '',
    `- 프로그램을 설치하려면 PC가 필요합니다.`,
    `- 파일을 옮기고 다시 열어 확인하는 과정이 길어집니다.`,
    `- 급할 때는 어떤 앱을 써야 할지 매번 검색하게 됩니다.`,
    '',
    `## ${name}가 하는 일`,
    '',
    ...featureLines.map((line) => `- ${line}`),
    '',
    `## 실제 사용 순서`,
    '',
    `1. Play 스토어에서 **${name}**를 설치합니다.`,
    `2. 카카오톡·메일·파일 관리자에서 받은 파일을 앱으로 엽니다.`,
    `3. 필요한 작업을 마치고 그대로 저장하거나 공유합니다.`,
    '',
    `## 자주 묻는 질문`,
    '',
    `**Q. 무료인가요?**  \nA. 네, 무료로 설치해 사용할 수 있습니다. ${scoreLine}`,
    '',
    `**Q. 회원가입이 필요한가요?**  \nA. 별도 가입 없이 바로 사용할 수 있습니다. 개인정보를 수집하지 않습니다.`,
    '',
    `**Q. 인터넷이 없어도 되나요?**  \nA. 파일 처리는 기기 안에서 이루어지므로 오프라인에서도 대부분의 기능을 쓸 수 있습니다.`,
    '',
    `## 설치 링크`,
    '',
    `[${name} Play 스토어에서 받기](${link})`,
    '',
    closer,
    '',
    '---',
    '',
    `**같이 쓸 수 있는 제목 후보**`,
    ...titles.map((t, index) => `${index + 1}. ${t}`),
  ].join('\n');

  return { title: titles[0], body, titles };
}

function communityBody(input: GenerateInput): { title: string; body: string } {
  const { app, keywords, link } = input;
  const name = appName(app);
  const primary = keywords[0] ?? app.genre ?? '이 기능';
  const features = bulletList(input.featureBullets ?? [], 4);
  const featureLines = (features.length >= 2 ? features : fallbackFeatures(app)).slice(0, 4);
  const seed = input.variantSeed ?? app.packageId;
  const opens = [
    `안녕하세요, ${name}를 직접 만들어 배포하고 있는 개발자입니다.`,
    `오랜만에 앱 하나 소개하러 왔습니다. ${name}입니다.`,
    `회사에서 ${primary} 업무 때문에 만든 앱이 있는데, 반응이 좋아서 공유합니다.`,
  ];

  const title = truncate(`[직접 만든 앱] ${name} — ${primary} 스마트폰에서 바로 처리`, 70);
  const body = [
    `※ 직접 만든 앱을 소개하는 글입니다.`,
    '',
    pickVariant(opens, seed, 3),
    '',
    `**만든 이유**`,
    `${primary} 하려고 매번 PC를 켜는 게 번거로워서, 스마트폰에서 바로 되는 앱이 있으면 좋겠다 싶었습니다. 기능을 욕심내지 않고 자주 쓰는 것만 넣었습니다.`,
    '',
    `**지금 되는 것**`,
    ...featureLines.map((line) => `- ${line}`),
    '',
    `**이런 분께 맞습니다**`,
    `- ${primary}이(가) 자주 필요한 분`,
    `- 프로그램 설치 없이 바로 확인하고 싶은 분`,
    `- 광고·회원가입 없는 앱을 찾는 분`,
    '',
    `**솔직한 한계**`,
    `- 대용량 파일은 기기 성능에 따라 느릴 수 있습니다.`,
    `- 아직 모든 형식을 지원하지는 않습니다.`,
    '',
    `**링크**  `,
    `${link}`,
    '',
    `써보시고 불편한 점 있으면 댓글로 알려주세요. 다음 업데이트에 반영하겠습니다.`,
  ].join('\n');

  return { title, body };
}

function shortsScript(input: GenerateInput): { title: string; body: string } {
  const { app, keywords, link } = input;
  const name = appName(app);
  const primary = keywords[0] ?? app.genre ?? '이 기능';
  const features = bulletList(input.featureBullets ?? [], 3);
  const demo = (features.length >= 2 ? features : fallbackFeatures(app)).slice(0, 3);

  const title = truncate(`${primary}, 폰으로 3초 만에 끝내는 법 #shorts`, 60);
  const body = [
    `# 30초 쇼츠 대본 — ${name}`,
    '',
    `**영상 제목 후보**`,
    `1. ${truncate(`${primary} 폰으로 3초 만에 끝내기 #shorts`, 55)}`,
    `2. ${truncate(`이거 몰라서 ${primary}에 시간 버렸습니다 #shorts`, 55)}`,
    `3. ${truncate(`${name} 하나면 ${primary} 끝 #shorts`, 55)}`,
    '',
    `| 구간 | 화면(컷) | 내레이션 | 자막 |
| --- | --- | --- | --- |
| 00:00–00:03 | ${name} 실행 화면 클로즈업 | "${primary}, 아직 PC로 하세요?" | ${primary} 아직 PC로? |
| 00:03–00:08 | 파일 목록에서 파일을 누르는 손 | "카톡으로 받은 파일, 열려고 하면 막히죠." | 카톡 파일 안 열릴 때 |
| 00:08–00:14 | ${demo[0] ? truncate(demo[0], 24) : '핵심 기능 사용 장면'} | "${demo[0] ? truncate(demo[0], 40) : '필요한 기능만 바로 씁니다.'}" | ① ${truncate(demo[0] ?? '핵심 기능', 16)} |
| 00:14–00:20 | ${demo[1] ? truncate(demo[1], 24) : '두 번째 기능'} | "${demo[1] ? truncate(demo[1], 40) : '군더더기 없이 바로 됩니다.'}" | ② ${truncate(demo[1] ?? '두 번째 기능', 16)} |
| 00:20–00:27 | 결과 화면, 손가락으로 확인 | "저장하고 바로 공유하면 끝." | ③ 저장 · 공유까지 |
| 00:27–00:30 | 앱 아이콘 + 설치 화면 | "무료니까 지금 받아두세요." | 프로필 링크에서 설치 |`,
    '',
    `**내레이션 대본 (그대로 읽기)**`,
    `"${primary}, 아직 PC로 하세요? 카톡으로 받은 파일, 열려고 하면 막히죠. ${name}는 스마트폰에서 바로 열고, ${truncate(demo[0] ?? '필요한 기능', 20)}까지 한 번에 됩니다. 저장하고 공유하면 끝. 무료니까 지금 받아두세요."`,
    '',
    `**촬영 팁**`,
    `- 첫 3초에 결과 화면을 먼저 보여주면 이탈이 줄어듭니다.`,
    `- 화면 녹화는 1080×1920 세로, 손가락이 화면을 가리지 않게 아래쪽에서 조작하세요.`,
    `- 자막은 화면 위쪽 1/3에 크게, 한 줄 12자 이내로 넣습니다.`,
    '',
    `**설명란**`,
    `${name} — ${app.summary ? truncate(app.summary, 60) : primary}  `,
    `${link}`,
    `#${appName(app).replace(/\s+/g, '')} #${primary.replace(/\s+/g, '')} #앱추천 #shorts`,
  ].join('\n');

  return { title, body };
}

function instagramBody(input: GenerateInput): { title: string; body: string } {
  const { app, keywords, link } = input;
  const name = appName(app);
  const primary = keywords[0] ?? app.genre ?? '이 기능';
  const features = bulletList(input.featureBullets ?? [], 3);

  const title = truncate(`${primary}, 이제 폰으로 끝냅니다`, 40);
  const body = [
    `# 릴스 30초 구성 — ${name}`,
    '',
    `**컷 구성**`,
    `1. (0–3초) 결과 화면부터 보여주기 — "이거 폰으로 되는 거 알고 계셨나요?"`,
    `2. (3–9초) 문제 장면 — 노트북 켜고 파일 찾는 모습, 흐릿하게 처리`,
    `3. (9–18초) 앱 화면 시연 2컷 — ${features[0] ?? primary}, ${features[1] ?? '저장과 공유'}`,
    `4. (18–25초) 결과 강조 — 완성된 화면 클로즈업`,
    `5. (25–30초) 앱 아이콘 + "프로필 링크" 자막`,
    '',
    `**캡션 (그대로 올리기)**`,
    `${primary} 때문에 매번 PC 앞에 앉아 계셨다면, 이 앱 하나로 정리됩니다.`,
    `· ${features[0] ?? '필요한 기능만 담았습니다'}`,
    `· ${features[1] ?? '저장과 공유까지 한 번에'}`,
    `· 광고 없이 무료`,
    ``,
    `프로필 링크에서 ${name} 설치하세요.`,
    `${link}`,
    '',
    `**해시태그 (15개)**`,
    `#${appName(app).replace(/\s+/g, '')} #${primary.replace(/\s+/g, '')} #앱추천 #무료앱 #안드로이드앱 #업무꿀팁 #직장인꿀팁 #생산성앱 #모바일앱 #신규앱 #앱스토어 #릴스 #reels #앱소개 #스마트폰활용`,
  ].join('\n');

  return { title, body };
}

/** 템플릿 엔진 기반 한국어 홍보 글 생성 (API 키 없이도 동작) */
export function generateTemplateContent(input: GenerateInput): GeneratedContent {
  const base = {
    channel: input.channel,
    link: input.link,
    hashtags: buildHashtags(input.app, input.keywords, input.channel === 'instagram' ? 15 : 10),
    generator: 'template' as const,
    model: null,
    warning: null,
    meta: {
      appName: appName(input.app),
      primaryKeyword: input.keywords[0] ?? null,
      keywords: input.keywords,
      packageId: input.app.packageId,
      generatedAt: new Date().toISOString(),
    },
  };

  switch (input.channel) {
    case 'naver_blog': {
      const { title, body, titles } = blogBody(input);
      return { ...base, title, titleOptions: titles, bodyMd: body };
    }
    case 'community': {
      const { title, body } = communityBody(input);
      return { ...base, title, titleOptions: [title], bodyMd: body };
    }
    case 'shorts': {
      const { title, body } = shortsScript(input);
      return { ...base, title, titleOptions: [title], bodyMd: body };
    }
    case 'instagram': {
      const { title, body } = instagramBody(input);
      return { ...base, title, titleOptions: [title], bodyMd: body };
    }
    default: {
      const { title, body } = blogBody(input);
      return { ...base, title, titleOptions: [title], bodyMd: body };
    }
  }
}

export function shortTitleFor(app: ContentAppInput): string {
  return shortTitle(app);
}
