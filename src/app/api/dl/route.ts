import { cookies } from 'next/headers';
import { sessionUser } from '../../../server/auth.ts';
import { openDownload } from '../../../server/trade.ts';
import { AppError } from '../../../server/util.ts';
import { fileResponse } from '../../../server/http.ts';

// 만료되는 서명 링크로만 내려받을 수 있다
export async function GET(req: Request) {
  try {
    const user = await sessionUser((await cookies()).get('sid')?.value);
    const { file, stream } = await openDownload(user, new URL(req.url).searchParams.get('t') || '', req.headers.get('x-forwarded-for')?.split(',')[0] || '');
    return fileResponse(file, stream);
  } catch (e: any) { return new Response(e instanceof AppError ? e.message : '다운로드 오류', { status: e instanceof AppError ? e.status : 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
}
