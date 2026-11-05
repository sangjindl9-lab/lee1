import { useEffect, useMemo, useState } from 'react';

// 투상도 결합(자동 3D 초안) 설정: 인식된 뷰·그룹을 보여주고 사용자가 정면/평면/측면을 고칠 수 있다
export const ROLE_COLOR: Record<string, string> = { front: '#f59e0b', top: '#38bdf8', side: '#34d399', aux: '#9ca3af' };
export const ROLE_LABEL: Record<string, string> = { front: '정면', top: '평면', side: '측면', aux: '보조' };

export interface Group { id: string; front: string; top: string | null; side: string | null; topPos?: string | null; sidePos?: string | null }

export function useGroups(a: any) {
  const [groups, setGroups] = useState<Group[]>([]);
  useEffect(() => { setGroups(structuredClone(a?.groups || [])); }, [a]);
  const byId = useMemo(() => Object.fromEntries((a?.views || []).map((v: any) => [v.id, v])), [a]);
  const ctr = (id: string) => { const b = byId[id].box; return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2]; };
  const fix = (g: Group): Group => ({
    ...g,
    topPos: g.top && byId[g.top] ? (ctr(g.top)[1] > ctr(g.front)[1] ? 'above' : 'below') : null,
    sidePos: g.side && byId[g.side] ? (ctr(g.side)[0] > ctr(g.front)[0] ? 'right' : 'left') : null,
  });
  const set = (i: number, k: 'front' | 'top' | 'side', v: string | null) => setGroups((gs) => gs.map((g, j) => (j === i ? fix({ ...g, [k]: v }) : g)));
  const add = () => setGroups((gs) => [...gs, { id: `G${gs.length + 1}`, front: a.views[0]?.id, top: null, side: null }]);
  const remove = (i: number) => setGroups((gs) => gs.filter((_, j) => j !== i));
  const roleOf = (vid: string) => { for (const g of groups) { if (g.front === vid) return ['front', g.id]; if (g.top === vid) return ['top', g.id]; if (g.side === vid) return ['side', g.id]; } return [null, null]; };
  return { groups, set, add, remove, roleOf };
}

export function ViewsOverlay({ a, roleOf, sw }: { a: any; roleOf: (id: string) => (string | null)[]; sw: number }) {
  return (
    <g data-testid="views-overlay">
      {a.views.map((v: any) => {
        const [role, gid] = roleOf(v.id);
        const col = role ? ROLE_COLOR[role] : '#9ca3af';
        return (
          <g key={v.id} data-view={v.id} data-role={role || ''}>
            {v.silhouettes.map((s: any, i: number) => (
              <polygon key={i} points={s.pts.map(([x, y]: number[]) => `${x},${-y}`).join(' ')} fill={role ? col : 'transparent'} fillOpacity={0.18}
                stroke={col} strokeWidth={sw * (role ? 1.6 : 0.8)} strokeDasharray={role ? undefined : `${sw * 4} ${sw * 3}`} />
            ))}
            {(v.faces || []).map((f: any, i: number) => (
              <polygon key={'f' + i} points={f.pts.map(([x, y]: number[]) => `${x},${-y}`).join(' ')} fill="none"
                stroke={f.material ? col : '#6b7280'} strokeWidth={sw * 0.6} strokeDasharray={f.material ? undefined : `${sw * 2} ${sw * 2}`} opacity={0.9} />
            ))}
            <text x={v.box[0][0]} y={-v.box[1][1] - sw * 3} fontSize={sw * 14} fill={col} fontWeight={700}>{v.id}{role ? ` ${ROLE_LABEL[role]} ${gid}` : ''}</text>
          </g>
        );
      })}
    </g>
  );
}

export function GroupsEditor({ a, groups, set, add, remove }: { a: any; groups: Group[]; set: any; add: () => void; remove: (i: number) => void }) {
  const opts = (none: boolean) => <>{none && <option value="">— 없음 —</option>}{a.views.map((v: any) => <option key={v.id} value={v.id}>{v.id}</option>)}</>;
  return (
    <div className="space-y-2" data-testid="groups-editor">
      <div className="flex items-center"><span className="label">투상도 그룹 (물체 1개 = 그룹 1개)</span><button className="btn btn-ghost ml-auto h-6 px-2 text-xs" onClick={add}>＋ 그룹</button></div>
      {groups.map((g, i) => (
        <div key={i} className="rounded border border-line p-2 text-xs">
          <div className="mb-1 flex items-center"><b>{g.id}</b><button className="btn btn-ghost ml-auto h-5 px-1.5 text-[11px]" onClick={() => remove(i)}>삭제</button></div>
          <div className="grid grid-cols-3 gap-1">
            {(['front', 'top', 'side'] as const).map((k) => (
              <label key={k} className="space-y-0.5"><span style={{ color: ROLE_COLOR[k] }}>{ROLE_LABEL[k]}{k === 'top' && g.topPos === 'below' ? '(아래=저면)' : ''}{k === 'side' && g.sidePos ? `(${g.sidePos === 'right' ? '우' : '좌'})` : ''}</span>
                <select className="input h-7 px-1" value={(g as any)[k] || ''} onChange={(e) => set(i, k, e.target.value || null)}>{opts(k !== 'front')}</select></label>
            ))}
          </div>
        </div>
      ))}
      {!groups.length && <div className="text-xs text-warn">짝이 맞는 투상도를 자동으로 찾지 못했습니다. ＋ 그룹으로 정면·평면·측면 뷰를 직접 지정하세요.</div>}
      <div className="text-[11px] text-mute">3각법 기준: 정면도 위쪽 뷰 = 평면도, 아래쪽 = 저면도, 오른쪽 = 우측면도. 각 뷰에서 정면도에 가까운 쪽을 물체의 앞면으로 봅니다.</div>
    </div>
  );
}
