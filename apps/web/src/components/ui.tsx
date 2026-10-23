'use client';

import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Loader2, X } from 'lucide-react';
import {
  ButtonHTMLAttributes, createContext, forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes,
  TextareaHTMLAttributes, useCallback, useContext, useEffect, useId, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { formatMoneyInput, isNegative, unformat, won } from '@/lib/format';
import { STATUS, TRADE, type ProjectStatus, type TradeType } from '@/lib/labels';

/** 클래스 병합 — 뒤에 준 크기·간격이 기본값을 확실히 덮어쓰도록 */
export const cx = (...v: ClassValue[]) => twMerge(clsx(v));

/* ─────────────── 버튼 ─────────────── */
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
const BTN: Record<BtnVariant, string> = {
  primary: 'bg-steel text-white hover:bg-steel-hover border border-transparent dark:text-[#0b1016]',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-hover',
  ghost: 'text-ink-2 hover:bg-surface-2 border border-transparent',
  danger: 'bg-surface text-seal border border-seal/40 hover:bg-seal-soft',
  quiet: 'text-steel-ink hover:underline underline-offset-2 border border-transparent px-0! h-auto!',
};
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled || loading}
        className={cx(
          'inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-[4px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          size === 'sm' ? 'h-7 px-2.5 text-meta' : 'h-8 px-3 text-body',
          BTN[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
        {children}
      </button>
    );
  },
);

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={clsx('inline-grid size-8 place-items-center rounded-[4px] text-muted hover:bg-surface-2 hover:text-ink', className)} {...rest}>
      {children}
    </button>
  );
}

/* ─────────────── 입력 ─────────────── */
const ctl =
  'h-8 w-full rounded-[4px] border border-line-strong bg-surface px-2.5 text-body text-ink placeholder:text-faint transition-colors hover:border-faint focus:border-steel focus:outline-none focus:ring-2 focus:ring-steel/15 disabled:bg-surface-2 disabled:text-muted aria-invalid:border-seal aria-invalid:ring-seal/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(ctl, className)} {...rest} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(ctl, 'h-auto min-h-20 py-1.5 leading-5', className)} {...rest} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(ctl, 'appearance-none bg-[length:14px] bg-[right_8px_center] bg-no-repeat pr-7', className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a93a0' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});

/** 금액 입력 — 천 단위 구분, 우측 정렬, 원 단위. 값은 숫자 문자열로 주고받는다 */
export function MoneyInput({ value, onChange, className, suffix = '원', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onChange: (digits: string) => void; suffix?: string }) {
  return (
    <div className="relative">
      <input
        inputMode="numeric"
        autoComplete="off"
        className={cx(ctl, 'num pr-7 text-right', className)}
        value={formatMoneyInput(value)}
        onChange={(e) => onChange(unformat(e.target.value))}
        {...rest}
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-meta text-faint">{suffix}</span>
    </div>
  );
}

