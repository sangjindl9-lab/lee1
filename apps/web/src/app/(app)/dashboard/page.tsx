'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarClock, RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ReactNode } from 'react';
import { Button, EmptyState, PageHeader, Panel, Skeleton, StatusBadge, TradeTag, Won } from '@/components/ui';
import { api } from '@/lib/api';
import { daysUntil, pct, relative, won, wonShort } from '@/lib/format';
import { TRADE, type ProjectStatus, type TradeType } from '@/lib/labels';
import { STAGE_TITLE } from '@/lib/nav';
import { useSession } from '@/lib/session';

interface Summary {
  asOf: string;
  scope: string;
  contract: {
    active: { count: number; supply: string; vat: string; total: string; budget: string; plannedMargin: string; plannedMarginRate: string | null };
    all: { count: number; supply: string; vat: string; total: string };
  };
  byStatus: { status: ProjectStatus; count: number; total: string }[];
  byTrade: { tradeType: TradeType; count: number; supply: string; budget: string }[];
  monthlyContracts: { ym: string; count: number; supply: string }[];
  activeProjects: { id: string; code: string; name: string; tradeType: TradeType; status: ProjectStatus; supplyAmount: string; progressRate: string; plannedEndDate: string | null; plannedMarginRate: string | null; elapsedRate: string | null }[];
  dueSoon: { id: string; code: string; name: string; tradeType: TradeType; plannedEndDate: string; progressRate: string }[];
  overdue: { id: string; code: string; name: string; tradeType: TradeType; plannedEndDate: string; progressRate: string }[];
  recent: { id: string; code: string; name: string; tradeType: TradeType; status: ProjectStatus; totalAmount: string; createdAt: string }[];
  vendorCount: number;
  purchase: { pending: number; draft: number; confirmed: string; confirmedSupply: string; open: number; receivedSupply: string } | null;
  approvals: { todo: number; minePending: number };
  pendingMetrics: Record<string, { available: false; stage: number }>;
}

/** 지표 한 칸 — 하나의 장부 띠 안에서 구분선으로 나뉜다 */
function Cell({ label, children, sub, href, className }: { label: string; children: ReactNode; sub?: ReactNode; href?: string; className?: string }) {
  const body = (
    <>
      <p className="text-meta text-muted">{label}</p>
      <p className="mt-1 text-figure font-semibold tracking-[-0.02em]">{children}</p>
      {sub && <div className="mt-1 text-meta text-muted">{sub}</div>}
    </>
  );
  const cls = clsx('block min-w-0 px-4 py-3.5', className);
  return href ? <Link href={href} className={clsx(cls, 'transition-colors hover:bg-surface-hover')}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** 아직 연결되지 않은 지표 — 0원으로 보이지 않도록 '연결 전'으로 표시 */
function PendingCell({ label, stage }: { label: string; stage: number }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-meta text-muted">{label}</p>
      <p className="mt-1 text-body text-faint">연결 전</p>
      <p className="mt-0.5 truncate text-[11px] text-faint">{STAGE_TITLE[stage]?.split(' · ')[1]} 기능 후 집계</p>
    </div>
  );
}

function MiniCell({ label, children, sub, href, tone }: { label: string; children: ReactNode; sub?: string; href: string; tone?: 'seal' }) {
  return (
    <Link href={href} className="block min-w-0 px-4 py-3 transition-colors hover:bg-surface-hover">
      <p className="text-meta text-muted">{label}</p>
      <p className={clsx('mt-1 text-[17px] font-semibold', tone === 'seal' && 'text-seal')}>{children}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-muted">{sub}</p>}
    </Link>
  );
}

