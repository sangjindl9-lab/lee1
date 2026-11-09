import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Alarm, Smartbox } from '../api/types';
import { Empty, ErrorState, Flag, Loading, OnlineDot } from '../components/common';
import { useAuth } from '../context/Auth';
import { useOnReconnect, useSocketEvent } from '../context/Realtime';
import { fmtNum, fmtTime, relTime } from '../lib/format';
import { SEVERITIES, SEVERITY_LABEL, UNRESOLVED_STATES } from '../lib/labels';
import { applyStatus, applyTelemetry, isUnresolved, upsertById } from '../lib/live';
import { useApi, useNow } from '../lib/useApi';

type View = 'grid' | 'list';
type Filter = 'all' | 'online' | 'offline' | 'alarm';

async function loadUnresolvedAlarms(): Promise<Alarm[]> {
  const lists = await Promise.all(UNRESOLVED_STATES.map((s) => api<Alarm[]>('/alarms', { query: { state: s } })));
  return lists.flat();
}

export function DashboardPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const canAlarm = can('alarm.read');
  const boxes = useApi(() => api<Smartbox[]>('/smartboxes'), []);
  const alarms = useApi(() => (canAlarm ? loadUnresolvedAlarms() : Promise.resolve<Alarm[]>([])), [canAlarm]);
  const [view, setView] = useState<View>(() => (window.innerWidth < 700 ? 'grid' : 'list'));
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const now = useNow(5000);

  useSocketEvent('telemetry', (ev) => boxes.setData((l) => l && l.map((b) => applyTelemetry(b, ev))));
  useSocketEvent('device_status', (ev) => boxes.setData((l) => l && l.map((b) => applyStatus(b, ev))));
  useSocketEvent('alarm', (a) =>
    alarms.setData((l) => {
      if (!l) return l;
      if (isUnresolved(a)) return upsertById(l, a);
      return l.filter((x) => x.id !== a.id);
    }),
  );
  useOnReconnect(() => {
    void boxes.reload();
    void alarms.reload();
  });

  const alarmBySb = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of alarms.data ?? []) if (a.smartbox_id) m.set(a.smartbox_id, (m.get(a.smartbox_id) ?? 0) + 1);
    return m;
  }, [alarms.data]);

  const alarmCount = (b: Smartbox): number => (alarms.data && !alarms.error ? alarmBySb.get(b.id) ?? 0 : b.open_alarm_count);

  const sevCounts = useMemo(() => {
    const c: Record<string, number> = { critical: 0, major: 0, warning: 0, info: 0 };
    for (const a of alarms.data ?? []) c[a.severity] = (c[a.severity] ?? 0) + 1;
    return c;
  }, [alarms.data]);

  const list = boxes.data ?? [];
  const total = list.length;
  const online = list.filter((b) => b.online).length;

  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return list
      .filter((b) => {
        if (filter === 'online' && !b.online) return false;
        if (filter === 'offline' && b.online) return false;
        if (filter === 'alarm' && alarmCount(b) === 0) return false;
        if (!qq) return true;
        return [b.site_name, b.cabinet_code, b.cabinet_name, b.device_id, b.serial_no].some((s) => s && s.toLowerCase().includes(qq));
      })
      .sort((a, b) => {
        // 이상 우선: 오프라인 → 알람 많은 순 → 현장/함체
        if (a.online !== b.online) return a.online ? 1 : -1;
        const d = alarmCount(b) - alarmCount(a);
        if (d) return d;
        return `${a.site_name ?? ''} ${a.cabinet_code ?? ''}`.localeCompare(`${b.site_name ?? ''} ${b.cabinet_code ?? ''}`, 'ko');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, filter, q, alarmBySb, alarms.data, alarms.error]);

  if (boxes.loading && !boxes.data) return <Loading />;
  if (boxes.error && !boxes.data) return <ErrorState error={boxes.error} onRetry={() => void boxes.reload()} />;

  return (
    <div className="page">
      <div className="page-head">
        <h1>대시보드</h1>
      </div>
      {boxes.error ? <ErrorState error={boxes.error} onRetry={() => void boxes.reload()} /> : null}
      <div className="stats">
        <Stat label="전체 스마트박스" value={total} onClick={() => setFilter('all')} active={filter === 'all'} />
        <Stat label="온라인" value={online} tone="ok" onClick={() => setFilter('online')} active={filter === 'online'} />
        <Stat label="오프라인" value={total - online} tone={total - online > 0 ? 'bad' : undefined} onClick={() => setFilter('offline')} active={filter === 'offline'} />
        {canAlarm
          ? SEVERITIES.map((s) => (
              <Stat
                key={s}
                label={`미조치 ${SEVERITY_LABEL[s]}`}
                value={alarms.error ? null : alarms.data ? sevCounts[s] : null}
                tone={sevCounts[s] > 0 ? `sev-${s}` : undefined}
                onClick={() => nav(`/alarms?severity=${s}`)}
              />
            ))
          : null}
      </div>
      {alarms.error ? <div className="banner banner-warn">알람 집계를 불러오지 못했습니다: {alarms.error.message}</div> : null}

      <div className="toolbar">
        <input className="search" placeholder="현장·함체·장치 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="표시 필터">
          <option value="all">전체</option>
          <option value="online">온라인</option>
          <option value="offline">오프라인</option>
          <option value="alarm">미조치 알람 있음</option>
        </select>
        <div className="seg">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            목록
          </button>
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>
            타일
          </button>
        </div>
        <span className="muted">{shown.length}대 표시</span>
      </div>

      {total === 0 ? (
        <Empty text="등록된 스마트박스가 없습니다. 현장·함체 관리에서 등록하세요." />
      ) : view === 'list' ? (
        <div className="table-wrap">
          <table className="tbl tbl-dense">
            <thead>
              <tr>
                <th>상태</th>
                <th>현장</th>
                <th>함체</th>
                <th className="num">온도</th>
                <th className="num">습도</th>
                <th className="num">AC 전력</th>
                <th className="num">DC 입력</th>
                <th>문</th>
                <th>UPS</th>
                <th className="num">알람</th>
                <th>최종 수신</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((b) => {
                const t = b.latest;
                const ac = alarmCount(b);
                return (
                  <tr key={b.id} className={'row-link' + (b.online ? '' : ' row-offline')} onClick={() => nav(`/smartboxes/${b.id}`)}>
                    <td>
                      <OnlineDot online={b.online} /> {b.online ? '온라인' : '오프라인'}
                    </td>
                    <td>{b.site_name ?? '—'}</td>
                    <td>
                      <Link to={`/smartboxes/${b.id}`} onClick={(e) => e.stopPropagation()}>
                        {b.cabinet_code ?? '—'}
                      </Link>{' '}
                      <span className="muted">{b.cabinet_name ?? ''}</span>
                    </td>
                    <td className="num">{fmtNum(t?.env?.t, 1, '℃')}</td>
                    <td className="num">{fmtNum(t?.env?.rh, 0, '%')}</td>
                    <td className="num">{fmtNum(t?.ac?.w, 0, 'W')}</td>
                    <td className="num">{fmtNum(t?.dc?.in_v, 2, 'V')}</td>
                    <td>
                      <Flag value={t?.inputs?.door} onText="열림" offText="닫힘" />
                    </td>
                    <td>
                      <UpsFlag acFail={t?.inputs?.ups_ac_fail} battLow={t?.inputs?.ups_batt_low} />
                    </td>
                    <td className="num">{ac > 0 ? <span className="badge-count">{ac}</span> : <span className="muted">0</span>}</td>
                    <td className="muted" title={fmtTime(b.last_seen_at)}>
                      {relTime(b.last_seen_at, now)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="tiles">
          {shown.map((b) => {
            const t = b.latest;
            const ac = alarmCount(b);
            return (
              <Link key={b.id} to={`/smartboxes/${b.id}`} className={'tile' + (b.online ? '' : ' tile-offline') + (ac > 0 ? ' tile-alarm' : '')}>
                <div className="tile-head">
                  <OnlineDot online={b.online} />
                  <span className="tile-title">{b.cabinet_code ?? b.device_id}</span>
                  {ac > 0 ? <span className="badge-count">{ac}</span> : null}
                </div>
                <div className="tile-sub">
                  {b.site_name ?? '—'} · {b.cabinet_name ?? ''}
                </div>
                <div className="tile-metrics">
                  <span>
                    <i>온도</i>
                    {fmtNum(t?.env?.t, 1, '℃')}
                  </span>
                  <span>
                    <i>습도</i>
                    {fmtNum(t?.env?.rh, 0, '%')}
                  </span>
                  <span>
                    <i>AC</i>
                    {fmtNum(t?.ac?.w, 0, 'W')}
                  </span>
                  <span>
                    <i>DC</i>
                    {fmtNum(t?.dc?.in_v, 2, 'V')}
                  </span>
                </div>
                <div className="tile-flags">
                  <span>
                    문 <Flag value={t?.inputs?.door} onText="열림" offText="닫힘" />
                  </span>
                  <span>
                    UPS <UpsFlag acFail={t?.inputs?.ups_ac_fail} battLow={t?.inputs?.ups_batt_low} />
                  </span>
                </div>
                <div className="tile-foot muted">최종 수신 {relTime(b.last_seen_at, now)}</div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UpsFlag({ acFail, battLow }: { acFail: boolean | null | undefined; battLow: boolean | null | undefined }) {
  if (acFail === true) return <span className="flag flag-bad">정전</span>;
  if (battLow === true) return <span className="flag flag-bad">저전압</span>;
  if (acFail === false) return <span className="flag flag-ok">정상</span>;
  return <span className="flag flag-unk">—</span>;
}

function Stat({
  label,
  value,
  tone,
  onClick,
  active,
}: {
  label: string;
  value: number | null;
  tone?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button className={'stat' + (tone ? ` stat-${tone}` : '') + (active ? ' active' : '')} onClick={onClick}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value === null ? '—' : value.toLocaleString('ko-KR')}</span>
    </button>
  );
}
