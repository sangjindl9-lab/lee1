import { suggestExplode } from '@shared/scene.js';
import { useWS, steps } from '../../store';

export default function ExplodePanel({ canWrite }: { canWrite: boolean }) {
  const scene = useWS((s) => s.scene);
  const model = useWS((s) => s.model);
  if (!scene || !model) return null;
  const S = steps(scene);
  const byStep = new Map<number, string[]>();
  for (const p of model.parts) { if (scene.parts[p.id]?.deleted) continue; const k = scene.parts[p.id]?.explode?.dist > 0 ? scene.parts[p.id].explode.step : 0; byStep.set(k, [...(byStep.get(k) || []), p.id]); }
  const name = (id: string) => scene.parts[id]?.label || model.parts.find((p) => p.id === id)?.name;
  return (
    <div className="space-y-3 p-3">
      <div className="panel-title">분해도 (수동 설정)</div>
      <p className="text-xs text-mute">부품을 선택해 방향·거리·단계를 정합니다. 기본값은 조립체 중심 기준 방향 제안이며 <b className="text-warn">충돌 검토는 하지 않습니다</b> (자동 분해 경로는 2단계).</p>
      <label className="block space-y-1"><span className="label">전체 분해 배율 ×{(scene.explode?.factor ?? 1).toFixed(2)}</span>
        <input type="range" className="w-full" min={0.2} max={3} step={0.05} value={scene.explode?.factor ?? 1} disabled={!canWrite}
          onChange={(e) => useWS.getState().patchScene((s) => { s.explode = { ...(s.explode || {}), factor: +e.target.value }; })} /></label>
      {canWrite && <div className="flex flex-wrap gap-1.5">
        <button className="btn" onClick={() => useWS.getState().set({ e: S, mode: 'manual', playing: false })}>전체 분해</button>
        <button className="btn" onClick={() => useWS.getState().set({ e: 0, mode: 'manual', playing: false })}>조립 상태</button>
        <button className="btn" onClick={() => { if (confirm('모든 부품의 분해 설정을 기본 제안으로 되돌릴까요?')) useWS.getState().patchScene((s) => { const ex: any = suggestExplode(model.parts); for (const p of model.parts) s.parts[p.id] = { ...(s.parts[p.id] || {}), explode: ex[p.id] }; }); }}>기본 제안 다시 적용</button>
      </div>}
      <div className="space-y-2">
        {[...byStep.keys()].sort((a, b) => a - b).map((k) => (
          <div key={k} className="rounded-md border border-line">
            <div className="flex items-center gap-2 border-b border-line bg-panel2 px-2 py-1 text-xs">
              <b>{k === 0 ? '고정 부품' : `${k}단계`}</b><span className="text-mute">{byStep.get(k)!.length}개</span>
              {k > 0 && <button className="btn btn-ghost ml-auto h-5 px-1.5 text-[11px]" onClick={() => useWS.getState().set({ e: k, mode: 'manual' })}>여기까지 분해</button>}
            </div>
            <div className="flex flex-wrap gap-1 p-1.5">
              {byStep.get(k)!.map((id) => <button key={id} className="chip hover:border-accent hover:text-ink" onClick={() => useWS.getState().set({ selected: id })}>{name(id)}</button>)}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-mute">분해 애니메이션은 1단계 → 마지막 단계 순서로 움직이고, 조립은 그 역순입니다.</p>
    </div>
  );
}
