import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { TopBar } from '../TopBar.jsx';
import { api } from '../lib.js';
import { useApp } from '../ui.jsx';

const ERR = {
  state: '로그인 시간이 지났어요. 다시 시도해 주세요.', oauth: '로그인 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  suspended: '이용이 제한된 계정이에요. 고객센터로 문의해 주세요.', provider: '지금은 사용할 수 없는 로그인 방식이에요.',
};
const LOGO = {
  kakao: <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#191919" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.6c-.1.4.3.7.6.5l4.3-2.8c.5.1.9.1 1.4.1 5.5 0 10-3.6 10-8S17.5 3 12 3z" /></svg>,
  naver: <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M15.6 12.8L8.2 2H2v20h6.4V11.2L15.8 22H22V2h-6.4z" /></svg>,
  google: <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z" /><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6H1.4a12 12 0 0 0 0 10.8z" /><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" /></svg>,
};
const NAME = { kakao: '카카오로 계속하기', naver: '네이버로 계속하기', google: 'Google로 계속하기' };

export default function Login() {
  const { me, config, refresh } = useApp();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false), [err, setErr] = useState(ERR[sp.get('error')] || null);
  const next = (sp.get('next') || '/').startsWith('/') && !(sp.get('next') || '').startsWith('//') ? sp.get('next') || '/' : '/';
  if (me) return <Navigate to={next} replace />;
  const providers = (config?.providers || []);
  const demo = async role => {
    setBusy(true); setErr(null);
    try { await api('/api/auth/demo', { method: 'POST', body: { role } }); await refresh(); nav(next, { replace: true }); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <>
      <TopBar />
      <main className="wrap">
        <div className="login">
          <h1>머묾에 오신 걸 환영해요</h1>
          <p className="muted">쓰고 있는 계정으로 3초 만에 시작하세요.</p>
          {err && <div className="err" style={{ marginTop: 16 }}>{err}</div>}
          <div className="sns">
            {['kakao', 'naver', 'google'].filter(p => providers.includes(p)).map(p => (
              <a key={p} className={p} href={`/auth/${p}?next=${encodeURIComponent(next)}`}>{LOGO[p]}{NAME[p]}</a>
            ))}
            {!providers.length && <div className="okmsg" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>카카오·네이버·구글 로그인 키가 아직 설정되지 않았어요.</div>}
          </div>
          {config?.demo && (
            <div className="box" style={{ marginTop: 24, textAlign: 'left' }}>
              <b>시연용 로그인</b>
              <p className="muted" style={{ margin: '4px 0 12px', fontSize: 13.5 }}>실서비스 전 테스트용이에요. 운영 시작 전에 반드시 꺼 주세요.</p>
              <div style={{ display: 'grid', gap: 8 }}>
                <button className="btn line" disabled={busy} onClick={() => demo('guest')}>게스트로 둘러보기</button>
                <button className="btn line" disabled={busy} onClick={() => demo('host')}>호스트로 둘러보기</button>
                <button className="btn line" disabled={busy} onClick={() => demo('admin')}>관리자로 둘러보기</button>
              </div>
            </div>
          )}
          <p className="legal-note">계속하면 머묾의 <Link className="link" to="/terms">이용약관</Link>과 <Link className="link" to="/privacy">개인정보처리방침</Link>에 동의하는 것으로 봐요.</p>
        </div>
      </main>
    </>
  );
}
