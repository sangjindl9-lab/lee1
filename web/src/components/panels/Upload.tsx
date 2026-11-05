import { useRef, useState } from 'react';
import { uploadFile, fmtBytes, fmtDate } from '../../api';

const STATUS: Record<string, [string, string]> = {
  uploaded: ['대기', 'text-mute'], analyzing: ['분석·변환 중', 'text-warn'], analyzed: ['분석 완료 — 3D 생성 필요', 'text-accent'],
  converted: ['변환 완료', 'text-ok'], failed: ['실패', 'text-bad'],
};

export default function UploadPanel({ projectId, files, jobs, onChange, onExtrude, canWrite }:
  { projectId: string; files: any[]; jobs: any[]; onChange: () => void; onExtrude: (fileId: string) => void; canWrite: boolean }) {
  const [busy, setBusy] = useState<{ name: string; p: number }[]>([]);
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  async function send(list: FileList | null) {
    if (!list) return;
    setErr('');
    for (const f of Array.from(list)) {
      setBusy((b) => [...b, { name: f.name, p: 0 }]);
      try { await uploadFile(projectId, f, (p) => setBusy((b) => b.map((x) => (x.name === f.name ? { ...x, p } : x)))); onChange(); }
      catch (e: any) { setErr(`${f.name}: ${e.message}`); }
      finally { setBusy((b) => b.filter((x) => x.name !== f.name)); }
    }
  }
  const jobFor = (fid: string) => jobs.find((j) => j.type === 'convert' && j.payload?.fileId === fid);
  return (
    <div className="space-y-3 p-3">
      <div className="panel-title">파일 업로드</div>
      {canWrite && (
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); send(e.dataTransfer.files); }}
          onClick={() => inp.current?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed p-5 text-center transition ${drag ? 'border-accent bg-accent/10' : 'border-line hover:border-mute'}`}>
          <div className="text-sm font-medium">파일을 끌어다 놓거나 클릭</div>
          <div className="mt-1 text-xs text-mute">STEP·IGES·STL·GLB · DXF·DWG·PDF 도면 · 대용량은 8MB 단위 분할 업로드</div>
          <input ref={inp} type="file" multiple hidden data-testid="file-input" accept=".step,.stp,.iges,.igs,.stl,.glb,.dxf,.dwg,.pdf" onChange={(e) => { send(e.target.files); e.target.value = ''; }} />
        </div>
      )}
      {busy.map((b) => (
        <div key={b.name} className="text-xs"><div className="flex justify-between"><span className="truncate">{b.name}</span><span className="num">{Math.round(b.p * 100)}%</span></div>
          <div className="mt-1 h-1 rounded bg-line"><div className="h-1 rounded bg-accent" style={{ width: `${b.p * 100}%` }} /></div></div>
      ))}
      {err && <div className="rounded border border-bad/40 bg-bad/10 px-2 py-1.5 text-xs text-bad">{err}</div>}
      <div className="space-y-1.5">
        {files.map((f) => {
          const j = jobFor(f.id);
          const [label, cls] = STATUS[f.status] || [f.status, ''];
          return (
            <div key={f.id} className="rounded-md border border-line bg-panel2 p-2 text-xs" data-testid="file-row" data-status={f.status}>
              <div className="flex items-center gap-2"><span className="chip uppercase">{f.ext}</span><span className="truncate font-medium">{f.original_name}</span><span className="num ml-auto text-mute">v{f.version}</span></div>
              <div className="mt-1 flex items-center gap-2 text-mute"><span className={`whitespace-nowrap ${cls}`}>{label}</span>
                {j?.status === 'running' && <span className="num">{Math.round(j.progress * 100)}%</span>}
                <span className="ml-auto num">{fmtBytes(Number(f.size))} · {fmtDate(f.created_at)}</span></div>
              {f.error && <div className="mt-1 text-bad">{f.error}</div>}
              <div className="mt-1.5 flex gap-1">
                {['dxf', 'dwg', 'pdf'].includes(f.ext) && f.status !== 'analyzing' && f.has_analysis && canWrite && <button className="btn h-6 px-2 text-xs btn-on" onClick={() => onExtrude(f.id)}>{f.ext === 'pdf' ? '축척·두께 입력 → 3D 생성' : '두께 입력 → 3D 생성'}</button>}
                {canWrite && <a className="btn h-6 px-2 text-xs" href={`/api/files/${f.id}/original`}>원본</a>}
              </div>
            </div>
          );
        })}
        {!files.length && <div className="text-xs text-mute">아직 업로드한 파일이 없습니다.</div>}
      </div>
    </div>
  );
}
