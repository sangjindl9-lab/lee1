/**
 * 백업 — 데이터베이스(pg_dump custom 형식) + 첨부파일(tar.gz). 시스템관리자만.
 *  - 백업 직후 pg_restore --list 로 파일이 온전한지 검증하고 SHA-256 을 기록
 *  - 자동 백업: 매일 BACKUP_HOUR(기본 3시, 한국시간)에 한 번, 최근 BACKUP_KEEP(기본 14)개만 보관
 *  - 복구는 화면에서 하지 않는다 (운영 중 데이터를 덮어쓰는 위험) — 설치 설명서의 복구 절차를 따른다
 */
import { Controller, ForbiddenException, Get, HttpCode, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import type { Response } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { AccessContext, Ctx, RequirePermission } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { config } from '../config';
import { DB, DB_TOKEN } from '../db/db';
import { backups } from '../db/schema';

const run = promisify(execFile);
const DIR = path.resolve(process.env.BACKUP_DIR ?? path.join(path.dirname(path.resolve(config.FILE_STORAGE_PATH)), 'backups'));
const KEEP = Number(process.env.BACKUP_KEEP ?? 14);
const HOUR = Number(process.env.BACKUP_HOUR ?? 3);

async function fileSha(p: string) {
  const h = createHash('sha256');
  for await (const c of createReadStream(p)) h.update(c as Buffer);
  return h.digest('hex');
}

@Injectable()
export class BackupsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly audit: AuditService) {}

  onModuleInit() {
    if (config.NODE_ENV === 'test' || process.env.BACKUP_AUTO === 'false') return;
    // 10분마다 확인해서, 정해진 시각이고 오늘 자동 백업이 없으면 실행
    this.timer = setInterval(() => void this.autoTick(), 10 * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async autoTick() {
    const kst = new Date(Date.now() + 9 * 3600000);
    if (kst.getUTCHours() !== HOUR) return;
    const day = kst.toISOString().slice(0, 10);
    const r = (await this.db.execute(sql`select 1 from backup_record where kind = 'AUTO' and (started_at + interval '9 hours')::date = ${day}::date limit 1`)).rows;
    if (r.length) return;
    await this.create(null, 'AUTO');
  }

  async create(ctx: AccessContext | null, kind: 'MANUAL' | 'AUTO') {
    if (this.busy) throw new ForbiddenException({ code: 'BACKUP_RUNNING', message: '백업이 이미 진행 중입니다' });
    this.busy = true;
    const [rec] = await this.db.insert(backups).values({ kind, createdById: ctx?.user.id ?? null, createdByName: ctx?.user.name ?? '자동' }).returning();
    void (async () => {
      try {
        await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
        const stamp = new Date(Date.now() + 9 * 3600000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const dbFile = path.join(DIR, `sserp-db-${stamp}.dump`);
        const filesFile = path.join(DIR, `sserp-files-${stamp}.tar.gz`);
        await run('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', dbFile, '--dbname', config.DATABASE_URL], { timeout: 30 * 60_000, maxBuffer: 10 * 1024 * 1024 });
        const storage = path.resolve(config.FILE_STORAGE_PATH);
        await fs.mkdir(storage, { recursive: true });
        await run('tar', ['-czf', filesFile, '-C', storage, '.'], { timeout: 30 * 60_000 });
        const list = await run('pg_restore', ['--list', dbFile], { timeout: 5 * 60_000, maxBuffer: 50 * 1024 * 1024 });
        const tables = (list.stdout.match(/TABLE DATA/g) ?? []).length;
        const [ds, fsz] = await Promise.all([fs.stat(dbFile), fs.stat(filesFile)]);
        await this.db.update(backups).set({
          status: 'DONE', dbFile: path.basename(dbFile), filesFile: path.basename(filesFile), dbSize: ds.size, filesSize: fsz.size, sha256: await fileSha(dbFile),
          verified: tables > 0, verifyMessage: `pg_restore 목록 확인: 테이블 데이터 ${tables}개`, finishedAt: new Date(),
        }).where(eq(backups.id, rec.id));
        await this.prune();
        if (ctx) await this.audit.fromCtx(ctx, { action: 'BACKUP', resource: 'company', summary: `백업 완료 ${path.basename(dbFile)} (${(ds.size / 1024 / 1024).toFixed(1)}MB, 테이블 ${tables}개)` });
        else await this.audit.write({ action: 'BACKUP', resource: 'company', summary: `자동 백업 완료 ${path.basename(dbFile)}`, userName: '자동' });
      } catch (e) {
        await this.db.update(backups).set({ status: 'FAILED', errorMessage: (e as Error).message.slice(0, 800), finishedAt: new Date() }).where(eq(backups.id, rec.id));
      } finally {
        this.busy = false;
      }
    })();
    return rec;
  }

  private async prune() {
    const all = await this.db.select().from(backups).where(eq(backups.status, 'DONE')).orderBy(desc(backups.startedAt));
    for (const b of all.slice(KEEP)) {
      for (const f of [b.dbFile, b.filesFile]) if (f) await fs.rm(path.join(DIR, f), { force: true });
      await this.db.update(backups).set({ status: 'FAILED', errorMessage: `보관 개수(${KEEP})를 넘어 파일 삭제` }).where(eq(backups.id, b.id));
    }
  }

  async list() {
    const rows = await this.db.select().from(backups).orderBy(desc(backups.startedAt)).limit(60);
    let free: number | null = null;
    try {
      const st = await fs.statfs(DIR).catch(async () => fs.statfs(path.dirname(DIR)));
      free = st.bavail * st.bsize;
    } catch {
      free = null;
    }
    return { dir: DIR, keep: KEEP, autoHour: HOUR, auto: process.env.BACKUP_AUTO !== 'false', freeBytes: free, rows, running: this.busy };
  }

  async download(ctx: AccessContext, id: string, which: 'db' | 'files', res: Response) {
    const [b] = await this.db.select().from(backups).where(eq(backups.id, id));
    const name = which === 'db' ? b?.dbFile : b?.filesFile;
    if (!b || b.status !== 'DONE' || !name) throw new NotFoundException({ code: 'NOT_FOUND', message: '백업 파일이 없습니다' });
    const full = path.join(DIR, path.basename(name));
    await fs.access(full).catch(() => {
      throw new NotFoundException({ code: 'NOT_FOUND', message: '백업 파일이 지워졌습니다' });
    });
    await this.audit.fromCtx(ctx, { action: 'DOWNLOAD', resource: 'company', summary: `백업 파일 내려받기 ${name}` });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    createReadStream(full).pipe(res);
  }
}

const sysAdmin = (ctx: AccessContext) => {
  if (!ctx.user.isSystemAdmin) throw new ForbiddenException({ code: 'SYSTEM_ADMIN_ONLY', message: '백업은 시스템관리자만 다룰 수 있습니다 (모든 회사의 자료가 들어 있음)' });
};

@ApiTags('관리 · 백업')
@Controller('backups')
export class BackupsController {
  constructor(private readonly svc: BackupsService) {}

  @Get()
  @RequirePermission('company', 'read')
  list(@Ctx() ctx: AccessContext) {
    sysAdmin(ctx);
    return this.svc.list();
  }

  @Post()
  @HttpCode(202)
  @RequirePermission('company', 'update')
  create(@Ctx() ctx: AccessContext) {
    sysAdmin(ctx);
    return this.svc.create(ctx, 'MANUAL');
  }

  @Get(':id/:which')
  @RequirePermission('company', 'update')
  download(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Param('which') which: string, @Res() res: Response) {
    sysAdmin(ctx);
    return this.svc.download(ctx, id, which === 'files' ? 'files' : 'db', res);
  }
}
