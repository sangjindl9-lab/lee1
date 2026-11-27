/** 앱 정보 → 유튜브 쇼츠 대본(15~25초, 5씬) 생성 */
import type { AppRow, AppSnapshotRow } from '../db.ts';
import { seededPick } from '../util.ts';
import type { Mood, Scene, SceneStat, ShortScript } from './types.ts';

interface AppProfile {
  name: string;
  category: string;
  hook: string[];
  problem: string[];
  solution: string;
  features: string[];
  stats: SceneStat[];
  cta: string;
  thumb: string;
  hashtag: string;
}

/** 이음소프트웨어 앱은 실측 정보를 그대로 쓰고, 그 밖의 앱은 키워드로 일반 대본을 만든다. */
const CURATED: Record<string, AppProfile> = {
  'kr.eumsoft.viewer': {
    name: '이음뷰어',
    category: 'PDF·캐드 뷰어',
    hook: ['도면 열려고\nPC 켰던 적 있나요?', '현장에서 받은 DWG,\n폰에서 안 열리죠?'],
    problem: ['카톡으로 받은 도면을\n보려고 노트북을\n또 꺼냈습니다', 'PDF·DWG·DXF\n포맷마다 앱을\n따로 깔았죠'],
    solution: '이음뷰어 하나면\n바로 열립니다',
    features: ['PDF·DWG·DXF 한 번에', '확대해도 선명한 도면', 'PC 없이 현장에서 확인'],
    stats: [
      { value: '0.5초', label: '파일 열기' },
      { value: '3종', label: '도면 포맷' },
      { value: '무료', label: '설치 비용' },
    ],
    cta: '지금 무료로\n설치하세요',
    thumb: '도면, 폰에서 바로',
    hashtag: 'DWG뷰어',
  },
  'kr.eumsoft.zip': {
    name: '이음ZIP',
    category: '압축 파일 관리',
    hook: ['받은 압축 파일,\n열지 못해 막힌 적?', 'ZIP 하나 때문에\n앱을 또 깔았죠?'],
    problem: ['ZIP·RAR·7Z\n포맷마다 열리는\n앱이 다릅니다', '비밀번호 걸린 압축,\n폰에서는\n열리지도 않죠'],
    solution: '이음ZIP 하나로\n전부 풀립니다',
    features: ['ZIP·RAR·7Z 모두 지원', '비밀번호 압축도 해제', '대용량 파일도 빠르게'],
    stats: [
      { value: '1개', label: '앱으로 정리' },
      { value: '7Z', label: '최신 포맷' },
      { value: '무료', label: '기본 기능' },
    ],
    cta: '지금 무료로\n설치하세요',
    thumb: '압축, 한 번에 풀기',
    hashtag: '압축풀기',
  },
  'kr.eumsoft.docs': {
    name: '이음과 문서',
    category: '문서 작성·관리',
    hook: ['회사 양식 문서,\n폰에서 못 고쳤죠?', '한글 문서 수정하려고\n노트북 또 열었나요?'],
    problem: ['문서 하나 고치려고\nPC방을 찾거나\n출근하길 기다렸죠', '보낸 문서가 깨져서\n다시 쓰는 일,\n익숙하시죠'],
    solution: '이음과 문서로\n폰에서 바로',
    features: ['한글 문서 작성·편집', 'PDF로 바로 저장', '양식 서식 그대로 유지'],
    stats: [
      { value: '모바일', label: '문서 편집' },
      { value: 'PDF', label: '즉시 변환' },
      { value: '무료', label: '시작 비용' },
    ],
    cta: '지금 무료로\n설치하세요',
    thumb: '문서, 폰에서 끝내기',
    hashtag: '문서편집',
  },
};

