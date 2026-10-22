'use client';

import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { KeyboardEvent, ReactNode, useRef, useState } from 'react';
import { Skeleton } from './ui';

export interface ColMeta {
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  /** 서버 정렬 키 */
  sortKey?: string;
  /** 합계행에 표시할 내용 */
  footer?: ReactNode;
  /** 좁은 화면에서 숨김 */
  hideBelow?: 'md' | 'lg' | 'xl' | '2xl';
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, any>[];
  data: T[] | undefined;
  loading?: boolean;
  getRowId: (r: T) => string;
  onRowClick?: (r: T) => void;
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSort?: (s: { key: string; dir: 'asc' | 'desc' }) => void;
  empty?: ReactNode;
  footerLabel?: ReactNode;
  /** 좁은 화면 카드형 행 */
  mobileRow?: (r: T) => ReactNode;
  page?: { page: number; size: number; total: number; onPage: (p: number) => void };
  rowClassName?: (r: T) => string | undefined;
  dense?: boolean;
}

const HIDE = { md: 'max-md:hidden', lg: 'max-lg:hidden', xl: 'max-xl:hidden', '2xl': 'max-2xl:hidden' } as const;

/**
 * 업무용 데이터 표: 고정 헤더, 우측 정렬 숫자, 합계행, 방향키 이동(↑↓, Enter), 좁은 화면 카드 전환.
 */
export function DataTable<T>({ columns, data, loading, getRowId, onRowClick, sort, onSort, empty, footerLabel, mobileRow, page, rowClassName, dense }: DataTableProps<T>) {
  const table = useReactTable({ data: data ?? [], columns, getCoreRowModel: getCoreRowModel(), getRowId });
  const [active, setActive] = useState(-1);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const rows = table.getRowModel().rows;
  const hasFooter = columns.some((c) => (c.meta as ColMeta | undefined)?.footer !== undefined);

  function onKey(e: KeyboardEvent<HTMLTableSectionElement>) {
    if (!rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(0, Math.min(rows.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      setActive(n);
      (bodyRef.current?.children[n] as HTMLElement | undefined)?.focus();
    } else if (e.key === 'Enter' && active >= 0 && onRowClick) {
      onRowClick(rows[active].original);
    }
  }

  const cellPad = dense ? 'px-2.5 py-1.5' : 'px-3 py-2';

  return (
    <div className="min-w-0">
      {mobileRow && (
        <ul className="divide-y divide-line md:hidden">
          {loading && !data
            ? Array.from({ length: 5 }).map((_, i) => <li key={i} className="p-3"><Skeleton className="h-10" /></li>)
            : rows.map((r) => (
                <li key={r.id}>
                  <button type="button" className="block w-full px-3 py-3 text-left active:bg-surface-hover" onClick={() => onRowClick?.(r.original)}>
                    {mobileRow(r.original)}
                  </button>
                </li>
              ))}
        </ul>
      )}
      <div className={clsx('scrollbar-thin overflow-x-auto', mobileRow && 'max-md:hidden')}>
        <table className="w-full border-collapse text-body">
          <thead className="sticky top-0 z-[1]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-surface-2">
                {hg.headers.map((h) => {
                  const meta = (h.column.columnDef.meta ?? {}) as ColMeta;
                  const sortable = !!(meta.sortKey && onSort);
                  const isSorted = sort && meta.sortKey === sort.key;
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={isSorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      style={{ width: meta.width }}
                      className={clsx('h-9 border-b border-line text-meta font-medium whitespace-nowrap text-muted', cellPad, meta.align === 'right' ? 'text-right' : meta.align === 'center' ? 'text-center' : 'text-left', meta.hideBelow && HIDE[meta.hideBelow])}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          className={clsx('inline-flex items-center gap-1 hover:text-ink', meta.align === 'right' && 'flex-row-reverse', isSorted && 'text-ink')}
                          onClick={() => onSort!({ key: meta.sortKey!, dir: isSorted && sort!.dir === 'asc' ? 'desc' : 'asc' })}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {isSorted ? (sort!.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody ref={bodyRef} onKeyDown={onKey}>
            {loading && !data
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-line">
                    {columns.map((_, j) => (
                      <td key={j} className={cellPad}><Skeleton className="h-4" /></td>
                    ))}
                  </tr>
                ))
              : rows.map((r, i) => (
                  <tr
                    key={r.id}
                    tabIndex={onRowClick ? 0 : -1}
                    onFocus={() => setActive(i)}
                    onClick={() => onRowClick?.(r.original)}
                    className={clsx('border-b border-line outline-none', onRowClick && 'cursor-pointer hover:bg-surface-hover focus-visible:bg-steel-soft', rowClassName?.(r.original))}
                  >
                    {r.getVisibleCells().map((c) => {
                      const meta = (c.column.columnDef.meta ?? {}) as ColMeta;
                      return (
                        <td key={c.id} className={clsx(cellPad, 'align-middle', meta.align === 'right' ? 'num text-right whitespace-nowrap' : meta.align === 'center' ? 'text-center' : '', meta.hideBelow && HIDE[meta.hideBelow])}>
                          {flexRender(c.column.columnDef.cell, c.getContext())}
                        </td>
                      );
                    })}
                  </tr>
                ))}
          </tbody>
          {hasFooter && !!rows.length && (
            <tfoot>
              <tr className="bg-surface-2 font-semibold">
                {table.getAllLeafColumns().map((col, i) => {
                  const meta = (col.columnDef.meta ?? {}) as ColMeta;
                  return (
                    <td key={col.id} className={clsx(cellPad, 'border-t-2 border-double border-line-strong', meta.align === 'right' && 'num text-right whitespace-nowrap', meta.hideBelow && HIDE[meta.hideBelow])}>
                      {i === 0 && meta.footer === undefined ? <span className="whitespace-nowrap">{footerLabel}</span> : meta.footer}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!loading && data && !data.length && empty}
      {page && page.total > page.size && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 text-meta text-muted">
          <span className="num">
            {(page.page - 1) * page.size + 1}–{Math.min(page.total, page.page * page.size)} / 총 {page.total.toLocaleString('ko-KR')}건
          </span>
          <div className="flex items-center gap-1">
            <button className="grid size-7 place-items-center rounded-[4px] hover:bg-surface-2 disabled:opacity-40" disabled={page.page <= 1} onClick={() => page.onPage(page.page - 1)} aria-label="이전 페이지">
              <ChevronLeft className="size-4" />
            </button>
            <span className="num px-1">{page.page} / {Math.ceil(page.total / page.size)}</span>
            <button className="grid size-7 place-items-center rounded-[4px] hover:bg-surface-2 disabled:opacity-40" disabled={page.page * page.size >= page.total} onClick={() => page.onPage(page.page + 1)} aria-label="다음 페이지">
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
