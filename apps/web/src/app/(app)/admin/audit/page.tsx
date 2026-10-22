'use client';

import clsx from 'clsx';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { Button, Dialog, EmptyState, Input, PageHeader, Seal, Select, useToast } from '@/components/ui';
import { api, ApiError, qs } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { AUDIT_ACTION, AUDIT_RESOURCE } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Row { id: number; createdAt: string; userName: string | null; action: string; resource: string; resourceId: string | null; summary: string | null; ip: string | null; before: unknown; after: unknown }

const TONE: Record<string, string> = { DELETE: 'text-seal', LOGIN_FAIL: 'text-seal', ACCOUNT_LOCKED: 'text-seal', MFA_FAIL: 'text-seal', VIEW_SENSITIVE: 'text-warn', PASSWORD_RESET: 'text-warn', SESSION_REVOKE: 'text-warn' };

export default function AuditPage() {
  const toast = useToast();
  const { can, company } = useSession();
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [f, setF] = useState({ from: '', to: today, resource: '', action: '', page: 1 });
  const q = useQuery({ queryKey: ['audit', company.id, f], queryFn: () => api<{ total: number; rows: Row[] }>(`/audit-logs${qs({ ...f, size: 50 })}`), placeholderData: keepPreviousData });
  const [detail, setDetail] = useState<Row | null>(null);
  const [verify, setVerify] = useState<{ ok: boolean; checked: number; brokenAt?: number } | null>(null);
  const [busy, setBusy] = useState(false);

  async function runVerify() {
    setBusy(true);
    try {
      setVerify(await api('/audit-logs/verify', { method: 'POST' }));
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '검사하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: 'at', header: '일시', meta: { width: 150 }, cell: ({ row }) => <span className="num text-ink-2">{dateTime(row.original.createdAt)}</span> },
      { id: 'user', header: '사용자', meta: { width: 110 }, cell: ({ row }) => row.original.userName ?? <span className="text-faint">–</span> },
      { id: 'action', header: '동작', meta: { width: 120 }, cell: ({ row }) => <span className={clsx('font-medium', TONE[row.original.action])}>{AUDIT_ACTION[row.original.action] ?? row.original.action}</span> },
      { id: 'resource', header: '대상', meta: { width: 96, hideBelow: 'md' }, cell: ({ row }) => <span className="text-muted">{AUDIT_RESOURCE[row.original.resource] ?? row.original.resource}</span> },
      { id: 'summary', header: '내용', cell: ({ row }) => <span className="line-clamp-1">{row.original.summary}</span> },
      { id: 'ip', header: '접속 IP', meta: { width: 120, hideBelow: 'lg' }, cell: ({ row }) => <span className="num text-meta text-muted">{row.original.ip?.replace('::ffff:', '')}</span> },
    ],
    [],
  );

  if (!can('audit:read')) return <EmptyState title="감사로그 조회 권한이 없습니다" />;
  return (
    <>
      <PageHeader
        title="감사로그"
        description="로그인, 등록·수정·삭제, 출력, 민감정보 조회가 모두 기록됩니다. 기록은 수정·삭제할 수 없고, 앞 기록과 해시로 이어져 있어 변조되면 검사에서 드러납니다."
        actions={<Button icon={<ShieldCheck className="size-4" />} loading={busy} onClick={runVerify}>무결성 검사</Button>}
      />
      <div className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, page: 1 })} className="w-[138px]" aria-label="시작일" />
          <span className="text-faint">~</span>
          <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value, page: 1 })} className="w-[138px]" aria-label="종료일" />
          <Select value={f.resource} onChange={(e) => setF({ ...f, resource: e.target.value, page: 1 })} className="w-[120px]" aria-label="대상">
            <option value="">대상 전체</option>
            {Object.entries(AUDIT_RESOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value, page: 1 })} className="w-[140px]" aria-label="동작">
            <option value="">동작 전체</option>
            {Object.entries(AUDIT_ACTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <DataTable
          dense
          columns={columns}
          data={q.data?.rows}
          loading={q.isLoading}
          getRowId={(r) => String(r.id)}
          onRowClick={setDetail}
          page={q.data ? { page: f.page, size: 50, total: q.data.total, onPage: (p) => setF({ ...f, page: p }) } : undefined}
          empty={<EmptyState title="기간 내 기록이 없습니다" />}
          mobileRow={(r) => (
            <div>
              <div className="flex justify-between gap-2"><span className={clsx('font-medium', TONE[r.action])}>{AUDIT_ACTION[r.action] ?? r.action}</span><span className="num text-meta text-muted">{dateTime(r.createdAt)}</span></div>
              <p className="mt-0.5 truncate text-meta text-ink-2">{r.userName} · {r.summary}</p>
            </div>
          )}
        />
      </div>

      <Dialog open={!!detail} onClose={() => setDetail(null)} title="기록 상세" width={640}>
        {detail && (
          <div className="space-y-3">
            <p><span className="font-medium">{detail.userName ?? '시스템'}</span> · {AUDIT_ACTION[detail.action] ?? detail.action} · <span className="num text-muted">{dateTime(detail.createdAt)}</span></p>
            <p className="text-ink-2">{detail.summary}</p>
            {(['before', 'after'] as const).map((k) =>
              detail[k] ? (
                <div key={k}>
                  <p className="mb-1 text-meta text-muted">{k === 'before' ? '변경 전' : '변경 후'}</p>
                  <pre className="scrollbar-thin max-h-56 overflow-auto rounded-[4px] bg-surface-2 p-3 text-meta leading-5">{JSON.stringify(detail[k], null, 2)}</pre>
                </div>
              ) : null,
            )}
            <p className="num text-meta text-faint">기록 번호 #{detail.id} · IP {detail.ip}</p>
          </div>
        )}
      </Dialog>

      <Dialog open={!!verify} onClose={() => setVerify(null)} title="감사로그 무결성 검사" footer={<Button variant="primary" onClick={() => setVerify(null)}>확인</Button>}>
        {verify && (verify.ok ? (
          <div className="flex items-center gap-5">
            <Seal name="검증" date={new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace(/\.$/, '')} size={72} animate label="무결성 확인 완료" />
            <div>
              <p className="font-medium">변조된 기록이 없습니다</p>
              <p className="num mt-1 text-muted">전체 {verify.checked.toLocaleString('ko-KR')}건의 해시 연결을 처음부터 다시 계산해 모두 일치했습니다.</p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <ShieldAlert className="size-8 shrink-0 text-seal" />
            <div>
              <p className="font-medium text-seal">기록 #{verify.brokenAt}에서 해시가 맞지 않습니다</p>
              <p className="mt-1 text-muted">데이터베이스가 직접 수정되었을 가능성이 있습니다. 시스템 관리자에게 즉시 알리고 백업과 대조하세요.</p>
            </div>
          </div>
        ))}
      </Dialog>
    </>
  );
}
