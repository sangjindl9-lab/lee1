'use client';

import clsx from 'clsx';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { KeyboardEvent, ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Spinner } from './ui';

export interface ComboOption {
  id: string;
  label: string;
  hint?: ReactNode;
  right?: ReactNode;
}

/**
 * 검색형 선택 상자 — 입력하면 search() 결과를 보여 주고 방향키·Enter 로 고른다.
 * 거래처·자재·현장처럼 목록이 긴 항목에 쓴다.
 */
export function Combobox({
  value, display, onChange, search, placeholder, invalid, disabled, allowClear = true, className, footer, autoFocus, id,
}: {
  value: string | null; display?: ReactNode; onChange: (opt: ComboOption | null) => void; search: (q: string) => Promise<ComboOption[]>;
  placeholder?: string; invalid?: boolean; disabled?: boolean; allowClear?: boolean; className?: string; footer?: ReactNode; autoFocus?: boolean; id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<ComboOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      search(q).then((r) => alive && (setOpts(r), setIdx(0))).finally(() => alive && setLoading(false));
    }, 160);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open, search]);

  useEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const r = btn.current!.getBoundingClientRect();
      const width = Math.max(r.width, 300);
      const below = window.innerHeight - r.bottom;
      setPos({ top: below < 320 && r.top > 320 ? r.top - 6 - 300 : r.bottom + 4, left: Math.min(r.left, window.innerWidth - width - 8), width });
    };
    place();
    const close = (e: MouseEvent) => {
      const el = document.getElementById(listId);
      if (el && !el.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, listId]);

  const pick = (o: ComboOption | null) => {
    onChange(o);
    setOpen(false);
    setQ('');
    btn.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(opts.length - 1, i + 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)));
    else if (e.key === 'Enter') (e.preventDefault(), opts[idx] && pick(opts[idx]));
    else if (e.key === 'Escape') (setOpen(false), btn.current?.focus());
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <>
      <button
        id={id}
        ref={btn}
        type="button"
        disabled={disabled}
        autoFocus={autoFocus}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || (e.key.length === 1 && !e.ctrlKey && !e.metaKey))) {
            setOpen(true);
            if (e.key.length === 1) setQ(e.key);
          }
        }}
        className={clsx(
          'flex h-8 w-full min-w-0 items-center gap-2 rounded-[4px] border bg-surface px-2.5 text-left text-body hover:border-faint focus:border-steel focus:ring-2 focus:ring-steel/15 focus:outline-none disabled:bg-surface-2',
          invalid ? 'border-seal' : 'border-line-strong',
          className,
        )}
      >
        <span className={clsx('min-w-0 flex-1 truncate', !value && 'text-faint')}>{value ? display : placeholder}</span>
        {value && allowClear && !disabled ? (
          <span role="button" tabIndex={-1} aria-label="선택 지우기" onClick={(e) => (e.stopPropagation(), pick(null))} className="grid size-5 place-items-center rounded-[3px] text-faint hover:bg-surface-2 hover:text-ink">
            <X className="size-3.5" />
          </span>
        ) : (
          <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />
        )}
      </button>
      {open && pos &&
        createPortal(
          <div id={listId} className="animate-pop fixed z-[70] overflow-hidden rounded-[6px] border border-line bg-surface shadow-pop" style={{ top: pos.top, left: pos.left, width: pos.width }}>
            <div className="flex items-center gap-2 border-b border-line px-2.5">
              <Search className="size-3.5 text-faint" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="검색" className="h-9 flex-1 bg-transparent outline-none placeholder:text-faint" aria-controls={`${listId}-ul`} />
              {loading && <Spinner className="size-3.5" />}
            </div>
            <ul id={`${listId}-ul`} role="listbox" className="scrollbar-thin max-h-[260px] overflow-y-auto py-1">
              {opts.map((o, i) => (
                <li key={o.id} role="option" aria-selected={o.id === value}>
                  <button type="button" onMouseEnter={() => setIdx(i)} onClick={() => pick(o)} className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left', i === idx && 'bg-steel-soft')}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.hint && <span className="block truncate text-meta text-muted">{o.hint}</span>}
                    </span>
                    {o.right && <span className="shrink-0 text-meta text-ink-2">{o.right}</span>}
                    {o.id === value && <Check className="size-4 shrink-0 text-steel" />}
                  </button>
                </li>
              ))}
              {!loading && !opts.length && <li className="px-3 py-5 text-center text-muted">{q ? '찾는 항목이 없습니다' : '검색어를 입력하세요'}</li>}
            </ul>
            {footer && <div className="border-t border-line">{footer}</div>}
          </div>,
          document.body,
        )}
    </>
  );
}
