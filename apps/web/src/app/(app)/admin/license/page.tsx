'use client';

import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, DL, PageHeader, Panel, Skeleton, Textarea, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { bizNo } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Status { mode: 'TRIAL' | 'LICENSED' | 'EXPIRED' | 'INVALID'; licensee?: string; bizRegNo?: string; maxUsers: number; activeUsers: number; expiresAt: string; daysLeft: number; writable: boolean; message: string }
const MODE = { TRIAL: ['평가판', 'warn'], LICENSED: ['정식 라이선스', 'ok'], EXPIRED: ['만료 · 조회만 가능', 'seal'], INVALID: ['확인 불가', 'seal'] } as const;

export default function LicensePage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ['license'], queryFn: () => api<Status>('/license', { noCompany: true }) });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const s = q.data;

  async function install() {
    setBusy(true);
    try {
      await api('/license', { method: 'POST', json: { license: text } });
      toast('ok', '라이선스를 등록했습니다');
      setText('');
      qc.invalidateQueries({ queryKey: ['license'] });
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '등록하지 못했습니다');
    } finally {
      setBusy(false);
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
                  { label: '사용자', value: s.licensee ?? '평가판' },
                  { label: '사업자등록번호', value: s.bizRegNo ? <span className="num">{bizNo(s.bizRegNo)}</span> : null },
                  { label: '사용자 수', value: <span className="num">{s.activeUsers} / {s.maxUsers}명</span> },
                  { label: '만료일', value: s.expiresAt ? <span className={clsx('num', s.daysLeft <= 30 && 'font-medium text-seal')}>{s.expiresAt} ({s.daysLeft >= 0 ? `${s.daysLeft}일 남음` : '만료'})</span> : null },
                ]}
              />
              <div className="mt-4 h-1.5 rounded-full bg-surface-2" aria-label="사용자 수 사용률">
                <div className={clsx('h-full rounded-full', s.activeUsers >= s.maxUsers ? 'bg-seal' : 'bg-steel')} style={{ width: `${Math.min(100, (s.activeUsers / Math.max(1, s.maxUsers)) * 100)}%` }} />
              </div>
              <p className="mt-2 text-meta text-muted">{s.message}</p>
            </>
          )}
        </Panel>
        {can('license:update') && (
          <Panel title="라이선스 등록·갱신">
            <p className="mb-3 text-muted">공급사에서 받은 라이선스 문자열을 그대로 붙여 넣으세요. 인터넷 연결 없이 서버에서 서명을 확인합니다.</p>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="num text-meta break-all" placeholder="eyJsaWNlbnNlSWQiOi…" spellCheck={false} />
            <div className="mt-3 flex justify-end"><Button variant="primary" loading={busy} disabled={text.trim().length < 20} onClick={install}>라이선스 등록</Button></div>
          </Panel>
        )}
      </div>
    </>
  );
}
