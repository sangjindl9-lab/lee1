import { processWebhook } from '../../../../server/trade.ts';
import { config } from '../../../../server/config.ts';

// 테스트 결제 시뮬레이터 웹훅. 원문 그대로 서명을 검증한다.
export async function POST(req: Request) {
  if (config.paymentProvider !== 'test') return new Response('not found', { status: 404 });
  try { const r = await processWebhook(await req.text(), req.headers.get('x-simpg-signature') || ''); return Response.json({ ok: true, duplicate: r.duplicate }); }
  catch (e: any) { return Response.json({ ok: false, error: e.code || 'ERROR' }, { status: e.code?.includes('SIGNATURE') ? 401 : 500 }); }
}