export function Field({ label, required, error, hint, children, className, htmlFor }: { label: string; required?: boolean; error?: string; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={clsx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={htmlFor} className="text-meta font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-seal" aria-label="필수">*</span>}
      </label>
      {children}
      {error ? <p className="text-meta text-seal" role="alert">{error}</p> : hint ? <p className="text-meta text-faint">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, disabled, indeterminate }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <label className={clsx('inline-flex items-center gap-2', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
      <input ref={ref} type="checkbox" className="size-3.5 accent-[var(--steel)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/* ─────────────── 표시 ─────────────── */
type Tone = 'outline' | 'steel' | 'seal' | 'ok' | 'ink' | 'warn' | 'muted';
const TONE: Record<Tone, string> = {
  outline: 'border border-line-strong text-muted',
  steel: 'bg-steel-soft text-steel-ink',
  seal: 'border border-seal/45 text-seal',
  ok: 'bg-ok-soft text-ok',
  ink: 'bg-ink text-surface',
  warn: 'bg-warn-soft text-warn',
  muted: 'bg-surface-2 text-muted',
};
export function Badge({ tone = 'outline', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex h-5 items-center gap-1 rounded-[3px] px-1.5 text-meta font-medium whitespace-nowrap', TONE[tone], className)}>{children}</span>;
}
export function StatusBadge({ status }: { status: ProjectStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
/** 공종 표식 — 전선 색처럼 짧은 색 막대 + 글자 (색만으로 구분하지 않음) */
export function TradeTag({ trade, short }: { trade: TradeType; short?: boolean }) {
  const t = TRADE[trade];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2">
      <span aria-hidden className="h-3 w-1 rounded-[1px]" style={{ background: t.color }} />
      {short ? t.short : t.label}
    </span>
  );
}

/** 금액 표시 — 음수는 인주색 △ */
export function Won({ value, className, unit, blankZero }: { value: string | null | undefined; className?: string; unit?: boolean; blankZero?: boolean }) {
  return (
    <span className={clsx('num', isNegative(value) && 'text-seal', className)}>
      {won(value, { blankZero })}
      {unit && value ? <span className="ml-0.5 text-[0.85em] font-normal text-faint">원</span> : null}
    </span>
  );
}

export function Panel({ title, actions, children, className, bodyClassName, id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={clsx('min-w-0 rounded-[6px] border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
          {typeof title === 'string' ? <h2 className="text-section font-semibold">{title}</h2> : title}
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={clsx(bodyClassName ?? 'p-4')}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {children}
        <h1 className="text-title font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-0.5 text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <p className="text-section font-medium text-ink-2">{title}</p>
      {description && <p className="mt-1 max-w-md text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-[3px] bg-surface-2', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[3px] border border-line-strong bg-surface px-1 text-[11px] font-medium text-muted">{children}</kbd>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="flex gap-0.5 border-b border-line">
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={clsx('-mb-px h-9 border-b-2 px-3 text-body font-medium', value === i.value ? 'border-steel text-ink' : 'border-transparent text-muted hover:text-ink')}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** 정의 목록 — 상세 화면의 '항목: 값' 묶음 */
export function DL({ items, cols = 2 }: { items: { label: string; value: ReactNode; wide?: boolean }[]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={clsx('grid gap-x-6 gap-y-3', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-3', cols === 4 && 'sm:grid-cols-2 lg:grid-cols-4')}>
      {items.map((i) => (
        <div key={i.label} className={clsx('min-w-0', i.wide && 'sm:col-span-full')}>
          <dt className="text-meta text-muted">{i.label}</dt>
          <dd className="mt-0.5 break-words text-ink">{i.value || <span className="text-faint">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ─────────────── 결재 도장 ─────────────── */
/** 인주색 원형 도장. 결재란·무결성 확인 등 '확정'의 순간에만 쓴다 */
export function Seal({ name, date, size = 56, rejected, animate, label, image }: { name: string; date?: string; size?: number; rejected?: boolean; animate?: boolean; label?: string; image?: string | null }) {
  if (image) {
    // 등록한 도장 이미지 — 날짜는 아래에 작게
    return (
      <span role="img" aria-label={label ?? `${name} ${rejected ? '반려' : '승인'} ${date ?? ''}`} className={clsx('relative inline-flex shrink-0 flex-col items-center text-seal', animate && 'animate-stamp')} style={{ width: size }}>
        <img src={image} alt="" draggable={false} className="block object-contain select-none" style={{ width: size * 0.92, height: size * 0.78 }} />
        {date && <span className="num leading-none" style={{ fontSize: Math.max(8, size * 0.15) }}>{date}</span>}
        {rejected && <span aria-hidden className="absolute inset-x-1 top-[40%] h-0.5 -rotate-45 bg-current" />}
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={label ?? `${name} ${rejected ? '반려' : '승인'} ${date ?? ''}`}
      className={clsx('relative inline-grid shrink-0 -rotate-[8deg] place-items-center rounded-full text-seal', animate && 'animate-stamp')}
      style={{ width: size, height: size, border: `2px solid currentColor`, boxShadow: 'inset 0 0 0 2px var(--surface), inset 0 0 0 3px currentColor', opacity: 0.92 }}
    >
      <span className="flex flex-col items-center leading-none">
        <span className="font-bold tracking-[0.04em]" style={{ fontSize: size * 0.24 }}>{name}</span>
        {date && <span className="num mt-0.5" style={{ fontSize: Math.max(8, size * 0.15) }}>{date}</span>}
      </span>
      {rejected && <span aria-hidden className="absolute inset-x-1 top-1/2 h-0.5 -rotate-45 bg-current" />}
    </span>
  );
}

/** 종이 결재란 형태: 담당 | 검토 | 승인 */
export function ApprovalBox({ steps }: { steps: { title: string; name?: string; date?: string; image?: string | null; state: 'done' | 'rejected' | 'waiting' | 'empty' }[] }) {
  return (
    <table className="border-collapse text-center text-meta">
      <tbody>
        <tr>
          <th rowSpan={2} className="w-6 border border-line-strong bg-surface-2 px-1 font-medium text-muted [writing-mode:vertical-rl]">결재</th>
          {steps.map((s, i) => (
            <th key={i} className="h-6 w-[72px] border border-line-strong bg-surface-2 font-medium text-muted">{s.title}</th>
          ))}
        </tr>
        <tr>
          {steps.map((s, i) => (
            <td key={i} className="h-[68px] border border-line-strong align-middle">
              {s.state === 'done' || s.state === 'rejected' ? <Seal name={s.name ?? ''} date={s.date} size={52} rejected={s.state === 'rejected'} image={s.image} /> : s.state === 'waiting' ? <span className="text-faint">{s.name ?? '대기'}</span> : null}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/* ─────────────── 대화상자·서랍 ─────────────── */
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
}

function useFocusTrap(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !ref.current) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = (['[data-autofocus]', 'input:not([disabled]):not([readonly]):not([type=hidden])', 'select:not([disabled])', 'textarea:not([disabled])', 'button:not([disabled])'] as const)
      .map((q) => el.querySelector<HTMLElement>(q))
      .find(Boolean);
    first?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const nodes = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!nodes.length) return;
      const [a, z] = [nodes[0], nodes[nodes.length - 1]];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    el.addEventListener('keydown', trap);
    return () => {
      el.removeEventListener('keydown', trap);
      prev?.focus?.();
    };
  }, [open]);
  return ref;
}

export function Dialog({ open, onClose, title, children, footer, width = 440, tone }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number; tone?: 'danger' }) {
  useEscape(open, onClose);
  const ref = useFocusTrap(open);
  const id = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgb(10_16_24/0.45)] p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal aria-labelledby={id} className="animate-pop flex max-h-[90dvh] w-full flex-col rounded-[6px] bg-surface shadow-pop" style={{ maxWidth: width }}>
        <header className={clsx('flex items-center justify-between gap-3 border-b px-4 py-3', tone === 'danger' ? 'border-seal/30' : 'border-line')}>
          <h2 id={id} className={clsx('text-section font-semibold', tone === 'danger' && 'text-seal')}>{title}</h2>
          <IconButton label="닫기" onClick={onClose}><X className="size-4" /></IconButton>
        </header>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEscape(open, onClose);
  const ref = useFocusTrap(open);
  const id = useId();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-[rgb(10_16_24/0.35)]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal aria-labelledby={id} className="animate-drawer flex h-full w-full flex-col bg-surface shadow-pop" style={{ maxWidth: width }}>
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={id} className="truncate text-section font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-meta text-muted">{subtitle}</p>}
          </div>
          <IconButton label="닫기" onClick={onClose}><X className="size-4" /></IconButton>
        </header>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ─────────────── 알림 ─────────────── */
type ToastItem = { id: number; kind: 'ok' | 'error' | 'info'; text: string };
const ToastCtx = createContext<(kind: ToastItem['kind'], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 lg:right-4 lg:left-auto lg:items-end">
        {items.map((t) => (
          <div key={t.id} className={clsx('animate-pop pointer-events-auto flex max-w-md items-start gap-2 rounded-[4px] px-3.5 py-2.5 text-body shadow-pop', t.kind === 'error' ? 'bg-seal text-white' : 'bg-ink text-surface')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-4 animate-spin text-muted', className)} aria-label="불러오는 중" />;
}

/** 확인 대화상자 훅 — 삭제 등 되돌리기 어려운 작업 전 */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; body: ReactNode; confirm: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const ask = useCallback((o: { title: string; body: ReactNode; confirm?: string; danger?: boolean }) => new Promise<boolean>((resolve) => setState({ confirm: '확인', ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  const node = (
    <Dialog
      open={!!state}
      onClose={() => close(false)}
      title={state?.title}
      tone={state?.danger ? 'danger' : undefined}
      footer={
        <>
          <Button onClick={() => close(false)}>취소</Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>{state?.confirm}</Button>
        </>
      }
    >
      <div className="text-ink-2">{state?.body}</div>
    </Dialog>
  );
  return { ask, node };
}
