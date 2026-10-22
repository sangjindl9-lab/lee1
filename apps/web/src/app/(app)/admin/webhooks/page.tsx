'use client';

import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Plus, RotateCw, Send, Webhook } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Checkbox, Dialog, Drawer, EmptyState, Field, Input, PageHeader, Skeleton, useConfirm, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { dateTime, relative } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Ep { id: string; name: string; url: string; events: string[]; isActive: boolean; version: number; createdAt: string; stats: { ok: number; failed: number; pending: number; last: string } | null }
interface Delivery { id: string; endpointId: string; event: string; status: 'PENDING' | 'DELIVERED' | 'FAILED'; attempts: number; lastStatusCode: number | null; lastError: string | null; nextAttemptAt: string; deliveredAt: string | null; createdAt: string; payload: { summary?: string } }
const D_TONE = { PENDING: 'warn', DELIVERED: 'ok', FAILED: 'seal' } as const;
const D_LABEL = { PENDING: '재시도 대기', DELIVERED: '전달됨', FAILED: '실패' };

function EpDrawer({ ep, events, onClose, onSaved }: { ep: Ep | null; events: { value: string; label: string }[]; onClose: () => void; onSaved: (secret?: string) => void }) {
  const [f, setF] = useState({ name: ep?.name ?? '', url: ep?.url ?? 'https://', events: new Set(ep?.events ?? []), isActive: ep?.isActive ?? true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (v: string) => setF((x) => { const n = new Set(x.events); if (n.has(v)) n.delete(v); else n.add(v); return { ...x, events: n }; });
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body = { name: f.name, url: f.url, events: [...f.events], isActive: f.isActive };
      if (ep) {
        await api(`/webhooks/${ep.id}`, { method: 'PUT', json: { ...body, version: ep.version } });
        onSaved();
      } else onSaved((await api<{ secret: string }>('/webhooks', { method: 'POST', json: body })).secret);
    } catch (e) {
      setErr(e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer open onClose={onClose} title={ep ? ep.name : '웹훅 등록'} subtitle="선택한 업무가 일어나면 이 주소로 JSON을 POST 합니다" footer={<><Button onClick={onClose}>취소</Button><Button variant="primary" loading={busy} disabled={!f.name.trim() || !f.events.size} onClick={save}>저장</Button></>}>
      <div className="space-y-4">
        <Field label="이름" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 그룹웨어 알림" /></Field>
        <Field label="받는 주소 (URL)" required hint="운영 환경에서는 https 만 쓸 수 있고, 내부망 주소로는 보내지 않습니다"><Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} inputMode="url" /></Field>
        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink-2">받을 이벤트</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">{events.map((e) => <Checkbox key={e.value} checked={f.events.has(e.value)} onChange={() => toggle(e.value)} label={<span>{e.label} <span className="num text-meta text-faint">{e.value}</span></span>} />)}</div>
        </fieldset>
        {ep && <Checkbox checked={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="사용 (끄면 발송을 멈춤)" />}
        {err && <p className="text-meta text-seal">{err}</p>}
      </div>
    </Drawer>
  );
}

export default function Page() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can, company } = useSession();
  const { ask, node } = useConfirm();
  const data = useQuery({ queryKey: ['webhooks', company.id], queryFn: () => api<{ events: { value: string; label: string }[]; endpoints: Ep[] }>('/webhooks'), enabled: can('integration:read') });
  const [sel, setSel] = useState<string | null>(null);
  const del = useQuery({ queryKey: ['webhook-deliveries', company.id, sel], queryFn: () => api<Delivery[]>(`/webhooks/deliveries${sel ? `?endpointId=${sel}` : ''}`), refetchInterval: 10_000, enabled: can('integration:read') });
  const [edit, setEdit] = useState<Ep | 'new' | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const editable = can('integration:update');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['webhooks'] });
    qc.invalidateQueries({ queryKey: ['webhook-deliveries'] });
  };
  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '처리하지 못했습니다');
    } finally {
      setBusy(null);
      refresh();
    }
  }
  if (!can('integration:read')) return <EmptyState title="웹훅을 볼 권한이 없습니다" />;
  return (
    <>
      <PageHeader title="웹훅" description="발주·결재·지급·세금계산서 같은 업무가 확정되면 외부 프로그램에 바로 알립니다. 실패하면 1분·5분·30분·2시간·12시간 뒤 다시 보냅니다."
        actions={editable && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>웹훅 등록</Button>} />
      <div className="mb-4 rounded-[6px] border border-line bg-surface px-4 py-3 text-meta text-ink-2">
        받는 쪽에서는 <code className="num rounded-[3px] bg-surface-2 px-1">X-SSERP-Signature</code> = <code className="num rounded-[3px] bg-surface-2 px-1">sha256=HMAC(비밀키, 타임스탬프 + &quot;.&quot; + 본문)</code> 을 확인하고, <code className="num rounded-[3px] bg-surface-2 px-1">X-SSERP-Timestamp</code> 가 5분보다 오래된 요청은 버리세요. 같은 알림이 두 번 올 수 있으니 <code className="num rounded-[3px] bg-surface-2 px-1">X-SSERP-Delivery</code> 로 중복을 거르세요.
      </div>
      {!data.data ? <Skeleton className="h-40" /> : !data.data.endpoints.length ? (
        <EmptyState icon={<Webhook className="size-6" />} title="등록한 웹훅이 없습니다" description="그룹웨어 알림이나 자체 시스템 연동이 필요할 때 등록하세요." />
      ) : (
        <ul className="mb-4 divide-y divide-line rounded-[6px] border border-line bg-surface">
          {data.data.endpoints.map((e) => (
            <li key={e.id} className={clsx('flex flex-wrap items-center gap-3 px-4 py-3', sel === e.id && 'bg-steel-soft/30')}>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSel(sel === e.id ? null : e.id)}>
                <span className="flex items-center gap-2"><b className={clsx(!e.isActive && 'text-muted line-through decoration-faint')}>{e.name}</b>{!e.isActive && <Badge tone="outline">꺼짐</Badge>}</span>
                <span className="num block truncate text-meta text-muted">{e.url}</span>
                <span className="block text-meta text-faint">{e.events.join(', ')}</span>
              </button>
              {e.stats && <span className="text-meta text-muted">전달 <b className="num text-ok">{e.stats.ok}</b> · 대기 <b className="num">{e.stats.pending}</b> · 실패 <b className={clsx('num', e.stats.failed > 0 && 'text-seal')}>{e.stats.failed}</b></span>}
              {editable && (
                <span className="flex gap-1.5">
                  <Button size="sm" icon={<Send className="size-3.5" />} loading={busy === 't' + e.id} onClick={() => run('t' + e.id, async () => { const r = await api<{ ok: boolean; statusCode: number | null; error: string | null }>(`/webhooks/${e.id}/test`, { method: 'POST' }); toast(r.ok ? 'ok' : 'error', r.ok ? `연결됨 (응답 ${r.statusCode})` : `실패: ${r.error}`); })}>연결 테스트</Button>
                  <Button size="sm" onClick={() => setEdit(e)}>수정</Button>
                  {e.isActive && <Button size="sm" variant="danger" onClick={async () => { if (await ask({ title: `'${e.name}' 웹훅 끄기`, body: '대기 중인 발송도 취소됩니다.', confirm: '끄기', danger: true })) run('d' + e.id, async () => { await api(`/webhooks/${e.id}`, { method: 'DELETE' }); toast('ok', '웹훅을 껐습니다'); }); }}>끄기</Button>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <section className="rounded-[6px] border border-line bg-surface">
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5"><h2 className="text-section font-semibold">최근 발송 기록{sel && <span className="ml-1 text-meta font-normal text-muted">· 선택한 웹훅만</span>}</h2>{sel && <Button size="sm" onClick={() => setSel(null)}>전체 보기</Button>}</header>
        {!del.data ? <Skeleton className="m-4 h-32" /> : !del.data.length ? <p className="p-4 text-muted">발송 기록이 없습니다</p> : (
          <ul className="divide-y divide-line">
            {del.data.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <Badge tone={D_TONE[d.status]}>{D_LABEL[d.status]}</Badge>
                <span className="num w-44 text-meta">{d.event}</span>
                <span className="min-w-0 flex-1 truncate text-meta text-ink-2">{d.payload.summary}</span>
                <span className="text-meta text-muted">{d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : ''}{d.lastError && d.status !== 'DELIVERED' ? ` ${d.lastError}` : ''}{d.status === 'PENDING' && d.attempts > 0 ? ` · ${d.attempts}회 실패, ${relative(d.nextAttemptAt)} 다시 보냄` : ''}</span>
                <span className="text-meta text-faint" title={dateTime(d.createdAt)}>{relative(d.createdAt)}</span>
                {editable && d.status === 'FAILED' && <Button size="sm" icon={<RotateCw className="size-3.5" />} loading={busy === d.id} onClick={() => run(d.id, async () => { await api(`/webhooks/deliveries/${d.id}/retry`, { method: 'POST' }); toast('ok', '다시 보냈습니다'); })}>다시 보내기</Button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {edit && data.data && <EpDrawer ep={edit === 'new' ? null : edit} events={data.data.events} onClose={() => setEdit(null)} onSaved={(s) => { setEdit(null); refresh(); if (s) setSecret(s); else toast('ok', '저장했습니다'); }} />}
      <Dialog open={!!secret} onClose={() => { setSecret(null); setCopied(false); }} title="서명용 비밀키" width={540} footer={<Button variant="primary" onClick={() => { setSecret(null); setCopied(false); }}>보관했습니다</Button>}>
        <p className="mb-3 text-ink-2">받는 쪽에서 서명을 확인할 때 쓰는 비밀키입니다. 이 창을 닫으면 다시 볼 수 없습니다.</p>
        <div className="flex gap-2"><Input readOnly value={secret ?? ''} className="num" onFocus={(e) => e.target.select()} /><Button icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={async () => { await navigator.clipboard.writeText(secret ?? ''); setCopied(true); }}>{copied ? '복사됨' : '복사'}</Button></div>
      </Dialog>
      {node}
    </>
  );
}
