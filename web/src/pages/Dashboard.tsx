import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api';
import { navigate } from '../router';
import { t } from '../i18n';
import { Wordmark } from '../components/Brand';
import ThemeToggle from '../components/ThemeToggle';
import type { Me } from '../App';

const INDUSTRIES = ['mold', 'machine', 'electric', 'building', 'product'] as const;

export default function Dashboard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [list, setList] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', industry: 'machine', description: '' });
  const [err, setErr] = useState('');
  const load = () => api('/projects').then(setList);
  useEffect(() => { load(); }, []);
  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    try { const p = await api('/projects', { body: f }); navigate(`/app/p/${p.id}`); } catch (x: any) { setErr(x.message); }
  }
  return (
    <div className="min-h-full">
      <header className="flex h-12 items-center gap-3 border-b border-line bg-panel px-4">
        <Wordmark />
        <span className="chip ml-2">{me.company.name}</span>
        <div className="ml-auto flex items-center gap-1">
          <span className="hidden text-sm text-mute sm:inline">{me.user.name} · {me.user.role === 'admin' ? '관리자' : me.user.role === 'viewer' ? '보기 전용' : '사용자'}</span>
          <ThemeToggle />
          <button className="btn btn-ghost" onClick={async () => { await api('/auth/logout', { method: 'POST' }); onLogout(); navigate('/login'); }}>로그아웃</button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-8">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="panel-title">Projects</div>
            <h1 className="text-2xl font-bold">프로젝트</h1>
          </div>
          {me.user.role !== 'viewer' && <button className="btn btn-accent ml-auto" onClick={() => setOpen(true)}>＋ 새 프로젝트</button>}
        </div>
        {list === null ? <div className="mt-8 text-mute">불러오는 중…</div> : list.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-line p-10 text-center">
            <div className="text-lg font-semibold">첫 프로젝트를 만들어 보세요</div>
            <p className="mt-1 text-sm text-mute">산업 분야를 고르고 STEP·DXF·STL·GLB 파일을 올리면 3D 쇼룸이 만들어집니다.</p>
            {me.user.role !== 'viewer' && <button className="btn btn-accent mt-4" onClick={() => setOpen(true)}>＋ 새 프로젝트</button>}
          </div>
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((p) => (
              <button key={p.id} onClick={() => navigate(`/app/p/${p.id}`)} className="group rounded-xl border border-line bg-panel p-4 text-left transition hover:border-accent">
                <div className="flex items-center gap-2"><span className="chip">{t(`industry.${p.industry}` as any)}</span><span className="ml-auto text-xs text-mute">{fmtDate(p.updated_at)}</span></div>
                <div className="mt-3 text-base font-semibold group-hover:text-accent">{p.name}</div>
                <div className="mt-1 line-clamp-2 min-h-[2.5em] text-sm text-mute">{p.description || '설명 없음'}</div>
                <div className="mt-3 flex gap-4 text-xs text-mute"><span>모델 <b className="num text-ink">{p.model_count}</b></span><span>파일 <b className="num text-ink">{p.file_count}</b></span></div>
              </button>
            ))}
          </div>
        )}
      </main>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <form onSubmit={create} onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-4 rounded-xl border border-line bg-panel p-5">
            <h2 className="text-lg font-semibold">새 프로젝트</h2>
            <label className="block space-y-1"><span className="label">프로젝트명</span><input className="input" autoFocus required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <div className="space-y-1"><span className="label">산업 분야</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {INDUSTRIES.map((k) => (
                  <button type="button" key={k} onClick={() => setF({ ...f, industry: k })} className={`btn justify-center ${f.industry === k ? 'btn-on' : ''}`}>{t(`industry.${k}` as any)}</button>
                ))}
              </div>
            </div>
            <label className="block space-y-1"><span className="label">설명</span><textarea className="input h-20 py-2" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            {err && <div className="text-sm text-bad">{err}</div>}
            <div className="flex justify-end gap-2"><button type="button" className="btn" onClick={() => setOpen(false)}>취소</button><button className="btn btn-accent">만들기</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
