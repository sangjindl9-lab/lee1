import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';

// DXF 분석 결과(윤곽·치수)를 2D 로 보여주고, 사용자가 두께를 입력하면 돌출 3D 를 만든다
export default function DxfExtrude({ fileId, onClose, onCreated }: { fileId: string; onClose: () => void; onCreated: (modelId: string) => void }) {
  const [f, setF] = useState<any>(null);
  const [th, setTh] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/files/${fileId}`).then((x) => { setF(x); setSel(new Set(x.analysis.profiles.filter((p: any) => p.role === 'outer').map((p: any) => p.id))); }); }, [fileId]);
  const a = f?.analysis;
  const view = useMemo(() => {
    if (!a?.profiles?.length) return null;
    const xs = a.profiles.flatMap((p: any) => [p.bbox[0][0], p.bbox[1][0]]), ys = a.profiles.flatMap((p: any) => [p.bbox[0][1], p.bbox[1][1]]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = Math.max(maxX - minX, maxY - minY) * 0.06;
    return { vb: `${minX - pad} ${-(maxY + pad)} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`, sw: Math.max(maxX - minX, maxY - minY) / 300 };
  }, [a]);
  async function make() {
    setErr(''); setBusy(true);
    try { const r = await api(`/files/${fileId}/extrude`, { body: { thickness: Number(th), profiles: [...sel] } }); onCreated(r.modelId); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-line bg-panel" onClick={(e) => e.stopPropagation()} data-testid="dxf-dialog">
        <div className="flex items-center border-b border-line px-4 py-3"><h2 className="font-semibold">DXF → 3D 생성 <span className="text-sm font-normal text-mute">{f?.original_name}</span></h2><button className="btn btn-ghost ml-auto" onClick={onClose}>✕</button></div>
        {!a ? <div className="p-6 text-mute">분석 결과 불러오는 중…</div> : (
          <div className="grid min-h-0 flex-1 gap-0 overflow-auto md:grid-cols-[1.4fr_1fr]">
            <div className="border-b border-line bg-bg p-3 md:border-b-0 md:border-r">
              {view && <svg viewBox={view.vb} className="h-[340px] w-full">
                {a.profiles.map((p: any) => {
                  const on = p.role === 'outer' ? sel.has(p.id) : sel.has(p.parent);
                  return <polygon key={p.id} points={p.points.map(([x, y]: number[]) => `${x},${-y}`).join(' ')}
                    fill={p.role === 'outer' ? (on ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'transparent') : 'var(--bg)'}
                    stroke={p.role === 'outer' ? (on ? 'var(--accent)' : 'var(--mute)') : 'var(--ok)'} strokeWidth={view.sw}
                    className={p.role === 'outer' ? 'cursor-pointer' : ''}
                    onClick={() => p.role === 'outer' && setSel((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} />;
                })}
              </svg>}
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-mute">
                <span><i className="mr-1 inline-block h-2 w-3 bg-accent/40 align-middle ring-1 ring-accent" />외곽(돌출 대상, 클릭해 선택)</span>
                <span><i className="mr-1 inline-block h-2 w-3 align-middle ring-1 ring-ok" />구멍</span>
              </div>
            </div>
            <div className="space-y-3 p-4 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info k="단위" v={a.unit} /><Info k="DXF 버전" v={a.version || '-'} />
                <Info k="닫힌 윤곽" v={`${a.profiles.length}개 (외곽 ${a.profiles.filter((p: any) => p.role === 'outer').length})`} />
                <Info k="열린 선분" v={String(a.openChains)} />
              </div>
              <div><div className="label mb-1">레이어</div><div className="flex flex-wrap gap-1">{a.layers.map((l: string) => <span key={l} className="chip">{l}</span>)}</div></div>
              <div><div className="label mb-1">치수 인식</div>
                {a.dimensions.length ? <ul className="space-y-0.5 text-xs">{a.dimensions.map((d: any, i: number) => (
                  <li key={i} className="flex gap-2"><span className="text-mute">{d.kind}</span><span className="num">{d.value ?? '?'} mm</span>
                    {d.matchesOutline ? <span className="text-ok">외곽과 일치</span> : <span className="text-warn">외곽과 불일치/부분 치수</span>}</li>))}</ul>
                  : <div className="text-xs text-mute">치수 객체 없음</div>}</div>
              {a.texts?.length > 0 && <div><div className="label mb-1">주석</div><div className="text-xs">{a.texts.join(' · ')}</div></div>}
              {a.warnings.map((w: string) => <div key={w} className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs text-warn">{w}</div>)}
              <label className="block space-y-1"><span className="label">두께 (mm) — 필수 입력</span>
                <input className="input num" type="number" min={0.01} step="any" value={th} onChange={(e) => setTh(e.target.value)} placeholder="예: 6" data-testid="thickness" autoFocus /></label>
              <div className="rounded-md border border-line bg-panel2 p-2 text-xs">
                <div className="mb-1 font-medium">생성 결과 형상 근거</div>
                <div><span className="text-ok">■</span> 원본 도면에서 확인: 외곽·구멍 윤곽</div>
                <div><span className="text-warn">■</span> 사용자 입력으로 확정: 두께 {th || '?'} mm</div>
                <div><span className="text-ai">■</span> AI 추정: 없음 (AI 형상 재구성은 3단계)</div>
              </div>
              {err && <div className="text-xs text-bad">{err}</div>}
              <button className="btn btn-accent h-9 w-full justify-center" disabled={!(Number(th) > 0) || !sel.size || busy} onClick={make} data-testid="extrude-go">{busy ? '생성 중…' : '3D 모델 생성'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
const Info = ({ k, v }: { k: string; v: string }) => <div className="rounded border border-line px-2 py-1"><div className="text-mute">{k}</div><div className="num">{v}</div></div>;
