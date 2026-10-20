import { useEffect, useRef, useState, type ReactNode } from 'react';

export const fmt1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-');
export const fmt2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '-');
export const won = (v: number) => (v ? Math.round(v).toLocaleString('ko-KR') : '0');

/** 숫자 입력: 입력 중에는 문자열을 유지하고 유효한 값일 때만 반영 */
export function NumField({
  value,
  onChange,
  min,
  max,
  digits = 2,
  thousands = false,
  className = 'cell-inp num text-right',
  readOnly,
  id,
  ariaLabel,
  placeholder,
}: {
  value: number;
  onChange?: (v: number) => void;
  min?: number;
  max?: number;
  digits?: number;
  thousands?: boolean;
  className?: string;
  readOnly?: boolean;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const show = (v: number) => {
    if (!Number.isFinite(v)) return '';
    if (thousands) return v ? Math.round(v).toLocaleString('ko-KR') : '';
    return String(Math.round(v * 10 ** digits) / 10 ** digits);
  };
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const parse = (s: string) => {
    const n = Number(s.replace(/,/g, '').trim());
    return s.trim() === '' ? 0 : n;
  };
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      className={className}
      inputMode="decimal"
      value={text}
      readOnly={readOnly}
      placeholder={placeholder}
      onFocus={(e) => {
        focused.current = true;
        if (thousands) setText(value ? String(Math.round(value)) : '');
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(show(value));
      }}
      onChange={(e) => {
        const s = e.target.value;
        setText(s);
        const n = parse(s);
        if (!Number.isFinite(n)) return;
        let v = n;
        if (min != null) v = Math.max(min, v);
        if (max != null) v = Math.min(max, v);
        onChange?.(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: wide ? 980 : 640 }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="h2">{title}</div>
          <button className="btn btn-sm" onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** 페이지 안에서 처리하는 확인 대화상자 (브라우저 confirm 대신) */
export function Confirm({ title, message, okLabel = '확인', danger, onOk, onClose }: { title: string; message: ReactNode; okLabel?: string; danger?: boolean; onOk: () => void; onClose: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button
            className={danger ? 'btn btn-primary' : 'btn btn-primary'}
            style={danger ? { background: 'var(--late)', borderColor: 'var(--late)', color: '#fff' } : undefined}
            onClick={() => {
              onOk();
              onClose();
            }}
          >
            {okLabel}
          </button>
        </>
      }
    >
      <div className="text-[14px] leading-relaxed text-ink2">{message}</div>
    </Modal>
  );
}

export function Field({ label, children, htmlFor, className = '' }: { label: string; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number | null>(null);
  const show = (m: string) => {
    setMsg(m);
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setMsg(null), 2800);
  };
  const node = msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
  return { show, node };
}
