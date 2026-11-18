import { runJobs } from '../../../server/trade.ts';
import { safeEqual } from '../../../server/util.ts';

// 외부 스케줄러가 호출하는 주기 작업(복구·기한 알림). JOBS_SECRET 이 설정된 경우에만 열린다.
export async function POST(req: Request) {
  const secret = process.env.JOBS_SECRET;
  if (!secret || !safeEqual(req.headers.get('authorization') || '', `Bearer ${secret}`)) return new Response('forbidden', { status: 403 });
  return Response.json({ errors: await runJobs() });
}
