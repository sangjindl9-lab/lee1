'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ReasonDialog } from '@/components/doc-ui';
import { Badge, Button, Checkbox, Dialog, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { dateTime, relative } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Key { id: string; name: string; keyPrefix: string; scopes: string[]; allowedIps: string[] | null; expiresAt: string | null; lastUsedAt: string | null; lastUsedIp: string | null; revokedAt: string | null; revokedReason: string | null; createdAt: string; userName: string }
interface Scope { value: string; resource: string; action: string; label?: string }
const ACTION = { read: '조회', create: '등록', update: '수정', export: '내보내기' } as Record<string, string>;

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const scopes = useQuery({ queryKey: ['apikey-scopes'], queryFn: () => api<Scope[]>('/api-keys/scopes') });
  const [f, setF] = useState({ name: '', expires: '365', ips: '' });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const byRes = useMemo(() => {
    const m = new Map<string, Scope[]>();
    const order = ['read', 'create', 'update', 'export'];
    for (const s of scopes.data ?? []) m.set(s.resource, [...(m.get(s.resource) ?? []), s]);
    return [...m.entries()].map(([r, l]) => [r, l.sort((a, b) => order.indexOf(a.action) - order.indexOf(b.action))] as const).sort((a, b) => (a[1][0].label ?? a[0]).localeCompare(b[1][0].label ?? b[0], 'ko'));
  }, [scopes.data]);
  const toggle = (v: string) => setSel((s) => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n; });
  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ key: string }>('/api-keys', { method: 'POST', json: { name: f.name, scopes: [...sel], expiresInDays: f.expires ? Number(f.expires) : null, allowedIps: f.ips.split(/[\s,]+/).filter(Boolean) } });
      onCreated(r.key);
    } catch (e) {
      setErr(e instanceof ApiError ? e.body.message : '발급하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="API 키 발급" width={680} footer={<><Button onClick={onClose}>취소</Button><Button variant="primary" loading={busy} disabled={!f.name.trim() || !sel.size} onClick={save}>발급</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="키 이름" required hint="어디에 쓰는 키인지 (예: 그룹웨어 연동)"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="유효기간"><Select value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })}><option value="30">30일</option><option value="90">90일</option><option value="365">1년</option><option value="730">2년</option><option value="">만료 없음 (권장하지 않음)</option></Select></Field>
        <Field label="허용 IP" hint="비우면 모든 IP. 쉼표·줄바꿈으로 여러 개" className="sm:col-span-2"><Textarea rows={2} value={f.ips} onChange={(e) => setF({ ...f, ips: e.target.value })} placeholder="예: 203.0.113.10" /></Field>
      </div>
      <h3 className="mt-4 mb-1 text-meta font-semibold text-ink-2">허용할 기능</h3>
      <p className="mb-2 text-meta text-muted">내 권한 안에서만 고를 수 있습니다. 사용자·역할·연동·API 키 같은 관리 기능은 키로 쓸 수 없습니다. 발급한 사람의 권한이 줄면 키 권한도 함께 줄어듭니다.</p>
      {!scopes.data ? <Skeleton className="h-40" /> : (
        <div className="max-h-[300px] overflow-auto rounded-[4px] border border-line">
          <table className="w-full text-meta">
            <tbody className="divide-y divide-line">
              {byRes.map(([res, list]) => (
                <tr key={res}>
                  <th scope="row" className="w-[140px] bg-surface-2 px-3 py-1.5 text-left font-medium">{list[0].label ?? res}</th>
                  <td className="px-3 py-1"><span className="flex flex-wrap gap-x-4">{list.map((s) => <Checkbox key={s.value} checked={sel.has(s.value)} onChange={() => toggle(s.value)} label={ACTION[s.action] ?? s.action} />)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && <p className="mt-3 text-meta text-seal">{err}</p>}
    </Dialog>
  );
}

export default function Page() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can, company } = useSession();
  const keys = useQuery({ queryKey: ['api-keys', company.id], queryFn: () => api<Key[]>('/api-keys'), enabled: can('apikey:read') });
  // API 문서는 서버 설정(SWAGGER_ENABLED)으로 켤 때만 있다
  const docsOn = useQuery({ queryKey: ['api-docs-on'], queryFn: () => fetch('/api/docs/openapi.json', { method: 'HEAD' }).then((r) => r.ok).catch(() => false), staleTime: Infinity }).data;
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoke, setRevoke] = useState<Key | null>(null);
  if (!can('apikey:read')) return <EmptyState title="API 키를 볼 권한이 없습니다" />;
  return (
    <>
      <PageHeader title="API 키" description="외부 프로그램(그룹웨어·BI·자체 시스템)이 SS-ERP 자료를 읽고 쓰도록 키를 발급합니다. 키 원문은 발급할 때 한 번만 보입니다."
        actions={<>
          {docsOn && <a href="/api/docs" target="_blank" rel="noopener noreferrer"><Button>API 문서</Button></a>}
          {can('apikey:create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>키 발급</Button>}
        </>} />
      <div className="mb-4 rounded-[6px] border border-line bg-surface px-4 py-3 text-meta text-ink-2">
        <p>요청 헤더에 <code className="num rounded-[3px] bg-surface-2 px-1">Authorization: Bearer ssk_…</code> 를 넣습니다. 상태를 바꾸는 <b>POST</b> 요청에는 요청마다 고유한 <code className="num rounded-[3px] bg-surface-2 px-1">Idempotency-Key</code> 헤더가 필요합니다 — 네트워크 오류로 다시 보내도 한 번만 처리됩니다.</p>
        <p className="mt-1 text-muted">키로 한 모든 작업은 발급한 사용자 이름으로 감사로그에 남습니다. 업무 이벤트를 받으려면 <Link href="/admin/webhooks" className="text-steel-ink underline">웹훅</Link>을 등록하세요.</p>
      </div>
      {!keys.data ? <Skeleton className="h-40" /> : !keys.data.length ? (
        <EmptyState icon={<KeyRound className="size-6" />} title="발급한 API 키가 없습니다" description="외부 프로그램과 연동할 때 키를 발급하세요." />
      ) : (
        <div className="overflow-x-auto rounded-[6px] border border-line bg-surface">
          <table className="w-full min-w-[860px]">
            <thead className="bg-surface-2 text-meta text-muted"><tr><th className="px-3 py-2 text-left font-medium">이름 · 키</th><th className="px-3 py-2 text-left font-medium">허용 기능</th><th className="px-3 py-2 text-left font-medium">발급</th><th className="px-3 py-2 text-left font-medium">마지막 사용</th><th className="px-3 py-2 text-left font-medium">만료</th><th className="px-3 py-2" /></tr></thead>
            <tbody className="divide-y divide-line">
              {keys.data.map((k) => {
                const expired = !!k.expiresAt && new Date(k.expiresAt) < new Date();
                const dead = !!k.revokedAt || expired;
                return (
                  <tr key={k.id} className={clsx(dead && 'text-muted')}>
                    <td className="px-3 py-2"><b className={clsx('font-medium', dead && 'line-through decoration-faint')}>{k.name}</b><span className="num block text-meta text-muted">{k.keyPrefix}…</span></td>
                    <td className="max-w-[280px] px-3 py-2 text-meta"><span className="line-clamp-2">{k.scopes.join(', ')}</span>{k.allowedIps && <span className="block text-faint">IP {k.allowedIps.join(', ')}</span>}</td>
                    <td className="px-3 py-2 text-meta">{k.userName}<span className="block text-muted">{dateTime(k.createdAt)}</span></td>
                    <td className="px-3 py-2 text-meta">{k.lastUsedAt ? <>{relative(k.lastUsedAt)}<span className="num block text-muted">{k.lastUsedIp}</span></> : <span className="text-faint">사용 안 함</span>}</td>
                    <td className="px-3 py-2 text-meta">{k.revokedAt ? <Badge tone="outline">폐기됨</Badge> : expired ? <Badge tone="warn">만료</Badge> : k.expiresAt ? dateTime(k.expiresAt).slice(0, 10) : '없음'}{k.revokedReason && <span className="block text-faint">{k.revokedReason}</span>}</td>
                    <td className="px-3 py-2 text-right">{!k.revokedAt && can('apikey:delete') && <Button size="sm" variant="danger" onClick={() => setRevoke(k)}>폐기</Button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && <CreateDialog onClose={() => setOpen(false)} onCreated={(k) => { setOpen(false); setShown(k); qc.invalidateQueries({ queryKey: ['api-keys'] }); }} />}
      <Dialog open={!!shown} onClose={() => { setShown(null); setCopied(false); }} title="API 키가 발급되었습니다" width={560} footer={<Button variant="primary" onClick={() => { setShown(null); setCopied(false); }}>안전하게 보관했습니다</Button>}>
        <p className="mb-3 text-ink-2">이 창을 닫으면 키 원문을 다시 볼 수 없습니다. 지금 복사해 연동할 프로그램의 비밀 설정에 넣으세요. 잃어버리면 폐기하고 새로 발급합니다.</p>
        <div className="flex gap-2">
          <Input readOnly value={shown ?? ''} className="num" onFocus={(e) => e.target.select()} />
          <Button icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={async () => { await navigator.clipboard.writeText(shown ?? ''); setCopied(true); }}>{copied ? '복사됨' : '복사'}</Button>
        </div>
      </Dialog>
      <ReasonDialog open={!!revoke} title={`'${revoke?.name}' 키 폐기`} body="폐기하면 이 키로 오는 요청이 바로 거부됩니다. 되돌릴 수 없습니다." confirm="폐기" danger onClose={() => setRevoke(null)}
        onConfirm={async (reason) => { await api(`/api-keys/${revoke!.id}`, { method: 'DELETE', json: { reason } }); toast('ok', '키를 폐기했습니다'); setRevoke(null); qc.invalidateQueries({ queryKey: ['api-keys'] }); }} />
    </>
  );
}
