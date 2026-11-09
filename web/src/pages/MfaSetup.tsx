import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import { api, errorText } from '../api/client';
import type { MfaSetupResponse } from '../api/types';
import { useAuth } from '../context/Auth';
import { BrandMark } from '../context/Branding';

/** 관리자 역할은 MFA를 켜야 다른 API를 쓸 수 있다(403 MFA_SETUP_REQUIRED). */
export function MfaSetupPage() {
  const { refresh, logout } = useAuth();
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setLoadErr(null);
    setSetup(null);
    setQr(null);
    try {
      const r = await api<MfaSetupResponse>('/auth/mfa/setup', { method: 'POST', silent: true });
      setSetup(r);
    } catch (e) {
      setLoadErr(errorText(e));
    }
  }

  useEffect(() => {
    void start();
  }, []);

  useEffect(() => {
    if (!setup) return;
    // 로컬에서만 생성 (네트워크 호출 없음)
    QRCode.toDataURL(setup.otpauth_url, { margin: 1, width: 200, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null));
  }, [setup]);

  async function enable(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api<{ enabled: boolean }>('/auth/mfa/enable', { method: 'POST', body: { code }, silent: true });
      const st = await refresh();
      // 기존 토큰이 계속 MFA 미설정 상태로 취급되면 다시 로그인하게 한다.
      if (st !== 'authed') await logout('2단계 인증이 설정되었습니다. 다시 로그인하세요.');
    } catch (e2) {
      setErr(errorText(e2));
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-box auth-box-wide">
        <BrandMark />
        <h1 className="auth-title">2단계 인증(MFA) 설정 필요</h1>
        <p className="muted">관리자 계정은 OTP 인증을 켜야 관제 기능을 사용할 수 있습니다. 인증 앱(Google Authenticator 등)에 아래 정보를 등록한 뒤 표시되는 6자리 코드를 입력하세요.</p>
        {loadErr ? (
          <div className="inline-error">
            설정 정보를 받지 못했습니다: {loadErr}{' '}
            <button className="btn btn-sm" onClick={() => void start()}>
              다시 시도
            </button>
          </div>
        ) : null}
        {setup ? (
          <div className="mfa-grid">
            {qr ? <img className="mfa-qr" src={qr} alt="OTP 등록 QR 코드" width={200} height={200} /> : null}
            <div className="mfa-info">
              <label className="field">
                <span>비밀키 (수동 입력용)</span>
                <input className="mono" readOnly value={setup.secret} onFocus={(e) => e.currentTarget.select()} />
              </label>
              <label className="field">
                <span>otpauth URL</span>
                <textarea className="mono" readOnly rows={3} value={setup.otpauth_url} onFocus={(e) => e.currentTarget.select()} />
              </label>
            </div>
          </div>
        ) : !loadErr ? (
          <div className="state state-loading">설정 정보를 받는 중…</div>
        ) : null}
        <form className="form" onSubmit={enable}>
          <label className="field">
            <span>인증코드 (6자리)</span>
            <input
              className="otp-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          {err ? <div className="inline-error">{err}</div> : null}
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => void logout()}>
              로그아웃
            </button>
            <button className="btn btn-primary" disabled={busy || code.length !== 6 || !setup}>
              {busy ? '확인 중…' : 'MFA 켜기'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
