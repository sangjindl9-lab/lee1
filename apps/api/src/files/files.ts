import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Res,
  UploadedFile, UseInterceptors, ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import type { Response } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
// file-type 16 은 CommonJS 버전 (실제 파일 서명 검사용)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FileType = require('file-type') as { fromBuffer(b: Buffer): Promise<{ ext: string; mime: string } | undefined> };
import { config } from '../config';
import { AccessService } from '../access/access.service';
import { AccessContext, can, Ctx } from '../access/context';
import { AuditService } from '../audit/audit.service';
import { sha256 } from '../common/crypto';
import { notFound } from '../common/errors';
import { ZodPipe } from '../common/zod.pipe';
import { DB, DB_TOKEN } from '../db/db';
import { fileObjects, projects, vendors } from '../db/schema';

/** 저장소 어댑터 — 로컬 디스크. S3 호환 저장소는 같은 인터페이스로 추가한다 */
export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  stream(key: string): NodeJS.ReadableStream;
}

class LocalStorage implements StorageAdapter {
  constructor(private readonly root: string) {}
  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('잘못된 경로');
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { mode: 0o640, flag: 'wx' });
  }
  stream(key: string) {
    return createReadStream(this.resolve(key));
  }
}

/** 허용 형식: 확장자와 실제 파일 서명이 모두 맞아야 한다 */
const ALLOWED: Record<string, { sig: string[]; mime: string }> = {
  pdf: { sig: ['pdf'], mime: 'application/pdf' },
  jpg: { sig: ['jpg'], mime: 'image/jpeg' },
  jpeg: { sig: ['jpg'], mime: 'image/jpeg' },
  png: { sig: ['png'], mime: 'image/png' },
  webp: { sig: ['webp'], mime: 'image/webp' },
  xlsx: { sig: ['xlsx', 'zip'], mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  docx: { sig: ['docx', 'zip'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pptx: { sig: ['pptx', 'zip'], mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  hwp: { sig: ['cfb'], mime: 'application/x-hwp' },
  hwpx: { sig: ['zip'], mime: 'application/hwp+zip' },
  xls: { sig: ['cfb'], mime: 'application/vnd.ms-excel' },
  dwg: { sig: ['@dwg'], mime: 'image/vnd.dwg' },
  zip: { sig: ['zip'], mime: 'application/zip' },
};

async function detect(buf: Buffer): Promise<string | undefined> {
  if (buf.subarray(0, 4).toString('latin1').startsWith('AC10')) return '@dwg';
  return (await FileType.fromBuffer(buf))?.ext;
}

const CATEGORIES = ['contract', 'drawing', 'estimate', 'bizreg', 'bankbook', 'photo', 'etc'] as const;
const UploadDto = z.object({
  category: z.enum(CATEGORIES).default('etc'),
  projectId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
});

@Injectable()
export class FilesService {
  private readonly storage: StorageAdapter = new LocalStorage(path.resolve(config.FILE_STORAGE_PATH));
  constructor(@Inject(DB_TOKEN) private readonly db: DB, private readonly access: AccessService, private readonly audit: AuditService) {}

  /** 파일이 붙을 대상(현장·거래처)에 대한 권한 확인 */
  private async assertTarget(ctx: AccessContext, t: { projectId?: string | null; vendorId?: string | null }, action: 'read' | 'update') {
    if (t.projectId) {
      if (!can(ctx, 'project', action)) throw new ForbiddenException({ code: 'FORBIDDEN', message: '이 현장의 파일을 다룰 권한이 없습니다' });
      const [p] = await this.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, t.projectId), eq(projects.companyId, ctx.companyId!), isNull(projects.deletedAt)));
      if (!p || !this.access.canSeeProject(ctx, p.id)) throw notFound('현장');
    } else if (t.vendorId) {
      if (!can(ctx, 'vendor', action)) throw new ForbiddenException({ code: 'FORBIDDEN', message: '이 거래처의 파일을 다룰 권한이 없습니다' });
      const [v] = await this.db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, t.vendorId), eq(vendors.companyId, ctx.companyId!), isNull(vendors.deletedAt)));
      if (!v) throw notFound('거래처');
    } else {
      throw new BadRequestException({ code: 'NO_TARGET', message: '파일을 첨부할 현장 또는 거래처를 지정해 주세요' });
    }
  }

  async upload(ctx: AccessContext, file: Express.Multer.File | undefined, dto: z.infer<typeof UploadDto>) {
    if (!file) throw new BadRequestException({ code: 'NO_FILE', message: '파일을 선택해 주세요' });
    await this.assertTarget(ctx, dto, 'update');
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
    const ext = path.extname(originalName).slice(1).toLowerCase();
    const rule = ALLOWED[ext];
    if (!rule) throw new BadRequestException({ code: 'FILE_TYPE', message: `허용되지 않는 파일 형식입니다 (.${ext || '없음'}). PDF·이미지·엑셀·워드·한글·DWG 파일만 올릴 수 있습니다` });
    const real = await detect(file.buffer);
    if (!real || !rule.sig.includes(real)) {
      throw new BadRequestException({ code: 'FILE_SIGNATURE', message: '파일 내용이 확장자와 다릅니다. 손상되었거나 위장된 파일일 수 있어 업로드를 막았습니다' });
    }
    const now = new Date();
    const key = `${ctx.companyId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer);
    return this.db.transaction(async (tx) => {
      const [f] = await tx
        .insert(fileObjects)
        .values({ companyId: ctx.companyId!, projectId: dto.projectId ?? null, vendorId: dto.vendorId ?? null, category: dto.category, originalName, storageKey: key, mimeType: rule.mime, size: file.size, sha256: sha256(file.buffer), createdById: ctx.user.id })
        .returning();
      await this.audit.fromCtx(ctx, { action: 'UPLOAD', resource: 'file', resourceId: f.id, summary: `파일 첨부 ${originalName}`, after: { projectId: f.projectId, vendorId: f.vendorId, category: f.category, sha256: f.sha256, size: f.size } }, tx);
      const { storageKey, ...out } = f;
      return out;
    });
  }

  async find(ctx: AccessContext, id: string, action: 'read' | 'update') {
    const [f] = await this.db.select().from(fileObjects).where(and(eq(fileObjects.id, id), eq(fileObjects.companyId, ctx.companyId!), isNull(fileObjects.deletedAt)));
    if (!f) throw notFound('파일');
    await this.assertTarget(ctx, f, action);
    return f;
  }

  async download(ctx: AccessContext, id: string, res: Response) {
    const f = await this.find(ctx, id, 'read');
    await this.audit.fromCtx(ctx, { action: 'DOWNLOAD', resource: 'file', resourceId: id, summary: `파일 내려받기 ${f.originalName}` });
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Length', String(f.size));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.originalName)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    this.storage.stream(f.storageKey).pipe(res);
  }

  /** 문서 스캔용 저장 — 현장·거래처가 아직 정해지지 않은 파일. PDF·이미지만 */
  async storeScan(ctx: AccessContext, file: Express.Multer.File | undefined, projectId?: string | null) {
    if (!file) throw new BadRequestException({ code: 'NO_FILE', message: '파일을 선택해 주세요' });
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
    const ext = path.extname(originalName).slice(1).toLowerCase();
    if (!['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) throw new BadRequestException({ code: 'FILE_TYPE', message: 'PDF 또는 사진(JPG·PNG·WEBP)만 인식할 수 있습니다' });
    const rule = ALLOWED[ext];
    const real = await detect(file.buffer);
    if (!real || !rule.sig.includes(real)) throw new BadRequestException({ code: 'FILE_SIGNATURE', message: '파일 내용이 확장자와 다릅니다. 손상되었거나 위장된 파일일 수 있어 업로드를 막았습니다' });
    const now = new Date();
    const key = `${ctx.companyId}/scan/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer);
    const [f] = await this.db.insert(fileObjects).values({ companyId: ctx.companyId!, projectId: projectId ?? null, category: 'scan', originalName, storageKey: key, mimeType: rule.mime, size: file.size, sha256: sha256(file.buffer), createdById: ctx.user.id }).returning();
    return f;
  }

  /** 권한 확인은 호출한 쪽(문서 스캔)이 한다 */
  async streamRaw(fileId: string, companyId: string, res: Response, inline = true) {
    const [f] = await this.db.select().from(fileObjects).where(and(eq(fileObjects.id, fileId), eq(fileObjects.companyId, companyId)));
    if (!f) throw notFound('파일');
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Length', String(f.size));
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.originalName)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    this.storage.stream(f.storageKey).pipe(res);
  }

  async readBuffer(fileId: string, companyId: string) {
    const [f] = await this.db.select().from(fileObjects).where(and(eq(fileObjects.id, fileId), eq(fileObjects.companyId, companyId)));
    if (!f) throw notFound('파일');
    const chunks: Buffer[] = [];
    for await (const c of this.storage.stream(f.storageKey) as AsyncIterable<Buffer>) chunks.push(c);
    return { file: f, buffer: Buffer.concat(chunks) };
  }

  /** 첨부 해제 (원본은 보존, 목록에서만 제외) */
  async remove(ctx: AccessContext, id: string) {
    const f = await this.find(ctx, id, 'update');
    await this.db.transaction(async (tx) => {
      await tx.update(fileObjects).set({ deletedAt: new Date() }).where(eq(fileObjects.id, id));
      await this.audit.fromCtx(ctx, { action: 'DELETE', resource: 'file', resourceId: id, summary: `첨부 해제 ${f.originalName}` }, tx);
    });
  }
}

@ApiTags('파일')
@Controller('files')
export class FilesController {
  constructor(private readonly svc: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config.FILE_MAX_MB * 1024 * 1024, files: 1 } }))
  upload(@Ctx() ctx: AccessContext, @UploadedFile() file: Express.Multer.File, @Body(new ZodPipe(UploadDto)) dto: z.infer<typeof UploadDto>) {
    return this.svc.upload(ctx, file, dto);
  }

  @Get(':id/download')
  download(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return this.svc.download(ctx, id, res);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Ctx() ctx: AccessContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.remove(ctx, id);
  }
}
