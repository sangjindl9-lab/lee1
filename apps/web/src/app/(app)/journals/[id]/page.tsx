'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, ChevronLeft, ExternalLink, Pencil, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { ReasonDialog, useRun } from '@/components/doc-ui';
import { Badge, Button, DL, EmptyState, Field, Input, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime, won } from '@/lib/format';
import { JOURNAL_STATUS } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Detail {
  id: string; code: string; entryDate: string; description: string; status: string; sourceType: string; sourceLabel: string; sourceCode: string | null; sourceHref: string | null;
  totalDebit: string; totalCredit: string; createdByName: string | null; createdAt: string; approvedByName: string | null; approvedAt: string | null; voidReason: string | null; version: number;
  reversalOf: { id: string; code: string } | null; reversedBy: { id: string; code: string; entryDate: string } | null;
  lines: { id: string; lineNo: number; accountCode: string; accountName: string; debit: string; credit: string; projectName: string | null; projectCode: string | null; vendorName: string | null; costCodeName: string | null; memo: string | null }[];
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const q = useQuery({ queryKey: ['journal', company.id, id], queryFn: () => api<Detail>(`/journal-entries/${id}`), retry: false });
  const { run, acting } = useRun(['journals', 'journal']);
  const [dialog, setDialog] = useState<null | 'void' | 'reverse'>(null);
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [revDate, setRevDate] = useState(today);
  const e = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['journal', company.id, id] });
  if (q.error) return <EmptyState title="전표를 찾을 수 없습니다" action={<Link href="/journals"><Button>전표 목록</Button></Link>} />;
  if (!e) return <Skeleton className="h-96" />;
  const manual = e.sourceType === 'MANUAL';

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/journals" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />전표 목록</Link>
          <div className="mb-1 flex flex-wrap items-center gap-2 text-meta"><span className="num text-muted">{e.code}</span><Badge tone={JOURNAL_STATUS[e.status].tone}>{JOURNAL_STATUS[e.status].label}</Badge><Badge tone={manual ? 'outline' : 'steel'}>{e.sourceLabel}{e.sourceCode ? ` ${e.sourceCode}` : ''}</Badge></div>
          <h1 className="text-title font-semibold">{e.description}</h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {e.sourceHref && <Link href={e.sourceHref}><Button icon={<ExternalLink className="size-3.5" />}>원천 문서</Button></Link>}
          {e.status === 'DRAFT' && manual && can('journal:update') && <><Button variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setDialog('void')}>무효 처리</Button><Link href={`/journals/${e.id}/edit`}><Button icon={<Pencil className="size-3.5" />}>수정</Button></Link></>}
          {e.status === 'DRAFT' && can('journal:approve') && <Button variant="primary" icon={<Check className="size-4" />} loading={acting === 'approve'} onClick={() => run('approve', () => api('/journal-entries/approve', { method: 'POST', json: { ids: [e.id] } }), '승인했습니다').then(refresh)}>승인</Button>}
          {e.status === 'APPROVED' && manual && !e.reversalOf && can('journal:approve') && <Button icon={<RotateCcw className="size-3.5" />} onClick={() => setDialog('reverse')}>역분개</Button>}
        </div>
      </div>

      {e.status === 'APPROVED' && !manual && <p className="mb-3 rounded-[4px] bg-surface-2 px-3 py-2 text-meta text-muted">자동분개 전표입니다. 잘못되었다면 원천 문서({e.sourceLabel} {e.sourceCode})를 취소하세요. 취소하면 자동으로 역분개됩니다.</p>}
      {e.status === 'DRAFT' && !manual && <p className="mb-3 rounded-[4px] bg-warn-soft px-3 py-2 text-meta text-warn">업무 처리로 자동으로 만들어진 전표입니다. 계정과 금액을 확인하고 승인하면 장부에 반영됩니다.</p>}
      {e.reversedBy && <p className="mb-3 rounded-[4px] bg-surface-2 px-3 py-2 text-meta text-muted">이 전표는 <Link className="num text-steel-ink underline" href={`/journals/${e.reversedBy.id}`}>{e.reversedBy.code}</Link> ({e.reversedBy.entryDate})로 역분개되었습니다.</p>}
      {e.reversalOf && <p className="mb-3 rounded-[4px] bg-surface-2 px-3 py-2 text-meta text-muted"><Link className="num text-steel-ink underline" href={`/journals/${e.reversalOf.id}`}>{e.reversalOf.code}</Link>을(를) 취소하는 역분개 전표입니다.</p>}
      {e.voidReason && <p className="mb-3 rounded-[4px] bg-surface-2 px-3 py-2 text-meta text-muted">무효 사유: {e.voidReason}</p>}

      <section className="mb-4 rounded-[6px] border border-line bg-surface p-4">
        <DL cols={4} items={[
          { label: '전표일자', value: <span className="num">{e.entryDate}</span> },
          { label: '금액', value: <span className="num font-semibold">{won(e.totalDebit)}원</span> },
          { label: '작성', value: <span className="num">{e.createdByName} · {dateTime(e.createdAt)}</span> },
          { label: '승인', value: e.approvedByName ? <span className="num">{e.approvedByName} · {dateTime(e.approvedAt)}</span> : null },
        ]} />
      </section>

      <section className="overflow-x-auto rounded-[6px] border border-line bg-surface">
        <table className="w-full min-w-[760px] text-body">
          <thead><tr className="bg-surface-2 text-meta text-muted"><th className="w-8 px-3 py-2 font-medium">#</th><th className="px-3 py-2 text-left font-medium">계정과목</th><th className="px-3 py-2 text-right font-medium">차변</th><th className="px-3 py-2 text-right font-medium">대변</th><th className="px-3 py-2 text-left font-medium">현장 · 원가항목</th><th className="px-3 py-2 text-left font-medium">거래처</th><th className="px-3 py-2 text-left font-medium">적요</th></tr></thead>
          <tbody>
            {e.lines.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="num px-3 py-2 text-center text-faint">{l.lineNo}</td>
                <td className="px-3"><span className="num text-muted">{l.accountCode}</span> {l.accountName}</td>
                <td className="num px-3 text-right">{Number(l.debit) ? won(l.debit) : ''}</td>
                <td className="num px-3 text-right">{Number(l.credit) ? won(l.credit) : ''}</td>
                <td className="px-3 text-ink-2">{l.projectName ?? ''}{l.costCodeName && <span className="text-meta text-muted"> · {l.costCodeName}</span>}</td>
                <td className="px-3 text-ink-2">{l.vendorName ?? ''}</td>
                <td className="px-3 text-meta text-muted">{l.memo}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t-2 border-double border-line-strong bg-surface-2 font-semibold"><td colSpan={2} className="px-3 py-2">합계</td><td className="num px-3 text-right">{won(e.totalDebit)}</td><td className="num px-3 text-right">{won(e.totalCredit)}</td><td colSpan={3} className="px-3 text-meta font-normal text-ok">차변 = 대변</td></tr></tfoot>
        </table>
      </section>

      <ReasonDialog open={dialog === 'void'} title="전표를 무효 처리할까요?" danger confirm="무효 처리" body="미승인 전표를 무효로 표시합니다. 기록은 남지만 장부에는 들어가지 않습니다." onClose={() => setDialog(null)}
        onConfirm={async (reason) => { if (await run('void', () => api(`/journal-entries/${e.id}/void`, { method: 'POST', json: { reason } }), '무효 처리했습니다')) { setDialog(null); refresh(); } }} />
      <ReasonDialog open={dialog === 'reverse'} title="역분개" confirm="역분개 전표 만들기" body="이 전표와 차변·대변이 반대인 전표를 만들어 효과를 없앱니다. 원래 전표는 지우지 않고 '역분개됨'으로 남습니다." onClose={() => setDialog(null)}
        extra={<Field label="역분개 일자" hint="원 전표 기간이 마감되었으면 열린 기간의 날짜를 쓰세요"><Input type="date" value={revDate} onChange={(x) => setRevDate(x.target.value)} /></Field>}
        onConfirm={async (reason) => { if (await run('reverse', () => api(`/journal-entries/${e.id}/reverse`, { method: 'POST', json: { reason, date: revDate } }), '역분개했습니다')) { setDialog(null); refresh(); } }} />
    </>
  );
}
