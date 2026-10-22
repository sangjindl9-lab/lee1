'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Crosshair, Pencil, Trash2, UserPlus, X } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { ProjectForm } from '@/components/project-form';
import { Attachments, History } from '@/components/records';
import { Button, DL, Dialog, EmptyState, Input, PageHeader, Select, Skeleton, StatusBadge, Tabs, TradeTag, Won, useConfirm, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { daysUntil, pct, won } from '@/lib/format';
import { CONTRACT_ROLE, SECTOR } from '@/lib/labels';
import { STAGE_TITLE } from '@/lib/nav';
import { useSession } from '@/lib/session';
import type { ProjectDetail } from '@/lib/types';

type Tab = 'overview' | 'members' | 'files' | 'history';

function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <p className="text-meta text-muted">{label}</p>
      <p className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">{children}</p>
      {sub && <p className="mt-0.5 text-meta text-muted">{sub}</p>}
    </div>
  );
}

function elapsed(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const s = Date.parse(start), e = Date.parse(end), t = Date.parse(today);
  return e > s ? Math.min(1, Math.max(0, (t - s) / (e - s))) : null;
}

function MembersEditor({ project, onDone }: { project: ProjectDetail; onDone: () => void }) {
  const toast = useToast();
  const opts = useQuery({ queryKey: ['member-options'], queryFn: () => api<{ membershipId: string; name: string; department: string | null; position: string | null }[]>('/members/options') });
  const [rows, setRows] = useState(project.members.map((m) => ({ membershipId: m.membershipId, roleInProject: m.roleInProject ?? '' })));
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const name = (id: string) => opts.data?.find((o) => o.membershipId === id);
  async function save() {
    setBusy(true);
    try {
      await api(`/projects/${project.id}/assignments`, { method: 'PUT', json: { members: rows } });
      toast('ok', '현장 담당자를 저장했습니다');
      onDone();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <p className="mb-3 text-muted">배정된 사람은 '배정 현장만' 권한이어도 이 현장 자료를 볼 수 있습니다.</p>
      <div className="mb-3 flex gap-2">
        <Select value={pick} onChange={(e) => setPick(e.target.value)} className="flex-1" aria-label="추가할 사람">
          <option value="">추가할 사람 선택</option>
          {opts.data?.filter((o) => !rows.some((r) => r.membershipId === o.membershipId)).map((o) => (
            <option key={o.membershipId} value={o.membershipId}>{o.name}{o.department ? ` · ${o.department}` : ''}{o.position ? ` ${o.position}` : ''}</option>
          ))}
        </Select>
        <Button icon={<UserPlus className="size-3.5" />} disabled={!pick} onClick={() => (setRows((r) => [...r, { membershipId: pick, roleInProject: '' }]), setPick(''))}>추가</Button>
      </div>
      {rows.length ? (
        <ul className="divide-y divide-line rounded-[4px] border border-line">
          {rows.map((r, i) => (
            <li key={r.membershipId} className="flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{name(r.membershipId)?.name ?? project.members.find((m) => m.membershipId === r.membershipId)?.name}</span>
              <Input value={r.roleInProject} onChange={(e) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, roleInProject: e.target.value } : x)))} placeholder="역할 (예: 현장소장)" className="w-40" aria-label="현장 내 역할" />
              <button type="button" className="grid size-8 place-items-center rounded-[4px] text-muted hover:bg-surface-2" aria-label="빼기" onClick={() => setRows((xs) => xs.filter((_, j) => j !== i))}><X className="size-4" /></button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[4px] border border-dashed border-line-strong py-6 text-center text-muted">배정된 사람이 없습니다</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onDone}>취소</Button>
        <Button variant="primary" loading={busy} onClick={save}>저장</Button>
      </div>
    </div>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { can, project: ctxProject, setProject, company } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const { ask, node } = useConfirm();
  const q = useQuery({ queryKey: ['project', company.id, id], queryFn: () => api<ProjectDetail>(`/projects/${id}`), retry: false });
  const p = q.data;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['project', company.id, id] });
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['project-options'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['history', id] });
  };

  if (q.error) {
    return <EmptyState title="현장을 찾을 수 없습니다" description="삭제되었거나 볼 수 있는 권한이 없는 현장입니다." action={<Link href="/projects"><Button>현장 목록으로</Button></Link>} />;
  }
  if (!p) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (editing) {
    return (
      <>
        <PageHeader title={`${p.name} 수정`}>
          <button type="button" onClick={() => setEditing(false)} className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />현장 상세</button>
        </PageHeader>
        <ProjectForm
          initial={p}
          code={p.code}
          submitLabel="변경 저장"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            await api(`/projects/${p.id}`, { method: 'PUT', json: { ...body, version: p.version } });
            toast('ok', '변경 내용을 저장했습니다');
            refresh();
            setEditing(false);
          }}
        />
      </>
    );
  }

  async function remove() {
    if (!p) return;
    const ok = await ask({ title: '현장을 삭제할까요?', danger: true, confirm: '삭제', body: <><b>{p.code} {p.name}</b>을(를) 목록에서 삭제합니다. 삭제 기록은 감사로그에 남습니다. '예정' 상태 현장만 삭제할 수 있습니다.</> });
    if (!ok) return;
    try {
      await api(`/projects/${p.id}?version=${p.version}`, { method: 'DELETE' });
      if (ctxProject?.id === p.id) setProject(null);
      toast('ok', '현장을 삭제했습니다');
      refresh();
      router.replace('/projects');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '삭제하지 못했습니다');
    }
  }

  const dd = daysUntil(p.plannedEndDate);
  const el = elapsed(p.startDate, p.plannedEndDate);
  const prog = Number(p.progressRate);
  const behind = el !== null && p.status === 'IN_PROGRESS' && el - prog >= 0.1;
  const isCtx = ctxProject?.id === p.id;

  return (
    <>
      {node}
      <PageHeader
        title={p.name}
        actions={
          <>
            {!isCtx && <Button icon={<Crosshair className="size-3.5" />} onClick={() => (setProject(p.id), toast('info', '이 현장을 작업 현장으로 선택했습니다'))}>작업 현장으로 선택</Button>}
            {can('project:delete') && p.status === 'PLANNED' && <Button variant="danger" icon={<Trash2 className="size-3.5" />} onClick={remove}>삭제</Button>}
            {can('project:update') && <Button variant="primary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>수정</Button>}
          </>
        }
      >
        <Link href="/projects" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />현장 목록</Link>
        <div className="mb-1 flex flex-wrap items-center gap-2 text-meta">
          <TradeTag trade={p.tradeType} />
          <span className="num text-muted">{p.code}</span>
          <StatusBadge status={p.status} />
          <span className="text-muted">{CONTRACT_ROLE[p.contractRole]} · {SECTOR[p.clientSector]}</span>
          {isCtx && <span className="rounded-[3px] bg-steel-soft px-1.5 text-steel-ink">작업 현장</span>}
        </div>
      </PageHeader>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-line bg-line md:grid-cols-5">
        <Stat label="계약총액" sub={<span className="num">공급가 {won(p.supplyAmount)} · 부가세 {won(p.vatAmount)}</span>}><Won value={p.totalAmount} /></Stat>
        <Stat label="실행예산">{Number(p.executionBudget) ? <Won value={p.executionBudget} /> : <span className="text-faint">미입력</span>}</Stat>
        <Stat label="계획 이익" sub={Number(p.executionBudget) ? <span className="num">이익률 {pct(p.plannedMarginRate)}</span> : undefined}>{Number(p.executionBudget) ? <Won value={p.plannedMargin} /> : <span className="text-faint">–</span>}</Stat>
        <Stat label="공정률" sub={el !== null ? <span className={clsx(behind && 'font-medium text-seal')}>기간 경과 {pct(el, 0)}{behind ? ' · 일정 지연' : ''}</span> : undefined}>
          <span className="num">{pct(p.progressRate, 0)}</span>
          <div className="relative mt-1.5 h-1.5 rounded-full bg-surface-2">
            <div className={clsx('h-full rounded-full', behind ? 'bg-seal' : 'bg-steel')} style={{ width: `${prog * 100}%` }} />
            {el !== null && <span aria-hidden className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink-2" style={{ left: `calc(${el * 100}% - 1px)` }} />}
          </div>
        </Stat>
        <Stat label="준공예정" sub={p.actualEndDate ? `실제 준공 ${p.actualEndDate}` : undefined}>
          <span className="num">{p.plannedEndDate ?? '–'}</span>
          {dd !== null && !p.actualEndDate && <span className={clsx('num ml-1.5 text-meta font-medium', dd < 0 ? 'text-seal' : dd <= 30 ? 'text-warn' : 'text-muted')}>{dd < 0 ? `${-dd}일 경과` : `D-${dd}`}</span>}
        </Stat>
      </div>

      <nav aria-label="이 현장의 업무" className="mt-3 flex flex-wrap gap-1.5">
        {[
          { href: `/project-pl/${p.id}`, label: '현장 손익', perm: 'report:read' },
          { href: `/budgets/${p.id}`, label: '실행예산', perm: 'budget:read' },
          { href: `/contracts?projectId=${p.id}`, label: '변경계약', perm: 'contract:read' },
          { href: `/claims?projectId=${p.id}`, label: '기성·수금', perm: 'claim:read' },
          { href: `/subcontracts?projectId=${p.id}`, label: '하도급', perm: 'subcontract:read' },
          { href: `/labor?projectId=${p.id}`, label: '노무비', perm: 'labor:read' },
          { href: `/projects/${p.id}/settlement`, label: p.status === 'SETTLED' ? '준공정산 (완료)' : '준공정산', perm: 'report:read' },
        ].filter((x) => can(x.perm)).map((x) => (
          <Link key={x.href} href={x.href} className="rounded-[4px] border border-line bg-surface px-2.5 py-1 text-meta text-ink-2 hover:border-steel hover:text-ink">{x.label}</Link>
        ))}
      </nav>

      <div className="mt-5">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'overview', label: '개요' },
            { value: 'members', label: <>담당자 <span className="num text-faint">{p.members.length}</span></> },
            { value: 'files', label: <>첨부파일 <span className="num text-faint">{p.files.length}</span></> },
            ...(can('audit:read') ? [{ value: 'history' as Tab, label: '변경 이력' }] : []),
          ]}
        />
        <div className="mt-4">
          {tab === 'overview' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-[6px] border border-line bg-surface p-4">
                <DL
                  cols={3}
                  items={[
                    { label: '발주처', value: p.clientName },
                    { label: '원도급사', value: p.primeContractor },
                    { label: '하도급사', value: p.subContractor },
                    { label: '계약형태', value: p.contractType },
                    { label: '계약일', value: p.contractDate && <span className="num">{p.contractDate}</span> },
                    { label: '착공일', value: p.startDate && <span className="num">{p.startDate}</span> },
                    { label: '공동도급 지분율', value: p.jointSharePercent && `${p.jointSharePercent}%` },
                    { label: '적용 부가세율', value: `${(Number(p.vatRate) * 100).toFixed(0)}%` },
                    { label: '현장소장', value: p.siteManagerName },
                    { label: '현장담당자', value: p.managerName },
                    { label: '현장 주소', value: p.siteAddress, wide: true },
                    { label: '메모', value: p.memo && <span className="whitespace-pre-wrap">{p.memo}</span>, wide: true },
                  ]}
                />
              </div>
              <div className="rounded-[6px] border border-line bg-surface">
                <p className="border-b border-line px-4 py-2.5 font-medium">이 현장에 연결될 업무</p>
                <ul className="divide-y divide-line text-body">
                  {[
                    ['실행예산·현장 손익', 2], ['발주·검수·지급결의', 2], ['세금계산서 매입·매출', 3], ['기성청구·수금', 4], ['하도급·노무비', 4],
                  ].map(([l, s]) => (
                    <li key={l as string} className="flex items-center justify-between px-4 py-2">
                      <span className="text-ink-2">{l}</span>
                      <span className="text-meta text-faint" title={STAGE_TITLE[s as number]}>{s}단계</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {tab === 'members' && (
            <div className="max-w-2xl rounded-[6px] border border-line bg-surface p-4">
              {p.members.length ? (
                <ul className="divide-y divide-line">
                  {p.members.map((m) => (
                    <li key={m.membershipId} className="flex items-center gap-3 py-2">
                      <span className="grid size-7 place-items-center rounded-full bg-steel-soft text-meta font-semibold text-steel-ink">{m.name.slice(0, 1)}</span>
                      <span className="flex-1">{m.name} <span className="text-meta text-muted">{m.loginId}</span></span>
                      <span className="text-muted">{m.roleInProject}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-4 text-center text-muted">배정된 사람이 없습니다. '배정 현장만' 권한을 가진 현장소장·공무담당은 배정되어야 이 현장을 볼 수 있습니다.</p>
              )}
              {can('project:update') && <div className="mt-3 border-t border-line pt-3"><Button icon={<UserPlus className="size-3.5" />} onClick={() => setMembersOpen(true)}>담당자 지정</Button></div>}
            </div>
          )}
          {tab === 'files' && (
            <div className="max-w-3xl rounded-[6px] border border-line bg-surface p-4">
              <Attachments files={p.files} target={{ projectId: p.id }} canEdit={can('project:update')} categories={['contract', 'drawing', 'estimate', 'photo', 'etc']} onChange={refresh} />
            </div>
          )}
          {tab === 'history' && (
            <div className="max-w-3xl rounded-[6px] border border-line bg-surface p-4"><History resourceId={p.id} /></div>
          )}
        </div>
      </div>

      <Dialog open={membersOpen} onClose={() => setMembersOpen(false)} title="현장 담당자 지정" width={560}>
        <MembersEditor project={p} onDone={() => (setMembersOpen(false), refresh())} />
      </Dialog>
    </>
  );
}

