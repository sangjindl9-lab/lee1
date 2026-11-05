import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';

// 2D 도면(DXF·DWG·PDF) 분석 결과를 보여주고, 두께(PDF 는 축척도)를 입력받아 돌출 3D 생성
export default function DxfExtrude({ fileId, onClose, onCreated }: { fileId: string; onClose: () => void; onCreated: (modelId: string) => void }) {
  const [f, setF] = useState<any>(null);
  const [th, setTh] = useState('');
  const [sc, setSc] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/files/${fileId}`).then((x) => {
      setF(x);
      const a = x.analysis;
      const outers = a.profiles.filter((p: any) => p.role === 'outer');
      // PDF 는 표제란 같은 사각형도 외곽으로 잡히므로 가장 큰 외곽 하나만 기본 선택
      // 상세도처럼 외곽이 많은 도면은 자동 선택하지 않는다
      setSel(new Set((a.sheet || outers.length > 20 ? [] : a.format === 'PDF' ? outers.slice(0, 1) : outers).map((p: any) => p.id)));
      if (a.scaleHint) setSc(String(a.scaleHint));
    });
  }, [fileId]);
  const a = f?.analysis;
  const pdf = a?.format === 'PDF';
  const k = pdf ? Number(sc) || 0 : 1;
  const view = useMemo(() => {
    if (!a) return null;
    if (pdf) return { vb: `0 ${-a.page.height} ${a.page.width} ${a.page.height}`, sw: Math.max(a.page.width, a.page.height) / 500 };
    if (!a.profiles?.length) return null;
    const xs = a.profiles.flatMap((p: any) => [p.bbox[0][0], p.bbox[1][0]]), ys = a.profiles.flatMap((p: any) => [p.bbox[0][1], p.bbox[1][1]]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = Math.max(maxX - minX, maxY - minY) * 0.06;
    return { vb: `${minX - pad} ${-(maxY + pad)} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`, sw: Math.max(maxX - minX, maxY - minY) / 300 };
  }, [a, pdf]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selected = a?.profiles.filter((p: any) => sel.has(p.id)) || [];
  const shown = selected.slice(0, 8);
  const sizeOf = (p: any) => [(p.bbox[1][0] - p.bbox[0][0]) * k, (p.bbox[1][1] - p.bbox[0][1]) * k];
  const nums: number[] = a?.numbers || [];
  const matchNum = (v: number) => nums.some((n) => Math.abs(n - v) <= Math.max(0.05, v * 0.003));
  async function make() {
    setErr(''); setBusy(true);
    try { const r = await api(`/files/${fileId}/extrude`, { body: { thickness: Number(th), profiles: [...sel], ...(pdf ? { scale: Number(sc) } : {}) } }); onCreated(r.modelId); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const ready = Number(th) > 0 && sel.size > 0 && (!pdf || k > 0) && a?.convertible;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-line bg-panel" onClick={(e) => e.stopPropagation()} data-testid="dxf-dialog">
        <div className="flex items-center border-b border-line px-4 py-3"><h2 className="font-semibold">{a?.format || '도면'} → 3D 생성 <span className="text-sm font-normal text-mute">{f?.original_name}</span></h2><button className="btn btn-ghost ml-auto" onClick={onClose}>✕</button></div>
        {!a ? <div className="p-6 text-mute">분석 결과 불러오는 중…</div> : (
          <div className="grid min-h-0 flex-1 gap-0 overflow-auto md:grid-cols-[1.5fr_1fr]">
            <div className="border-b border-line bg-bg p-3 md:border-b-0 md:border-r">
              {view && <svg viewBox={view.vb} className="h-[380px] w-full" data-testid="drawing-view">
                {pdf && a.hasPreview && <image href={`/api/files/${fileId}/preview`} x={0} y={-a.page.height} width={a.page.width} height={a.page.height} opacity={0.35} preserveAspectRatio="none" />}
                {pdf && <rect x={0} y={-a.page.height} width={a.page.width} height={a.page.height} fill="none" stroke="var(--line)" strokeWidth={view.sw} />}
                {a.profiles.map((p: any) => {
                  const isSel = sel.has(p.id) || (p.role === 'hole' && sel.has(p.parent));
                  if (p.role === 'line') return <polygon key={p.id} points={p.points.map(([x, y]: number[]) => `${x},${-y}`).join(' ')} fill="none" stroke="var(--mute)" strokeWidth={view.sw * 0.6} opacity={0.5} />;
                  const stroke = p.role === 'frame' ? (isSel ? 'var(--accent)' : 'var(--mute)') : p.role === 'outer' ? (isSel ? 'var(--accent)' : 'var(--mute)') : 'var(--ok)';
                  return <polygon key={p.id} points={p.points.map(([x, y]: number[]) => `${x},${-y}`).join(' ')}
                    fill={p.role === 'hole' ? 'var(--bg)' : isSel ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'transparent'}
                    fillOpacity={p.role === 'hole' && pdf ? 0.6 : 1}
                    stroke={stroke} strokeWidth={view.sw} strokeDasharray={p.role === 'frame' ? `${view.sw * 6} ${view.sw * 4}` : undefined}
                    className={p.role !== 'hole' ? 'cursor-pointer' : ''} data-role={p.role} data-id={p.id}
                    onClick={() => p.role !== 'hole' && toggle(p.id)}><title>{p.id} · {p.role === 'frame' ? '도곽' : p.role === 'outer' ? '외곽' : '구멍'}</title></polygon>;
                })}
              </svg>}
              {!a.convertible && <div className="mt-2 rounded border border-bad/40 bg-bad/10 p-2 text-xs text-bad">이 도면에서는 돌출할 닫힌 외곽 윤곽을 찾지 못했습니다.</div>}
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-mute">
                <span><i className="mr-1 inline-block h-2 w-3 bg-accent/40 align-middle ring-1 ring-accent" />선택한 외곽(돌출 대상) — 클릭해서 선택/해제</span>
                <span><i className="mr-1 inline-block h-2 w-3 align-middle ring-1 ring-ok" />구멍</span>
                {a.profiles.some((p: any) => p.role === 'frame') && <span><i className="mr-1 inline-block h-2 w-3 align-middle ring-1 ring-mute" />도곽(테두리, 기본 제외)</span>}
              </div>
            </div>
            <div className="space-y-3 p-4 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Info k="형식" v={`${a.format}${a.version ? ` ${a.version}` : ''}`} />
                <Info k="단위" v={a.unit} />
                {pdf && <Info k="PDF 종류" v={a.pdfType === 'vector' ? '벡터 도면' : a.pdfType === 'scanned' ? '스캔(이미지)' : '내용 없음'} />}
                {pdf && <Info k="용지" v={`${a.page.width.toFixed(0)}×${a.page.height.toFixed(0)} mm · ${a.pages}쪽`} />}
                <Info k="닫힌 윤곽" v={`외곽 ${a.profiles.filter((p: any) => p.role === 'outer').length} · 구멍 ${a.profiles.filter((p: any) => p.role === 'hole').length}`} />
                <Info k="열린 선분" v={String(a.openChains)} />
              </div>
              {a.layers?.length > 0 && <div><div className="label mb-1">레이어</div><div className="flex max-h-16 flex-wrap gap-1 overflow-auto">{a.layers.map((l: string) => <span key={l} className="chip">{l}</span>)}</div></div>}
              {!pdf && <div><div className="label mb-1">치수 인식</div>
                {a.dimensions.length ? <ul className="max-h-28 space-y-0.5 overflow-auto text-xs">{a.dimensions.map((d: any, i: number) => (
                  <li key={i} className="flex gap-2"><span className="text-mute">{d.kind}</span><span className="num">{d.value ?? '?'} mm</span>
                    {d.matchesOutline ? <span className="text-ok">외곽과 일치</span> : <span className="text-warn">부분 치수</span>}</li>))}</ul>
                  : <div className="text-xs text-mute">치수 객체 없음</div>}</div>}
              {a.texts?.length > 0 && <div><div className="label mb-1">도면 글자</div><div className="max-h-20 overflow-auto text-xs">{a.texts.slice(0, 40).join(' · ')}</div></div>}
              {a.warnings.map((w: string) => <div key={w} className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs text-warn">{w}</div>)}
              {pdf && <label className="block space-y-1"><span className="label">축척 1 : N — 필수 입력</span>
                <div className="flex items-center gap-2"><span className="num shrink-0">1 :</span><input className="input num" type="number" min={0.001} step="any" value={sc} onChange={(e) => setSc(e.target.value)} placeholder="예: 2" data-testid="scale" /></div>
                {a.scaleHint && <div className="text-[11px] text-ai">도면 글자에서 "1:{a.scaleHint}" 를 읽었습니다 — 확인 후 사용하세요.</div>}</label>}
              {selected.length === 0 && a.convertible && <div className="rounded border border-accent/40 bg-accent/10 px-2 py-1.5 text-xs">왼쪽 도면에서 돌출할 외곽을 클릭해 선택하세요.</div>}
              {selected.length > 0 && k > 0 && <div className="rounded-md border border-line p-2 text-xs" data-testid="real-size">
                <div className="label mb-1">선택 외곽 실제 크기{pdf ? ` (축척 1:${k})` : ''}</div>
                {shown.map((p: any) => { const [w, h] = sizeOf(p); return (
                  <div key={p.id} className="num">{p.id}: {w.toFixed(2)} × {h.toFixed(2)} mm
                    {pdf && <> {matchNum(+w.toFixed(1)) ? <span className="text-ok">가로=도면 숫자</span> : null} {matchNum(+h.toFixed(1)) ? <span className="text-ok">세로=도면 숫자</span> : null}</>}</div>); })}
                {pdf && <div className="mt-1 text-[11px] text-mute">도면에 적힌 치수 숫자와 일치하면 축척이 맞습니다.</div>}
              </div>}
              <label className="block space-y-1"><span className="label">두께 (mm) — 필수 입력</span>
                <input className="input num" type="number" min={0.01} step="any" value={th} onChange={(e) => setTh(e.target.value)} placeholder="예: 6" data-testid="thickness" autoFocus /></label>
              <div className="rounded-md border border-line bg-panel2 p-2 text-xs">
                <div className="mb-1 font-medium">생성 결과 형상 근거</div>
                <div><span className="text-ok">■</span> 원본 도면에서 확인: 외곽·구멍 윤곽</div>
                {pdf && <div><span className="text-warn">■</span> 사용자 입력으로 확정: 축척 1:{sc || '?'}</div>}
                <div><span className="text-warn">■</span> 사용자 입력으로 확정: 두께 {th || '?'} mm</div>
                <div><span className="text-ai">■</span> AI 추정: 없음 (AI 형상 재구성은 3단계)</div>
              </div>
              {err && <div className="text-xs text-bad">{err}</div>}
              <button className="btn btn-accent h-9 w-full justify-center" disabled={!ready || busy} onClick={make} data-testid="extrude-go">{busy ? '생성 중…' : '3D 모델 생성'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
const Info = ({ k, v }: { k: string; v: string }) => <div className="rounded border border-line px-2 py-1"><div className="text-mute">{k}</div><div className="num break-all">{v}</div></div>;
