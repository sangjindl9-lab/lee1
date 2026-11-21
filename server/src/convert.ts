import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { httpError, requireUser } from './auth.js';

/**
 * Word·PowerPoint·Excel·한글(hwp는 LibreOffice 지원 범위 내)·RTF·ODF → PDF 변환(서버의 LibreOffice).
 * 변환이 끝나면 임시 파일은 즉시 삭제(문서 보관 안 함).
 */
const ALLOWED = ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'odp', 'ods', 'rtf', 'hwp', 'hwpx', 'txt'];

export function convertRoutes(app: FastifyInstance) {
  app.post('/v1/convert', { bodyLimit: 100 * 1024 * 1024 }, async (req, reply) => {
    await requireUser(req);
    const name = String((req.query as any).name ?? 'file');
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED.includes(ext)) throw httpError(415, 'unsupported_format');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw httpError(400, 'empty');
    const dir = mkdtempSync(join(tmpdir(), 'conv-'));
    try {
      const src = join(dir, `in.${ext}`);
      writeFileSync(src, body);
      await new Promise<void>((res, rej) => execFile(process.env.SOFFICE ?? 'soffice', ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', dir, src],
        { timeout: 120_000 }, (e) => (e ? rej(e) : res())))
        .catch((e) => { throw (e as any)?.code === 'ENOENT' ? httpError(503, 'converter_not_available') : httpError(422, 'conversion_failed'); });
      const pdf = readdirSync(dir).find((f) => f.endsWith('.pdf'));
      if (!pdf) throw httpError(422, 'conversion_failed');
      reply.type('application/pdf');
      return readFileSync(join(dir, pdf));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
