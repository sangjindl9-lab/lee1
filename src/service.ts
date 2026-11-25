import type { AppRow, KeywordRow, RankSnapshotRow, Store } from './db.ts';
import type { AppConfig } from './config.ts';
import { fetchAppDetails, type AppDetails } from './playstore/appDetails.ts';
import { findAppRank, searchKeyword, type KeywordSearchOutcome } from './playstore/search.ts';
import { fetchDeveloperApps } from './playstore/developer.ts';
import { buildAsoSuggestions, extractFeatureBullets, type CompetitorInput } from './aso/analysis.ts';
import {
  buildUtmLink,
  defaultUtm,
  generateTemplateContent,
  CHANNELS,
  type Channel,
  type ContentAppInput,
  type GeneratedContent,
  type GenerateInput,
} from './content/templates.ts';
import { generateWithAi } from './content/openai.ts';
import { markdownToHtml } from './content/markdown.ts';
import { deliverDraft } from './webhook.ts';
import { kstDateString, playStoreShareUrl, truncate } from './util.ts';

export interface RankCheckItem {
  keywordId: number;
  term: string;
  rank: number | null;
  status: string;
  scanned: number;
  competitors: { rank: number; packageId?: string; title: string | null; developer: string | null; score: number | null }[];
}

export interface RankCheckOutcome {
  appId: number;
  packageId: string;
  checkedAt: string;
  items: RankCheckItem[];
  errors: string[];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length || 1)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function resolveOpenAiKey(store: Store, config: AppConfig): string | null {
  const fromDb = store.getSetting('openai_api_key') ?? '';
  if (fromDb.trim()) return fromDb.trim();
  return config.openaiApiKey;
}

export function resolveRankDepth(store: Store, config: AppConfig): number {
  const raw = Number.parseInt(store.getSetting('rank_depth') ?? '', 10);
  if (Number.isFinite(raw)) return Math.min(50, Math.max(5, raw));
  return config.rankDepth;
}

