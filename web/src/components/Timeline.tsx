import { useWS, steps, duration } from '../store';

export const CLIP_LABEL: Record<string, string> = { hold: '정지', explode: '분해', assemble: '조립', turntable: '360° 회전' };
const CLIP_COLOR: Record<string, string> = { hold: 'var(--line)', explode: 'var(--accent)', assemble: 'var(--ok)', turntable: '#60a5fa' };

export default function Timeline({ compact = false }: { compact?: boolean }) {
  const scene = useWS((s) => s.scene);
  const t = useWS((s) => s.t), e = useWS((s) => s.e), mode = useWS((s) => s.mode), playing = useWS((s) => s.playing);
  if (!scene) return null;
  const S = steps(scene), T = duration(scene);
  const cur = useWS.getState().current();
  const shownE = mode === 'timeline' ? cur.e : e;
  const play = () => { const st = useWS.getState(); st.set({ playing: !playing, mode: 'timeline', t: st.t >= T ? 0 : st.t }); };
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${compact ? '' : 'px-3 py-2'}`} data-testid="timeline">
      <div className="flex items-center gap-1">
        <button className="btn btn-accent w-9 justify-center px-0" title="재생/일시정지" onClick={play} data-testid="play">{playing ? '❚❚' : '▶'}</button>
        <button className="btn w-9 justify-center px-0" title="처음으로" onClick={() => useWS.getState().set({ playing: false, t: 0, mode: 'timeline' })}>⏮</button>
      </div>
      <div className="flex min-w-[240px] flex-1 items-center gap-2">
        <span className="num w-20 text-xs text-mute">{t.toFixed(1)} / {T.toFixed(1)}s</span>
        <div className="relative flex-1">
          <div className="flex h-2 overflow-hidden rounded-full">
            {scene.animation.clips.map((c: any, i: number) => <div key={i} title={`${CLIP_LABEL[c.type]} ${c.duration}s`} style={{ flex: c.duration, background: CLIP_COLOR[c.type], opacity: 0.85 }} className="border-r border-bg last:border-0" />)}
          </div>
          <input type="range" className="absolute inset-x-0 -top-1.5 w-full opacity-90" min={0} max={T || 1} step={0.01} value={Math.min(t, T)}
            onChange={(ev) => useWS.getState().set({ t: +ev.target.value, mode: 'timeline', playing: false })} aria-label="타임라인" />
        </div>
      </div>
      {!compact && <div className="flex items-center gap-2">
        <span className="label">분해</span>
        <input type="range" data-testid="explode-slider" min={0} max={S || 1} step={0.01} value={shownE} className="w-40"
          onChange={(ev) => useWS.getState().set({ e: +ev.target.value, mode: 'manual', playing: false })} />
        <span className="num w-16 text-xs text-mute">{S ? `${Math.min(S, Math.ceil(shownE - 1e-6))}/${S}단계` : '설정 없음'}</span>
      </div>}
    </div>
  );
}
