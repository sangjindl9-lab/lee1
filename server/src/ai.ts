import type { FastifyInstance } from 'fastify';
import type { Db } from './db.js';
import { httpError, requireUser } from './auth.js';
import { entitlements } from './billing.js';

/**
 * AI 게이트웨이: 제공업체 교체 가능(AI_PROVIDER=anthropic|openai|mock), API 키는 서버 환경변수에만 보관.
 * 사용자별 하루 요청 한도(무료/유료), 기능별 토큰·비용 집계(ai_requests), 실패 시 1회 재시도.
 * 사용자의 개인 ChatGPT·Claude 구독은 이 API 사용 권한으로 쓰지 않는다(정책상 불가).
 */
export const FEATURES: Record<string, string> = {
  summarize: 'Summarize the note concisely in the same language as the note. Use short bullet points.',
  meeting_minutes: 'Rewrite the note as clean meeting minutes in the note language: title, date if present, attendees, agenda items, decisions, action items with owners.',
  key_points: 'Extract the key points of the note as a short bullet list, in the note language.',
  todos: 'Extract every to-do / action item from the note as a checklist ("☐ ..."), in the note language. If none, say so briefly.',
  study_summary: 'Make a study summary of the note for exam review: core concepts, definitions, formulas, and 3 self-check questions. Same language as the note.',
  quiz: 'Create a 5-question multiple-choice quiz (4 options each, mark the answer) from the note, in the note language.',
  translate: 'Translate the note into the target language. Keep formatting. Output only the translation.',
  proofread: 'Correct spelling and grammar of the note. Output only the corrected text, same language.',
  polish: 'Rewrite the note into clear, well-structured sentences without changing the meaning. Same language.',
  qa: 'Answer the question using only the document. If the answer is not in the document, say you could not find it. Answer in the language of the question.',
  keywords: 'Turn the search request into 3-8 short search keywords (in the languages likely used in the notes). Output keywords separated by commas only.',
};

const PRICE: Record<string, [number, number]> = { // 백만 토큰당 마이크로달러(입력, 출력) — 운영 시 실제 단가로 갱신
  anthropic: [3_000_000, 15_000_000], openai: [2_500_000, 10_000_000], mock: [0, 0],
};

type AiOut = { text: string; inputTokens: number; outputTokens: number; model: string };

async function callProvider(system: string, user: string): Promise<AiOut> {
  const provider = process.env.AI_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : '');
  if (provider === 'mock') return { text: `[mock] ${user.slice(0, 120)}`, inputTokens: Math.ceil(user.length / 4), outputTokens: 30, model: 'mock' };
  if (provider === 'anthropic') {
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 2000, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error(`provider_${r.status}`);
    const j: any = await r.json();
    return { text: j.content?.map((c: any) => c.text ?? '').join('') ?? '', inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0, model };
  }
  if (provider === 'openai') {
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 2000 }),
    });
    if (!r.ok) throw new Error(`provider_${r.status}`);
    const j: any = await r.json();
    return { text: j.choices?.[0]?.message?.content ?? '', inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0, model };
  }
  throw httpError(503, 'ai_not_configured');
}

export function aiRoutes(app: FastifyInstance, db: Db) {
  app.post('/v1/ai/:feature', { bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const u = await requireUser(req);
    const feature = (req.params as any).feature as string;
    if (!FEATURES[feature]) throw httpError(404, 'unknown_feature');
    const b = req.body as any;
    const text = String(b?.text ?? '').slice(0, 60_000);
    if (!text.trim() && feature !== 'keywords') throw httpError(400, 'empty_text');
    if (!b?.consentVersion) throw httpError(400, 'consent_required'); // 문서 전송 동의 없이는 처리하지 않음
    const ent = await entitlements(db, u.userId);
    const used = (await db.query(`SELECT count(*)::int n FROM ai_requests WHERE user_id=$1 AND created_at > now() - interval '1 day' AND state <> 'failed'`, [u.userId])).rows[0].n;
    if (used >= ent.aiDailyLimit) throw httpError(429, 'ai_limit_reached');
    const tier = ent.plan === 'free' ? 'free' : 'paid';
    let user = text;
    if (feature === 'translate') user = `Target language: ${String(b.targetLang ?? 'en')}\n\n${text}`;
    if (feature === 'qa') user = `Document:\n${text}\n\nQuestion: ${String(b.question ?? '').slice(0, 2000)}`;
    const provider = process.env.AI_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.OPENAI_API_KEY ? 'openai' : 'none');
    const row = (await db.query(`INSERT INTO ai_requests(user_id, feature, provider, model, notebook_id, tier, state, consent_version) VALUES($1,$2,$3,'',$4,$5,'queued',$6) RETURNING id`,
      [u.userId, feature, provider, /^[0-9a-f-]{36}$/i.test(String(b.notebookId)) && (await db.query('SELECT 1 FROM notebooks WHERE id=$1 AND user_id=$2', [b.notebookId, u.userId])).rows.length ? b.notebookId : null, tier, String(b.consentVersion).slice(0, 20)])).rows[0].id;
    let out: AiOut | null = null; let err: any;
    for (let attempt = 0; attempt < 2 && !out; attempt++) {
      try { out = await callProvider(FEATURES[feature], user); } catch (e: any) { err = e; if (e?.statusCode) break; }
    }
    if (!out) {
      await db.query(`UPDATE ai_requests SET state='failed', error=$2, updated_at=now() WHERE id=$1`, [row, String(err?.message ?? err)]);
      throw err?.statusCode ? err : httpError(502, 'ai_provider_failed');
    }
    const [pi, po] = PRICE[provider] ?? [0, 0];
    const cost = Math.round((out.inputTokens * pi + out.outputTokens * po) / 1_000_000);
    await db.query(`UPDATE ai_requests SET state='done', model=$2, input_tokens=$3, output_tokens=$4, cost_micro_usd=$5, updated_at=now() WHERE id=$1`,
      [row, out.model, out.inputTokens, out.outputTokens, cost]);
    return { feature, text: out.text, author: 'ai', model: out.model, remainingToday: ent.aiDailyLimit - used - 1 };
  });

  app.get('/v1/ai/usage', async (req) => {
    const u = await requireUser(req);
    const ent = await entitlements(db, u.userId);
    const used = (await db.query(`SELECT count(*)::int n FROM ai_requests WHERE user_id=$1 AND created_at > now() - interval '1 day' AND state <> 'failed'`, [u.userId])).rows[0].n;
    return { usedToday: used, dailyLimit: ent.aiDailyLimit, plan: ent.plan, configured: !!(process.env.AI_PROVIDER || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) };
  });
}
