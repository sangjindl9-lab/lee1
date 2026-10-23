'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, Download } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, EmptyState, PageHeader, Skeleton, useToast } from '@/components/ui';
import { api, ApiError, download } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Row {
  id: string;
  kind: 'MANUAL' | 'AUTO';
  status: 'RUNNING' | 'DONE' | 'FAILED';
  dbFile: string | null;
  filesFile: string | null;
  dbSize: number | null;
  filesSize: number | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  createdByName: string | null;
}
interface List { keep: number; autoHour: number; auto: boolean; freeBytes: number | null; rows: Row[]; running: boolean }

const STATUS = { RUNNING: ['진행 중', 'warn'], DONE: ['완료', 'ok'], FAILED: ['실패·삭제됨', 'seal'] } as const;
const mb = (n: number | null) => (n == null ? '—' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

export default function BackupsPage() {
  const { me } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['backups'], queryFn: () => api<List>('/backups'), enabled: !!me?.user.isSystemAdmin, refetchInterval: (query) => (query.state.data?.running ? 3000 : false) });

  if (!me?.user.isSystemAdmin) return <EmptyState title="백업은 시스템관리자만 다룰 수 있습니다" description="모든 회사의 자료가 들어 있어 시스템관리자 계정으로만 볼 수 있습니다." />;

  async function run() {
    setBusy(true);
    try {
      await api('/backups', { method: 'POST', json: {} });
      toast('ok', '백업을 시작했습니다. 잠시 뒤 목록에 나타납니다');
      qc.invalidateQueries({ queryKey: ['backups'] });
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '백업을 시작하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  async function get(r: Row, which: 'db' | 'files') {
    try {
      await download(`/backups/${r.id}/${which}`, (which === 'db' ? r.dbFile : r.filesFile) ?? 'backup');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '내려받지 못했습니다');
    }
  }

  const d = q.data;
  return (
    <>
      <PageHeader
        title="백업"
        description="데이터베이스와 첨부파일을 통째로 보관합니다. 백업 파일에는 이 서버의 모든 회사 자료가 들어 있으니 안전한 곳에 보관하세요."
        actions={<Button variant="primary" icon={<DatabaseBackup className="size-4" />} loading={busy || !!d?.running} onClick={run}>지금 백업</Button>}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[6px] border border-line bg-surface px-4 py-3">
          <p className="text-meta text-muted">자동 백업</p>
          <p className="mt-1 font-medium">{!d ? '…' : d.auto ? `매일 ${d.autoHour}시` : '꺼짐 (서버 백업 사용)'}</p>
        </div>
        <div className="rounded-[6px] border border-line bg-surface px-4 py-3">
          <p className="text-meta text-muted">보관 개수</p>
          <p className="mt-1 font-medium">{d ? `최근 ${d.keep}개 (오래된 것부터 자동 삭제)` : '…'}</p>
        </div>
        <div className="rounded-[6px] border border-line bg-surface px-4 py-3">
          <p className="text-meta text-muted">남은 저장공간</p>
          <p className="num mt-1 font-medium">{d?.freeBytes != null ? `${(d.freeBytes / 1024 / 1024 / 1024).toFixed(1)}GB` : '—'}</p>
        </div>
      </div>
      {!d ? <Skeleton className="h-40" /> : !d.rows.length ? (
        <EmptyState icon={<DatabaseBackup className="size-6" />} title="아직 백업이 없습니다" description="'지금 백업'을 눌러 첫 백업을 만드세요." />
      ) : (
        <div className="overflow-x-auto rounded-[6px] border border-line bg-surface">
          <table className="w-full min-w-[760px]">
            <thead className="bg-surface-2 text-meta text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">시작</th>
                <th className="px-3 py-2 text-left font-medium">구분</th>
                <th className="px-3 py-2 text-left font-medium">상태</th>
                <th className="px-3 py-2 text-right font-medium">데이터베이스</th>
                <th className="px-3 py-2 text-right font-medium">첨부파일</th>
                <th className="px-3 py-2 text-left font-medium">실행</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td className="num px-3 py-2">{dateTime(r.startedAt)}</td>
                  <td className="px-3 py-2">{r.kind === 'AUTO' ? '자동' : '수동'}</td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>
                    {r.errorMessage && <p className="mt-1 max-w-[280px] text-meta text-muted">{r.errorMessage}</p>}
                  </td>
                  <td className="num px-3 py-2 text-right">{mb(r.dbSize)}</td>
                  <td className="num px-3 py-2 text-right">{mb(r.filesSize)}</td>
                  <td className="px-3 py-2 text-meta">{r.createdByName ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {r.status === 'DONE' && (
                      <span className="inline-flex gap-1">
                        <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => get(r, 'db')}>DB</Button>
                        <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => get(r, 'files')}>첨부</Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-meta text-muted">복구는 서버에서 진행합니다 (관리자 매뉴얼 '백업과 복구'). 내려받기는 감사로그에 기록됩니다.</p>
    </>
  );
}