function genericProfile(app: AppRow, keywords: string[], snapshot: AppSnapshotRow | null): AppProfile {
  const name = app.label || snapshot?.title || app.package_id.split('.').pop() || '이음 앱';
  const note = app.notes ?? snapshot?.summary ?? '';
  const category = note.split('—')[0]?.trim() || snapshot?.genre || '모바일 앱';
  const mainKeyword = keywords[0] ?? category;
  const features =
    keywords.length > 0
      ? [
          `${keywords[0]} 바로 실행`,
          keywords[1] ? `${keywords[1]} 지원` : '필요할 때 즉시 실행',
          keywords[2] ? `${keywords[2]}까지 한 번에` : '가볍고 빠른 동작',
        ]
      : [`${category} 한 번에`, '설치 후 바로 사용', '가볍고 빠른 실행'];
  return {
    name,
    category,
    hook: [`${mainKeyword} 때문에\n매번 막혔죠?`, `${mainKeyword},\n아직도 이렇게 하세요?`],
    problem: [`${mainKeyword} 하려고\n앱을 찾아 헤매고\n결국 포기했습니다`, `번거로운 절차 때문에\n할 일이 밀렸죠`],
    solution: `${name} 하나면\n한 번에 끝납니다`,
    features,
    stats: [
      { value: '1분', label: '설치 시간' },
      { value: '무료', label: '이용 요금' },
      { value: '즉시', label: '시작 가능' },
    ],
    cta: '지금 무료로\n설치하세요',
    thumb: `${mainKeyword}, 지금 시작`,
    hashtag: mainKeyword.replace(/\s+/g, ''),
  };
}

export function profileFor(app: AppRow, keywords: string[], snapshot: AppSnapshotRow | null): AppProfile {
  return CURATED[app.package_id] ?? genericProfile(app, keywords, snapshot);
}

function clip(text: string, max: number): string {
  return [...text].length <= max ? text : [...text].slice(0, max - 1).join('') + '…';
}

export interface ScriptInput {
  app: AppRow;
  snapshot: AppSnapshotRow | null;
  keywords: string[];
  mood: Mood;
  seed?: string;
}

export function buildShortScript(input: ScriptInput): ShortScript {
  const { app, snapshot, keywords, mood } = input;
  const seed = input.seed ?? `${app.package_id}-${Date.now()}`;
  const profile = profileFor(app, keywords, snapshot);
  const name = profile.name;
  const kw = keywords.filter(Boolean);
  const primary = kw[0] ?? profile.category;
  const warnings: string[] = [];
  if (!snapshot?.icon) warnings.push('스토어 아이콘 정보를 DB에서 찾지 못했습니다. 필요 시 Play에서 직접 내려받습니다.');

  const hookPick = seededPick(profile.hook, `${seed}-hook`);
  const problemPick = seededPick(profile.problem, `${seed}-problem`);
  const [f1, f2, f3] = profile.features;
  const [s1, s2, s3] = profile.stats;

  const scenes: Scene[] = [
    {
      index: 1,
      role: 'hook',
      kicker: `EUM · ${clip(profile.category, 18)}`,
      headline: hookPick,
      sub: `${name} · 15초 요약`,
      bullets: [],
      stats: [],
      badge: '',
      narration: `${primary}, 아직도 막히시나요?`,
      duration: 0,
    },
    {
      index: 2,
      role: 'problem',
      kicker: 'PROBLEM',
      headline: problemPick,
      sub: '매번 반복되는 이 과정',
      bullets: [],
      stats: [],
      badge: 'BEFORE',
      narration: '파일은 안 열리고, 앱은 따로따로.',
      duration: 0,
    },
    {
      index: 3,
      role: 'solution',
      kicker: 'SOLUTION',
      headline: profile.solution,
      sub: `${name} 하나로 정리 끝`,
      bullets: [f1, f2, f3].filter(Boolean),
      stats: [],
      badge: 'AFTER',
      narration: `${name} 하나면 끝납니다.`,
      duration: 0,
    },
    {
      index: 4,
      role: 'proof',
      kicker: 'WHY EUM',
      headline: '숫자로 보는 이유',
      sub: '',
      bullets: [],
      stats: [s1, s2, s3].filter(Boolean),
      badge: '',
      narration: '설치는 1분, 비용은 무료입니다.',
      duration: 0,
    },
    {
      index: 5,
      role: 'cta',
      kicker: 'DOWNLOAD',
      headline: profile.cta,
      sub: kw.slice(0, 3).join(' · ') || primary,
      bullets: [],
      stats: [],
      badge: 'PLAY STORE',
      narration: '지금 Play 스토어에서 받으세요.',
      duration: 0,
    },
  ];

  const titleCore = seededPick(
    [
      `${profile.thumb} | ${name}`,
      `${primary} 이걸로 끝 | ${name}`,
      `${name} 하나면 충분합니다 | ${primary}`,
    ],
    `${seed}-title`,
  );
  const title = clip(`${titleCore} #Shorts`, 100);

  const tagSet = new Set<string>(['Shorts', '이음소프트웨어', '앱추천', profile.hashtag]);
  for (const term of kw.slice(0, 3)) tagSet.add(term.replace(/\s+/g, ''));
  const hashtags = [...tagSet].filter(Boolean).map((tag) => `#${tag}`);

  const description = [
    `${profile.thumb} — ${name}`,
    '',
    `${name}은(는) ${profile.category} 앱입니다.`,
    `${f1}, ${f2}까지 한 번에 해결하세요.`,
    '',
    `▶ Play 스토어에서 무료로 설치하기`,
    app.store_url,
    '',
    hashtags.join(' '),
  ].join('\n');

  return {
    packageId: app.package_id,
    appName: name,
    mood,
    scenes,
    title,
    description,
    hashtags,
    keywords: kw.slice(0, 4),
    generator: 'template',
    warnings,
  };
}

