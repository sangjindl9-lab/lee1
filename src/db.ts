import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_KEYWORDS, SEED_APPS, type AppConfig } from './config.ts';
import { DEMO_SEED } from './seed/demo-seed.ts';
import { kstDateString, storeUrl } from './util.ts';

export interface AppRow {
  id: number;
  package_id: string;
  label: string | null;
  store_url: string;
  notes: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface KeywordRow {
  id: number;
  app_id: number;
  term: string;
  active: number;
  created_at: string;
}

export interface AppSnapshotRow {
  id: number;
  app_id: number;
  captured_at: string;
  captured_date: string;
  title: string | null;
  developer: string | null;
  genre: string | null;
  score: number | null;
  ratings: number | null;
  reviews: number | null;
  installs: string | null;
  min_installs: number | null;
  max_installs: number | null;
  updated_ts: number | null;
  version: string | null;
  summary: string | null;
  description: string | null;
  icon: string | null;
  price_text: string | null;
  extra_json: string | null;
}

export interface RankSnapshotRow {
  id: number;
  app_id: number;
  keyword_id: number;
  captured_at: string;
  captured_date: string;
  rank: number | null;
  scanned: number | null;
  status: string;
  error: string | null;
  competitors_json: string | null;
}

export interface AsoPlanRow {
  id: number;
  app_id: number;
  title: string;
  summary: string;
  description_head: string;
  keywords_json: string;
  rationale: string | null;
  status: string;
  created_at: string;
}

export interface DraftRow {
  id: number;
  app_id: number;
  channel: string;
  title: string;
  body_md: string;
  body_html: string;
  hashtags: string;
  cta_url: string;
  keywords_json: string;
  generator: string;
  model: string | null;
  warning: string | null;
  status: string;
  created_at: string;
}

export interface ShortRow {
  id: number;
  app_id: number;
  status: string;
  stage: string;
  progress: number;
  engine: string;
  video_provider: string;
  tts_provider: string;
  mood: string;
  title: string;
  description: string;
  hashtags: string;
  script_json: string;
  file_path: string | null;
  file_bytes: number | null;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  warnings_json: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id TEXT NOT NULL UNIQUE,
  label TEXT,
  store_url TEXT NOT NULL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (app_id, term)
);
CREATE TABLE IF NOT EXISTS app_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  captured_date TEXT NOT NULL,
  title TEXT, developer TEXT, genre TEXT,
  score REAL, ratings INTEGER, reviews INTEGER,
  installs TEXT, min_installs INTEGER, max_installs INTEGER,
  updated_ts INTEGER, version TEXT, summary TEXT, description TEXT,
  icon TEXT, price_text TEXT, extra_json TEXT,
  UNIQUE (app_id, captured_date)
);
CREATE TABLE IF NOT EXISTS rank_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  captured_date TEXT NOT NULL,
  rank INTEGER,
  scanned INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  competitors_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_rank_kw_date ON rank_snapshots (keyword_id, captured_date);
