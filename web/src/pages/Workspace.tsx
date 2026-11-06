import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { navigate } from '../router';
import { t } from '../i18n';
import { useWS } from '../store';
import type { Me } from '../App';
import { Logo } from '../components/Brand';
import ThemeToggle from '../components/ThemeToggle';
import Viewer, { captureThumb } from '../components/Viewer';
import ViewerToolbar from '../components/ViewerToolbar';
import PartTree from '../components/PartTree';
import PartProps from '../components/PartProps';
import Timeline from '../components/Timeline';
import UploadPanel, { DRAWING } from '../components/panels/Upload';
import DxfExtrude from '../components/panels/DxfExtrude';
import ExplodePanel from '../components/panels/Explode';
import VideoPanel from '../components/panels/Video';
import SharePanel from '../components/panels/Share';
import ProjectInfo from '../components/panels/ProjectInfo';
import ReviewBanner from '../components/ReviewBanner';

type Tab = 'project' | 'upload' | 'convert' | 'explode' | 'video' | 'share';
const TABS: [Tab, string][] = [['project', t('nav.project')], ['upload', t('nav.upload')], ['convert', t('nav.convert')], ['explode', t('nav.explode')], ['video', t('nav.video')], ['share', t('nav.share')]];

export default function Workspace({ projectId, me }: { projectId: string; me: Me }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [modelId, setModelId] = useState<string | null>(new URLSearchParams(location.search).get('m'));
  const [tab, setTab] = useState<Tab>('upload');
  const [dxf, setDxf] = useState<string | null>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const viewerBox = useRef<HTMLDivElement>(null);
  const model = useWS((s) => s.model);
  const dirty = useWS((s) => s.dirty);
  const canWrite = me.user.role !== 'viewer';

  const load = useCallback(() => api(`/projects/${projectId}`).then((d) => { setData(d); return d; }).catch((e) => setErr(e.message)), [projectId]);
  useEffect(() => { load().then((d) => { if (d?.models?.length) { setTab('explode'); setModelId((m) => m || d.models[0].id); } }); }, [load]);

  // 진행 중 작업이 있으면 2초 간격 갱신
  // 선택된 모델이 삭제되었으면 선택 해제
  useEffect(() => {
    if (data && modelId && !data.models.some((m: any) => m.id === modelId)) { setModelId(data.models[0]?.id || null); if (!data.models.length) useWS.setState({ model: null, scene: null }); }
  }, [data, modelId]);
  const busy = data?.jobs?.some((j: any) => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!busy) return;
    const h = setInterval(async () => {
      const prev = new Set((data?.models || []).map((m: any) => m.id));
      const d = await load();
      // 새로 만들어진 모델(2D 도면 자동 초안 포함)은 바로 연다
      const fresh = d?.models.find((m: any) => !prev.has(m.id));
      if (fresh && !useWS.getState().dirty) { setModelId(fresh.id); setTab('explode'); }
    }, 2000);
    return () => clearInterval(h);
  }, [busy, load, data, modelId]);

  useEffect(() => {
    if (!modelId) return;
    history.replaceState(null, '', `/app/p/${projectId}?m=${modelId}`);
    let timer: any;
    api(`/models/${modelId}`).then((d) => {
      useWS.getState().load(d.model, d.scene.data, d.scene.version);
      // 썸네일이 없으면 처음 화면이 그려진 뒤 한 번 찍어 둔다 (고객사 쇼룸 목록용)
      if (!d.model.has_thumb && canWrite) timer = setTimeout(() => {
        if (useWS.getState().model?.id !== modelId) return;
        const img = captureThumb(); if (img) api(`/models/${modelId}/thumbnail`, { method: 'PUT', body: { image: img } }).catch(() => {});
      }, 3000);
    });
    api(`/models/${modelId}/scenes`).then(setVersions);
    return () => clearTimeout(timer);
  }, [modelId, projectId, canWrite]);

  const save = useCallback(async () => {
    const st = useWS.getState();
    if (!st.model || !st.dirty) return;
    setSaving(true);
    try {
      const r = await api(`/models/${st.model.id}/scene`, { method: 'PUT', body: { data: st.scene } });
      useWS.setState({ dirty: false, sceneVersion: r.version });
      api(`/models/${st.model.id}/scenes`).then(setVersions);
    } finally { setSaving(false); }
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } };
    const u = (e: BeforeUnloadEvent) => { if (useWS.getState().dirty) e.preventDefault(); };
    addEventListener('keydown', k); addEventListener('beforeunload', u);
    return () => { removeEventListener('keydown', k); removeEventListener('beforeunload', u); };
  }, [save]);

  if (err) return <div className="p-8 text-bad">{err} <button className="btn ml-2" onClick={() => navigate('/app')}>목록으로</button></div>;
  if (!data) return <div className="grid h-full place-items-center text-mute">불러오는 중…</div>;
  const zUp = model ? model.stats?.upAxis !== 'Y' : true;
  const pendingDxf = data.files.filter((f: any) => DRAWING.includes(f.ext) && f.has_analysis);

  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto] overflow-hidden">
      <header className="flex h-11 items-center gap-1 border-b border-line bg-panel px-2">
        <button className="btn btn-ghost px-1.5" onClick={() => navigate('/app')} title="프로젝트 목록"><Logo size={20} /></button>
        <button className="btn btn-ghost px-1.5 lg:hidden" onClick={() => setLeftOpen(!leftOpen)}>☰</button>
        <div className="mr-2 hidden max-w-[16rem] truncate text-sm font-semibold sm:block">{data.project.name}</div>
        <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto" data-testid="tabs">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`h-8 shrink-0 rounded-md px-3 text-[13px] ${tab === k ? 'bg-panel2 font-semibold text-accent' : 'text-mute hover:text-ink'}`}>{l}</button>
          ))}
        </nav>
        {model && canWrite && <button className={`btn ${dirty ? 'btn-accent' : ''}`} onClick={save} disabled={!dirty || saving} data-testid="save" title="Ctrl+S">{saving ? '저장 중…' : dirty ? '저장' : '저장됨'}</button>}
        <ThemeToggle />
      </header>

      <div className="relative flex min-h-0">
        <aside className={`${leftOpen ? 'flex' : 'hidden'} absolute inset-y-0 left-0 z-20 w-64 flex-col border-r border-line bg-panel lg:static lg:flex`}>
          <div className="border-b border-line p-3">
            <div className="panel-title mb-2">모델</div>
            <div className="max-h-40 space-y-0.5 overflow-auto">
              {data.models.map((m: any) => (
                <div key={m.id} data-testid="model-row" onClick={() => setModelId(m.id)} role="button"
                  className={`group flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-[13px] ${m.id === modelId ? 'bg-accent/15 text-accent' : 'hover:bg-panel2'}`}>
                  <span className="truncate">{m.name}</span><span className="num ml-auto text-[10px] text-mute">{m.stats.partCount}p</span>
                  {canWrite && <button title="모델 삭제" data-testid="model-delete" className="w-4 text-mute opacity-0 hover:text-bad group-hover:opacity-100" onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`3D 모델 '${m.name}' 을(를) 삭제할까요?\n장면 설정·영상·공유 링크도 함께 삭제됩니다. 원본 파일은 남습니다.`)) return;
                    await api(`/models/${m.id}`, { method: 'DELETE' });
                    if (m.id === modelId) { setModelId(null); useWS.setState({ model: null, scene: null }); history.replaceState(null, '', `/app/p/${projectId}`); }
                    load();
                  }}>✕</button>}
                </div>
              ))}
              {!data.models.length && <div className="text-xs text-mute">파일을 올리면 모델이 생성됩니다.</div>}
            </div>
          </div>
          <PartTree />
        </aside>

        <main ref={viewerBox} className="relative min-w-0 flex-1 bg-bg">
          {modelId && model?.id === modelId ? (
            <>
              <Viewer key={modelId} url={`/api/models/${modelId}/glb`} zUp={zUp} />
              <ViewerToolbar container={viewerBox} />
              {model && (model as any).review_status && (model as any).review_status !== 'n/a' && <ReviewBanner canWrite={canWrite} />}
              {model && <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-panel/80 px-2 py-1 text-[11px] text-mute backdrop-blur">
                {model.name} · {model.stats.partCount}개 부품 · {model.stats.size?.map((x: number) => x.toFixed(0)).join('×')} {model.stats.unit}</div>}
            </>
          ) : (
            <div className="grid h-full place-items-center p-6 text-center">
              <div><div className="text-lg font-semibold">{data.models.length ? '모델 불러오는 중…' : '3D 모델이 아직 없습니다'}</div>
                <div className="mt-1 text-sm text-mute">{busy ? '파일을 분석·변환하고 있습니다…' : '오른쪽 [파일 업로드]에 2D 도면(PDF·DWG·DXF·스캔·사진)이나 3D 파일을 올리면 바로 3D 쇼룸이 만들어집니다.'}</div></div>
            </div>
          )}
        </main>

        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-line bg-panel md:block" data-testid="right-panel">
          {model && <PartProps readOnly={!canWrite} />}
          {tab === 'project' && <ProjectInfo project={data.project} versions={versions} />}
          {tab === 'upload' && <UploadPanel projectId={projectId} files={data.files} jobs={data.jobs} onChange={load} onExtrude={setDxf} canWrite={canWrite} />}
          {tab === 'convert' && (
            <div className="space-y-3 p-3">
              <div className="panel-title">3D 변환</div>
              <p className="text-xs text-mute">STEP·IGES·STL·GLB 는 원본 형상 그대로 변환됩니다. 2D 도면(DXF·DWG·PDF·스캔본·이미지)은 올리는 즉시 <b className="text-ai">참고용 AI 3D 초안</b>이 만들어집니다 — 투상도가 3개면 결합, 1개면 두께를 추정해 돌출. 축척·두께가 틀리면 아래에서 고쳐 다시 만드세요.</p>
              {pendingDxf.map((f: any) => (
                <div key={f.id} className="flex items-center gap-2 rounded border border-line p-2 text-xs"><span className="chip uppercase">{f.ext}</span><span className="truncate">{f.original_name} v{f.version}</span>
                  {canWrite && <button className="btn btn-on ml-auto h-6 px-2 text-xs" onClick={() => setDxf(f.id)}>{f.status === 'converted' ? '다시 만들기' : '3D 생성'}</button>}</div>
              ))}
              <ProjectInfo project={data.project} versions={versions} />
            </div>
          )}
          {tab === 'explode' && <ExplodePanel canWrite={canWrite} />}
          {tab === 'video' && modelId && <VideoPanel modelId={modelId} jobs={data.jobs} onSave={save} canWrite={canWrite} refresh={load} />}
          {tab === 'share' && modelId && model && <SharePanel projectId={projectId} modelId={modelId} modelName={model.name} canWrite={canWrite} onBeforeShare={save} />}
          {(tab === 'video' || tab === 'share') && !modelId && <div className="p-3 text-sm text-mute">먼저 모델을 만드세요.</div>}
        </aside>
      </div>

      <footer className="border-t border-line bg-panel">{model && <Timeline />}</footer>
      {dxf && <DxfExtrude fileId={dxf} onClose={() => setDxf(null)} onCreated={async (id) => { setDxf(null); await load(); setModelId(id); setTab('explode'); }} />}
    </div>
  );
}
