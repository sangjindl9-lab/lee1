'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { CloudDownload, Download, FileSpreadsheet, GitCompareArrows, Plus, Receipt, Search, TriangleAlert } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { SegTabs, SumStrip } from '@/components/doc-ui';
import { CollectDialog, ImportDialog } from '@/components/tax-bits';
import { Badge, Button, EmptyState, Input, PageHeader, Won, useToast } from '@/components/ui';
import { api, ApiError, download, qs } from '@/lib/api';
import { bizNo } from '@/lib/format';
import { NTS_STATUS, TI_SOURCE, TI_STATUS } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Row {
  id: string; code: string; direction: 'SALES' | 'PURCHASE'; status: string; approvalNo: string | null; writeDate: string; counterpartName: string | null; counterpartBizNo: string | null;
  vendorId: string | null; vendorName: string | null; projectName: string | null; supplyAmount: string; vatAmount: string; totalAmount: string; matchDiff: string | null; matchedSupply: string | null;
  source: string; ntsStatus: string | null; isTestIssue: boolean; docKind: string;
}
interface Resp { total: number; page: number; size: number; sums: { supplyAmount: string; vatAmount: string; totalAmount: string }; open: number; mismatch: number; rows: Row[] }

const TABS = {
  PURCHASE: [{ value: '', label: '전체' }, { value: 'COLLECTED', label: '미처리' }, { value: 'POSTED', label: '처리완료' }, { value: 'IGNORED', label: '제외' }],
  SALES: [{ value: '', label: '전체' }, { value: 'DRAFT', label: '작성중' }, { value: 'PENDING', label: '결재중' }, { value: 'READY', label: '발행대기' }, { value: 'ISSUED', label: '발행' }, { value: 'FAILED', label: '실패' }, { value: 'CANCELLED', label: '취소' }],
};