/** 공정률 막대 + 경과율 눈금. 눈금이 막대보다 앞서면 일정보다 늦은 것 */
function ProgressVsTime({ progress, elapsed }: { progress: string; elapsed: string | null }) {
  const p = Math.round(Number(progress) * 100);
  const e = elapsed === null ? null : Math.round(Number(elapsed) * 100);
  const behind = e !== null && e - p >= 10;
  return (
    <div className="flex items-center gap-2" title={e !== null ? `공정률 ${p}% · 기간 경과 ${e}%` : `공정률 ${p}%`}>
      <div className="relative h-1.5 w-full min-w-16 rounded-full bg-surface-2">
        <div className={clsx('h-full rounded-full', behind ? 'bg-seal' : 'bg-steel')} style={{ width: `${p}%` }} />
        {e !== null && <span aria-hidden className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-ink-2" style={{ left: `calc(${e}% - 1px)` }} />}
      </div>
      <span className={clsx('num w-9 shrink-0 text-right text-meta', behind ? 'font-medium text-seal' : 'text-ink-2')}>{p}%</span>
    </div>
  );
}

function MonthlyChart({ data }: { data: Summary['monthlyContracts'] }) {
  const rows = data.map((d) => ({ ...d, label: `${Number(d.ym.slice(5))}월`, value: Number(d.supply) }));
  const hasAny = rows.some((r) => r.value > 0);
  if (!hasAny) return <EmptyState title="최근 12개월 계약 체결 내역이 없습니다" description="현장에 계약일과 계약금액을 입력하면 월별로 집계됩니다." />;
  return (
    <div className="h-[220px]" role="img" aria-label="최근 12개월 월별 계약 체결 공급가액 막대그래프">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--line-strong)' }} tick={{ fill: 'var(--muted)', fontSize: 11 }} interval="equidistantPreserveStart" minTickGap={4} />
          <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: 'var(--muted)', fontSize: 11 }} tickFormatter={(v) => wonShort(String(v))} />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-[4px] border border-line bg-surface px-3 py-2 text-meta shadow-pop">
                  <p className="font-medium text-ink">{(payload[0].payload as any).ym.replace('-', '년 ')}월</p>
                  <p className="num mt-0.5 text-ink-2">공급가액 {won((payload[0].payload as any).supply)}원</p>
                  <p className="text-muted">계약 {(payload[0].payload as any).count}건</p>
                </div>
              ) : null
            }
          />
          <Bar dataKey="value" fill="var(--steel)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TradeBreakdown({ rows }: { rows: Summary['byTrade'] }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.supply)));
  const order: TradeType[] = ['ELECTRIC', 'TELECOM', 'BUILDING', 'COMPLEX'];
  const sorted = order.map((t) => rows.find((r) => r.tradeType === t)).filter(Boolean) as Summary['byTrade'];
  if (!sorted.length) return <EmptyState title="진행 중인 현장이 없습니다" />;
  return (
    <ul className="space-y-3.5">
      {sorted.map((r) => (
        <li key={r.tradeType}>
          <Link href={`/projects?tradeType=${r.tradeType}`} className="group block">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-ink-2 group-hover:text-ink">{TRADE[r.tradeType].label} <span className="font-normal text-muted">{r.count}건</span></span>
              <span className="num text-ink">{wonShort(r.supply)}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${(Number(r.supply) / max) * 100}%`, background: TRADE[r.tradeType].color }} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { company, perms, project } = useSession();
  const q = useQuery({ queryKey: ['dashboard', company.id], queryFn: () => api<Summary>('/dashboard'), refetchInterval: 5 * 60_000 });
  const d = q.data;
  const statusCount = (s: ProjectStatus) => d?.byStatus.find((x) => x.status === s)?.count ?? 0;

  return (
    <>
      <PageHeader
        title="대시보드"
        description={
          <>
            {company.name}
            {perms?.scope === 'ASSIGNED' && ' · 배정된 현장만 집계'}
            {d && <> · {relative(d.asOf)} 기준</>}
          </>
        }
        actions={<Button variant="ghost" size="sm" icon={<RefreshCw className={clsx('size-3.5', q.isFetching && 'animate-spin')} />} onClick={() => q.refetch()}>새로고침</Button>}
      />

      {project && (
        <Link href={`/projects/${project.id}`} className="mb-4 flex items-center gap-3 rounded-[6px] border border-line bg-surface px-4 py-2.5 hover:bg-surface-hover">
          <span aria-hidden className="h-5 w-1 rounded-[1px]" style={{ background: TRADE[project.tradeType].color }} />
          <span className="text-muted">선택한 현장</span>
          <span className="truncate font-medium">{project.code} {project.name}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-steel-ink">현장 상세 <ArrowRight className="size-3.5" /></span>
        </Link>
      )}

      {/* 핵심 지표: 하나의 장부 띠 */}
      <section aria-label="계약 현황" className="overflow-hidden rounded-[6px] border border-line bg-surface">
        {q.isLoading || !d ? (
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="bg-surface p-4"><Skeleton className="h-3 w-20" /><Skeleton className="mt-2 h-6 w-32" /></div>)}</div>
        ) : (
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-5 [&>*]:bg-surface sm:max-lg:[&>*:last-child]:col-span-2">
            <Cell label="진행 계약총액" href="/projects?status=IN_PROGRESS" className="col-span-2 sm:col-span-1" sub={<span className="num">공급가 {wonShort(d.contract.active.supply)} · 부가세 {wonShort(d.contract.active.vat)}</span>}>
              <span className="num">{won(d.contract.active.total)}</span>
            </Cell>
            <Cell label="실행예산 합계" sub={<span className="num">계획 원가율 {d.contract.active.plannedMarginRate ? pct(1 - Number(d.contract.active.plannedMarginRate)) : '–'}</span>}>
              <span className="num">{won(d.contract.active.budget)}</span>
            </Cell>
            <Cell label="계획 이익" sub={<span className="num">계획 이익률 {pct(d.contract.active.plannedMarginRate)}</span>}>
              <Won value={d.contract.active.plannedMargin} className={undefined} />
            </Cell>
            <Cell label="진행 중 현장" href="/projects" sub={<span>예정 {statusCount('PLANNED')} · 진행 {statusCount('IN_PROGRESS')} · 중지 {statusCount('SUSPENDED')}</span>}>
              <span className="num">{d.contract.active.count}</span>
              <span className="ml-1 text-body font-normal text-muted">곳</span>
            </Cell>
            <Cell label="준공 일정" sub={<span className={clsx(d.overdue.length && 'text-seal')}>준공예정일 경과 {d.overdue.length}곳</span>}>
              <span className="num">{d.dueSoon.length}</span>
              <span className="ml-1 text-body font-normal text-muted">곳 · 30일 내</span>
            </Cell>
          </div>
        )}
        {/* 이후 단계 지표 — 값을 만들어 내지 않고 연결 전임을 표시 */}
        {d && (
          <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:hidden [&>*]:bg-surface">
            <MiniCell label="결재할 문서" href="/approvals" tone={d.approvals.todo ? 'seal' : undefined}><span className="num">{d.approvals.todo}</span><span className="ml-0.5 text-meta font-normal text-muted">건</span></MiniCell>
            {d.purchase && <MiniCell label="미승인 발주서" href="/purchase-orders?status=PENDING"><span className="num">{d.purchase.pending}</span><span className="ml-0.5 text-meta font-normal text-muted">건</span></MiniCell>}
          </div>
        )}
        {d && (
          <p className="border-t border-line bg-surface-2 px-4 py-2.5 text-meta text-muted sm:hidden">
            매출·수금·현금·미지급·세금계산서 지표는 해당 기능이 연결되면 집계됩니다.
          </p>
        )}
        {d && (
          <div className="grid grid-cols-2 gap-px border-t border-line bg-line max-sm:hidden sm:grid-cols-4 lg:grid-cols-7 [&>*]:bg-surface-2 max-lg:[&>*:last-child]:col-span-2">
            <MiniCell label="결재할 문서" href="/approvals" tone={d.approvals.todo ? 'seal' : undefined}><span className="num">{d.approvals.todo}</span><span className="ml-0.5 text-meta font-normal text-muted">건</span></MiniCell>
            {d.purchase ? (
              <>
                <MiniCell label="미승인 발주서" href="/purchase-orders?status=PENDING" sub={d.purchase.draft ? `작성중·반려 ${d.purchase.draft}건` : undefined}><span className="num">{d.purchase.pending}</span><span className="ml-0.5 text-meta font-normal text-muted">건</span></MiniCell>
                <MiniCell label="발주 확정 (부가세 포함)" href="/purchase-orders?status=OPEN" sub={`입고 대기 ${d.purchase.open}건`}><span className="num">{wonShort(d.purchase.confirmed)}</span></MiniCell>
                <MiniCell label="검수 완료 (공급가)" href="/receipts"><span className="num">{wonShort(d.purchase.receivedSupply)}</span></MiniCell>
              </>
            ) : (
              <>
                <PendingCell label="미승인 발주서" stage={2} />
                <PendingCell label="발주 확정" stage={2} />
                <PendingCell label="검수 완료" stage={2} />
              </>
            )}
            <PendingCell label="누적 매출·수금" stage={d.pendingMetrics.revenue.stage} />
            <PendingCell label="현금·미지급금" stage={d.pendingMetrics.payables.stage} />
            <PendingCell label="세금계산서" stage={d.pendingMetrics.taxInvoices.stage} />
          </div>
        )}
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="진행 현장 공정" actions={<Link href="/projects?status=IN_PROGRESS" className="text-meta text-steel-ink hover:underline">전체 보기</Link>} bodyClassName="p-0">
          {!d ? (
            <div className="space-y-3 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5" />)}</div>
          ) : d.activeProjects.length ? (
            <>
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full table-fixed text-body">
                  <thead>
                    <tr className="bg-surface-2 text-meta text-muted">
                      <th scope="col" className="px-4 py-2 text-left font-medium">현장</th>
                      <th scope="col" className="w-[26%] px-3 py-2 text-left font-medium max-sm:hidden">공정률 <span className="font-normal text-faint">| 기간 경과</span></th>
                      <th scope="col" className="w-[84px] px-3 py-2 text-right font-medium max-md:hidden">공급가액</th>
                      <th scope="col" className="w-[92px] px-3 py-2 text-right font-medium max-md:hidden">계획 이익률</th>
                      <th scope="col" className="w-[92px] px-4 py-2 text-right font-medium">준공예정</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.activeProjects.slice(0, 8).map((p) => {
                      const dd = daysUntil(p.plannedEndDate);
                      return (
                        <tr key={p.id} onClick={() => router.push(`/projects/${p.id}`)} className="cursor-pointer border-t border-line hover:bg-surface-hover">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span aria-hidden className="h-4 w-1 shrink-0 rounded-[1px]" style={{ background: TRADE[p.tradeType].color }} />
                              <Link href={`/projects/${p.id}`} className="min-w-0 truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                              {p.status === 'SUSPENDED' && <StatusBadge status="SUSPENDED" />}
                            </div>
                            <p className="num mt-0.5 truncate pl-3 text-meta text-muted">{p.code} · {TRADE[p.tradeType].short}</p>
                          </td>
                          <td className="px-3 py-2.5 max-sm:hidden"><ProgressVsTime progress={p.progressRate} elapsed={p.elapsedRate} /></td>
                          <td className="num px-3 py-2.5 text-right max-md:hidden">{wonShort(p.supplyAmount)}</td>
                          <td className="num px-3 py-2.5 text-right max-md:hidden">{pct(p.plannedMarginRate)}</td>
                          <td className={clsx('num px-4 py-2.5 text-right whitespace-nowrap', dd !== null && dd < 0 ? 'font-medium text-seal' : dd !== null && dd <= 30 ? 'text-warn' : 'text-ink-2')}>
                            {dd === null ? '–' : dd < 0 ? `${-dd}일 경과` : dd === 0 ? '오늘' : `D-${dd}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="flex items-center gap-2 border-t border-line px-4 py-2 text-[11px] text-faint">
                <span aria-hidden className="inline-block h-3 w-0.5 rounded-full bg-ink-2" /> 세로 눈금은 착공~준공예정 기간 중 오늘까지 지난 비율입니다. 공정률이 10%p 이상 뒤처지면 붉게 표시합니다.
              </p>
            </>
          ) : (
            <EmptyState title="진행 중인 현장이 없습니다" description="현장을 등록하고 상태를 '진행'으로 바꾸면 여기에 공정이 표시됩니다." action={<Link href="/projects/new"><Button variant="primary">현장 등록</Button></Link>} />
          )}
        </Panel>

        <div className="grid gap-4">
          <Panel title="공종별 진행 계약">
            {d ? <TradeBreakdown rows={d.byTrade} /> : <Skeleton className="h-32" />}
          </Panel>
          <Panel title="일정 확인 필요" bodyClassName="p-0">
            {!d ? (
              <div className="p-4"><Skeleton className="h-20" /></div>
            ) : !d.overdue.length && !d.dueSoon.length ? (
              <p className="px-4 py-6 text-center text-muted">30일 안에 준공 예정인 현장이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.overdue.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-surface-hover">
                      <AlertTriangle className="size-4 shrink-0 text-seal" aria-label="준공예정일 경과" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="num shrink-0 text-meta font-medium text-seal">{-(daysUntil(p.plannedEndDate) ?? 0)}일 경과</span>
                    </Link>
                  </li>
                ))}
                {d.dueSoon.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-surface-hover">
                      <CalendarClock className="size-4 shrink-0 text-warn" aria-label="준공 임박" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="num shrink-0 text-meta text-warn">D-{daysUntil(p.plannedEndDate)} · {pct(p.progressRate, 0)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="월별 계약 체결" actions={<span className="text-meta text-muted">계약일 기준 · 공급가액</span>}>
          {d ? <MonthlyChart data={d.monthlyContracts} /> : <Skeleton className="h-[220px]" />}
        </Panel>
        <Panel title="최근 등록 현장" bodyClassName="p-0">
          {!d ? (
            <div className="p-4"><Skeleton className="h-40" /></div>
          ) : d.recent.length ? (
            <ul className="divide-y divide-line">
              {d.recent.map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover">
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{p.name}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-meta text-muted"><TradeTag trade={p.tradeType} short /><span className="num">{p.code}</span><span>{relative(p.createdAt)}</span></p>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={p.status} />
                      <p className="num mt-0.5 text-meta text-ink-2">{wonShort(p.totalAmount)}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="아직 등록된 현장이 없습니다" action={<Link href="/projects/new"><Button variant="primary">첫 현장 등록</Button></Link>} />
          )}
          {d && <p className="border-t border-line px-4 py-2 text-meta text-muted">등록 거래처 <Link href="/vendors" className="num font-medium text-steel-ink hover:underline">{d.vendorCount}곳</Link></p>}
        </Panel>
      </div>
    </>
  );
}

