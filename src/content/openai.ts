import type { Channel, GenerateInput, GeneratedContent } from './templates.ts';
import { buildHashtags, channelLabel, generateTemplateContent } from './templates.ts';

export interface AiOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface AiResult {
  content: GeneratedContent;
  warning: string | null;
}

const CHANNEL_BRIEF: Record<Channel, string> = {
  naver_blog: `네이버 블로그 포스팅. 검색 유입을 노리는 정보성 글.
- 제목 후보 5개(각 60자 이내, 핵심 키워드를 앞쪽에)
- 본문: 인트로(키워드를 첫 두 문장에), 문제 제기 3가지, 앱이 해결하는 방식(불릿), 사용 순서 3단계, FAQ 3개, 설치 링크 CTA
- 마크다운(##, -, 1.) 사용, 과장·최상급 표현 금지, 실제 기능만 언급`,
  community: `커뮤니티(디스콰이엇·클리앙) 자기소개형 글.
- 첫 줄에 직접 만든 앱이라는 사실을 밝힘(광고 표시)
- 만든 이유, 지금 되는 것, 맞는 사람, 솔직한 한계, 링크, 피드백 요청
- 마케팅 문체 대신 담백한 개발자 말투, 이모지 최소화`,
  shorts: `유튜브 쇼츠 30초 대본.
- 0-3초 훅, 3-8초 문제, 8-20초 시연 3컷, 20-27초 결과, 27-30초 CTA
- 표로 구간/화면/내레이션/자막 정리, 이어서 읽는 내레이션 전문, 촬영 팁, 설명란, 해시태그`,
  instagram: `인스타그램 릴스 30초 구성 + 캡션.
- 5컷 구성(시간 표기), 캡션(줄바꿈 포함, 첫 문장 훅), 해시태그 15개`,
};

function buildPrompt(input: GenerateInput): { system: string; user: string } {
  const app = input.app;
  const system = [
    '너는 한국 스타트업의 앱 마케팅을 돕는 카피라이터다.',
    '사실과 다른 기능, 없는 수상·후기·순위를 절대 만들지 않는다.',
    'Play 스토어 정책상 금지되는 표현(타사 상호, 최고·1위 보장, 과장된 효능)을 쓰지 않는다.',
    '자연스러운 한국어로, 번역투 없이 쓴다.',
    '결과는 JSON 으로만 답한다: {"title": string, "titleOptions": string[], "bodyMarkdown": string, "hashtags": string}.',
  ].join(' ');

  const user = [
    `채널: ${channelLabel(input.channel)}`,
    CHANNEL_BRIEF[input.channel],
    '',
    '[앱 정보]',
    `- 패키지: ${app.packageId}`,
    `- 이름: ${app.name}`,
    `- 스토어 제목: ${app.title ?? app.name}`,
    `- 한 줄 소개: ${app.summary ?? '(없음)'}`,
    `- 카테고리: ${app.genre ?? '(없음)'}`,
    `- 평점: ${app.score ?? '(없음)'}`,
    `- 설치: ${app.installs ?? '(없음)'}`,
    `- 스토어 설명 발췌: ${(app.description ?? '').slice(0, 1200)}`,
    '',
    `[강조할 키워드] ${input.keywords.join(', ') || '(없음)'}`,
    `[핵심 기능] ${(input.featureBullets ?? []).slice(0, 6).join(' / ') || '(설명 참고)'}`,
    `[설치 링크(그대로 사용)] ${input.link}`,
    `[브랜드] ${input.brand ?? app.developer ?? ''}`,
    '',
    '본문은 마크다운으로, 설치 링크를 본문 안에 한 번 이상 그대로 넣어라.',
    'hashtags 는 "#태그 #태그" 형태 한 줄로.',
  ].join('\n');

  return { system, user };
}

function extractJson(raw: string): { title?: string; titleOptions?: string[]; bodyMarkdown?: string; hashtags?: string } {
  const trimmed = raw.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}

/**
 * OpenAI 로 홍보 글을 고도화합니다. 실패하면 템플릿 결과를 그대로 돌려주고 경고를 남깁니다.
 */
export async function generateWithAi(input: GenerateInput, options: AiOptions): Promise<AiResult> {
  const fallback = generateTemplateContent(input);
  if (!options.apiKey) return { content: fallback, warning: 'OpenAI API 키가 없어 템플릿으로 생성했습니다.' };

  const { system, user } = buildPrompt(input);
  const baseUrl = options.baseUrl ?? 'https://api.openai.com/v1/chat/completions';
  try {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model ?? 'gpt-4o-mini',
        temperature: 0.85,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 45_000),
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        content: { ...fallback, warning: `OpenAI 응답 오류(${res.status})로 템플릿을 사용했습니다.` },
        warning: `OpenAI 응답 오류 ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? '';
    const parsed = extractJson(raw);
    if (!parsed.bodyMarkdown || !parsed.title) {
      return {
        content: { ...fallback, warning: 'OpenAI 응답을 해석하지 못해 템플릿을 사용했습니다.' },
        warning: 'OpenAI 응답 형식이 예상과 달랐습니다.',
      };
    }
    return {
      content: {
        channel: input.channel,
        title: parsed.title,
        titleOptions: parsed.titleOptions?.length ? parsed.titleOptions : [parsed.title],
        bodyMd: parsed.bodyMarkdown,
        hashtags: parsed.hashtags || buildHashtags(input.app, input.keywords),
        link: input.link,
        generator: 'openai',
        model: options.model ?? 'gpt-4o-mini',
        warning: null,
        meta: {
          appName: input.app.name,
          keywords: input.keywords,
          packageId: input.app.packageId,
          generatedAt: new Date().toISOString(),
        },
      },
      warning: null,
    };
  } catch (err) {
    return {
      content: { ...fallback, warning: 'OpenAI 호출에 실패해 템플릿을 사용했습니다.' },
      warning: err instanceof Error ? err.message : String(err),
    };
  }
}
