'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronLeft, FileText, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { ReasonDialog, useRun } from '@/components/doc-ui';
import { RequestForm, type RequestInitial } from '@/components/request-form';
import { Badge, Button, DL, Drawer, EmptyState, Skeleton, TradeTag } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { PR_STATUS, type TradeType } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Detail extends RequestInitial { code: string; status: string; projectCode: string; projectName: string; tradeType: TradeType; requesterName: string; createdAt: string; createdById: string; poId: string | null; poCode: string | null; rejectReason: string | null; lines: (RequestInitial['lines'][number] & { id: string; lineNo: number })[] }

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can, company, me } = useSession();
  const q = useQuery({ queryKey: ['purchase-request', company.id, id], queryFn: () => api<Detail>(`/purchase-requests/${id}`), retry: false });
  const { run } = useRun(['purchase-requests']);
  const [dlg, setDlg] = useState<null | 'reject' | 'cancel' | 'edit'>(null);
  const r = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['purchase-request', company.id, id] });
  if (q.error) return <EmptyState title="구매요청을 찾을 수 없습니다" />;
  if (!r) return <Skeleton className="h-80" />;
  const open = r.status === 'REQUESTED';
  const mine = r.createdById === me.user.id;
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/purchase-requests" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />구매요청</Link>
          <p className="mb-1 flex items-center gap-2 text-meta"><span className="num text-muted">{r.code}</span><Badge tone={PR_STATUS[r.status].tone}>{PR_STATUS[r.status].label}</Badge><TradeTag trade={r.tradeType} short /><span className="text-muted">{r.projectName}</span></p>
          <h1 className="text-title font-semibold">{r.title}</h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {open && mine && <Button icon={<X className="size-3.5" />} onClick={() => setDlg('cancel')}>요청 취소</Button>}
          {open && (mine || can('purchase:update')) && <Button icon={<Pencil className="size-3.5" />} onClick={() => setDlg('edit')}>수정</Button>}
          {open && can('purchase:update') && !mine && <Button variant="danger" icon={<Ban className="size-3.5" />} onClick={() => setDlg('reject')}>반려</Button>}
          {open && can('purchase:create') && <Button variant="primary" icon={<FileText className="size-4" />} onClick={() => router.push(`/purchase-orders/new?request=${r.id}`)}>발주서로 만들기</Button>}
          {r.poId && <Link href={`/purchase-orders/${r.poId}`}><Button icon={<FileText className="size-3.5" />}>발주서 {r.poCode}</Button></Link>}
        </div>
      </div>
      {r.rejectReason && r.status !== 'REQUESTED' && <p className="mb-4 rounded-[4px] bg-seal-soft px-3 py-2 text-seal">{PR_STATUS[r.status].label} 사유: {r.rejectReason}</p>}
      <section className="mb-4 rounded-[6px] border border-line bg-surface p-4"><DL cols={4} items={[{ label: '요청자', value: r.requesterName }, { label: '요청일시', value: <span className="num">{dateTime(r.createdAt)}</span> }, { label: '필요한 날', value: <span className="num">{r.neededBy}</span> }, { label: '메모', value: r.memo }]} /></section>
      <section className="overflow-x-auto rounded-[6px] border border-line bg-surface">
        <table className="w-full min-w-[560px] text-body">
          <thead><tr className="bg-surface-2 text-meta text-muted"><th className="w-10 px-3 py-2 font-medium">No</th><th className="px-3 py-2 text-left font-medium">품명</th><th className="px-3 py-2 text-left font-medium">규격</th><th className="px-3 py-2 text-center font-medium">단위</th><th className="px-3 py-2 text-right font-medium">수량</th><th className="px-3 py-2 text-left font-medium">비고</th></tr></thead>
          <tbody>{r.lines.map((l) => <tr key={l.id} className="border-t border-line"><td className="num px-3 py-2 text-center text-faint">{l.lineNo}</td><td className="px-3 font-medium">{l.name}</td><td className="px-3 text-ink-2">{l.spec}</td><td className="px-3 text-center">{l.unit}</td><td className="num px-3 text-right">{l.qty.replace(/\.?0+$/, '')}</td><td className="px-3 text-meta text-muted">{l.memo}</td></tr>)}</tbody>
        </table>
      </section>
      <Drawer open={dlg === 'edit'} onClose={() => setDlg(null)} title="구매요청 수정" width={720}><RequestForm initial={r} onCancel={() => setDlg(null)} onSaved={() => { setDlg(null); refresh(); }} /></Drawer>
      <ReasonDialog open={dlg === 'reject'} title="구매요청 반려" danger confirm="반려" body="요청자에게 반려 사유가 보입니다." onClose={() => setDlg(null)} onConfirm={async (reason) => { if (await run('rej', () => api(`/purchase-requests/${r.id}/reject`, { method: 'POST', json: { version: r.version, reason } }), '반려했습니다')) { setDlg(null); refresh(); } }} />
      <ReasonDialog open={dlg === 'cancel'} title="요청 취소" confirm="요청 취소" body="이 구매요청을 취소합니다." onClose={() => setDlg(null)} onConfirm={async (reason) => { if (await run('can', () => api(`/purchase-requests/${r.id}/cancel`, { method: 'POST', json: { version: r.version, reason } }), '취소했습니다')) { setDlg(null); refresh(); } }} />
    </>
  );
}
