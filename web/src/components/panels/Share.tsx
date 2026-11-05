import { useEffect, useState } from 'react';
import { api, fmtDate } from '../../api';
import { captureThumb } from '../Viewer';

export default function SharePanel({ projectId, modelId, modelName, canWrite, onBeforeShare }: { projectId: string; modelId: string; modelName: string; canWrite: boolean; onBeforeShare: () => Promise<void> }) {
  const [list, setList] = useState<any[]>([]);
  const [f, setF] = useState({ title: '', password: '', expiresAt: '', listed: true });
  const [err, setErr] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const load = () => api(`/projects/${projectId}/shares`).then(setList);
  useEffect(() => { load(); }, [projectId]);
  async function create() {
    setErr('');
    try {
      await onBeforeShare();
      // 고객사 쇼룸 목록에 보일 썸네일 = 지금 화면
      const img = captureThumb(); if (img) await api(`/models/${modelId}/thumbnail`, { method: 'PUT', body: { image: img } }).catch(() => {});
      await api(`/models/${modelId}/shares`, { body: { title: f.title || modelName, password: f.password || undefined, listed: f.listed, expiresAt: f.expiresAt ? new Date(f.expiresAt + 'T23:59:59').toISOString() : undefined } });
      setF({ title: '', password: '', expiresAt: '', listed: true }); load();
    } catch (e: any) { setErr(e.message); }
  }
  const mine = list.filter((s) => s.model_id === modelId);
  const state = (s: any) => s.revoked_at ? ['폐기됨', 'text-bad'] : s.expires_at && new Date(s.expires_at) < new Date() ? ['만료', 'text-warn'] : ['사용 중', 'text-ok'];
  return (
    <div className="space-y-3 p-3">
      <div className="panel-title">웹주소(URL) 쇼룸 공유</div>
      <p className="text-xs text-mute">받는 사람은 로그인 없이 브라우저·스마트폰에서 회전·분해·조립 애니메이션·부품 설명을 볼 수 있습니다. 원본 CAD 파일은 공개되지 않습니다.</p>
      {canWrite && <div className="space-y-2 rounded-md border border-line bg-panel2 p-2.5">
        <input className="input" placeholder={`제목 (기본: ${modelName})`} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" type="password" placeholder="비밀번호 (선택)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <input className="input" type="date" title="만료일 (선택)" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={f.listed} onChange={(e) => setF({ ...f, listed: e.target.checked })} data-testid="share-listed" />고객사 쇼룸 목록(/c/…)에도 표시</label>
        <button className="btn btn-accent w-full justify-center" onClick={create} data-testid="share-create">공유 링크 만들기 (현재 장면 저장 후)</button>
        {err && <div className="text-xs text-bad">{err}</div>}
      </div>}
      {mine.map((s) => {
        const [lab, cls] = state(s);
        return (
          <div key={s.id} className="space-y-1.5 rounded-md border border-line p-2.5 text-xs" data-testid="share-row">
            <div className="flex items-center gap-2"><b className="truncate">{s.title}</b><span className={`ml-auto ${cls}`}>{lab}</span></div>
            <div className="flex gap-1"><input className="input num h-7 flex-1 text-[11px]" readOnly value={s.url} data-testid="share-url" onFocus={(e) => e.target.select()} />
              <button className="btn h-7 px-2 text-xs" onClick={() => navigator.clipboard?.writeText(s.url)}>복사</button>
              <a className="btn h-7 px-2 text-xs" href={s.url} target="_blank" rel="noreferrer">열기</a></div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-mute">
              <span>방문 <b className="num text-ink">{s.view_count}</b></span>{s.has_password && <span>🔒 비밀번호</span>}
              {s.expires_at && <span>만료 {fmtDate(s.expires_at)}</span>}<span>{fmtDate(s.created_at)}</span>
              {canWrite && !s.revoked_at && <label className="flex items-center gap-1"><input type="checkbox" checked={s.listed} onChange={async (e) => { await api(`/shares/${s.id}`, { method: 'PATCH', body: { listed: e.target.checked } }); load(); }} />쇼룸 목록</label>}
            </div>
            {!s.revoked_at && <div className="flex flex-wrap gap-1">
              <button className="btn h-6 px-2 text-xs" onClick={() => setQr(qr === s.id ? null : s.id)}>QR코드</button>
              <button className="btn h-6 px-2 text-xs" onClick={() => navigator.clipboard?.writeText(`<iframe src="${s.url}" width="960" height="600" style="border:0" allowfullscreen></iframe>`)}>iframe 코드 복사</button>
              {canWrite && <><button className="btn h-6 px-2 text-xs" onClick={async () => { await api(`/shares/${s.id}/reissue`, { method: 'POST' }); load(); }}>재발급</button>
                <button className="btn h-6 px-2 text-xs text-bad" onClick={async () => { if (confirm('이 링크를 폐기할까요? 더 이상 열리지 않습니다.')) { await api(`/shares/${s.id}`, { method: 'PATCH', body: { revoke: true } }); load(); } }}>폐기</button></>}
            </div>}
            {qr === s.id && <div className="flex items-end gap-2 pt-1"><img src={`/api/shares/${s.id}/qr.png`} alt="QR" className="h-36 w-36 rounded bg-white p-1" data-testid="qr" />
              <a className="btn h-6 px-2 text-xs" href={`/api/shares/${s.id}/qr.png`} download={`qr-${s.token}.png`}>PNG 저장</a></div>}
          </div>
        );
      })}
      {!mine.length && <div className="text-xs text-mute">이 모델의 공유 링크가 없습니다.</div>}
    </div>
  );
}
