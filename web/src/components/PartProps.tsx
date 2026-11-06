import { useWS } from '../store';

const AXES: [string, number[]][] = [['+X', [1, 0, 0]], ['-X', [-1, 0, 0]], ['+Y', [0, 1, 0]], ['-Y', [0, -1, 0]], ['+Z', [0, 0, 1]], ['-Z', [0, 0, -1]]];
const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(2));

export default function PartProps({ readOnly = false }: { readOnly?: boolean }) {
  const model = useWS((s) => s.model);
  const sel = useWS((s) => s.selected);
  const cfg = useWS((s) => (sel ? s.scene?.parts?.[sel] : null)) || {};
  const part = model?.parts.find((p) => p.id === sel);
  if (!part) return null;
  const size = part.bbox.max.map((v, i) => v - part.bbox.min[i]);
  const ex = cfg.explode || { dir: [0, 0, 1], dist: 0, step: 0 };
  const patch = (p: any) => !readOnly && useWS.getState().patchPart(part.id, p);
  const unit = model?.stats?.unit?.startsWith('mm') ? 'mm' : '';
  return (
    <section className="space-y-3 border-b border-line p-3" data-testid="part-props">
      <div className="flex items-center gap-2"><span className="panel-title">부품 속성</span><span className="num chip">{part.id}</span>
        <button className="btn btn-ghost ml-auto h-6 px-2 text-xs" onClick={() => useWS.getState().set({ selected: null })}>✕</button></div>
      <input className="input font-semibold" value={cfg.label ?? part.name} readOnly={readOnly} onChange={(e) => patch({ label: e.target.value || undefined })} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-mute">크기 {unit}</dt><dd className="num">{size.map(fmt).join(' × ')}</dd>
        <dt className="text-mute">중심</dt><dd className="num">{part.center.map(fmt).join(', ')}</dd>
        {part.volume != null && <><dt className="text-mute">체적</dt><dd className="num">{(part.volume / 1000).toFixed(2)} cm³ <span className="text-mute">(형상 계산)</span></dd></>}
        <dt className="text-mute">삼각형</dt><dd className="num">{part.triangles.toLocaleString()}</dd>
        {part.extras?.brepFaces != null && <><dt className="text-mute">B-Rep 면</dt><dd className="num">{part.extras.brepFaces}</dd></>}
        {part.extras?.provenance && <><dt className="text-mute">형상 근거</dt><dd>윤곽=<span className="text-ok">원본 도면</span>, {part.extras.provenance.scale ? <>축척 1:{part.extras.scale}·</> : null}두께=<span className="text-warn">사용자 입력</span></dd></>}
      </dl>
      {!readOnly && (<>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="label">색상</span>
            <div className="flex gap-1"><input type="color" className="h-8 w-10 rounded border border-line bg-transparent" value={cfg.color || '#9aa0a6'} onChange={(e) => patch({ color: e.target.value })} />
              {cfg.color && <button className="btn h-8 px-2 text-xs" onClick={() => patch({ color: undefined })}>원래색</button>}</div></label>
          <label className="space-y-1"><span className="label">투명도 {Math.round((cfg.opacity ?? 1) * 100)}%</span>
            <input type="range" min={0.05} max={1} step={0.05} className="w-full" value={cfg.opacity ?? 1} onChange={(e) => patch({ opacity: +e.target.value >= 1 ? undefined : +e.target.value })} /></label>
        </div>
        <div className="flex gap-2">
          <button className="btn flex-1 justify-center" onClick={() => patch({ hidden: cfg.hidden ? undefined : true })}>{cfg.hidden ? '보이기' : '숨기기'}</button>
          <button className="btn flex-1 justify-center" onClick={() => useWS.getState().set({ isolate: useWS.getState().isolate === part.id ? null : part.id })}>격리</button>
          <button className="btn flex-1 justify-center text-bad" data-testid="part-delete" onClick={() => { useWS.getState().patchPart(part.id, { deleted: true, hidden: undefined }); useWS.getState().set({ selected: null, isolate: null }); }}>부품 삭제</button>
        </div>
        <div className="space-y-2 rounded-lg border border-line bg-panel2 p-2.5">
          <div className="panel-title">분해 설정</div>
          <div className="grid grid-cols-6 gap-1">
            {AXES.map(([l, d]) => (
              <button key={l} className={`btn h-7 justify-center px-0 text-xs ${String(d) === String(ex.dir) ? 'btn-on' : ''}`} onClick={() => patch({ explode: { dir: d } })}>{l}</button>
            ))}
          </div>
          <label className="block space-y-1"><span className="label">이동 거리 {ex.dist} {unit}</span>
            <div className="flex gap-2"><input type="range" className="flex-1" min={0} max={Math.max(50, Math.round((model!.stats.size ? Math.max(...model!.stats.size) : 100) * 1.5))} step={1} value={ex.dist}
              onChange={(e) => patch({ explode: { dist: +e.target.value } })} />
              <input className="input num h-7 w-20" type="number" value={ex.dist} onChange={(e) => patch({ explode: { dist: Math.max(0, +e.target.value) } })} /></div></label>
          <label className="flex items-center gap-2"><span className="label">분해 단계</span>
            <input className="input num h-7 w-16" type="number" min={0} max={20} value={ex.step} onChange={(e) => patch({ explode: { step: Math.max(0, Math.round(+e.target.value)) } })} />
            <span className="text-[11px] text-mute">0 = 고정 부품</span></label>
        </div>
        <label className="block space-y-1"><span className="label">부품 설명 (공유 쇼룸에 표시)</span>
          <textarea className="input h-16 py-1.5" value={cfg.desc || ''} onChange={(e) => patch({ desc: e.target.value || undefined })} placeholder="규격, 재질, 기능 등" /></label>
      </>)}
      {readOnly && cfg.desc && <p className="whitespace-pre-wrap text-sm">{cfg.desc}</p>}
    </section>
  );
}
