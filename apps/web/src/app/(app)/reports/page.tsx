'use client';

import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { FileDown, Printer } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ProjectPicker } from '@/components/pickers';
import { Button, EmptyState, Field, Input, PageHeader, Select, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, blobUrl, download, qs } from '@/lib/api';
import { won } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Def { key: string; title: string; group: string; perm: string; params: ('period' | 'date' | 'project')[]; description: string }
interface Built { title: string; subtitle?: string; columns: { header: string; money?: boolean; align?: string }[]; rows: (string | number | null)[][]; totals?: (string | number | null)[]; notes?: string[]; landscape?: boolean }

function Body() {
  const toast = useToast();
  const router = useRouter();
  const sp = useSearchParams();
  const { can, company } = useSession();
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [p, setP] = useState({ from: today.slice(0, 8) + '01', to: today, date: today, projectId: null as string | null });
  const [pdf, setPdf] = useState({ size: 'A4', orientation: 'auto' });
  const [busy, setBusy] = useState<string | null>(null);
  const cat = useQuery({ queryKey: ['report-catalog', company.id], queryFn: () => api<Def[]>('/reports') });
  const key = sp.get('r') ?? cat.data?.[0]?.key;
  const def = cat.data?.find((d) => d.key === key);
  const params = def ? { ...(def.params.includes('period') ? { from: p.from, to: p.to } : {}), ...(def.params.includes('date') ? { date: p.date } : {}), ...(def.params.includes('project') && p.projectId ? { projectId: p.projectId } : {}) } : {};
  const data = useQuery({ queryKey: ['report', company.id, key, params], queryFn: () => api<Built>(`/reports/${key}${qs(params)}`), enabled: !!def });
  async function out(fmt: 'pdf' | 'xlsx' | 'view') {
    setBusy(fmt);
    try {
      const q = qs({ ...params, format: fmt === 'view' ? 'pdf' : fmt, ...(fmt !== 'xlsx' ? pdf : {}) });
      if (fmt === 'view') {
        const { url } = await blobUrl(`/reports/${key}${q}`);
        window.open(url, '_blank', 'noopener');
      } else await download(`/reports/${key}${q}`, `${def!.title}.${fmt}`);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '출력하지 못했습니다');
    } finally {
      setBusy(null);
    }
  }
  if (!can('report:read')) return <EmptyState title="보고서를 볼 권한이 없습니다" />;
  const groups = [...new Set((cat.data ?? []).map((d) => d.group))];
  return (
    <>
      <PageHeader title="보고서" description="같은 자료를 화면에서 확인하고 PDF(A4·A3, 세로·가로) 또는 엑셀로 출력합니다. 내 권한으로 볼 수 있는 보고서만 표시됩니다." />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="보고서 목록" className="self-start rounded-[6px] border border-line bg-surface p-1.5">
          {!cat.data ? <Skeleton className="h-60" /> : groups.map((g) => (
            <div key={g} className="mb-1.5 last:mb-0">
              <p className="px-2 pt-1.5 pb-1 text-meta text-faint">{g}</p>
              {cat.data.filter((d) => d.group === g).map((d) => (
                <button key={d.key} type="button" onClick={() => router.replace(`/reports?r=${d.key}`)} aria-current={d.key === key ? 'page' : undefined}
                  className={clsx('block w-full rounded-[4px] px-2 py-1.5 text-left', d.key === key ? 'bg-steel-soft font-medium text-steel-ink' : 'hover:bg-surface-2')}>{d.title}</button>
              ))}
            </div>
          ))}
        </nav>
        {!def ? <Skeleton className="h-80" /> : (
          <section className="min-w-0 rounded-[6px] border border-line bg-surface">
            <header className="border-b border-line px-4 py-3">
              <h2 className="text-section font-semibold">{def.title}</h2>
              <p className="text-meta text-muted">{def.description}</p>
              <div className="mt-3 flex flex-wrap items-end gap-2">
                {def.params.includes('period') && <><Field label="시작일"><Input type="date" value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} className="w-[140px]" /></Field><Field label="종료일"><Input type="date" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} className="w-[140px]" /></Field></>}
                {def.params.includes('date') && <Field label="기준일"><Input type="date" value={p.date} onChange={(e) => setP({ ...p, date: e.target.value })} className="w-[140px]" /></Field>}
                {def.params.includes('project') && <Field label="현장" className="w-[220px]"><ProjectPicker value={p.projectId} onChange={(v) => setP({ ...p, projectId: v })} placeholder="전체 현장" includeSettled /></Field>}
                {can('report:export') && (
                  <div className="ml-auto flex flex-wrap items-end gap-2">
                    <Field label="용지"><Select value={pdf.size} onChange={(e) => setPdf({ ...pdf, size: e.target.value })} className="w-[76px]"><option>A4</option><option>A3</option></Select></Field>
                    <Field label="방향"><Select value={pdf.orientation} onChange={(e) => setPdf({ ...pdf, orientation: e.target.value })} className="w-[92px]"><option value="auto">자동</option><option value="portrait">세로</option><option value="landscape">가로</option></Select></Field>
                    <Button icon={<Printer className="size-4" />} loading={busy === 'view'} onClick={() => out('view')}>PDF 보기</Button>
                    <Button loading={busy === 'pdf'} onClick={() => out('pdf')}>PDF 저장</Button>
                    <Button icon={<FileDown className="size-4" />} loading={busy === 'xlsx'} onClick={() => out('xlsx')}>엑셀</Button>
                  </div>
                )}
              </div>
            </header>
            {data.isError ? <p className="p-4 text-seal">{data.error instanceof ApiError ? data.error.body.message : '보고서를 만들지 못했습니다'}</p> : !data.data ? <Skeleton className="m-4 h-60" /> : (
              <>
                {data.data.subtitle && <p className="px-4 pt-3 text-meta text-muted">{data.data.subtitle}</p>}
                {!data.data.rows.length ? <EmptyState title="자료가 없습니다" description="기간이나 현장 조건을 바꿔 보세요." /> : (
                  <div className="max-h-[calc(100dvh-320px)] overflow-auto p-4 pt-3">
                    <table className="w-full min-w-[720px] border-collapse text-meta">
                      <thead className="sticky top-0 z-[1]"><tr>{data.data.columns.map((c, i) => <th key={i} className="border border-line bg-surface-2 px-2 py-1.5 font-medium whitespace-nowrap text-ink-2">{c.header}</th>)}</tr></thead>
                      <tbody>
                        {data.data.rows.map((r, i) => (
                          <tr key={i} className="even:bg-surface-2/40">{r.map((v, j) => <td key={j} className={clsx('border border-line px-2 py-1', data.data!.columns[j].money ? 'num text-right whitespace-nowrap' : data.data!.columns[j].align === 'center' ? 'text-center whitespace-nowrap' : 'min-w-[9rem]')}>{data.data!.columns[j].money ? (v === null || v === '' ? '' : won(String(v))) : v}</td>)}</tr>
                        ))}
                      </tbody>
                      {data.data.totals && <tfoot><tr className="bg-surface-2 font-semibold">{data.data.totals.map((v, j) => <td key={j} className={clsx('border border-line px-2 py-1.5', data.data!.columns[j].money && 'num text-right')}>{data.data!.columns[j].money && v !== null && v !== '' ? won(String(v)) : v}</td>)}</tr></tfoot>}
                    </table>
                    {data.data.notes?.map((n) => <p key={n} className="mt-2 text-meta text-muted">· {n}</p>)}
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </>
  );
}

export default function Page() {
  return <Suspense fallback={<Skeleton className="h-80" />}><Body /></Suspense>;
}
