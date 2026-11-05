import { useState } from 'react';
import { api } from '../api';
import { navigate } from '../router';
import { Wordmark } from '../components/Brand';
import type { Me } from '../App';

export default function Auth({ mode, onDone }: { mode: 'login' | 'signup'; onDone: (m: Me) => void }) {
  const [f, setF] = useState({ companyName: '', name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const up = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api(`/auth/${mode}`, { body: f });
      onDone(await api<Me>('/auth/me'));
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-line bg-panel lg:block">
        <BlueprintArt />
        <div className="absolute bottom-10 left-10 right-10">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">Industrial Digital Showroom</div>
          <h1 className="mt-3 text-3xl font-bold leading-tight">CAD 를 올리면<br />분해·조립되는 3D 쇼룸으로.</h1>
          <p className="mt-3 max-w-md text-sm text-mute">STEP·DXF·STL·GLB 업로드 → 부품 트리 → 분해도·조립 애니메이션 → MP4 영상과 공유 URL 까지 한 곳에서.</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <Wordmark />
          <h2 className="pt-4 text-xl font-semibold">{mode === 'login' ? '로그인' : '회사 계정 만들기'}</h2>
          {mode === 'signup' && (<>
            <Field label="회사명"><input className="input" value={f.companyName} onChange={up('companyName')} required autoFocus /></Field>
            <Field label="이름"><input className="input" value={f.name} onChange={up('name')} required /></Field>
          </>)}
          <Field label="이메일"><input className="input" type="email" value={f.email} onChange={up('email')} required autoFocus={mode === 'login'} /></Field>
          <Field label="비밀번호"><input className="input" type="password" value={f.password} onChange={up('password')} required minLength={mode === 'signup' ? 8 : 1} /></Field>
          {err && <div className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{err}</div>}
          <button className="btn btn-accent h-10 w-full justify-center" disabled={busy}>{busy ? '처리 중…' : mode === 'login' ? '로그인' : '가입하고 시작하기'}</button>
          <div className="text-center text-sm text-mute">
            {mode === 'login'
              ? <>계정이 없나요? <a className="text-accent" href="/signup" onClick={(e) => { e.preventDefault(); navigate('/signup'); }}>회사 계정 만들기</a></>
              : <>이미 계정이 있나요? <a className="text-accent" href="/login" onClick={(e) => { e.preventDefault(); navigate('/login'); }}>로그인</a></>}
          </div>
          {mode === 'signup' && <p className="text-xs text-mute">가입한 계정은 회사 관리자 권한을 가지며, 회사 데이터는 다른 회사와 완전히 분리됩니다.</p>}
        </form>
      </div>
    </div>
  );
}
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block space-y-1"><span className="label">{label}</span>{children}</label>;

function BlueprintArt() {
  // 분해된 부품을 표현한 아이소메트릭 도식
  const box = (x: number, y: number, w: number, h: number, d: number, k: string, accent = false) => {
    const p = (a: number, b: number) => `${a},${b}`;
    const top = [p(x, y), p(x + w, y - w * 0.5), p(x + w + d, y - w * 0.5 + d * 0.5), p(x + d, y + d * 0.5)].join(' ');
    const left = [p(x, y), p(x + d, y + d * 0.5), p(x + d, y + d * 0.5 + h), p(x, y + h)].join(' ');
    const right = [p(x + d, y + d * 0.5), p(x + w + d, y - w * 0.5 + d * 0.5), p(x + w + d, y - w * 0.5 + d * 0.5 + h), p(x + d, y + d * 0.5 + h)].join(' ');
    return (<g key={k} stroke={accent ? 'var(--accent)' : 'var(--mute)'} strokeWidth="1" fill="none" opacity={accent ? 1 : 0.7}>
      <polygon points={top} fill={accent ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent'} /><polygon points={left} /><polygon points={right} /></g>);
  };
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice">
      <defs><pattern id="g" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="var(--line)" strokeWidth="0.6" /></pattern></defs>
      <rect width="600" height="600" fill="url(#g)" />
      {box(210, 120, 170, 16, 170, 'lid', true)}
      {box(210, 210, 170, 110, 170, 'body')}
      {box(210, 395, 170, 12, 170, 'base')}
      {box(90, 260, 60, 90, 18, 'side')}
      {box(470, 190, 60, 90, 18, 'sink')}
      {[0, 1, 2, 3].map((i) => <line key={i} x1={230 + i * 45} y1={60 + (i % 2) * 20} x2={230 + i * 45} y2={110 + (i % 2) * 20} stroke="var(--accent)" strokeDasharray="3 4" />)}
      <line x1="295" y1="160" x2="295" y2="205" stroke="var(--mute)" strokeDasharray="3 4" />
      <line x1="150" y1="300" x2="205" y2="300" stroke="var(--mute)" strokeDasharray="3 4" />
      <line x1="470" y1="240" x2="420" y2="250" stroke="var(--mute)" strokeDasharray="3 4" />
    </svg>
  );
}
