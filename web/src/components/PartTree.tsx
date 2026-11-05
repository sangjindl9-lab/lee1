import { useMemo, useState } from 'react';
import { useWS, type Part } from '../store';

export default function PartTree() {
  const model = useWS((s) => s.model);
  const scene = useWS((s) => s.scene);
  const selected = useWS((s) => s.selected);
  const isolate = useWS((s) => s.isolate);
  const [q, setQ] = useState('');
  const tree = useMemo(() => {
    const kids = new Map<string | null, Part[]>();
    for (const p of model?.parts || []) { const k = p.parentId ?? null; kids.set(k, [...(kids.get(k) || []), p]); }
    return kids;
  }, [model]);
  if (!model) return null;
  const match = (p: Part) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.id.toLowerCase().includes(q.toLowerCase());
  const row = (p: Part, depth: number): React.ReactNode => {
    const hidden = !!scene?.parts?.[p.id]?.hidden;
    const sel = selected === p.id;
    const children = tree.get(p.id) || [];
    if (!match(p) && !children.some(match)) return null;
    return (
      <div key={p.id}>
        <div data-testid="part-row" data-part={p.id}
          className={`group flex h-7 cursor-pointer items-center gap-1 rounded px-1.5 text-[13px] ${sel ? 'bg-accent/15 text-accent' : 'hover:bg-panel2'} ${hidden ? 'opacity-45' : ''}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => useWS.getState().set({ selected: sel ? null : p.id })}
          onDoubleClick={() => useWS.getState().set({ isolate: isolate === p.id ? null : p.id, selected: p.id })}
          onMouseEnter={() => useWS.getState().set({ hover: p.id })} onMouseLeave={() => useWS.getState().set({ hover: null })}>
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-line" style={{ background: scene?.parts?.[p.id]?.color || 'transparent' }} />
          <span className="truncate">{p.name}</span>
          <span className="num ml-auto text-[10px] text-mute">{scene?.parts?.[p.id]?.explode?.step ? `S${scene.parts[p.id].explode.step}` : ''}</span>
          <button title={hidden ? '보이기' : '숨기기'} className="w-5 text-mute opacity-0 group-hover:opacity-100 hover:text-ink"
            onClick={(e) => { e.stopPropagation(); useWS.getState().patchPart(p.id, { hidden: hidden ? undefined : true }); }}>{hidden ? '◌' : '●'}</button>
        </div>
        {children.map((c) => row(c, depth + 1))}
      </div>
    );
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className="panel-title">부품 트리</span><span className="num text-xs text-mute">{model.parts.length}</span>
        {isolate && <button className="btn ml-auto h-6 px-2 text-xs" onClick={() => useWS.getState().set({ isolate: null })}>격리 해제</button>}
      </div>
      <div className="px-3 pb-2"><input className="input h-7" placeholder="부품 검색" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">{(tree.get(null) || []).map((p) => row(p, 0))}</div>
      <div className="border-t border-line px-3 py-2 text-[11px] text-mute">클릭: 선택 · 더블클릭: 격리 · ●: 숨김</div>
    </div>
  );
}
