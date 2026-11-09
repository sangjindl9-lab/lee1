import { useEffect, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { label, SEVERITY_LABEL, ALARM_STATE_LABEL, COMMAND_STATUS_LABEL } from '../lib/labels';

export function Loading({ text = '불러오는 중…' }: { text?: string }) {
  return <div className="state state-loading">{text}</div>;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const unreachable = error instanceof ApiError && error.unreachable;
  const forbidden = error instanceof ApiError && error.status === 403;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className={'state state-error' + (unreachable ? ' state-offline' : '')} role="alert">
      <div className="state-title">
        {unreachable ? '관제 서버에 연결할 수 없습니다' : forbidden ? '접근 권한이 없습니다' : '데이터를 불러오지 못했습니다'}
      </div>
      <div className="state-msg">
        {unreachable ? '네트워크 또는 서버 상태를 확인하세요. 표시된 값이 없으면 실제 상태를 알 수 없는 것입니다.' : msg}
      </div>
      {onRetry ? (
        <button className="btn" onClick={onRetry}>
          다시 시도
        </button>
      ) : null}
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="inline-error" role="alert">
      {msg}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="state state-empty">{text}</div>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`sev sev-${severity}`}>{label(SEVERITY_LABEL, severity)}</span>;
}

export function AlarmStateBadge({ state }: { state: string }) {
  return <span className={`pill st-${state}`}>{label(ALARM_STATE_LABEL, state)}</span>;
}

export function CommandStatusBadge({ status }: { status: string }) {
  return <span className={`pill cmd-${status}`}>{label(COMMAND_STATUS_LABEL, status)}</span>;
}

export function OnlineDot({ online }: { online: boolean | null | undefined }) {
  const cls = online === true ? 'on' : online === false ? 'off' : 'unk';
  const t = online === true ? '온라인' : online === false ? '오프라인' : '알 수 없음';
  return <span className={`dot dot-${cls}`} title={t} aria-label={t} />;
}

/** true=이상(경고색), false=정상, null=— */
export function Flag({ value, onText, offText }: { value: boolean | null | undefined; onText: string; offText: string }) {
  if (value === true) return <span className="flag flag-bad">{onText}</span>;
  if (value === false) return <span className="flag flag-ok">{offText}</span>;
  return <span className="flag flag-unk">—</span>;
}

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
  closeOnBackdrop = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  closeOnBackdrop?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnBackdrop) onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, closeOnBackdrop]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' modal-wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Card({ title, children, extra, className }: { title: string; children: ReactNode; extra?: ReactNode; className?: string }) {
  return (
    <section className={'card' + (className ? ' ' + className : '')}>
      <div className="card-head">
        <h3>{title}</h3>
        {extra}
      </div>
      <div className="card-body">{children}</div>
    </section>
  );
}

export function KV({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className={'kv-v' + (mono ? ' mono' : '')}>{v}</span>
    </div>
  );
}
