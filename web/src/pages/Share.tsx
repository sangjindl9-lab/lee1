import { useEffect, useRef, useState } from 'react';
import { useWS, steps } from '../store';
import Viewer from '../components/Viewer';
import ViewerToolbar from '../components/ViewerToolbar';
import Timeline from '../components/Timeline';
import { BrandMark, brandStyle } from '../components/Brand';

export default function SharePage({ token }: { token: string }) {
  const [d, setD] = useState<any>(null);
  const [state, setState] = useState<{ error?: string; needsPassword?: boolean; title?: string } | null>(null);
  const [pw, setPw] = useState('');
  const [pass, setPass] = useState<string | undefined>();
  const [listOpen, setListOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const sel = useWS((s) => s.selected);
  const scene = useWS((s) => s.scene);
  const e = useWS((s) => s.e);

  async function load(p?: string) {
    const r = await fetch(`/api/public/shares/${token}`, { headers: p ? { 'x-share-pass': p } : {} });
    const j = await r.json();
    if (!r.ok) { setState(j); return; }
    setState(null); setD(j);
    useWS.getState().load({ ...j.model, source_file_id: '', source_file_version: 0 }, j.scene, 0);
    document.title = `${j.title} · 3D 쇼룸`;
  }
  useEffect(() => { load(); }, [token]);
  async function unlock(ev: React.FormEvent) {
    ev.preventDefault();
    const r = await fetch(`/api/public/shares/${token}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    const j = await r.json();
    if (!r.ok) return setState({ ...state, error: j.error, needsPassword: true });
    setPass(j.passToken); load(j.passToken);
  }

  if (state?.needsPassword) return (
    <Center>
      <form onSubmit={unlock} className="w-full max-w-xs space-y-3 rounded-xl border border-line bg-panel p-5">
        <div className="text-lg font-semibold">🔒 {state.title || '보호된 쇼룸'}</div>
        <p className="text-sm text-mute">비밀번호를 입력하세요.</p>
        <input className="input" type="password" autoFocus value={pw} onChange={(ev) => setPw(ev.target.value)} data-testid="share-pw" />
        {state.error && state.error !== '비밀번호가 필요합니다' && <div className="text-sm text-bad">{state.error}</div>}
        <button className="btn btn-accent w-full justify-center">열기</button>
      </form>
    </Center>
  );
  if (state?.error) return <Center><div className="text-center"><div className="text-lg font-semibold">{state.error}</div><div className="mt-1 text-sm text-mute">링크를 보낸 담당자에게 문의하세요.</div></div></Center>;
  if (!d) return <Center><span className="text-mute">쇼룸 불러오는 중…</span></Center>;

  const S = steps(scene);
  const part = d.model.parts.find((p: any) => p.id === sel);
  const pcfg = sel ? scene?.parts?.[sel] : null;
  const label = (p: any) => scene?.parts?.[p.id]?.label || p.name;
  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto] overflow-hidden" data-testid="share-page" style={brandStyle(d.company.brand?.color)}>
      <header className="flex h-12 items-center gap-3 border-b border-line bg-panel px-3" style={{ borderBottomColor: d.company.brand?.color || undefined }}>
        {d.company.slug ? <a className="min-w-0 shrink-0 sm:shrink" href={`/c/${d.company.slug}`} title="이 회사의 다른 제품 보기"><BrandMark brand={d.company.brand} name={d.company.name} compact /></a> : <div className="shrink-0 sm:shrink"><BrandMark brand={d.company.brand} name={d.company.name} compact /></div>}
        <div className="hidden h-6 w-px shrink-0 bg-line sm:block" />
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold" data-testid="share-title">{d.title}</div><div className="truncate text-[11px] text-mute">{d.company.brand?.tagline || '3D 디지털 쇼룸'}</div></div>
        <button className="btn ml-auto shrink-0" onClick={() => setListOpen(!listOpen)} data-testid="parts-toggle">부품 {d.model.parts.length}</button>
      </header>
      <div className="relative min-h-0" ref={box}>
        <Viewer url={`/api/public/shares/${token}/model.glb`} headers={pass ? { 'x-share-pass': pass } : undefined} zUp={d.model.stats?.upAxis !== 'Y'} gizmo={false} />
        <ViewerToolbar container={box} simple />
        {d.model.provenance?.reference && <div className="pointer-events-none absolute bottom-2 right-2 z-10 rounded-md border border-ai/60 bg-panel/90 px-2 py-1 text-[11px] font-semibold text-ai backdrop-blur" data-testid="reference-badge"
          title="2D 도면에서 자동으로 만든 형상입니다. 실제 제품과 다를 수 있습니다.">참고용 AI 3D 시각화{d.model.review_status === 'approved' ? ' · 검토 완료' : ''}</div>}
        {listOpen && (
          <div className="absolute bottom-2 right-2 top-14 z-10 w-64 overflow-auto rounded-lg border border-line bg-panel/95 p-1.5 backdrop-blur">
            {d.model.parts.map((p: any) => (
              <button key={p.id} onClick={() => useWS.getState().set({ selected: p.id })} className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm ${sel === p.id ? 'bg-accent/15 text-accent' : 'hover:bg-panel2'}`}>{label(p)}</button>
            ))}
          </div>
        )}
        {part && (
          <div className="absolute bottom-2 left-2 z-10 max-w-[min(22rem,calc(100%-1rem))] rounded-lg border border-line bg-panel/95 p-3 shadow-lg backdrop-blur" data-testid="share-part-card">
            <div className="flex items-start gap-2"><div className="font-semibold">{label(part)}</div><button className="btn btn-ghost ml-auto h-6 px-1.5" onClick={() => useWS.getState().set({ selected: null })}>✕</button></div>
            <div className="num mt-1 text-xs text-mute">{part.bbox.max.map((v: number, i: number) => (v - part.bbox.min[i]).toFixed(1)).join(' × ')} {d.model.stats.unit?.startsWith('mm') ? 'mm' : ''}</div>
            {pcfg?.desc && <p className="mt-2 whitespace-pre-wrap text-sm">{pcfg.desc}</p>}
          </div>
        )}
      </div>
      <footer className="space-y-2 border-t border-line bg-panel px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {S > 0 && <div className="flex items-center gap-2">
          <span className="label w-10">분해</span>
          <input type="range" className="flex-1" min={0} max={S} step={0.01} value={useWS.getState().mode === 'manual' ? e : useWS.getState().current().e}
            onChange={(ev) => useWS.getState().set({ e: +ev.target.value, mode: 'manual', playing: false })} data-testid="share-explode" />
          <button className="btn h-7 px-2 text-xs" onClick={() => useWS.getState().set({ e: S, mode: 'manual', playing: false })}>분해</button>
          <button className="btn h-7 px-2 text-xs" onClick={() => useWS.getState().set({ e: 0, mode: 'manual', playing: false })}>조립</button>
        </div>}
        <Timeline compact />
        {(d.company.brand?.phone || d.company.brand?.website || d.company.slug) && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute">
          {d.company.slug && <a className="text-accent" href={`/c/${d.company.slug}`}>{d.company.name} 제품 전체 보기 →</a>}
          {d.company.brand?.phone && <a href={`tel:${d.company.brand.phone}`}>☎ {d.company.brand.phone}</a>}
          {d.company.brand?.website && <a href={d.company.brand.website} target="_blank" rel="noreferrer">{d.company.brand.website.replace(/^https?:\/\//, '')}</a>}
        </div>}
      </footer>
    </div>
  );
}
const Center = ({ children }: { children: React.ReactNode }) => <div className="grid h-full place-items-center p-4">{children}</div>;
