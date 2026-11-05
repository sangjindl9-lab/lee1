import { useState } from 'react';
import { api } from '../api';
import { useWS } from '../store';

// AI 추정 형상(투상도 결합 초안) 검토·승인 표시
export default function ReviewBanner({ canWrite }: { canWrite: boolean }) {
  const model: any = useWS((s) => s.model);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const st = model.review_status;
  async function decide(decision: 'approved' | 'rejected') {
    setBusy(true);
    try { const r = await api(`/models/${model.id}/review`, { body: { decision, note } }); useWS.setState({ model: { ...model, ...r } }); }
    finally { setBusy(false); }
  }
  const tone = st === 'approved' ? 'border-ok/50 text-ok' : st === 'rejected' ? 'border-bad/50 text-bad' : 'border-ai/60 text-ai';
  return (
    <div className={`absolute left-1/2 top-14 z-10 w-[min(34rem,calc(100%-1rem))] -translate-x-1/2 rounded-lg border bg-panel/95 p-3 text-xs shadow-lg backdrop-blur ${tone}`} data-testid="review-banner" data-status={st}>
      <div className="font-semibold">{st === 'pending' ? 'AI 추정 형상 — 검토 필요' : st === 'approved' ? '검토 승인된 추정 형상' : '반려된 추정 형상'}</div>
      <p className="mt-1 text-mute">{model.provenance?.note}</p>
      {model.review_note && st !== 'pending' && <p className="mt-1 text-ink">메모: {model.review_note}</p>}
      {st === 'pending' && canWrite && (
        <div className="mt-2 flex gap-1.5">
          <input className="input h-7 flex-1" placeholder="검토 메모 (선택)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="btn btn-accent h-7 px-3" disabled={busy} onClick={() => decide('approved')} data-testid="approve">승인</button>
          <button className="btn h-7 px-3" disabled={busy} onClick={() => decide('rejected')}>반려</button>
        </div>
      )}
    </div>
  );
}
