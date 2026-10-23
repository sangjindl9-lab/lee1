'use client';

import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, DL, Input, PageHeader, Panel, Skeleton, Textarea, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { bizNo } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Status {
  mode: 'TRIAL' | 'LICENSED' | 'EXPIRED' | 'INVALID';
  licenseId?: string;
  licensee?: string;
  bizRegNo?: string;
  edition?: string;
  maxUsers: number;
  activeUsers: number;
  issuedAt?: string;
  expiresAt: string;
  daysLeft: number;
  writable: boolean;
  renewSoon: boolean;
  message: string;
  online: { connected: boolean; lastSyncAt: string | null; lastError: string | null };
}
const MODE = { TRIAL: ['평가판', 'warn'], LICENSED: ['정식 라이선스', 'ok'], EXPIRED: ['만료 · 조회만 가능', 'seal'], INVALID: ['확인 불가', 'seal'] } as const;

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function LicensePage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['license'], queryFn: () => api<Status>('/license', { noCompany: true }) });
  const [text, setText] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'' | 'install' | 'connect' | 'sync'>('');
  const s = q.data;
  const canEdit = can('license:update');

  async function run(kind: 'install' | 'connect' | 'sync', fn: () => Promise<unknown>, ok: string) {
    setBusy(kind);
    try {
      const r = (await fn()) as { syncMessage?: string } | undefined;
      toast('ok', r?.syncMessage ?? ok);
      qc.invalidateQueries({ queryKey: ['license'] });
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '처리하지 못했습니다');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <PageHeader title="라이선스" description="이 서버에 설치된 SS-ERP 사용 권한입니다. 라이선스가 끝나도 자료는 지워지지 않고 조회와 출력은 계속할 수 있습니다." />
      <div className="grid max-w-4xl gap-4">
        <Panel title="현재 상태" actions={s && <Badge tone={MODE[s.mode][1]}>{MODE[s.mode][0]}</Badge>}>
          {!s ? <Skeleton className="h-24" /> : (
            <>
              <DL
                cols={4}
                items={[
                  { label: '사용 회사', value: s.licensee ?? '평가판' },
                  { label: '사업자등록번호', value: s.bizRegNo ? <span className="num">{bizNo(s.bizRegNo)}</span> : null },
                  { label: '사용자 수', value: <span className="num">{s.activeUsers} / {s.maxUsers}명</span> },
                  { label: '만료일', value: s.expiresAt ? <span className={clsx('num', s.daysLeft <= 30 && 'font-medium text-seal')}>{s.expiresAt} ({s.daysLeft >= 0 ? `${s.daysLeft}일 남음` : '만료'})</span> : null },
                ]}
              />
              <div className="mt-4 h-1.5 rounded-full bg-surface-2" aria-label="사용자 수 사용률">
                <div className={clsx('h-full rounded-full', s.activeUsers >= s.maxUsers ? 'bg-seal' : 'bg-steel')} style={{ width: `${Math.min(100, (s.activeUsers / Math.max(1, s.maxUsers)) * 100)}%` }} />
              </div>
              <p className={clsx('mt-2 text-meta', s.renewSoon || !s.writable ? 'font-medium text-seal' : 'text-muted')}>{s.message}</p>
              {s.licenseId && <p className="mt-1 text-meta text-muted">라이선스 번호 <span className="num">{s.licenseId.slice(0, 8).toUpperCase()}</span>{s.issuedAt ? ` · 발급 ${s.issuedAt.slice(0, 10)}` : ''}</p>}
            </>
          )}
        </Panel>

        <Panel title="온라인 자동 갱신" actions={s && <Badge tone={s.online.connected ? 'ok' : 'outline'}>{s.online.connected ? '연결됨' : '연결 안 됨'}</Badge>}>
          <p className="mb-3 text-muted">
            공급사에서 받은 <b>설치 코드</b>로 한 번 연결해 두면, 연간 계약을 갱신하거나 사용자 수를 늘릴 때 새 라이선스가 자동으로 들어옵니다. 인터넷에 연결되지 않는 서버는 아래에서 라이선스 문자열을 직접 등록하세요.
          </p>
          {s?.online.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-meta text-muted">
                마지막 확인 {fmtTime(s.online.lastSyncAt)}
                {s.online.lastError && <span className="ml-2 text-seal">· 최근 확인 실패: {s.online.lastError}</span>}
              </p>
              {canEdit && <Button loading={busy === 'sync'} onClick={() => run('sync', () => api('/license/sync', { method: 'POST', json: {} }), '최신 라이선스를 확인했습니다')}>지금 확인</Button>}
            </div>
          ) : canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="예: SS-7K2Q-9WXM-4HPA" className="num min-w-0 flex-1" spellCheck={false} autoComplete="off" />
              <Button variant="primary" loading={busy === 'connect'} disabled={code.trim().length < 8} onClick={() => run('connect', () => api('/license/connect', { method: 'POST', json: { code } }), '발급 서버에 연결했습니다')}>연결</Button>
            </div>
          ) : null}
        </Panel>

        {canEdit && (
          <Panel title="라이선스 직접 등록 (오프라인)">
            <p className="mb-3 text-muted">공급사에서 받은 라이선스 문자열을 그대로 붙여 넣으세요. 인터넷 연결 없이 서버에서 서명과 사업자등록번호를 확인합니다.</p>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="num text-meta break-all" placeholder="eyJsaWNlbnNlSWQiOi…" spellCheck={false} />
            <div className="mt-3 flex justify-end">
              <Button variant="primary" loading={busy === 'install'} disabled={text.trim().length < 20} onClick={() => run('install', async () => { await api('/license', { method: 'POST', json: { license: text } }); setText(''); }, '라이선스를 등록했습니다')}>라이선스 등록</Button>
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
