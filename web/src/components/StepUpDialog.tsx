import { useState, type FormEvent, type ReactNode } from 'react';
import { api, errorText } from '../api/client';
import type { ReauthResponse } from '../api/types';
import { useAuth } from '../context/Auth';
import { Modal } from './common';

export interface StepUpDialogProps {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** 사유 입력 필수 여부 (전원 명령) */
  requireReason?: boolean;
  reasonPlaceholder?: string;
  onSubmit: (stepUpToken: string, reason: string) => Promise<void>;
  onClose: () => void;
}

/**
 * 재인증(step-up) 대화상자.
 * 비밀번호(+MFA 사용자는 TOTP)로 POST /auth/reauth → step_up_token을 받아 onSubmit에 넘긴다.
 */
export function StepUpDialog(p: StepUpDialogProps) {
  const { user } = useAuth();
  const needCode = !!user?.mfa_enabled;
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reasonOk = !p.requireReason || reason.trim().length >= 2;
  const codeOk = !needCode || /^\d{6}$/.test(code);
  const canSubmit = !busy && password.length > 0 && codeOk && reasonOk;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    let token: string;
    try {
      const r = await api<ReauthResponse>('/auth/reauth', {
        method: 'POST',
        body: needCode ? { password, code } : { password },
        silent: true,
      });
      token = r.step_up_token;
    } catch (e2) {
      setErr('재인증 실패: ' + errorText(e2));
      setBusy(false);
      return;
    }
    try {
      await p.onSubmit(token, reason.trim());
      p.onClose();
    } catch (e3) {
      setErr(errorText(e3));
      setBusy(false);
    }
  }

  return (
    <Modal title={p.title} onClose={() => !busy && p.onClose()} closeOnBackdrop={!busy}>
      <form onSubmit={submit} className="form">
        {p.children}
        {p.requireReason ? (
          <label className="field">
            <span>사유 (필수)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={p.reasonPlaceholder ?? '조작 사유를 입력하세요'}
              required
            />
          </label>
        ) : null}
        <div className="stepup-note">본인 확인을 위해 다시 인증하세요. ({user?.display_name || user?.username})</div>
        <label className="field">
          <span>비밀번호</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        {needCode ? (
          <label className="field">
            <span>OTP 인증코드 (6자리)</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
        ) : null}
        {err ? <div className="inline-error">{err}</div> : null}
        <div className="form-actions">
          <button type="button" className="btn" onClick={p.onClose} disabled={busy}>
            취소
          </button>
          <button type="submit" className={'btn ' + (p.danger ? 'btn-danger' : 'btn-primary')} disabled={!canSubmit}>
            {busy ? '처리 중…' : p.confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