/** OpenAI로 대본을 다듬습니다. 실패하면 원본 대본을 그대로 돌려줍니다. */
export async function refineScriptWithAi(
  script: ShortScript,
  apiKey: string,
  model: string,
  timeoutMs = 25_000,
): Promise<{ script: ShortScript; ok: boolean; error: string | null }> {
  const prompt = {
    role: 'system' as const,
    content:
      '너는 한국어 유튜브 쇼츠 카피라이터다. 주어진 5개 씬 대본을 15~25초 숏폼에 맞게 더 강한 훅과 짧은 문장으로 다듬는다. ' +
      '각 씬 headline은 최대 2줄, 줄당 12자 이내, narration은 25자 이내로 쓴다. JSON만 출력한다.',
  };
  const user = {
    role: 'user' as const,
    content: JSON.stringify({
      app: script.appName,
      title: script.title,
      scenes: script.scenes.map((s) => ({ role: s.role, headline: s.headline, sub: s.sub, narration: s.narration })),
      output: { scenes: [{ headline: 'string', sub: 'string', narration: 'string' }], title: 'string', description: 'string' },
    }),
  };
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [prompt, user],
        temperature: 0.8,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text();
      return { script, ok: false, error: `OpenAI ${res.status}: ${clip(text, 120)}` };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as {
      scenes?: { headline?: string; sub?: string; narration?: string }[];
      title?: string;
      description?: string;
    };
    const refined = parsed.scenes ?? [];
    if (refined.length !== script.scenes.length) {
      return { script, ok: false, error: 'AI 대본 씬 수가 맞지 않아 그대로 사용합니다.' };
    }
    const next: ShortScript = {
      ...script,
      generator: 'openai',
      title: parsed.title ? clip(parsed.title, 100) : script.title,
      description: parsed.description || script.description,
      scenes: script.scenes.map((scene, i) => ({
        ...scene,
        headline: refined[i]?.headline?.trim() || scene.headline,
        sub: refined[i]?.sub?.trim() || scene.sub,
        narration: refined[i]?.narration?.trim() || scene.narration,
      })),
    };
    return { script: next, ok: true, error: null };
  } catch (err) {
    return { script, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
