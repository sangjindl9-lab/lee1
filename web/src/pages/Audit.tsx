import { useState } from 'react';
import { api, errorText } from '../api/client';
import type { AuditLog, AuditVerify } from '../api/types';
import { Empty, ErrorState, Loading } from '../components/common';
import { fmtTime } from '../lib/format';
import { useApi } from '../lib/useApi';

const PAGE = 100;

function detailText(d: unknown): string {
  if (d === null || d === undefined || d === '') return '—';
  if (typeof d === 'string') return d;
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}

export function AuditPage() {
  const [action, setAction] = useState('');
  const [applied, setApplied] = useState('');
  const logs = useApi(() => api<AuditLog[]>('/audit-logs', { query: { limit: PAGE, action: applied || undefined } }), [applied]);
  const [more, setMore] = useState<{ busy: boolean; done: boolean; err: string | null }>({ busy: false, done: false, err: null });
  const [verify, setVerify] = useState<{ busy: boolean; res: AuditVerify | null; err: string | null }>({ busy: false, res: null, err: null });

  async function loadMore() {
    const l = logs.data;
    if (!l || l.length === 0) return;
    setMore({ busy: true, done: false, err: null });
    try {
      const last = l[l.length - 1];
      const r = await api<AuditLog[]>('/audit-logs', { query: { limit: PAGE, before_id: String(last.id), action: applied || undefined } });
      logs.setData((x) => [...(x ?? []), ...r]);
      setMore({ busy: false, done: r.length < PAGE, err: null });
    } catch (e) {
      setMore({ busy: false, done: false, err: errorText(e) });
    }
  }

  async function runVerify() {
    setVerify({ busy: true, res: null, err: null });
    try {
      const r = await api<AuditVerify>('/audit-logs/verify');
      setVerify({ busy: false, res: r, err: null });
    } catch (e) {
      setVerify({ busy: false, res: null, err: errorText(e) });
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>감사로그</h1>
        <button className="btn btn-primary" onClick={() => void runVerify()} disabled={verify.busy}>
          {verify.busy ? '검증 중…' : '무결성 검증'}
        </button>
      </div>
      {verify.res ? (
        verify.res.ok ? (
          <div className="banner banner-ok">무결성 검증 통과: {verify.res.checked.toLocaleString('ko-KR')}건의 해시 체인이 정상입니다.</div>
        ) : (
          <div className="banner banner-err">
            무결성 검증 실패: {verify.res.checked.toLocaleString('ko-KR')}건 검사 중 로그 ID <b className="mono">{String(verify.res.broken_at_id ?? '—')}</b>에서 해시 체인이 끊어졌습니다. 변조 가능성이 있으니 보안 담당자에게 알리세요.
          </div>
        )
      ) : null}
      {verify.err ? <div className="banner banner-err">검증 요청 실패: {verify.err}</div> : null}

      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setMore({ busy: false, done: false, err: null });
          setApplied(action.trim());
        }}
      >
        <input className="search" placeholder="작업(action) 코드로 필터 (예: command.create)" value={action} onChange={(e) => setAction(e.target.value)} />
        <button className="btn">조회</button>
      </form>

      {logs.error ? <ErrorState error={logs.error} onRetry={() => void logs.reload()} /> : null}
      {logs.loading && !logs.data ? <Loading /> : null}
      {logs.data && logs.data.length === 0 ? <Empty text="감사로그가 없습니다." /> : null}
      {logs.data && logs.data.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="tbl tbl-dense">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>시각</th>
                  <th>사용자</th>
                  <th>작업</th>
                  <th>대상</th>
                  <th>내용</th>
                  <th>IP</th>
                  <th>해시</th>
                </tr>
              </thead>
              <tbody>
                {logs.data.map((l) => (
                  <tr key={String(l.id)} className={verify.res && !verify.res.ok && String(verify.res.broken_at_id) === String(l.id) ? 'row-broken' : ''}>
                    <td className="mono">{String(l.id)}</td>
                    <td className="nowrap">{fmtTime(l.ts)}</td>
                    <td>{l.username ?? '—'}</td>
                    <td className="mono">{l.action}</td>
                    <td className="small">
                      {l.target_type ?? '—'}
                      {l.target_id ? <div className="muted mono">{l.target_id}</div> : null}
                    </td>
                    <td className="wrap small mono detail-cell">{detailText(l.detail)}</td>
                    <td className="mono small">{l.ip ?? '—'}</td>
                    <td className="mono small" title={`prev ${l.prev_hash ?? '—'}\nhash ${l.hash ?? '—'}`}>
                      {l.hash ? l.hash.slice(0, 10) + '…' : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="more">
            {more.err ? <span className="text-bad">{more.err}</span> : null}
            {more.done ? (
              <span className="muted">마지막 기록입니다.</span>
            ) : (
              <button className="btn" onClick={() => void loadMore()} disabled={more.busy}>
                {more.busy ? '불러오는 중…' : '이전 기록 더 보기'}
              </button>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