CREATE TABLE IF NOT EXISTS content_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  body_html TEXT NOT NULL,
  hashtags TEXT NOT NULL DEFAULT '',
  cta_url TEXT NOT NULL DEFAULT '',
  keywords_json TEXT NOT NULL DEFAULT '[]',
  generator TEXT NOT NULL,
  model TEXT,
  warning TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS aso_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  description_head TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER,
  event TEXT NOT NULL,
  url TEXT NOT NULL,
  ok INTEGER NOT NULL,
  status_code INTEGER,
  error TEXT,
  response_snippet TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS competitor_cache (
  package_id TEXT PRIMARY KEY,
  title TEXT, developer TEXT, score REAL, installs TEXT,
  summary TEXT, description TEXT, genre TEXT,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  message TEXT,
  meta_json TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shorts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'script',
  progress INTEGER NOT NULL DEFAULT 0,
  engine TEXT NOT NULL DEFAULT 'builtin',
  video_provider TEXT NOT NULL DEFAULT 'builtin',
  tts_provider TEXT NOT NULL DEFAULT 'builtin',
  mood TEXT NOT NULL DEFAULT 'bright',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '',
  script_json TEXT NOT NULL DEFAULT '{}',
  file_path TEXT,
  file_bytes INTEGER,
  duration_sec REAL,
  width INTEGER,
  height INTEGER,
  fps INTEGER,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_shorts_created ON shorts (created_at DESC);
`;

export class Store {
  readonly db: DatabaseSync;
  readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
    this.db = new DatabaseSync(config.dbFile);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
    this.bootstrap();
  }

  close(): void {
    this.db.close();
  }

  private bootstrap(): void {
    const now = new Date().toISOString();
    const seeded = this.getSetting('seeded_v2');
    if (this.config.seedDemoData && !seeded) {
      if (this.counts().apps === 0) {
        // 빈 볼륨으로 처음 기동: 실측 시드(앱·키워드·순위·ASO 개편안·홍보 초안)를 그대로 채운다.
        this.importDemoSeed();
      } else if (!this.getSetting('seeded_v1')) {
        // 이미 데이터가 있는 기존 DB에는 최소 시드만 보강한다.
        for (const seed of SEED_APPS) {
          const app = this.upsertApp(seed.packageId, seed.name, seed.note);
          const terms = DEFAULT_KEYWORDS[seed.packageId] ?? [];
          for (const term of terms) this.addKeyword(app.id, term);
        }
      }
      this.setSetting('seeded_v1', this.getSetting('seeded_v1') ?? now);
      this.setSetting('seeded_v2', now);
    }
    this.setDefault('rank_schedule_time', '09:00');
    this.setDefault('rank_schedule_enabled', 'true');
    this.setDefault('content_schedule_enabled', 'false');
    this.setDefault('content_schedule_time', '10:00');
    this.setDefault('content_schedule_frequency', 'daily');
    this.setDefault('content_schedule_weekday', '1');
    this.setDefault('content_schedule_channels', 'naver_blog,community,shorts');
    this.setDefault('webhook_enabled', 'false');
    this.setDefault('webhook_url', '');
    this.setDefault('openai_model', this.config.openaiModel);
    this.setDefault('openai_api_key', '');
    this.setDefault('utm_source', 'eum_promo');
    this.setDefault('utm_medium', 'blog');
    this.setDefault('utm_campaign', 'always_on');
    this.setDefault('rank_depth', String(this.config.rankDepth));
    // 쇼츠 스튜디오 — AI 프로바이더 (키가 비어 있으면 내장 엔진으로 동작)
    this.setDefault('shorts_video_provider', 'builtin');
    this.setDefault('shorts_video_api_key', '');
    this.setDefault('shorts_video_endpoint', '');
    this.setDefault('shorts_video_model', '');
    this.setDefault('shorts_tts_provider', 'builtin');
    this.setDefault('shorts_tts_api_key', '');
    this.setDefault('shorts_tts_voice', '');
    this.setDefault('shorts_mood', 'bright');
    this.setDefault('shorts_narration', 'true');
  }

  /** 시드 스냅샷을 원래 id 그대로 삽입한다 (빈 DB 전용). */
  private importDemoSeed(): void {
    this.db.exec('BEGIN');
    try {
      this.insertRows('apps', DEMO_SEED.apps);
      this.insertRows('keywords', DEMO_SEED.keywords);
      this.insertRows('app_snapshots', DEMO_SEED.app_snapshots);
      this.insertRows('rank_snapshots', DEMO_SEED.rank_snapshots);
      this.insertRows('aso_plans', DEMO_SEED.aso_plans);
      this.insertRows('content_drafts', DEMO_SEED.content_drafts);
      this.insertRows('competitor_cache', DEMO_SEED.competitor_cache);
      this.insertRows('job_runs', DEMO_SEED.job_runs);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private insertRows(table: string, rows: readonly Record<string, unknown>[]): void {
    for (const row of rows) {
      const cols = Object.keys(row);
      const stmt = this.db.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      );
      stmt.run(...cols.map((col) => row[col] as never));
    }
  }

  // ---------- settings ----------
  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  allSettings(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const out: Record<string, string> = {};
    for (const row of rows) out[row.key] = row.value;
    return out;
  }

  private setDefault(key: string, value: string): void {
    if (this.getSetting(key) === null) this.setSetting(key, value);
  }

  // ---------- apps ----------
  listApps(activeOnly = false): AppRow[] {
    const sql = activeOnly
      ? 'SELECT * FROM apps WHERE active = 1 ORDER BY id'
      : 'SELECT * FROM apps ORDER BY id';
    return this.db.prepare(sql).all() as unknown as AppRow[];
  }

  getApp(id: number): AppRow | null {
    return (this.db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as unknown as AppRow) ?? null;
  }

  getAppByPackage(packageId: string): AppRow | null {
    return (
      (this.db.prepare('SELECT * FROM apps WHERE package_id = ?').get(packageId) as unknown as AppRow) ?? null
    );
  }

  upsertApp(packageId: string, label?: string | null, notes?: string | null): AppRow {
    const now = new Date().toISOString();
    const existing = this.getAppByPackage(packageId);
    if (existing) {
      this.db
        .prepare('UPDATE apps SET label = COALESCE(?, label), notes = COALESCE(?, notes), updated_at = ? WHERE id = ?')
        .run(label ?? null, notes ?? null, now, existing.id);
      return this.getApp(existing.id)!;
    }
    this.db
      .prepare('INSERT INTO apps (package_id, label, store_url, notes, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run(packageId, label ?? null, storeUrl(packageId), notes ?? null, now, now);
    return this.getAppByPackage(packageId)!;
  }

  deleteApp(id: number): void {
    this.db.prepare('DELETE FROM apps WHERE id = ?').run(id);
  }

  // ---------- keywords ----------
  listKeywords(appId: number, activeOnly = false): KeywordRow[] {
    const sql = activeOnly
      ? 'SELECT * FROM keywords WHERE app_id = ? AND active = 1 ORDER BY id'
      : 'SELECT * FROM keywords WHERE app_id = ? ORDER BY id';
    return this.db.prepare(sql).all(appId) as unknown as KeywordRow[];
  }

  getKeyword(id: number): KeywordRow | null {
    return (this.db.prepare('SELECT * FROM keywords WHERE id = ?').get(id) as unknown as KeywordRow) ?? null;
  }

  addKeyword(appId: number, term: string): KeywordRow {
    const clean = term.trim().replace(/\s+/g, ' ');
    const existing = this.db
      .prepare('SELECT * FROM keywords WHERE app_id = ? AND term = ?')
      .get(appId, clean) as unknown as KeywordRow | undefined;
    if (existing) return existing;
    this.db
      .prepare('INSERT INTO keywords (app_id, term, active, created_at) VALUES (?, ?, 1, ?)')
      .run(appId, clean, new Date().toISOString());
    return this.db
      .prepare('SELECT * FROM keywords WHERE app_id = ? AND term = ?')
      .get(appId, clean) as unknown as KeywordRow;
  }

  deleteKeyword(id: number): void {
    this.db.prepare('DELETE FROM keywords WHERE id = ?').run(id);
  }

  toggleKeyword(id: number, active: boolean): void {
    this.db.prepare('UPDATE keywords SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }

  // ---------- app snapshots ----------
  saveAppSnapshot(appId: number, data: Omit<AppSnapshotRow, 'id' | 'app_id' | 'captured_at' | 'captured_date'>): AppSnapshotRow {
    const now = new Date().toISOString();
    const date = kstDateString();
    this.db
      .prepare(
        `INSERT INTO app_snapshots (app_id, captured_at, captured_date, title, developer, genre, score, ratings, reviews,
          installs, min_installs, max_installs, updated_ts, version, summary, description, icon, price_text, extra_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_id, captured_date) DO UPDATE SET
           captured_at = excluded.captured_at, title = excluded.title, developer = excluded.developer,
           genre = excluded.genre, score = excluded.score, ratings = excluded.ratings, reviews = excluded.reviews,
           installs = excluded.installs, min_installs = excluded.min_installs, max_installs = excluded.max_installs,
           updated_ts = excluded.updated_ts, version = excluded.version, summary = excluded.summary,
           description = excluded.description, icon = excluded.icon, price_text = excluded.price_text,
           extra_json = excluded.extra_json`,
      )
      .run(
        appId,
        now,
        date,
        data.title ?? null,
        data.developer ?? null,
        data.genre ?? null,
        data.score ?? null,
        data.ratings ?? null,
        data.reviews ?? null,
        data.installs ?? null,
        data.min_installs ?? null,
        data.max_installs ?? null,
        data.updated_ts ?? null,
        data.version ?? null,
        data.summary ?? null,
        data.description ?? null,
        data.icon ?? null,
        data.price_text ?? null,
        data.extra_json ?? null,
      );
    return this.latestAppSnapshot(appId)!;
  }

  latestAppSnapshot(appId: number): AppSnapshotRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM app_snapshots WHERE app_id = ? ORDER BY captured_at DESC LIMIT 1')
        .get(appId) as unknown as AppSnapshotRow) ?? null
    );
  }

  appSnapshotHistory(appId: number, limit = 60): AppSnapshotRow[] {
    return this.db
      .prepare('SELECT * FROM app_snapshots WHERE app_id = ? ORDER BY captured_date DESC LIMIT ?')
      .all(appId, limit) as unknown as AppSnapshotRow[];
  }

  // ---------- rank snapshots ----------
  saveRankSnapshot(row: {
    appId: number;
    keywordId: number;
    rank: number | null;
    scanned: number;
    status: string;
    error?: string | null;
    competitors?: unknown;
  }): RankSnapshotRow {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO rank_snapshots (app_id, keyword_id, captured_at, captured_date, rank, scanned, status, error, competitors_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.appId,
        row.keywordId,
        now,
        kstDateString(),
        row.rank,
        row.scanned,
        row.status,
        row.error ?? null,
        row.competitors ? JSON.stringify(row.competitors) : null,
      );
    return this.db.prepare('SELECT * FROM rank_snapshots WHERE id = last_insert_rowid()').get() as unknown as RankSnapshotRow;
  }

  latestRank(keywordId: number): RankSnapshotRow | null {
    return (
      (this.db
        .prepare('SELECT * FROM rank_snapshots WHERE keyword_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1')
        .get(keywordId) as unknown as RankSnapshotRow) ?? null
    );
  }

  /** 일자별 마지막 순위 (차트용) */
  rankHistory(keywordId: number, days = 30): { captured_date: string; rank: number | null; status: string }[] {
    const rows = this.db
      .prepare(
        `SELECT captured_date, rank, status FROM (
           SELECT captured_date, rank, status, captured_at, id,
                  ROW_NUMBER() OVER (PARTITION BY captured_date ORDER BY captured_at DESC, id DESC) AS rn
           FROM rank_snapshots WHERE keyword_id = ?
         ) WHERE rn = 1 ORDER BY captured_date ASC`,
      )
      .all(keywordId) as { captured_date: string; rank: number | null; status: string }[];
    return rows.slice(-days);
  }

  rankRowsSince(date: string): RankSnapshotRow[] {
    return this.db
      .prepare('SELECT * FROM rank_snapshots WHERE captured_date >= ? ORDER BY captured_at DESC')
      .all(date) as unknown as RankSnapshotRow[];
  }

  // ---------- drafts ----------
  saveDraft(draft: {
    appId: number;
    channel: string;
    title: string;
    bodyMd: string;
    bodyHtml: string;
    hashtags: string;
    ctaUrl: string;
    keywords: string[];
    generator: string;
    model?: string | null;
    warning?: string | null;
  }): DraftRow {
    this.db
      .prepare(
        `INSERT INTO content_drafts (app_id, channel, title, body_md, body_html, hashtags, cta_url, keywords_json, generator, model, warning, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      )
      .run(
        draft.appId,
        draft.channel,
        draft.title,
        draft.bodyMd,
        draft.bodyHtml,
        draft.hashtags,
        draft.ctaUrl,
        JSON.stringify(draft.keywords),
        draft.generator,
        draft.model ?? null,
        draft.warning ?? null,
        new Date().toISOString(),
      );
    return this.db.prepare('SELECT * FROM content_drafts WHERE id = last_insert_rowid()').get() as unknown as DraftRow;
  }

  listDrafts(limit = 50, appId?: number): DraftRow[] {
    if (appId) {
      return this.db
        .prepare('SELECT * FROM content_drafts WHERE app_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(appId, limit) as unknown as DraftRow[];
    }
    return this.db.prepare('SELECT * FROM content_drafts ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as DraftRow[];
  }

  getDraft(id: number): DraftRow | null {
    return (this.db.prepare('SELECT * FROM content_drafts WHERE id = ?').get(id) as unknown as DraftRow) ?? null;
  }

  updateDraftStatus(id: number, status: string): void {
    this.db.prepare('UPDATE content_drafts SET status = ? WHERE id = ?').run(status, id);
  }

  deleteAsoPlan(id: number): void {
    this.db.prepare('DELETE FROM aso_plans WHERE id = ?').run(id);
  }

  deleteDraft(id: number): void {
    this.db.prepare('DELETE FROM content_drafts WHERE id = ?').run(id);
  }

  // ---------- ASO 개편안 ----------
  saveAsoPlan(plan: {
    appId: number;
    title: string;
    summary: string;
    descriptionHead: string;
    keywords: string[];
    rationale?: string | null;
  }): AsoPlanRow {
    this.db
      .prepare(
        `INSERT INTO aso_plans (app_id, title, summary, description_head, keywords_json, rationale, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?)`,
      )
      .run(
        plan.appId,
        plan.title,
        plan.summary,
        plan.descriptionHead,
        JSON.stringify(plan.keywords),
        plan.rationale ?? null,
        new Date().toISOString(),
      );
    return this.db.prepare('SELECT * FROM aso_plans WHERE id = last_insert_rowid()').get() as unknown as AsoPlanRow;
  }

  listAsoPlans(appId: number, limit = 20): AsoPlanRow[] {
    return this.db
      .prepare('SELECT * FROM aso_plans WHERE app_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(appId, limit) as unknown as AsoPlanRow[];
  }

  latestAsoPlan(appId: number): AsoPlanRow | null {
    return (this.db.prepare('SELECT * FROM aso_plans WHERE app_id = ? ORDER BY created_at DESC LIMIT 1').get(appId) as unknown as AsoPlanRow) ?? null;
  }

  // ---------- webhook log ----------
  logWebhook(row: {
    draftId: number | null;
    event: string;
    url: string;
    ok: boolean;
    statusCode?: number | null;
    error?: string | null;
    responseSnippet?: string | null;
  }): void {
    this.db
      .prepare(
        'INSERT INTO webhook_deliveries (draft_id, event, url, ok, status_code, error, response_snippet, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        row.draftId,
        row.event,
        row.url,
        row.ok ? 1 : 0,
        row.statusCode ?? null,
        row.error ?? null,
        row.responseSnippet ?? null,
        new Date().toISOString(),
      );
  }

  recentWebhookDeliveries(limit = 20): unknown[] {
    return this.db
      .prepare('SELECT * FROM webhook_deliveries ORDER BY created_at DESC LIMIT ?')
      .all(limit) as unknown[];
  }

  // ---------- competitor cache ----------
  getCompetitor(packageId: string, maxAgeMs = 20 * 3_600_000): {
    package_id: string;
    title: string | null;
    developer: string | null;
    score: number | null;
    installs: string | null;
    summary: string | null;
    description: string | null;
    genre: string | null;
    fetched_at: string;
  } | null {
    const row = this.db
      .prepare('SELECT * FROM competitor_cache WHERE package_id = ?')
      .get(packageId) as
      | {
          package_id: string;
          title: string | null;
          developer: string | null;
          score: number | null;
          installs: string | null;
          summary: string | null;
          description: string | null;
          genre: string | null;
          fetched_at: string;
        }
      | undefined;
    if (!row) return null;
    if (Date.now() - Date.parse(row.fetched_at) > maxAgeMs) return null;
    return row;
  }

  saveCompetitor(data: {
    packageId: string;
    title: string | null;
    developer: string | null;
    score: number | null;
    installs: string | null;
    summary: string | null;
    description: string | null;
    genre: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO competitor_cache (package_id, title, developer, score, installs, summary, description, genre, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(package_id) DO UPDATE SET title = excluded.title, developer = excluded.developer,
           score = excluded.score, installs = excluded.installs, summary = excluded.summary,
           description = excluded.description, genre = excluded.genre, fetched_at = excluded.fetched_at`,
      )
      .run(
        data.packageId,
        data.title,
        data.developer,
        data.score,
        data.installs,
        data.summary,
        data.description,
        data.genre,
        new Date().toISOString(),
      );
  }

  // ---------- jobs ----------
  startJob(kind: string, meta?: unknown): number {
    this.db
      .prepare('INSERT INTO job_runs (kind, started_at, status, meta_json) VALUES (?, ?, ?, ?)')
      .run(kind, new Date().toISOString(), 'running', meta ? JSON.stringify(meta) : null);
    const row = this.db.prepare('SELECT id FROM job_runs WHERE id = last_insert_rowid()').get() as { id: number };
    return row.id;
  }

  finishJob(id: number, status: string, message?: string): void {
    this.db
      .prepare('UPDATE job_runs SET finished_at = ?, status = ?, message = ? WHERE id = ?')
      .run(new Date().toISOString(), status, message ?? null, id);
  }

  recentJobs(limit = 15): unknown[] {
    return this.db.prepare('SELECT * FROM job_runs ORDER BY started_at DESC LIMIT ?').all(limit) as unknown[];
  }

  // ---------- 쇼츠 ----------
  createShort(row: {
    appId: number;
    mood: string;
    engine: string;
    videoProvider: string;
    ttsProvider: string;
  }): ShortRow {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO shorts (app_id, status, stage, progress, engine, video_provider, tts_provider, mood, created_at, updated_at)
         VALUES (?, 'queued', 'queued', 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.appId, row.engine, row.videoProvider, row.ttsProvider, row.mood, now, now);
    const created = this.db.prepare('SELECT * FROM shorts WHERE id = last_insert_rowid()').get() as unknown as ShortRow;
    return created;
  }

  updateShort(
    id: number,
    patch: Partial<
      Pick<
        ShortRow,
        | 'status'
        | 'stage'
        | 'progress'
        | 'engine'
        | 'video_provider'
        | 'tts_provider'
        | 'title'
        | 'description'
        | 'hashtags'
        | 'script_json'
        | 'file_path'
        | 'file_bytes'
        | 'duration_sec'
        | 'width'
        | 'height'
        | 'fps'
        | 'warnings_json'
        | 'error'
        | 'finished_at'
      >
    >,
  ): void {
    const keys = Object.keys(patch).filter((key) => patch[key as keyof typeof patch] !== undefined);
    if (keys.length === 0) return;
    const sets = keys.map((key) => `${key} = ?`).join(', ');
    const values = keys.map((key) => patch[key as keyof typeof patch] as never);
    this.db.prepare(`UPDATE shorts SET ${sets}, updated_at = ? WHERE id = ?`).run(...values, new Date().toISOString(), id);
  }

  getShort(id: number): ShortRow | null {
    return (this.db.prepare('SELECT * FROM shorts WHERE id = ?').get(id) as unknown as ShortRow) ?? null;
  }

  listShorts(limit = 40): ShortRow[] {
    return this.db.prepare('SELECT * FROM shorts ORDER BY created_at DESC, id DESC LIMIT ?').all(limit) as unknown as ShortRow[];
  }

  deleteShort(id: number): void {
    this.db.prepare('DELETE FROM shorts WHERE id = ?').run(id);
  }

  counts(): { apps: number; keywords: number; drafts: number } {
    const a = this.db.prepare('SELECT COUNT(*) AS c FROM apps').get() as { c: number };
    const k = this.db.prepare('SELECT COUNT(*) AS c FROM keywords').get() as { c: number };
    const d = this.db.prepare('SELECT COUNT(*) AS c FROM content_drafts').get() as { c: number };
    return { apps: a.c, keywords: k.c, drafts: d.c };
  }
}