function Inner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const dir = (sp.get('direction') === 'SALES' ? 'SALES' : 'PURCHASE') as 'SALES' | 'PURCHASE';
  const f = { direction: dir, status: sp.get('status') ?? '', q: sp.get('q') ?? '', from: sp.get('from') ?? '', to: sp.get('to') ?? '', mismatch: sp.get('mismatch') ?? '', page: Number(sp.get('page') ?? 1) };
  const [q, setQ] = useState(f.q);
  const [dialog, setDialog] = useState<null | 'import' | 'collect'>(null);
  const set = (p: Partial<typeof f>) => {
    const n = { ...f, page: 1, ...p };
    router.replace(`/tax-invoices${qs({ ...n, direction: n.direction === 'PURCHASE' ? undefined : n.direction, page: n.page > 1 ? n.page : undefined })}`, { scroll: false });
  };
  useEffect(() => {
    const t = setTimeout(() => q !== f.q && set({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const params = { ...f, size: 50 };
  const list = useQuery({ queryKey: ['tax-invoices', company.id, params], queryFn: () => api<Resp>(`/tax-invoices${qs(params)}`), placeholderData: keepPreviousData });
  const d = list.data;
  const purchase = dir === 'PURCHASE';

  const columns = useMemo<ColumnDef<Row>[]>(() => [
    { id: 'date', header: '작성일', meta: { width: 96 }, cell: ({ row }) => <span className="num text-ink-2">{row.original.writeDate}</span> },
    {
      id: 'who', header: purchase ? '공급자' : '공급받는자',
      cell: ({ row: { original: r } }) => (
        <div className="min-w-[180px]">
          <Link href={`/tax-invoices/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">{r.counterpartName ?? '(상호 없음)'}</Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-meta text-muted">
            <span className="num">{bizNo(r.counterpartBizNo)}</span>
            {!r.vendorId && <Badge tone="warn">거래처 미등록</Badge>}
            {r.docKind === 'EXEMPT' && <Badge tone="muted">면세</Badge>}
            {r.projectName && <span className="truncate">· {r.projectName}</span>}
          </p>
        </div>
      ),
    },
    { id: 'approval', header: '승인번호', meta: { hideBelow: 'xl' }, cell: ({ row }) => <span className="num text-meta text-muted">{row.original.approvalNo ?? (row.original.isTestIssue ? '가상 발행' : '–')}</span> },
    { id: 'src', header: '출처', meta: { width: 92, hideBelow: 'lg' }, cell: ({ row }) => <span className="text-meta text-muted">{TI_SOURCE[row.original.source] ?? row.original.source}</span> },
    {
      id: 'status', header: '상태', meta: { width: 120 },
      cell: ({ row: { original: r } }) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={TI_STATUS[r.status].tone}>{r.isTestIssue && r.status === 'ISSUED' ? '가상 발행' : TI_STATUS[r.status].label}</Badge>
          {r.direction === 'SALES' && r.status === 'ISSUED' && !r.isTestIssue && r.ntsStatus && <Badge tone={NTS_STATUS[r.ntsStatus].tone}>{NTS_STATUS[r.ntsStatus].label.replace('국세청 ', '')}</Badge>}
        </div>
      ),
    },
    ...(purchase ? [{
      id: 'diff', header: '검수 대사', meta: { width: 110, align: 'right' as const, hideBelow: 'md' as const },
      cell: ({ row: { original: r } }: { row: { original: Row } }) => r.matchedSupply === null ? <span className="text-meta text-faint">미연결</span>
        : Number(r.matchDiff) === 0 ? <span className="text-meta text-ok">일치</span>
        : <span className="num inline-flex items-center gap-1 text-meta font-medium text-seal"><TriangleAlert className="size-3" />{Number(r.matchDiff) > 0 ? '+' : ''}<Won value={r.matchDiff} /></span>,
    }] : []),
    { id: 'supply', header: '공급가액', meta: { align: 'right', hideBelow: '2xl', footer: <Won value={d?.sums.supplyAmount} /> }, cell: ({ row }) => <Won value={row.original.supplyAmount} /> },
    { id: 'vat', header: '세액', meta: { align: 'right', hideBelow: 'lg', footer: <Won value={d?.sums.vatAmount} /> }, cell: ({ row }) => <Won value={row.original.vatAmount} /> },
    { id: 'total', header: '합계', meta: { align: 'right', footer: <Won value={d?.sums.totalAmount} /> }, cell: ({ row }) => <Won value={row.original.totalAmount} className="font-medium" /> },
  ], [d?.sums, purchase]);

  return (
    <>
      <PageHeader
        title="세금계산서"
        description={purchase ? '홈택스에서 받은 매입 계산서를 검수 내역과 맞춰 보고 장부에 반영합니다. 계산서를 받았다고 지급이 끝난 것은 아닙니다.' : '매출 계산서를 작성해 결재를 받은 뒤 연동사로 발행합니다. 테스트 모드 발행은 법적 효력이 없습니다.'}
        actions={<>
          {can('taxinvoice:export') && <Button icon={<Download className="size-3.5" />} onClick={() => download(`/tax-invoices/export.xlsx${qs(params)}`, '세금계산서.xlsx').catch((e: ApiError) => toast('error', e.body.message))}>엑셀</Button>}
          {purchase && <Link href="/tax-invoices/reconcile"><Button icon={<GitCompareArrows className="size-3.5" />}>발주·계산서 대사</Button></Link>}
          {can('taxinvoice:create') && <Button icon={<FileSpreadsheet className="size-3.5" />} onClick={() => setDialog('import')}>엑셀 올리기</Button>}
          {can('taxinvoice:create') && <Button icon={<CloudDownload className="size-3.5" />} onClick={() => setDialog('collect')}>홈택스 가져오기</Button>}
          {can('taxinvoice:create') && <Link href={`/tax-invoices/new?direction=${dir}`}><Button variant="primary" icon={<Plus className="size-4" />}>{purchase ? '종이 계산서 입력' : '매출 계산서 작성'}</Button></Link>}
        </>}
      >
        <div className="mt-3 flex gap-1" role="tablist" aria-label="매입·매출">
          {(['PURCHASE', 'SALES'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={dir === k} onClick={() => set({ direction: k, status: '', mismatch: '' })}
              className={clsx('h-9 border-b-2 px-3 font-medium', dir === k ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
              {k === 'PURCHASE' ? '매입' : '매출'}
            </button>
          ))}
        </div>
      </PageHeader>
      {d && (
        <SumStrip items={[
          { label: '조회 합계', value: d.sums.totalAmount, hint: `${d.total}건`, strong: true },
          { label: '공급가액', value: d.sums.supplyAmount, tone: 'muted' },
          { label: purchase ? '매입세액' : '매출세액', value: d.sums.vatAmount, tone: 'steel', hint: purchase ? '부가세 신고 때 공제 대상' : '부가세 신고 때 납부 대상' },
        ]} />
      )}
      {d && purchase && (d.open > 0 || d.mismatch > 0) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {d.open > 0 && <button onClick={() => set({ status: 'COLLECTED', mismatch: '' })} className="rounded-[4px] border border-warn/40 bg-warn-soft px-3 py-1.5 text-meta text-ink-2 hover:border-warn">처리할 계산서 <b className="num">{d.open}</b>건</button>}
          {d.mismatch > 0 && <button onClick={() => set({ mismatch: f.mismatch ? '' : '1' })} className={clsx('rounded-[4px] border px-3 py-1.5 text-meta', f.mismatch ? 'border-seal bg-seal text-white' : 'border-seal/40 bg-seal-soft text-seal hover:border-seal')}>검수 금액과 다른 계산서 <b className="num">{d.mismatch}</b>건</button>}
        </div>
      )}
      <div className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <SegTabs label="상태" value={f.status} onChange={(v) => set({ status: v })} items={TABS[dir]} />
          <div className="flex items-center gap-1">
            <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className="w-[138px]" aria-label="작성일 시작" />
            <span className="text-faint">~</span>
            <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} className="w-[138px]" aria-label="작성일 끝" />
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="상호·사업자번호·승인번호" className="pl-8" aria-label="검색" />
          </div>
        </div>
        <DataTable
          columns={columns}
          data={d?.rows}
          loading={list.isLoading}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/tax-invoices/${r.id}`)}
          footerLabel={d ? `합계 ${d.total}건` : undefined}
          rowClassName={(r) => (['CANCELLED', 'IGNORED'].includes(r.status) ? 'text-muted' : undefined)}
          page={d ? { page: f.page, size: 50, total: d.total, onPage: (p) => set({ page: p }) } : undefined}
          mobileRow={(r) => (
            <div>
              <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.counterpartName}</span><Badge tone={TI_STATUS[r.status].tone}>{r.isTestIssue && r.status === 'ISSUED' ? '가상 발행' : TI_STATUS[r.status].label}</Badge></div>
              <div className="mt-1 flex justify-between text-meta text-muted"><span className="num">{r.writeDate}</span><Won value={r.totalAmount} className="text-ink-2" /></div>
            </div>
          )}
          empty={<EmptyState icon={<Receipt className="size-8" strokeWidth={1.25} />} title={f.status || f.q || f.mismatch ? '조건에 맞는 세금계산서가 없습니다' : purchase ? '받은 세금계산서가 아직 없습니다' : '작성한 매출 세금계산서가 없습니다'}
            description={purchase ? '홈택스에서 가져오거나, 홈택스에서 내려받은 엑셀을 올리세요. 같은 계산서는 두 번 들어가지 않습니다.' : '기성이나 공사대금을 청구할 때 매출 세금계산서를 작성하세요.'}
            action={can('taxinvoice:create') && !f.status && !f.q ? (purchase ? <Button variant="primary" icon={<FileSpreadsheet className="size-4" />} onClick={() => setDialog('import')}>엑셀 올리기</Button> : <Link href="/tax-invoices/new?direction=SALES"><Button variant="primary" icon={<Plus className="size-4" />}>매출 계산서 작성</Button></Link>) : undefined} />}
        />
      </div>
      <ImportDialog open={dialog === 'import'} direction={dir} onClose={() => setDialog(null)} onDone={() => { setDialog(null); qc.invalidateQueries({ queryKey: ['tax-invoices'] }); }} />
      <CollectDialog open={dialog === 'collect'} direction={dir} onClose={() => setDialog(null)} onDone={() => qc.invalidateQueries({ queryKey: ['tax-invoices'] })} />
    </>
  );
}

export default function Page() {
  return <Suspense><Inner /></Suspense>;
}
