import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Command, Smartbox } from '../api/types';
import { Empty, ErrorState, InlineError, KV, Loading, Modal } from '../components/common';
import { StepUpDialog } from '../components/StepUpDialog';
import { useAuth } from '../context/Auth';
import { useOnReconnect, useSocketEvent } from '../context/Realtime';
import { fmtTime, toMs } from '../lib/format';
import { COMMAND_STATUS_LABEL, COMMAND_TYPE_LABEL, ROLE_LABEL, commandParamsText, label } from '../lib/labels';
import { sortCommands, upsertById } from '../lib/live';
import { useApi, useNow } from '../lib/useApi';

const APPROVAL_TTL_MS = 10 * 60_000; // docs/api.md: 승인 유효시간 10분

export function ApprovalsPage() {
  const { can, user } = useAuth();
  const cmds = useApi(() => api<Command[]>('/commands', { query: { status: 'pending_approval' } }).then(sortCommands), []);
  const boxes = useApi(() => api<Smartbox[]>('/smartboxes').catch(() => [] as Smartbox[]), []);
  const [approve, setApprove] = useState<Command | null>(null);
  const [reject, setReject] = useState<Command | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const now = useNow(1000);

  const boxMap = useMemo(() => new Map((boxes.data ?? []).map((b) => [b.id, b])), [boxes.data]);

  useSocketEvent('command', (c) => {
    cmds.setData((l) => {
      if (!l) return l;
      if (c.status === 'pending_approval') return sortCommands(upsertById(l, c));
      return l.filter((x) => x.id !== c.id);
    });
  });
  useOnReconnect(() => void cmds.reload());

  const canApprove = can('command.approve');

  function remove(c: Command) {
    cmds.setData((l) => (l ? l.filter((x) => x.id !== c.id) : l));
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>승인 대기 명령</h1>
        <button className="btn" onClick={() => void cmds.reload()}>
          새로고침
        </button>
      </div>
      <p className="muted">공유 장비 채널(PoE 스위치·광컨버터)의 전원 차단·재투입은 요청자와 다른 승인자의 승인이 필요합니다. 승인 유효시간은 요청 후 10분입니다.</p>
      {msg ? (
        <div className="banner banner-info" onClick={() => setMsg(null)}>
          {msg}
        </div>
      ) : null}
      {cmds.error ? <ErrorState error={cmds.error} onRetry={() => void cmds.reload()} /> : null}
      {cmds.loading && !cmds.data ? <Loading /> : null}
      {cmds.data && cmds.data.length === 0 ? <Empty text="승인 대기 중인 명령이 없습니다." /> : null}
      {cmds.data && cmds.data.length > 0 ? (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>요청 시각</th>
                <th>남은 시간</th>
                <th>현장 / 함체</th>
                <th>명령</th>
                <th>요청자</th>
                <th>사유</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {cmds.data.map((c) => {
                const b = boxMap.get(c.smartbox_id);
                const ch = typeof c.params?.ch === 'number' ? b?.channels.find((x) => x.ch === c.params?.ch) : undefined;
                const created = toMs(c.created_at);
                const left = created === null ? null : created + APPROVAL_TTL_MS - now;
                const mine = !!user && c.requested_by === user.id;
                return (
                  <tr key={c.id}>
                    <td className="nowrap">{fmtTime(c.created_at)}</td>
                    <td className={'mono ' + (left !== null && left < 120_000 ? 'text-bad' : '')}>
                      {left === null ? '—' : left <= 0 ? '만료' : `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`}
                    </td>
                    <td>
                      <Link to={`/smartboxes/${c.smartbox_id}`}>{b ? `${b.site_name ?? ''} / ${b.cabinet_code ?? ''}` : c.smartbox_id}</Link>
                      {b ? <div className="muted small mono">{b.device_id}</div> : null}
                    </td>
                    <td>
                      <b>{label(COMMAND_TYPE_LABEL, c.type)}</b> {commandParamsText(c.type, c.params)}
                      {ch ? (
                        <div className="muted small">
                          {ch.name || '—'} ({label(ROLE_LABEL, ch.role)}){ch.shared ? ' · 공유 장비' : ''}
                        </div>
                      ) : null}
                    </td>
                    <td>{c.requested_by_name ?? '—'}</td>
                    <td className="wrap">{c.reason || '—'}</td>
                    <td className="ctl">
                      {canApprove && !mine ? (
                        <>
                          <button className="btn btn-sm btn-danger" onClick={() => setApprove(c)}>
                            승인
                          </button>
                          <button className="btn btn-sm" onClick={() => setReject(c)}>
                            거부
                          </button>
                        </>
                      ) : mine ? (
                        <span className="muted small">본인 요청 (다른 승인자 필요)</span>
                      ) : (
                        <span className="muted small">승인 권한 없음</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {approve ? (
        <StepUpDialog
          title="명령 승인"
          confirmLabel="승인하고 실행"
          danger
          onClose={() => setApprove(null)}
          onSubmit={async (token) => {
            const r = await api<Command>(`/commands/${encodeURIComponent(approve.id)}/approve`, { method: 'POST', stepUpToken: token });
            remove(approve);
            setMsg(`명령을 승인했습니다. 현재 상태: ${label(COMMAND_STATUS_LABEL, r.status)}`);
          }}
        >
          <ApprovalSummary c={approve} box={boxMap.get(approve.smartbox_id)} />
          <div className="banner banner-err">
            승인하면 즉시 장치로 전송됩니다. 공유 장비 채널이면 <b>그 뒤에 연결된 모든 카메라의 전원이 꺼집니다.</b>
          </div>
        </StepUpDialog>
      ) : null}
      {reject ? (
        <RejectDialog
          c={reject}
          onClose={() => setReject(null)}
          onDone={() => {
            remove(reject);
            setMsg('명령을 거부했습니다.');
          }}
        />
      ) : null}
    </div>
  );
}

function ApprovalSummary({ c, box }: { c: Command; box?: Smartbox }) {
  return (
    <div className="confirm-summary">
      <KV k="현장 / 함체" v={box ? `${box.site_name ?? ''} / ${box.cabinet_code ?? ''}` : c.smartbox_id} />
      <KV k="명령" v={`${label(COMMAND_TYPE_LABEL, c.type)} ${commandParamsText(c.type, c.params)}`} />
      <KV k="요청자" v={c.requested_by_name ?? '—'} />
      <KV k="사유" v={c.reason || '—'} />
      <KV k="요청 시각" v={fmtTime(c.created_at)} />
    </div>
  );
}

function RejectDialog({ c, onClose, onDone }: { c: Command; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/commands/${encodeURIComponent(c.id)}/reject`, { method: 'POST', body: { reason: reason.trim() } });
      onDone();
      onClose();
    } catch (e2) {
      setErr(e2);
      setBusy(false);
    }
  }
  return (
    <Modal title="명령 거부" onClose={() => !busy && onClose()}>
      <form className="form" onSubmit={submit}>
        <ApprovalSummary c={c} />
        <label className="field">
          <span>거부 사유 (필수)</span>
          <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
        <InlineError error={err} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn btn-primary" disabled={busy || !reason.trim()}>
            {busy ? '처리 중…' : '거부'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
