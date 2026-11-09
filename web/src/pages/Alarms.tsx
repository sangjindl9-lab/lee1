import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Alarm, User } from '../api/types';
import { AlarmStateBadge, Empty, ErrorState, InlineError, Loading, Modal, SeverityBadge } from '../components/common';
import { useAuth } from '../context/Auth';
import { useOnReconnect, useSocketEvent } from '../context/Realtime';
import { fmtTime, toMs } from '../lib/format';
import { ALARM_STATES, ALARM_STATE_LABEL, ALARM_TYPE_LABEL, SEVERITIES, SEVERITY_LABEL, UNRESOLVED_STATES, label } from '../lib/labels';
import { isUnresolved, upsertById } from '../lib/live';
import { useApi } from '../lib/useApi';

function sortAlarms(l: Alarm[]): Alarm[] {
  return l.slice().sort((a, b) => (toMs(b.last_at ?? b.first_at) ?? 0) - (toMs(a.last_at ?? a.first_at) ?? 0));
}

type ActionKind = 'ack' | 'assign' | 'resolve';

export function AlarmsPage() {
  const { can, user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const stateF = sp.get('state') ?? 'unresolved';
  const sevF = sp.get('severity') ?? '';
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const timers = useRef<number[]>([]);
  const [action, setAction] = useState<{ kind: ActionKind; alarm: Alarm } | null>(null);

  const alarms = useApi(async () => {
    const sev = sevF || undefined;
    if (stateF === 'unresolved') {
      const lists = await Promise.all(UNRESOLVED_STATES.map((s) => api<Alarm[]>('/alarms', { query: { state: s, severity: sev } })));
      return sortAlarms(lists.flat());
    }
    return api<Alarm[]>('/alarms', { query: { state: stateF === 'all' ? undefined : stateF, severity: sev } });
  }, [stateF, sevF]);

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  function matches(a: Alarm): boolean {
    if (sevF && a.severity !== sevF) return false;
    if (stateF === 'unresolved') return isUnresolved(a);
    if (stateF === 'all') return true;
    return a.state === stateF;
  }

  useSocketEvent('alarm', (a) => {
    alarms.setData((l) => {
      if (!l) return l;
      if (!matches(a)) return l.filter((x) => x.id !== a.id);
      return sortAlarms(upsertById(l, a));
    });
    // 긴급 알람은 새로 생기거나 다시 발생(open 상태로 갱신)하면 잠시 깜박인다
    if (a.severity === 'critical' && a.state === 'open' && matches(a)) {
      setFlash((s) => new Set(s).add(a.id));
      const tm = window.setTimeout(() => {
        setFlash((s) => {
          const n = new Set(s);
          n.delete(a.id);
          return n;
        });
      }, 6000);
      timers.current.push(tm);
    }
  });
  useOnReconnect(() => void alarms.reload());

  function setFilter(k: string, v: string) {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  }

  const canAck = can('alarm.ack');
  const canManage = can('alarm.manage');

  return (
    <div className="page">
      <div className="page-head">
        <h1>알람</h1>
        <button className="btn" onClick={() => void alarms.reload()}>
          새로고침
        </button>
      </div>
      <div className="toolbar">
        <label className="inline-field">
          상태
          <select value={stateF} onChange={(e) => setFilter('state', e.target.value)}>
            <option value="unresolved">미조치 전체</option>
            <option value="all">전체</option>
            {ALARM_STATES.map((s) => (
              <option key={s} value={s}>
                {ALARM_STATE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <div className="seg">
          <button className={!sevF ? 'active' : ''} onClick={() => setFilter('severity', '')}>
            전체 등급
          </button>
          {SEVERITIES.map((s) => (
            <button key={s} className={(sevF === s ? 'active ' : '') + `seg-sev-${s}`} onClick={() => setFilter('severity', s)}>
              {SEVERITY_LABEL[s]}
            </button>
          ))}
        </div>
        {alarms.data ? <span className="muted">{alarms.data.length}건</span> : null}
      </div>

      {alarms.error ? <ErrorState error={alarms.error} onRetry={() => void alarms.reload()} /> : null}
      {alarms.loading && !alarms.data ? <Loading /> : null}
      {alarms.data && alarms.data.length === 0 ? <Empty text="조건에 맞는 알람이 없습니다." /> : null}
      {alarms.data && alarms.data.length > 0 ? (
        <div className="table-wrap">
          <table className="tbl tbl-dense">
            <thead>
              <tr>
                <th>등급</th>
                <th>발생 시각</th>
                <th>현장</th>
                <th>함체</th>
                <th>유형</th>
                <th>내용</th>
                <th>상태</th>
                <th>담당</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {alarms.data.map((a) => (
                  <tr key={a.id} className={`sevrow sevrow-${a.severity}` + (flash.has(a.id) ? ' flash' : '')}>
                    <td>
                      <SeverityBadge severity={a.severity} />
                    </td>
                    <td className="nowrap">
                      {fmtTime(a.first_at)}
                      {a.count && a.count > 1 ? (
                        <div className="muted small">
                          최근 {fmtTime(a.last_at)} · {a.count}회
                        </div>
                      ) : null}
                    </td>
                    <td>{a.site_name ?? '—'}</td>
                    <td>{a.smartbox_id ? <Link to={`/smartboxes/${a.smartbox_id}`}>{a.cabinet_code ?? '—'}</Link> : a.cabinet_code ?? '—'}</td>
                    <td>{label(ALARM_TYPE_LABEL, a.type)}</td>
                    <td className="wrap">
                      <div>{a.title}</div>
                      {a.detail ? <div className="muted small">{a.detail}</div> : null}
                    </td>
                    <td>
                      <AlarmStateBadge state={a.state} />
                      {a.ack_by_name ? <div className="muted small">확인 {a.ack_by_name}</div> : null}
                    </td>
                    <td>{a.assignee_name ?? '—'}</td>
                    <td className="ctl">
                      {canAck && a.state === 'open' ? (
                        <button className="btn btn-sm" onClick={() => setAction({ kind: 'ack', alarm: a })}>
                          확인
                        </button>
                      ) : null}
                      {canManage && isUnresolved(a) ? (
                        <>
                          <button className="btn btn-sm" onClick={() => setAction({ kind: 'assign', alarm: a })}>
                            담당 지정
                          </button>
                          <button className="btn btn-sm btn-primary" onClick={() => setAction({ kind: 'resolve', alarm: a })}>
                            조치 완료
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {action ? (
        <AlarmActionDialog
          kind={action.kind}
          alarm={action.alarm}
          me={user}
          onClose={() => setAction(null)}
          onDone={(updated) => {
            if (updated) {
              alarms.setData((l) => {
                if (!l) return l;
                if (!matches(updated)) return l.filter((x) => x.id !== updated.id);
                return sortAlarms(upsertById(l, updated));
              });
            } else void alarms.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function AlarmActionDialog({
  kind,
  alarm,
  me,
  onClose,
  onDone,
}: {
  kind: ActionKind;
  alarm: Alarm;
  me: User | null;
  onClose: () => void;
  onDone: (a: Alarm | null) => void;
}) {
  const [note, setNote] = useState('');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState<User[] | null>(null);
  const [usersErr, setUsersErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    if (kind !== 'assign') return;
    api<User[]>('/users/assignable')
      .then((u) => setUsers(u.filter((x) => x.active !== false)))
      .catch(() => setUsersErr('담당자 목록을 불러오지 못했습니다. 본인에게만 지정할 수 있습니다.'));
  }, [kind]);

  const title = kind === 'ack' ? '알람 확인' : kind === 'assign' ? '담당자 지정' : '조치 완료';
  const valid = kind === 'ack' || (kind === 'assign' ? !!userId : note.trim().length > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const path = `/alarms/${encodeURIComponent(alarm.id)}/${kind}`;
      const body = kind === 'ack' ? (note.trim() ? { note: note.trim() } : {}) : kind === 'assign' ? { user_id: userId } : { note: note.trim() };
      const r = await api<unknown>(path, { method: 'POST', body });
      onDone(r && typeof r === 'object' && 'id' in r && 'state' in r ? (r as Alarm) : null);
      onClose();
    } catch (e2) {
      setErr(e2);
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={() => !busy && onClose()}>
      <form className="form" onSubmit={submit}>
        <div className="confirm-summary">
          <div>
            <SeverityBadge severity={alarm.severity} /> {alarm.title}
          </div>
          <div className="muted small">
            {alarm.site_name ?? '—'} · {alarm.cabinet_code ?? '—'} · {fmtTime(alarm.first_at)}
          </div>
        </div>
        {kind === 'assign' ? (
          <label className="field">
            <span>담당자</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">선택</option>
              {me ? <option value={me.id}>나에게 지정 ({me.display_name || me.username})</option> : null}
              {(users ?? [])
                .filter((u) => u.id !== me?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name || u.username} ({u.username})
                  </option>
                ))}
            </select>
            {usersErr ? <span className="muted small">{usersErr}</span> : null}
          </label>
        ) : (
          <label className="field">
            <span>{kind === 'resolve' ? '조치 내용 (필수)' : '메모 (선택)'}</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </label>
        )}
        <InlineError error={err} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn btn-primary" disabled={busy || !valid}>
            {busy ? '처리 중…' : title}
          </button>
        </div>
      </form>
    </Modal>
  );
}
