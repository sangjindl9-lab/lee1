import { useEffect, useState } from 'react';
import { api, fmtBytes, fmtDate } from '../../api';
import { useWS, duration } from '../../store';
import { CLIP_LABEL } from '../Timeline';
import { viewerBridge } from '../Viewer';
import { BACKGROUNDS, TEMPLATE_ORDER } from '../../engine/stage';

const QUAL = [['hd', 'HD 1280×720'], ['fhd', 'Full HD 1920×1080'], ['qhd', 'QHD 2560×1440'], ['4k', '4K 3840×2160']];

export default function VideoPanel({ modelId, jobs, onSave, canWrite, refresh }: { modelId: string; jobs: any[]; onSave: () => Promise<void>; canWrite: boolean; refresh: () => void }) {
  const scene = useWS((s) => s.scene);
  const [q, setQ] = useState('fhd');
  const [fps, setFps] = useState(30);
  const [videos, setVideos] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const running = jobs.filter((j) => j.type === 'render' && j.payload?.modelId === modelId && (j.status === 'queued' || j.status === 'running'));
  const failed = jobs.filter((j) => j.type === 'render' && j.payload?.modelId === modelId && j.status === 'failed').slice(0, 2);
  const loadV = () => api(`/models/${modelId}/videos`).then(setVideos);
  useEffect(() => { loadV(); }, [modelId, running.length]);
  if (!scene) return null;
  const clips = scene.animation.clips as any[];
  const edit = (fn: (c: any[]) => void) => useWS.getState().patchScene((s) => fn(s.animation.clips));
  async function render() {
    setErr('');
    try { await onSave(); await api(`/models/${modelId}/renders`, { body: { quality: q, fps } }); refresh(); }
    catch (e: any) { setErr(e.message); }
  }
  function saveCamera() {
    const cam = viewerBridge.camera as any, tgt = viewerBridge.target;
    if (!cam || !tgt) return;
    useWS.getState().patchScene((s) => { s.camera = { position: cam.position.toArray(), target: tgt.toArray(), fov: cam.fov || 35 }; });
  }
  return (
    <div className="space-y-3 p-3">
      <div className="panel-title">동영상 제작</div>
      <div className="space-y-1.5">
        <div className="flex items-center"><span className="label">장면 구성 (클립을 이어 붙여 한 영상으로)</span><span className="num ml-auto text-xs text-mute">{duration(scene).toFixed(1)}s</span></div>
        {clips.map((c, i) => (
          <div key={i} className="flex items-center gap-1 rounded border border-line bg-panel2 p-1" data-testid="clip">
            <span className="num w-5 text-center text-[11px] text-mute">{i + 1}</span>
            <select className="input h-7 w-28 px-1" value={c.type} disabled={!canWrite} onChange={(e) => edit((cl) => { cl[i].type = e.target.value; if (e.target.value === 'turntable') cl[i].degrees ??= 360; })}>
              {Object.entries(CLIP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className="input num h-7 w-16" type="number" min={0.2} max={60} step={0.5} value={c.duration} disabled={!canWrite} onChange={(e) => edit((cl) => { cl[i].duration = Math.max(0.2, +e.target.value); })} />
            <span className="text-[11px] text-mute">초</span>
            {c.type === 'turntable' && <><input className="input num h-7 w-16" type="number" step={15} value={c.degrees} disabled={!canWrite} onChange={(e) => edit((cl) => { cl[i].degrees = +e.target.value; })} /><span className="text-[11px] text-mute">°</span></>}
            {canWrite && <div className="ml-auto flex">
              <button className="btn btn-ghost h-6 w-6 justify-center px-0 text-xs" disabled={i === 0} onClick={() => edit((cl) => { [cl[i - 1], cl[i]] = [cl[i], cl[i - 1]]; })}>↑</button>
              <button className="btn btn-ghost h-6 w-6 justify-center px-0 text-xs" onClick={() => edit((cl) => { cl.splice(i, 1); })}>✕</button></div>}
          </div>
        ))}
        {canWrite && <div className="flex flex-wrap gap-1">{Object.entries(CLIP_LABEL).map(([k, v]) => (
          <button key={k} className="btn h-7 px-2 text-xs" onClick={() => edit((cl) => { cl.push({ type: k, duration: k === 'hold' ? 1 : 4, ...(k === 'turntable' ? { degrees: 360 } : {}) }); })}>＋ {v}</button>))}</div>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1"><span className="label">배경</span>
          <select className="input" value={scene.background || 'studio'} disabled={!canWrite} onChange={(e) => useWS.getState().patchScene((s) => { s.background = e.target.value; })}>
            {TEMPLATE_ORDER.filter((k) => k !== 'transparent').map((k) => <option key={k} value={k}>{BACKGROUNDS[k].label}</option>)}</select></label>
        <label className="space-y-1"><span className="label">모드</span>
          <select className="input" value={scene.viewMode || 'showroom'} disabled={!canWrite} onChange={(e) => useWS.getState().patchScene((s) => { s.viewMode = e.target.value; })}>
            <option value="showroom">홍보 쇼룸 (재질·조명)</option><option value="technical">기술 검토 (그리드·평조명)</option></select></label>
      </div>
      <label className="block space-y-1"><span className="label">제품명 자막</span>
        <input className="input" value={scene.title || ''} disabled={!canWrite} onChange={(e) => useWS.getState().patchScene((s) => { s.title = e.target.value; })} /></label>
      <label className="block space-y-1"><span className="label">설명 자막</span>
        <input className="input" value={scene.overlay?.subtitle || ''} disabled={!canWrite} placeholder="예: IP66 방수 제어함 · 분해 구조" onChange={(e) => useWS.getState().patchScene((s) => { s.overlay = { ...(s.overlay || {}), subtitle: e.target.value }; })} /></label>
      <label className="block space-y-1"><span className="label">워터마크 (비우면 회사명)</span>
        <input className="input" value={scene.overlay?.watermark ?? ''} disabled={!canWrite} onChange={(e) => useWS.getState().patchScene((s) => { s.overlay = { ...(s.overlay || {}), watermark: e.target.value || undefined }; })} /></label>
      <div className="flex items-center gap-2 text-xs">
        <button className="btn h-7 px-2 text-xs" disabled={!canWrite} onClick={saveCamera}>현재 시점을 영상 카메라로</button>
        <span className="text-mute">{scene.camera ? '저장된 시점 사용' : '자동(등각) 시점'}</span>
        {scene.camera && canWrite && <button className="btn btn-ghost h-7 px-2 text-xs" onClick={() => useWS.getState().patchScene((s) => { s.camera = null; })}>초기화</button>}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <select className="input" value={q} onChange={(e) => setQ(e.target.value)}>{QUAL.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input w-24" value={fps} onChange={(e) => setFps(+e.target.value)}>{[24, 30, 60].map((f) => <option key={f} value={f}>{f}fps</option>)}</select>
      </div>
      {(q === 'qhd' || q === '4k') && <div className="text-[11px] text-warn">CPU 렌더 서버에서는 고해상도가 오래 걸립니다. GPU 렌더 워커 연결 시 빨라집니다.</div>}
      {canWrite && <button className="btn btn-accent h-9 w-full justify-center" onClick={render} data-testid="render-go">MP4 렌더링 시작 (저장 후 진행)</button>}
      {err && <div className="text-xs text-bad">{err}</div>}
      {running.map((j) => (
        <div key={j.id} className="rounded border border-line p-2 text-xs" data-testid="render-job">
          <div className="flex"><span>{j.status === 'queued' ? '대기열' : '렌더링 중'} · {j.payload.quality.toUpperCase()} {j.payload.fps}fps</span><span className="num ml-auto">{Math.round(j.progress * 100)}%</span></div>
          <div className="mt-1 h-1.5 rounded bg-line"><div className="h-1.5 rounded bg-accent transition-all" style={{ width: `${j.progress * 100}%` }} /></div>
          <div className="mt-1 text-mute">{j.message}</div>
        </div>
      ))}
      {failed.map((j) => (
        <div key={j.id} className="rounded border border-bad/40 p-2 text-xs text-bad">렌더 실패: {j.error?.slice(0, 200)}
          {canWrite && <button className="btn ml-2 h-6 px-2 text-xs" onClick={async () => { await api(`/jobs/${j.id}/retry`, { method: 'POST' }); refresh(); }}>재시도</button>}</div>
      ))}
      <div className="space-y-2">
        <div className="label">완성된 영상</div>
        {videos.map((v) => (
          <div key={v.id} className="overflow-hidden rounded-md border border-line" data-testid="video-row">
            <video src={`/api/videos/${v.id}/file`} poster={`/api/videos/${v.id}/thumb`} controls preload="none" className="aspect-video w-full bg-black" />
            <div className="flex items-center gap-2 p-2 text-xs"><span className="num">{v.width}×{v.height} · {v.fps}fps · {Number(v.duration).toFixed(1)}s · {fmtBytes(Number(v.size))}</span>
              <a className="btn btn-accent ml-auto h-6 px-2 text-xs" href={`/api/videos/${v.id}/file?download=1`}>MP4 다운로드</a></div>
            <div className="px-2 pb-2 text-[11px] text-mute">{fmtDate(v.created_at)}</div>
          </div>
        ))}
        {!videos.length && <div className="text-xs text-mute">아직 없습니다.</div>}
      </div>
    </div>
  );
}
