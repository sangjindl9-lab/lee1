import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { loadConfig, type AppConfig } from './config.ts';
import { Store } from './db.ts';
import {
  asoSuggestions,
  checkRanks,
  generateDraft,
  importDeveloperApps,
  keywordOverview,
  overview,
  refreshAppDetails,
  resolveOpenAiKey,
  resolveRankDepth,
} from './service.ts';
import { CHANNELS, channelLabel, type Channel } from './content/templates.ts';
import { sendTestWebhook, deliverDraft } from './webhook.ts';
import { computeNextContentRun, computeNextRankRun, runContentJob, runRankJob, startScheduler } from './scheduler.ts';
import { extractPackageId, isValidPackageId, kstDateString, kstDateTimeString } from './util.ts';
import { createShortsRunner, shortToJson } from './shorts/index.ts';
import { providerSettingsView, resolveProviders } from './shorts/providers.ts';
import { MOODS, TTS_PROVIDERS, VIDEO_PROVIDERS, type Mood, type TtsProviderId, type VideoProviderId } from './shorts/types.ts';

const VERSION = '1.0.0';
const COOKIE_NAME = 'eum_promo_session';

function signToken(secret: string, expiresAt: number): string {
  const payload = `v1.${expiresAt}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(secret: string, token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [, expiresRaw, sig] = parts;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  const expected = crypto.createHmac('sha256', secret).update(`v1.${expiresRaw}`).digest('base64url');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

type AsyncHandler = (req: Request, res: Response) => Promise<unknown> | unknown;

function asyncRoute(handler: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

export interface CreatedServer {
  app: express.Express;
  store: Store;
  config: AppConfig;
  close: () => Promise<void>;
}

export function createServer(overrides: Partial<AppConfig> = {}): CreatedServer {
  const config = loadConfig(overrides);
  const store = new Store(config);
  const shorts = createShortsRunner(store, config, (message) => console.log(message));
  shorts.recover();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const publicCandidates = [
    path.resolve(import.meta.dirname, '..', 'public'),
    path.resolve(import.meta.dirname, '..', '..', 'public'),
  ];
  const publicDir = publicCandidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) ?? publicCandidates[0];

  // ---------- 세션 ----------
  const authRequired = Boolean(config.adminPassword);
  const requireAuth: express.RequestHandler = (req, res, next) => {
    if (!authRequired) return next();
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (verifyToken(config.authSecret, token)) return next();
    res.status(401).json({ error: '로그인이 필요합니다.', code: 'AUTH_REQUIRED' });
  };

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'eum-promo-aso-studio', version: VERSION, time: new Date().toISOString(), kst: kstDateTimeString() });
  });

  app.get('/api/session', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    res.json({ authRequired, authenticated: authRequired ? verifyToken(config.authSecret, token) : true });
  });

  app.post(
    '/api/login',
    asyncRoute((req, res) => {
      if (!authRequired) return res.json({ ok: true });
      const password = String(req.body?.password ?? '');
      const expected = config.adminPassword ?? '';
      const ok =
        password.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));
      if (!ok) {
        return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
      }
      const expiresAt = Date.now() + 30 * 24 * 3_600_000;
      res.cookie(COOKIE_NAME, signToken(config.authSecret, expiresAt), {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 3_600_000,
        path: '/',
      });
      return res.json({ ok: true });
    }),
  );

  app.post('/api/logout', (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  app.use('/api', requireAuth);

  // ---------- 대시보드 ----------
  app.get('/api/overview', (_req, res) => {
    res.json(overview(store));
  });

  app.get('/api/channels', (_req, res) => {
    res.json({ channels: CHANNELS });
  });

  // ---------- 앱 ----------
  app.get('/api/apps', (_req, res) => {
    const apps = store.listApps().map((a) => {
      const snapshot = store.latestAppSnapshot(a.id);
      return {
        ...a,
        snapshot,
        keywordCount: store.listKeywords(a.id).length,
      };
    });
    res.json({ apps });
  });

  app.post(
    '/api/apps',
    asyncRoute(async (req, res) => {
      const packageId = extractPackageId(String(req.body?.packageId ?? ''));
      if (!isValidPackageId(packageId)) {
        return res.status(400).json({ error: '패키지명 형식이 올바르지 않습니다. 예: kr.eumsoft.viewer' });
      }
      const existing = store.getAppByPackage(packageId);
      const appRow = store.upsertApp(packageId, req.body?.label ? String(req.body.label) : null, req.body?.notes ? String(req.body.notes) : null);
      const terms: string[] = Array.isArray(req.body?.keywords) ? req.body.keywords.map((t: unknown) => String(t)) : [];
      for (const term of terms) {
        if (term.trim()) store.addKeyword(appRow.id, term);
      }
      const refresh = req.body?.fetchNow !== false;
      let fetchError: string | null = null;
      if (refresh) {
        const result = await refreshAppDetails(store, config, appRow);
        fetchError = result.error;
      }
      return res.status(existing ? 200 : 201).json({
        app: store.getApp(appRow.id),
        snapshot: store.latestAppSnapshot(appRow.id),
        existed: Boolean(existing),
        fetchError,
      });
    }),
  );

  app.get('/api/apps/:id', (req, res) => {
    const appRow = store.getApp(Number(req.params.id));
    if (!appRow) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
    return res.json({
      app: appRow,
      snapshot: store.latestAppSnapshot(appRow.id),
      history: store.appSnapshotHistory(appRow.id, 30),
      keywords: keywordOverview(store, appRow),
    });
  });

  app.delete('/api/apps/:id', (req, res) => {
    const appRow = store.getApp(Number(req.params.id));
    if (!appRow) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
    store.deleteApp(appRow.id);
    res.json({ ok: true });
  });

  app.post(
    '/api/apps/:id/refresh',
    asyncRoute(async (req, res) => {
      const appRow = store.getApp(Number(req.params.id));
      if (!appRow) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
      const result = await refreshAppDetails(store, config, appRow);
      if (!result.details) return res.status(502).json({ error: result.error ?? '앱 정보를 가져오지 못했습니다.' });
      return res.json({ ok: true, details: result.details, snapshot: store.latestAppSnapshot(appRow.id) });
    }),
  );

  // ---------- 키워드 ----------
  app.post(
    '/api/apps/:id/keywords',
    asyncRoute((req, res) => {
      const appRow = store.getApp(Number(req.params.id));
      if (!appRow) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
      const raw = req.body?.terms ?? req.body?.term;
      const terms: string[] = Array.isArray(raw) ? raw.map((t: unknown) => String(t)) : [String(raw ?? '')];
      const cleaned = terms.map((t) => t.trim().replace(/\s+/g, ' ')).filter((t) => t.length >= 2 && t.length <= 60);
      if (cleaned.length === 0) {
        return res.status(400).json({ error: '키워드를 2자 이상 입력하세요.' });
      }
      const saved = cleaned.map((term) => store.addKeyword(appRow.id, term));
      return res.status(201).json({ keywords: saved, all: keywordOverview(store, appRow) });
    }),
  );

  app.patch('/api/keywords/:id', (req, res) => {
    const keyword = store.getKeyword(Number(req.params.id));
    if (!keyword) return res.status(404).json({ error: '키워드를 찾을 수 없습니다.' });
    store.toggleKeyword(keyword.id, Boolean(req.body?.active));
    res.json({ ok: true });
  });

  app.delete('/api/keywords/:id', (req, res) => {
    const keyword = store.getKeyword(Number(req.params.id));
    if (!keyword) return res.status(404).json({ error: '키워드를 찾을 수 없습니다.' });
    store.deleteKeyword(keyword.id);
    res.json({ ok: true });
  });

  // ---------- 순위 점검 ----------
  app.post(
    '/api/apps/:id/check-ranks',
    asyncRoute(async (req, res) => {
      const appRow = store.getApp(Number(req.params.id));
      if (!appRow) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
      const keywordIds = Array.isArray(req.body?.keywordIds) ? req.body.keywordIds.map(Number) : undefined;
      const jobId = store.startJob('rank_check_manual', { appId: appRow.id });
      try {
        const outcome = await checkRanks(store, config, { appId: appRow.id, keywordIds });
        const items = outcome.flatMap((o) => o.items);
        const errors = outcome.flatMap((o) => o.errors);
        store.finishJob(
          jobId,
          items.length && items.length === errors.length ? 'failed' : 'success',
          `${appRow.label ?? appRow.package_id} 키워드 ${items.length}개 점검${errors.length ? ` · 오류 ${errors.length}` : ''}`,
        );
        return res.json({ outcomes: outcome, keywords: keywordOverview(store, appRow) });
      } catch (err) {
        store.finishJob(jobId, 'failed', err instanceof Error ? err.message : String(err));
        throw err;
      }
    }),
  );

  app.get('/api/apps/:id/rank-history', (req, res) => {
    const appRow = store.getApp(Number(req.params.id));
    if (!appRow) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
    const keywordId = req.query.keywordId ? Number(req.query.keywordId) : null;
    const keywords = store.listKeywords(appRow.id);
    const target = keywordId ? keywords.filter((k) => k.id === keywordId) : keywords;
    res.json({
      series: target.map((k) => ({
        keywordId: k.id,
        term: k.term,
        points: store.rankHistory(k.id, Number(req.query.days ?? 30)),
      })),
    });
  });

  // ---------- 경쟁 분석 / ASO ----------
  app.get(
    '/api/apps/:id/aso',
    asyncRoute(async (req, res) => {
      const appRow = store.getApp(Number(req.params.id));
      if (!appRow) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
      const keywordId = req.query.keywordId ? Number(req.query.keywordId) : undefined;
      const suggestion = await asoSuggestions(store, config, appRow, keywordId);
      return res.json(suggestion);
    }),
  );

  // ---------- 저장된 ASO 개편안 ----------
  app.get('/api/apps/:id/aso-plans', (req, res) => {
    const appRow = store.getApp(Number(req.params.id));
    if (!appRow) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
    const plans = store.listAsoPlans(appRow.id).map((plan) => ({
      ...plan,
      keywords: JSON.parse(plan.keywords_json) as string[],
      titleLength: Array.from(plan.title).length,
      summaryLength: Array.from(plan.summary).length,
    }));
    res.json({ app: { id: appRow.id, packageId: appRow.package_id }, plans });
  });

  app.post('/api/apps/:id/aso-plans', (req, res) => {
    const appRow = store.getApp(Number(req.params.id));
    if (!appRow) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
    const title = String(req.body?.title ?? '').trim();
    const summary = String(req.body?.summary ?? '').trim();
    const descriptionHead = String(req.body?.descriptionHead ?? '').trim();
    if (!title || !summary || !descriptionHead) {
      return res.status(400).json({ error: 'title, summary, descriptionHead 는 필수입니다.' });
    }
    const keywords: string[] = Array.isArray(req.body?.keywords) ? req.body.keywords.map((k: unknown) => String(k)) : [];
    const plan = store.saveAsoPlan({
      appId: appRow.id,
      title,
      summary,
      descriptionHead,
      keywords,
      rationale: req.body?.rationale ? String(req.body.rationale) : null,
    });
    return res.status(201).json({
      plan: {
        ...plan,
        keywords,
        titleLength: Array.from(title).length,
        summaryLength: Array.from(summary).length,
      },
    });
  });

  app.delete('/api/aso-plans/:id', (req, res) => {
    store.deleteAsoPlan(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- 콘텐츠 ----------
  app.post(
    '/api/apps/:id/content',
    asyncRoute(async (req, res) => {
      const appRow = store.getApp(Number(req.params.id));
      if (!appRow) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
      const channel = String(req.body?.channel ?? 'naver_blog') as Channel;
      if (!CHANNELS.some((c) => c.id === channel)) {
        return res.status(400).json({ error: '지원하지 않는 채널입니다.' });
      }
      const keywordIds = Array.isArray(req.body?.keywordIds) ? req.body.keywordIds.map(Number) : undefined;
      const result = await generateDraft(store, config, {
        appId: appRow.id,
        channel,
        keywordIds,
        useAi: Boolean(req.body?.useAi),
        deliver: Boolean(req.body?.deliver),
      });
      const draft = store.getDraft(result.draftId);
      return res.status(201).json({ ...result, draft });
    }),
  );

  app.get('/api/drafts', (req, res) => {
    const appId = req.query.appId ? Number(req.query.appId) : undefined;
    const drafts = store.listDrafts(Number(req.query.limit ?? 40), appId).map((d) => ({
      ...d,
      channelLabel: channelLabel(d.channel),
    }));
    res.json({ drafts });
  });

  app.get('/api/drafts/:id', (req, res) => {
    const draft = store.getDraft(Number(req.params.id));
    if (!draft) return res.status(404).json({ error: '초안을 찾을 수 없습니다.' });
    res.json({ draft: { ...draft, channelLabel: channelLabel(draft.channel) } });
  });

  app.get('/api/drafts/:id/download', (req, res) => {
    const draft = store.getDraft(Number(req.params.id));
    if (!draft) return res.status(404).json({ error: '초안을 찾을 수 없습니다.' });
    const format = String(req.query.format ?? 'html');
    const safeTitle = draft.title.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
    if (format === 'md') {
      const body = [`# ${draft.title}`, '', draft.body_md, '', draft.hashtags, '', draft.cta_url].join('\n');
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.md`);
      return res.send(body);
    }
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${draft.title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Malgun Gothic',sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.75;color:#1f2328}h1{font-size:26px}h2{font-size:20px;margin-top:32px}blockquote{border-left:4px solid #d0d7de;margin:16px 0;padding:4px 16px;color:#57606a}ul,ol{padding-left:22px}a{color:#0969da}hr{border:none;border-top:1px solid #d8dee4;margin:28px 0}</style>
</head><body><h1>${draft.title}</h1>${draft.body_html}<hr><p>${draft.hashtags}</p><p><a href="${draft.cta_url}">Play 스토어에서 보기</a></p></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.html`);
    return res.send(html);
  });

  app.patch('/api/drafts/:id', (req, res) => {
    const draft = store.getDraft(Number(req.params.id));
    if (!draft) return res.status(404).json({ error: '초안을 찾을 수 없습니다.' });
    const status = String(req.body?.status ?? 'draft');
    if (!['draft', 'used', 'archived'].includes(status)) {
      return res.status(400).json({ error: '상태 값이 올바르지 않습니다.' });
    }
    store.updateDraftStatus(draft.id, status);
    return res.json({ ok: true });
  });

  app.delete('/api/drafts/:id', (req, res) => {
    store.deleteDraft(Number(req.params.id));
    res.json({ ok: true });
  });

  app.post(
    '/api/drafts/:id/deliver',
    asyncRoute(async (req, res) => {
      const draft = store.getDraft(Number(req.params.id));
      if (!draft) return res.status(404).json({ error: '초안을 찾을 수 없습니다.' });
      const appRow = store.getApp(draft.app_id);
      if (!appRow) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
      const url = String(req.body?.url ?? store.getSetting('webhook_url') ?? '').trim();
      if (!url) return res.status(400).json({ error: '웹훅 URL을 먼저 설정하세요.' });
      const result = await deliverDraft(store, draft, appRow, url);
      return res.json(result);
    }),
  );

  // ---------- 웹훅 ----------
  app.post(
    '/api/webhook/test',
    asyncRoute(async (req, res) => {
      const url = String(req.body?.url ?? store.getSetting('webhook_url') ?? '').trim();
      if (!url) return res.status(400).json({ error: '웹훅 URL을 입력하세요.' });
      const result = await sendTestWebhook(store, url);
      return res.json(result);
    }),
  );

  app.get('/api/webhook/deliveries', (_req, res) => {
    res.json({ deliveries: store.recentWebhookDeliveries(20) });
  });

  // ---------- 쇼츠 스튜디오 ----------
  app.get(
    '/api/shorts/providers',
    asyncRoute(async (_req, res) => {
      const status = await shorts.status();
      res.json({
        ...status,
        moods: MOODS,
        videoProviders: VIDEO_PROVIDERS,
        ttsProviders: TTS_PROVIDERS,
      });
    }),
  );

  app.get('/api/shorts', (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30)));
    const rows = store.listShorts(limit).map((row) => ({
      ...shortToJson(row),
      appName: store.getApp(row.app_id)?.label ?? store.getApp(row.app_id)?.package_id ?? '',
    }));
    res.json({ shorts: rows });
  });

  app.post(
    '/api/shorts',
    asyncRoute(async (req, res) => {
      const appRow = store.getApp(Number(req.body?.appId));
      if (!appRow) return res.status(404).json({ error: '앱을 찾을 수 없습니다.' });
      const providers = resolveProviders(store, config);
      const mood = String(req.body?.mood ?? store.getSetting('shorts_mood') ?? 'bright') as Mood;
      if (!MOODS.some((m) => m.id === mood)) {
        return res.status(400).json({ error: '지원하지 않는 분위기입니다.' });
      }
      const narration = req.body?.narration === undefined ? store.getSetting('shorts_narration') !== 'false' : Boolean(req.body.narration);
      const videoProvider = String(req.body?.videoProvider ?? providers.video.id) as VideoProviderId;
      const ttsProvider = String(req.body?.ttsProvider ?? providers.tts.id) as TtsProviderId;
      if (!VIDEO_PROVIDERS.some((p) => p.id === videoProvider)) {
        return res.status(400).json({ error: '지원하지 않는 영상 프로바이더입니다.' });
      }
      if (!TTS_PROVIDERS.some((p) => p.id === ttsProvider)) {
        return res.status(400).json({ error: '지원하지 않는 TTS 프로바이더입니다.' });
      }
      const row = shorts.enqueue({ appId: appRow.id, mood, narration, videoProvider, ttsProvider });
      return res.status(202).json({
        short: { ...shortToJson(row), appName: appRow.label ?? appRow.package_id },
        engine: providers.video.ready && videoProvider !== 'builtin' ? `${providers.video.label} 연결됨` : '내장 풀오토',
      });
    }),
  );

  app.get('/api/shorts/:id', (req, res) => {
    const row = store.getShort(Number(req.params.id));
    if (!row) return res.status(404).json({ error: '쇼츠를 찾을 수 없습니다.' });
    const appRow = store.getApp(row.app_id);
    return res.json({ short: { ...shortToJson(row), appName: appRow?.label ?? appRow?.package_id ?? '' } });
  });

  app.get('/api/shorts/:id/video', (req, res) => {
    const row = store.getShort(Number(req.params.id));
    if (!row || !row.file_path || !fs.existsSync(row.file_path)) {
      return res.status(404).json({ error: '영상 파일을 찾을 수 없습니다.' });
    }
    const stat = fs.statSync(row.file_path);
    const range = req.headers.range;
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? Number(match[1]) : 0;
      const end = match && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start >= stat.size) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`);
        return res.end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', end - start + 1);
      return fs.createReadStream(row.file_path, { start, end }).pipe(res);
    }
    res.setHeader('Content-Length', stat.size);
    return fs.createReadStream(row.file_path).pipe(res);
  });

  app.get('/api/shorts/:id/download', (req, res) => {
    const row = store.getShort(Number(req.params.id));
    if (!row || !row.file_path || !fs.existsSync(row.file_path)) {
      return res.status(404).json({ error: '영상 파일을 찾을 수 없습니다.' });
    }
    const safe = (row.title || `eum-short-${row.id}`).replace(/[\\/:*?"<>|\s#]+/g, '_').slice(0, 60);
    return res.download(row.file_path, `${safe}.mp4`);
  });

  app.delete('/api/shorts/:id', (req, res) => {
    const row = store.getShort(Number(req.params.id));
    if (!row) return res.status(404).json({ error: '쇼츠를 찾을 수 없습니다.' });
    if (row.file_path && fs.existsSync(row.file_path)) {
      try {
        fs.unlinkSync(row.file_path);
      } catch {
        // 파일이 이미 없으면 무시
      }
    }
    store.deleteShort(row.id);
    res.json({ ok: true });
  });

  // ---------- 설정 ----------
  app.get('/api/settings', (_req, res) => {
    const settings = store.allSettings();
    res.json({
      settings: {
        ...settings,
        openai_api_key: maskSecret(resolveOpenAiKey(store, config)),
        openai_key_set: Boolean(resolveOpenAiKey(store, config)),
        ...providerSettingsView(store, config),
      },
      env: {
        port: config.port,
        dataDir: config.dataDir,
        adminPasswordSet: Boolean(config.adminPassword),
        openaiEnvKeySet: Boolean(config.openaiApiKey),
        rankDepth: resolveRankDepth(store, config),
        shortsDir: config.shortsDir,
      },
    });
  });

  app.put(
    '/api/settings',
    asyncRoute((req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const allowed = [
        'rank_schedule_enabled',
        'rank_schedule_time',
        'content_schedule_enabled',
        'content_schedule_time',
        'content_schedule_frequency',
        'content_schedule_weekday',
        'content_schedule_channels',
        'webhook_enabled',
        'webhook_url',
        'openai_api_key',
        'openai_model',
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'rank_depth',
        'shorts_video_provider',
        'shorts_video_api_key',
        'shorts_video_endpoint',
        'shorts_video_model',
        'shorts_tts_provider',
        'shorts_tts_api_key',
        'shorts_tts_voice',
        'shorts_mood',
        'shorts_narration',
      ];
      for (const key of allowed) {
        if (!(key in body)) continue;
        const value = body[key];
        if (typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number') continue;
        const text = typeof value === 'boolean' ? String(value) : String(value);
        if (key === 'rank_schedule_time' || key === 'content_schedule_time') {
          if (!/^\d{1,2}:\d{2}$/.test(text)) return res.status(400).json({ error: `${key} 형식은 HH:MM 입니다.` });
          const [hour, minute] = text.split(':').map(Number);
          if (hour > 23 || minute > 59) return res.status(400).json({ error: `${key} 는 00:00 ~ 23:59 사이여야 합니다.` });
        }
        if (key === 'rank_depth') {
          const depth = Number.parseInt(text, 10);
          if (!Number.isFinite(depth) || depth < 5 || depth > 50) {
            return res.status(400).json({ error: '순위 탐색 깊이는 5~50 사이여야 합니다.' });
          }
        }
        if (key === 'webhook_url' && text && !/^https?:\/\//.test(text)) {
          return res.status(400).json({ error: '웹훅 URL은 http(s)로 시작해야 합니다.' });
        }
        if (key === 'openai_api_key' && text.includes('••••')) continue; // 마스킹된 값은 무시
        if (key === 'shorts_video_api_key' && text.includes('••••')) continue;
        if (key === 'shorts_tts_api_key' && text.includes('••••')) continue;
        if (key === 'shorts_video_provider' && !VIDEO_PROVIDERS.some((p) => p.id === text)) {
          return res.status(400).json({ error: '지원하지 않는 영상 프로바이더입니다.' });
        }
        if (key === 'shorts_tts_provider' && !TTS_PROVIDERS.some((p) => p.id === text)) {
          return res.status(400).json({ error: '지원하지 않는 TTS 프로바이더입니다.' });
        }
        if (key === 'shorts_mood' && !MOODS.some((m) => m.id === text)) {
          return res.status(400).json({ error: '지원하지 않는 분위기입니다.' });
        }
        if ((key === 'shorts_video_endpoint' || key === 'shorts_video_model') && text.length > 300) {
          return res.status(400).json({ error: '값이 너무 깁니다.' });
        }
        store.setSetting(key, text);
      }
      return res.json({ ok: true, settings: store.allSettings() });
    }),
  );

  // ---------- 스케줄러 ----------
  app.get('/api/scheduler', (_req, res) => {
    const rank = computeNextRankRun(store);
    const content = computeNextContentRun(store);
    res.json({
      rank: {
        enabled: store.getSetting('rank_schedule_enabled') === 'true',
        time: store.getSetting('rank_schedule_time'),
        nextRun: rank ? rank.toISOString() : null,
        nextRunKst: rank ? kstDateTimeString(rank) : null,
      },
      content: {
        enabled: store.getSetting('content_schedule_enabled') === 'true',
        time: store.getSetting('content_schedule_time'),
        frequency: store.getSetting('content_schedule_frequency'),
        weekday: store.getSetting('content_schedule_weekday'),
        channels: store.getSetting('content_schedule_channels'),
        nextRun: content ? content.toISOString() : null,
        nextRunKst: content ? kstDateTimeString(content) : null,
      },
      jobs: store.recentJobs(10),
    });
  });

  app.post(
    '/api/scheduler/run',
    asyncRoute(async (req, res) => {
      const kind = String(req.body?.kind ?? 'rank');
      const result = kind === 'content' ? await runContentJob(store, config) : await runRankJob(store, config);
      return res.json(result);
    }),
  );

  // ---------- 개발자 앱 일괄 가져오기 ----------
  app.post(
    '/api/import-developer',
    asyncRoute(async (req, res) => {
      const query = String(req.body?.query ?? '이음소프트웨어').trim();
      if (!query) return res.status(400).json({ error: '개발자 이름 또는 ID를 입력하세요.' });
      const result = await importDeveloperApps(store, config, query);
      return res.json(result);
    }),
  );

  // ---------- 백업 ----------
  app.get('/api/export', (req, res) => {
    const format = String(req.query.format ?? 'json');
    const apps = store.listApps().map((appRow) => ({
      ...appRow,
      keywords: store.listKeywords(appRow.id),
      snapshots: store.appSnapshotHistory(appRow.id, 90),
    }));
    const payload = { exportedAt: new Date().toISOString(), date: kstDateString(), apps };
    if (format === 'csv') {
      const rows = [['앱', '패키지', '키워드', '순위', '점검일']];
      for (const appRow of apps) {
        for (const keyword of appRow.keywords) {
          const latest = store.latestRank(keyword.id);
          rows.push([
            appRow.label ?? '',
            appRow.package_id,
            keyword.term,
            latest?.rank ? String(latest.rank) : latest?.status ?? '',
            latest?.captured_date ?? '',
          ]);
        }
      }
      const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="eum-promo-${kstDateString()}.csv"`);
      return res.send('\uFEFF' + csv);
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="eum-promo-${kstDateString()}.json"`);
    return res.send(JSON.stringify(payload, null, 2));
  });

  // ---------- 정적 파일 ----------
  app.use(express.static(publicDir, { index: 'index.html', extensions: ['html'] }));

  app.get('/api/*', (_req, res) => {
    res.status(404).json({ error: '없는 API 경로입니다.' });
  });

  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    return res.sendFile(path.join(publicDir, 'index.html'));
  });

  // ---------- 오류 처리 ----------
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error('[eum-promo]', message);
    if (res.headersSent) return;
    res.status(500).json({ error: message || '서버 오류가 발생했습니다.' });
  });

  const scheduler = config.enableScheduler ? startScheduler(store, config, (msg) => console.log(msg)) : null;

  const close = async () => {
    scheduler?.stop();
    store.close();
  };

  return { app, store, config, close };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const { app, config } = createServer();
  const server = app.listen(config.port, () => {
    console.log(`이음 앱 홍보·ASO 자동화 센터: http://localhost:${config.port}  (데이터: ${config.dbFile})`);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

