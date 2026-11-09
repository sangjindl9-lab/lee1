import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, errorText } from '../api/client';
import type { Health } from '../api/types';
import { useAuth } from '../context/Auth';
import { BrandMark, useBranding } from '../context/Branding';

function useHealth() {
  const [h, setH] = useState<{ ok: boolean | null; version?: string; err?: string }>({ ok: null });
  useEffect(() => {
    let alive = true;
    api<Health>('/health', { silent: true })
      .then((r) => alive && setH({ ok: !!r.ok, version: r.version }))
      .catch((e: unknown) => alive && setH({ ok: false, err: errorText(e) }));
    return () => {
      alive = false;
    };
  }, []);
  return h;
}

export function LoginPage() {
  const { login, verifyMfa, notice } = useAuth();
  const branding = useBranding();
  const health = useHealth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await login(username.trim(), password);
      if (r) {
        setMfaToken(r.mfaToken);
        setPassword('');
      }
    } catch (e2) {
      setErr(e2 instanceof ApiError && e2.status === 401 ? '아이디 또는 비밀번호가 올바르지 않습니다.' : errorText(e2));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setBusy(true);
    setErr(null);
    try {
      await verifyMfa(mfaToken, code);
    } catch (e2) {
      setErr(e2 instanceof ApiError && e2.status === 401 ? '인증코드가 올바르지 않거나 만료되었습니다.' : errorText(e2));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-box">
        <BrandMark />
        {notice ? <div className="banner banner-info">{notice}</div> : null}
        {!mfaToken ? (
          <form className="form" onSubmit={onLogin}>
            <h1 className="auth-title">관제 로그인</h1>
            <label className="field">
              <span>아이디</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
            </label>
            <label className="field">
              <span>비밀번호</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
            {err ? <div className="inline-error">{err}</div> : null}
            <button className="btn btn-primary btn-block" disabled={busy || !username || !password}>
              {busy ? '확인 중…' : '로그인'}
            </button>
          </form>
        ) : (
          <form className="form" onSubmit={onVerify}>
            <h1 className="auth-title">2단계 인증</h1>
            <p className="muted">인증 앱(OTP)에 표시된 6자리 코드를 입력하세요.</p>
            <label className="field">
              <span>인증코드</span>
              <input
                className="otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
              />
            </label>
            {err ? <div className="inline-error">{err}</div> : null}
            <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
              {busy ? '확인 중…' : '확인'}
            </button>
            <button
              type="button"
              className="btn btn-block"
              onClick={() => {
                setMfaToken(null);
                setCode('');
                setErr(null);
              }}
            >
              처음으로
            </button>
          </form>
        )}
        <div className="auth-foot">
          <span className={'health ' + (health.ok === true ? 'ok' : health.ok === false ? 'bad' : '')}>
            서버 상태: {health.ok === null ? '확인 중' : health.ok ? '정상' : health.err ? '연결 불가' : '이상'}
            {health.version ? ` · v${health.version}` : ''}
          </span>
          {branding.companyName ? <span>{branding.companyName}</span> : null}
        </div>
      </div>
    </div>
  );
}
