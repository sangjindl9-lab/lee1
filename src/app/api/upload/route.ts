import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cookies } from 'next/headers';
import { sessionUser } from '../../../server/auth.ts';
import { addFile } from '../../../server/catalog.ts';
import { config } from '../../../server/config.ts';
import { AppError, randomId } from '../../../server/util.ts';

// 납품 파일 업로드. 같은 출처의 로그인 사용자만 허용하고, 용량을 제한한다.
export async function POST(req: Request) {
  const url = new URL(req.url);
  const back = url.searchParams.get('back') || '/seller';
  const done = (key: string, msg: string) => new Response(null, { status: 303, headers: { Location: `${back.startsWith('/') && !back.startsWith('//') ? back : '/seller'}?${key}=${encodeURIComponent(msg)}` } });
  try {
    const origin = req.headers.get('origin'); const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    if (!origin || new URL(origin).host !== host) throw new AppError('허용되지 않은 요청입니다', 403);
    const user = await sessionUser((await cookies()).get('sid')?.value);
    if (!user) throw new AppError('로그인이 필요합니다', 401);
    if (Number(req.headers.get('content-length') || 0) > config.maxUploadBytes + 1024 * 1024) throw new AppError(`파일은 ${Math.round(config.maxUploadBytes / 1048576)}MB 까지 올릴 수 있습니다`);
    const fd = await req.formData();
    const file = fd.get('file');
    if (!(file instanceof File)) throw new AppError('파일을 선택하세요');
    if (file.size > config.maxUploadBytes) throw new AppError(`파일은 ${Math.round(config.maxUploadBytes / 1048576)}MB 까지 올릴 수 있습니다`);
    const tmp = path.join(os.tmpdir(), `eum-up-${randomId(8)}`);
    fs.writeFileSync(tmp, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    await addFile(user, Number(fd.get('version_id')), String(fd.get('kind') || ''), tmp, file.name);
    return done('ok', '파일을 보관하고 검사했습니다');
  } catch (e: any) {
    if (!(e instanceof AppError)) console.error('[upload]', e);
    return done('err', e instanceof AppError ? e.message : '업로드 처리 중 오류가 발생했습니다');
  }
}
