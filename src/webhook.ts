import type { DraftRow, Store } from './db.ts';
import { channelLabel } from './content/templates.ts';

export interface WebhookDeliveryResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  responseSnippet: string | null;
  deliveredAt: string;
}

export function buildDraftPayload(draft: DraftRow, app: { package_id: string; label: string | null }, event = 'draft.created') {
  return {
    event,
    source: 'eum-promo-aso-studio',
    generatedAt: draft.created_at,
    app: {
      packageId: app.package_id,
      name: app.label,
      storeUrl: `https://play.google.com/store/apps/details?id=${app.package_id}`,
    },
    draft: {
      id: draft.id,
      channel: draft.channel,
      channelLabel: channelLabel(draft.channel),
      title: draft.title,
      bodyMarkdown: draft.body_md,
      bodyHtml: draft.body_html,
      hashtags: draft.hashtags,
      link: draft.cta_url,
      keywords: JSON.parse(draft.keywords_json || '[]'),
      generator: draft.generator,
      model: draft.model,
    },
  };
}

/** Slack incoming webhook 이면 text 필드를 추가합니다. */
function shapeForEndpoint(url: string, payload: ReturnType<typeof buildDraftPayload>): unknown {
  if (/hooks\.slack\.com/.test(url)) {
    const preview = payload.draft.bodyMarkdown.split('\n').slice(0, 12).join('\n');
    return {
      text: `[${payload.draft.channelLabel}] ${payload.draft.title}`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${payload.draft.title}*\n\`${payload.app.name}\` · ${payload.draft.channelLabel}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${preview}\`\`\`` } },
        { type: 'section', text: { type: 'mrkdwn', text: `<${payload.draft.link}|Play 스토어에서 보기>` } },
      ],
      eumPromo: payload,
    };
  }
  return payload;
}

export async function postWebhook(
  url: string,
  payload: unknown,
  timeoutMs = 12_000,
): Promise<{ ok: boolean; statusCode: number | null; error: string | null; responseSnippet: string | null }> {
  try {
    new URL(url);
  } catch {
    return { ok: false, statusCode: null, error: '웹훅 URL 형식이 올바르지 않습니다.', responseSnippet: null };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'eum-promo-aso-studio/1.0' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text().catch(() => '');
    return {
      ok: res.ok,
      statusCode: res.status,
      error: res.ok ? null : `웹훅 응답 ${res.status}`,
      responseSnippet: text.slice(0, 400),
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: null,
      error: err instanceof Error ? err.message : String(err),
      responseSnippet: null,
    };
  }
}

export async function deliverDraft(
  store: Store,
  draft: DraftRow,
  app: { package_id: string; label: string | null },
  url: string,
): Promise<WebhookDeliveryResult> {
  const payload = buildDraftPayload(draft, app);
  const result = await postWebhook(url, shapeForEndpoint(url, payload));
  const deliveredAt = new Date().toISOString();
  store.logWebhook({
    draftId: draft.id,
    event: payload.event,
    url,
    ok: result.ok,
    statusCode: result.statusCode,
    error: result.error,
    responseSnippet: result.responseSnippet,
  });
  return { ...result, deliveredAt };
}

export async function sendTestWebhook(store: Store, url: string): Promise<WebhookDeliveryResult> {
  const payload = {
    event: 'webhook.test',
    source: 'eum-promo-aso-studio',
    generatedAt: new Date().toISOString(),
    message: '이음 앱 홍보·ASO 자동화 센터의 테스트 발송입니다. 이 JSON 을 받으면 연동이 정상입니다.',
    sample: {
      app: { packageId: 'kr.eumsoft.viewer', name: '이음뷰어' },
      draft: { channel: 'naver_blog', title: 'PDF·캐드 뷰어 앱 추천', link: 'https://play.google.com/store/apps/details?id=kr.eumsoft.viewer' },
    },
  };
  const result = await postWebhook(url, shapeForEndpoint(url, payload as never));
  const deliveredAt = new Date().toISOString();
  store.logWebhook({
    draftId: null,
    event: 'webhook.test',
    url,
    ok: result.ok,
    statusCode: result.statusCode,
    error: result.error,
    responseSnippet: result.responseSnippet,
  });
  return { ...result, deliveredAt };
}
