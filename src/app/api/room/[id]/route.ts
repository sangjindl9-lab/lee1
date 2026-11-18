import { cookies } from 'next/headers';
import { sessionUser } from '../../../../server/auth.ts';
import { openRoomFile } from '../../../../server/ip.ts';
import { AppError } from '../../../../server/util.ts';
import { fileResponse } from '../../../../server/http.ts';

// 지식재산권 비공개 자료실: 승인받은 열람자만, 열람 기록을 남긴다
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await sessionUser((await cookies()).get('sid')?.value);
    const { file, stream } = await openRoomFile(user, Number((await ctx.params).id));
    return fileResponse(file, stream);
  } catch (e: any) { return new Response(e instanceof AppError ? e.message : '열람 오류', { status: e instanceof AppError ? e.status : 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
}