export async function refreshAppDetails(
  store: Store,
  config: AppConfig,
  app: AppRow,
): Promise<{ details: AppDetails | null; error: string | null }> {
  try {
    const details = await fetchAppDetails(app.package_id, config.locale.hl, config.locale.gl);
    store.saveAppSnapshot(app.id, {
      title: details.title,
      developer: details.developer,
      genre: details.genre,
      score: details.score,
      ratings: details.ratings,
      reviews: details.reviews,
      installs: details.installs,
      min_installs: details.minInstalls,
      max_installs: details.maxInstalls,
      updated_ts: details.updatedTs,
      version: details.version,
      summary: details.summary,
      description: details.description,
      icon: details.icon,
      price_text: details.priceText,
      extra_json: JSON.stringify({ contentRating: details.contentRating, released: details.released }),
    });
    if (!app.label && details.title) {
      store.upsertApp(app.package_id, details.title, app.notes);
    }
    return { details, error: null };
  } catch (err) {
    return { details: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function checkRanks(
  store: Store,
  config: AppConfig,
  options: { appId?: number; keywordIds?: number[] } = {},
): Promise<RankCheckOutcome[]> {
  const apps = options.appId
    ? [store.getApp(options.appId)].filter((a): a is AppRow => Boolean(a))
    : store.listApps(true);
  const depth = resolveRankDepth(store, config);
  const outcomes: RankCheckOutcome[] = [];

  for (const app of apps) {
    let keywords = store.listKeywords(app.id, true);
    if (options.keywordIds?.length) {
      keywords = keywords.filter((k) => options.keywordIds!.includes(k.id));
    }
    const items: RankCheckItem[] = [];
    const errors: string[] = [];

    for (const keyword of keywords) {
      try {
        const outcome: KeywordSearchOutcome = await searchKeyword(keyword.term, {
          depth,
          hl: config.locale.hl,
          gl: config.locale.gl,
        });
        const rank = findAppRank(outcome.results, app.package_id);
        const status = rank ? 'ranked' : 'outside';
        const competitors = outcome.results.slice(0, 5).map((item) => ({
          rank: item.rank,
          packageId: item.packageId,
          title: item.title,
          developer: item.developer,
          score: item.score,
        }));
        store.saveRankSnapshot({
          appId: app.id,
          keywordId: keyword.id,
          rank,
          scanned: outcome.results.length,
          status,
          competitors,
        });
        items.push({ keywordId: keyword.id, term: keyword.term, rank, status, scanned: outcome.results.length, competitors });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${keyword.term}: ${message}`);
        store.saveRankSnapshot({
          appId: app.id,
          keywordId: keyword.id,
          rank: null,
          scanned: 0,
          status: 'error',
          error: message,
        });
        items.push({ keywordId: keyword.id, term: keyword.term, rank: null, status: 'error', scanned: 0, competitors: [] });
      }
    }

    outcomes.push({
      appId: app.id,
      packageId: app.package_id,
      checkedAt: new Date().toISOString(),
      items,
      errors,
    });
  }
  return outcomes;
}

/** 키워드 최신 순위 + 전일 대비 변동 */
export function keywordOverview(store: Store, app: AppRow): {
  keyword: KeywordRow;
  latest: RankSnapshotRow | null;
  previousRank: number | null;
  delta: number | null;
  history: { captured_date: string; rank: number | null; status: string }[];
}[] {
  return store.listKeywords(app.id).map((keyword) => {
    const latest = store.latestRank(keyword.id);
    const history = store.rankHistory(keyword.id, 30);
    const prevEntry = history.length >= 2 ? history[history.length - 2] : null;
    const previousRank = prevEntry ? prevEntry.rank : null;
    const delta = latest?.rank && previousRank ? previousRank - latest.rank : null;
    return { keyword, latest, previousRank, delta, history };
  });
}

function snapshotToContentApp(store: Store, app: AppRow): ContentAppInput {
  const snapshot = store.latestAppSnapshot(app.id);
  return {
    packageId: app.package_id,
    name: app.label ?? snapshot?.title ?? app.package_id,
    title: snapshot?.title ?? null,
    summary: snapshot?.summary ?? null,
    description: snapshot?.description ?? null,
    genre: snapshot?.genre ?? null,
    score: snapshot?.score ?? null,
    installs: snapshot?.installs ?? null,
    developer: snapshot?.developer ?? null,
  };
}

export async function collectCompetitors(
  store: Store,
  config: AppConfig,
  keyword: KeywordRow,
): Promise<CompetitorInput[]> {
  const latest = store.latestRank(keyword.id);
  const raw = latest?.competitors_json ? (JSON.parse(latest.competitors_json) as RankCheckItem['competitors']) : [];
  const enriched = await mapLimit(raw, 3, async (item): Promise<CompetitorInput> => {
    if (!item.packageId) return { ...item, packageId: '', summary: null, description: null };
    const cached = store.getCompetitor(item.packageId);
    if (cached) {
      return {
        packageId: item.packageId,
        rank: item.rank,
        title: cached.title ?? item.title,
        developer: cached.developer ?? item.developer,
        score: cached.score ?? item.score,
        summary: cached.summary,
        description: cached.description,
        installs: cached.installs,
      };
    }
    try {
      const details = await fetchAppDetails(item.packageId, config.locale.hl, config.locale.gl);
      store.saveCompetitor({
        packageId: item.packageId,
        title: details.title,
        developer: details.developer,
        score: details.score,
        installs: details.installs,
        summary: details.summary,
        description: details.description,
        genre: details.genre,
      });
      return {
        packageId: item.packageId,
        rank: item.rank,
        title: details.title ?? item.title,
        developer: details.developer ?? item.developer,
        score: details.score ?? item.score,
        summary: details.summary,
        description: details.description,
        installs: details.installs,
      };
    } catch {
      return { ...item, packageId: item.packageId ?? '', summary: null, description: null } as CompetitorInput;
    }
  });
  return enriched;
}

export async function asoSuggestions(
  store: Store,
  config: AppConfig,
  app: AppRow,
  keywordId?: number,
): Promise<unknown> {
  const keywords = store.listKeywords(app.id, true);
  const target = keywordId ? keywords.find((k) => k.id === keywordId) ?? null : keywords[0] ?? null;
  let competitors: CompetitorInput[] = [];
  if (target) {
    competitors = await collectCompetitors(store, config, target);
  }
  const contentApp = snapshotToContentApp(store, app);
  const suggestion = buildAsoSuggestions(
    { title: contentApp.title ?? null, summary: contentApp.summary ?? null, description: contentApp.description ?? null, name: contentApp.name, packageId: app.package_id },
    competitors,
    keywords.map((k) => k.term),
  );
  return {
    app: { id: app.id, packageId: app.package_id, name: contentApp.name, title: contentApp.title },
    keyword: target ? { id: target.id, term: target.term } : null,
    competitors: competitors.map((c) => ({ packageId: c.packageId, rank: c.rank, title: c.title, score: c.score, installs: c.installs ?? null })),
    ...suggestion,
  };
}

export interface GenerateDraftOptions {
  appId: number;
  channel: Channel;
  keywordIds?: number[];
  useAi?: boolean;
  deliver?: boolean;
  variantSeed?: string;
}

export interface DraftGenerationResult {
  draftId: number;
  channel: Channel;
  title: string;
  generator: string;
  warning: string | null;
  webhook: { attempted: boolean; ok?: boolean; error?: string | null } | null;
}

export async function generateDraft(
  store: Store,
  config: AppConfig,
  options: GenerateDraftOptions,
): Promise<DraftGenerationResult> {
  const app = store.getApp(options.appId);
  if (!app) throw new Error('앱을 찾을 수 없습니다.');
  const contentApp = snapshotToContentApp(store, app);
  const allKeywords = store.listKeywords(app.id, true);
  const selected =
    options.keywordIds && options.keywordIds.length
      ? allKeywords.filter((k) => options.keywordIds!.includes(k.id))
      : allKeywords;
  const keywordTerms = (selected.length ? selected : allKeywords).map((k) => k.term);

  const snapshot = store.latestAppSnapshot(app.id);
  const featureBullets = extractFeatureBullets(snapshot?.description ?? contentApp.description, 6);
  const channelUtm = defaultUtm(options.channel);
  const link = buildUtmLink(app.package_id, {
    source: store.getSetting('utm_source') || channelUtm.source,
    medium: channelUtm.medium,
    campaign: store.getSetting('utm_campaign') || channelUtm.campaign,
    content: options.channel,
  });

  const input: GenerateInput = {
    app: contentApp,
    keywords: keywordTerms,
    channel: options.channel,
    link,
    featureBullets,
    brand: contentApp.developer ?? '이음소프트웨어',
    variantSeed: options.variantSeed ?? `${app.package_id}:${options.channel}:${kstDateString()}`,
  };

  let content: GeneratedContent;
  let warning: string | null = null;
  const apiKey = options.useAi ? resolveOpenAiKey(store, config) : null;
  if (options.useAi && apiKey) {
    const aiResult = await generateWithAi(input, {
      apiKey,
      model: store.getSetting('openai_model') || config.openaiModel,
    });
    content = aiResult.content;
    warning = aiResult.warning ?? aiResult.content.warning ?? null;
  } else {
    content = generateTemplateContent(input);
    if (options.useAi && !apiKey) warning = 'OpenAI API 키가 설정되지 않아 템플릿으로 생성했습니다.';
  }

  const bodyHtml = markdownToHtml(content.bodyMd);
  const draft = store.saveDraft({
    appId: app.id,
    channel: content.channel,
    title: truncate(content.title, 120),
    bodyMd: content.bodyMd,
    bodyHtml,
    hashtags: content.hashtags,
    ctaUrl: link,
    keywords: keywordTerms,
    generator: content.generator,
    model: content.model ?? null,
    warning,
  });

  let webhookInfo: DraftGenerationResult['webhook'] = null;
  const webhookUrl = (store.getSetting('webhook_url') ?? '').trim();
  const webhookEnabled = store.getSetting('webhook_enabled') === 'true';
  if ((options.deliver || webhookEnabled) && webhookUrl) {
    const result = await deliverDraft(store, draft, app, webhookUrl);
    webhookInfo = { attempted: true, ok: result.ok, error: result.error };
  }

  return {
    draftId: draft.id,
    channel: content.channel,
    title: content.title,
    generator: content.generator,
    warning,
    webhook: webhookInfo,
  };
}

/** 스케줄러용: 앱 하나에 대해 여러 채널 초안을 한 번에 생성 */
export async function generateScheduledDrafts(
  store: Store,
  config: AppConfig,
  channels: Channel[],
): Promise<DraftGenerationResult[]> {
  const results: DraftGenerationResult[] = [];
  for (const app of store.listApps(true)) {
    const keywords = store.listKeywords(app.id, true);
    if (keywords.length === 0) continue;
    for (const channel of channels) {
      try {
        results.push(await generateDraft(store, config, { appId: app.id, channel }));
      } catch (err) {
        results.push({
          draftId: 0,
          channel,
          title: `${app.package_id} 생성 실패`,
          generator: 'template',
          warning: err instanceof Error ? err.message : String(err),
          webhook: null,
        });
      }
    }
  }
  return results;
}

export function parseChannels(raw: string | null): Channel[] {
  const valid = new Set(CHANNELS.map((c) => c.id));
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim() as Channel)
    .filter((s) => valid.has(s));
}

export async function importDeveloperApps(
  store: Store,
  config: AppConfig,
  developerQuery: string,
): Promise<{ added: string[]; existing: string[]; found: number }> {
  const items = await fetchDeveloperApps(developerQuery, config.locale.hl, config.locale.gl);
  const added: string[] = [];
  const existing: string[] = [];
  for (const item of items) {
    if (store.getAppByPackage(item.packageId)) {
      existing.push(item.packageId);
      continue;
    }
    store.upsertApp(item.packageId, item.title ?? null, null);
    added.push(item.packageId);
  }
  return { added, existing, found: items.length };
}

export function overview(store: Store): unknown {
  const apps = store.listApps();
  const today = kstDateString();
  const ranksToday = store.rankRowsSince(today);
  const buckets = { ranked: 0, outside: 0, error: 0 };
  for (const row of ranksToday) {
    if (row.status === 'ranked') buckets.ranked += 1;
    else if (row.status === 'outside') buckets.outside += 1;
    else buckets.error += 1;
  }
  const appSummaries = apps.map((app) => {
    const keywords = store.listKeywords(app.id, true);
    const latest = keywords.map((k) => store.latestRank(k.id)).filter(Boolean) as RankSnapshotRow[];
    const ranked = latest.filter((r) => r.status === 'ranked' && r.rank);
    const best = ranked.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0] ?? null;
    const snapshot = store.latestAppSnapshot(app.id);
    return {
      id: app.id,
      packageId: app.package_id,
      name: app.label ?? snapshot?.title ?? app.package_id,
      title: snapshot?.title ?? null,
      score: snapshot?.score ?? null,
      installs: snapshot?.installs ?? null,
      ratings: snapshot?.ratings ?? null,
      genre: snapshot?.genre ?? null,
      icon: snapshot?.icon ?? null,
      updatedAt: snapshot?.captured_at ?? null,
      keywordCount: keywords.length,
      checkedKeywords: latest.length,
      bestRank: best ? { keywordId: best.keyword_id, rank: best.rank } : null,
      storeUrl: playStoreShareUrl(app.package_id),
    };
  });
  return {
    counts: store.counts(),
    rankToday: buckets,
    apps: appSummaries,
    jobs: store.recentJobs(8),
    deliveries: store.recentWebhookDeliveries(5),
  };
}
