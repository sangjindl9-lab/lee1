'use client';

import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, ExternalLink, KeyRound, PlugZap, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRun } from '@/components/doc-ui';
import { Badge, Button, Checkbox, Drawer, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

interface FieldDef { key: string; label: string; secret?: boolean; required?: boolean; help?: string; type?: 'text' | 'textarea' | 'select' | 'checkbox'; options?: { value: string; label: string }[] }
interface ProviderDef { id: string; label: string; description: string; fields: FieldDef[]; testOnly?: boolean; verified: boolean; docs?: string }
interface Config { provider: string; mode: 'TEST' | 'LIVE'; enabled: boolean; settings: Record<string, unknown>; secretKeys: string[]; lastTestAt: string | null; lastTestOk: boolean | null; lastTestMessage: string | null; updatedAt: string | null; isDefault?: boolean }
interface Kind { kind: string; label: string; description: string; providers: ProviderDef[]; config: Config | null }
interface Job { id: string; kind: string; provider: string; mode: string; action: string; status: string; attempts: number; summary: string | null; errorMessage: string | null; startedAt: string; createdByName: string | null }

const JOB_STATUS: Record<string, { label: string; tone: 'ok' | 'seal' | 'warn' | 'outline' }> = { SUCCESS: { label: '성공', tone: 'ok' }, FAILED: { label: '실패', tone: 'seal' }, RUNNING: { label: '진행 중', tone: 'outline' }, WAITING_AUTH: { label: '인증 대기', tone: 'warn' } };

function Editor({ k, onClose }: { k: Kind; onClose: () => void }) {
  const qc = useQueryClient();
  const cur = k.config;
  const [provider, setProvider] = useState(cur?.provider ?? k.providers[0].id);
  const [mode, setMode] = useState<'TEST' | 'LIVE'>(cur?.mode ?? 'TEST');
  const [enabled, setEnabled] = useState(cur?.enabled ?? true);
  const [settings, setSettings] = useState<Record<string, unknown>>(cur?.settings ?? {});
  const [secrets, setSecrets] = useState<Record<string, string | null>>({});
  const p = k.providers.find((x) => x.id === provider)!;
  const sameProvider = cur?.provider === provider;
  const { run, acting } = useRun(['integrations']);
  useEffect(() => {
    if (p.testOnly && k.kind !== 'OCR') setMode('TEST');
  }, [p, k.kind]);
  const save = () => run('save', () => api(`/integrations/${k.kind}`, { method: 'PUT', json: { provider, mode, enabled, settings, secrets } }), '저장했습니다').then((ok) => { if (ok) { qc.invalidateQueries({ queryKey: ['integrations-status'] }); onClose(); } });
  return (
    <Drawer open onClose={onClose} title={k.label} subtitle={k.description} width={560}
      footer={<><Button onClick={onClose}>닫기</Button><Button variant="primary" loading={acting === 'save'} onClick={save}>저장</Button></>}>
      <div className="space-y-4">
        <div role="radiogroup" aria-label="공급업체" className="space-y-1.5">
          {k.providers.map((x) => (
            <label key={x.id} className={clsx('flex cursor-pointer items-start gap-2 rounded-[4px] border px-3 py-2', provider === x.id ? 'border-steel bg-steel-soft/40' : 'border-line hover:bg-surface-hover')}>
              <input type="radio" name="provider" checked={provider === x.id} onChange={() => setProvider(x.id)} className="mt-1 accent-[var(--color-steel)]" />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5 font-medium">{x.label}{x.testOnly && <Badge tone="warn">테스트 전용</Badge>}{!x.verified && <Badge tone="seal">계약 후 검증 필요</Badge>}</span>
                <span className="block text-meta text-muted">{x.description}</span>
                {x.docs && <a href={x.docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-meta text-steel-ink hover:underline">개발자 문서<ExternalLink className="size-3" /></a>}
              </span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="모드">
            <Select value={mode} onChange={(e) => setMode(e.target.value as 'TEST' | 'LIVE')} disabled={!!p.testOnly && k.kind !== 'OCR'}>
              <option value="TEST">테스트</option><option value="LIVE">운영</option>
            </Select>
          </Field>
          <Field label="사용"><div className="flex h-8 items-center"><Checkbox checked={enabled} onChange={setEnabled} label={enabled ? '사용함' : '사용 안 함'} /></div></Field>
        </div>
        {mode === 'LIVE' && k.kind === 'TAX_ISSUE' && <p className="flex items-start gap-2 rounded-[4px] bg-seal-soft px-3 py-2 text-meta text-seal"><ShieldAlert className="mt-0.5 size-4 shrink-0" />운영 모드 발행은 국세청에 실제로 전송되어 법적 효력이 있습니다. 테스트 모드에서 충분히 확인한 뒤 바꾸세요.</p>}
        {p.fields.length > 0 && (
          <div className="space-y-3 border-t border-line pt-4">
            {p.fields.map((fd) => {
              const saved = sameProvider && cur?.secretKeys.includes(fd.key);
              if (fd.secret) return (
                <Field key={fd.key} label={fd.label} required={fd.required} hint={<>{fd.help}{saved && <span className="ml-1 inline-flex items-center gap-0.5 text-ok"><KeyRound className="size-3" />저장됨 — 바꿀 때만 입력</span>}</>}>
                  {fd.type === 'textarea'
                    ? <Textarea rows={3} value={secrets[fd.key] ?? ''} onChange={(e) => setSecrets({ ...secrets, [fd.key]: e.target.value })} placeholder={saved ? '••••••••' : undefined} className="font-mono text-meta" autoComplete="off" />
                    : <Input type="password" value={secrets[fd.key] ?? ''} onChange={(e) => setSecrets({ ...secrets, [fd.key]: e.target.value })} placeholder={saved ? '••••••••' : undefined} autoComplete="new-password" />}
                </Field>
              );
              const v = settings[fd.key];
              return (
                <Field key={fd.key} label={fd.label} required={fd.required} hint={fd.help}>
                  {fd.type === 'select' ? <Select value={String(v ?? '')} onChange={(e) => setSettings({ ...settings, [fd.key]: e.target.value })}><option value="">선택</option>{fd.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
                    : fd.type === 'checkbox' ? <Checkbox checked={!!v} onChange={(c) => setSettings({ ...settings, [fd.key]: c })} label="사용" />
                    : <Input value={String(v ?? '')} onChange={(e) => setSettings({ ...settings, [fd.key]: e.target.value })} />}
                </Field>
              );
            })}
            <p className="text-meta text-faint">비밀값은 암호화(AES-256-GCM)해 저장하며 화면에 다시 보여 주지 않습니다. 변경 내역은 감사로그에 남습니다.</p>
          </div>
        )}
      </div>
    </Drawer>
  );
}

export default function Page() {
  const { can } = useSession();
  const q = useQuery({ queryKey: ['integrations'], queryFn: () => api<Kind[]>('/integrations') });
  const jobs = useQuery({ queryKey: ['integrations', 'jobs'], queryFn: () => api<Job[]>('/integrations/jobs') });
  const [edit, setEdit] = useState<Kind | null>(null);
  const { run, acting } = useRun(['integrations']);
  const toast = useToast();
  if (!can('integration:read')) return <EmptyState title="외부 연동 설정을 볼 권한이 없습니다" />;
  return (
    <>
      <PageHeader title="외부 연동" description="세금계산서 발행·홈택스 수집·휴폐업 조회·문서 인식에 쓸 외부 서비스를 고릅니다. 키가 없어도 엑셀 올리기·직접 입력으로 모든 업무를 할 수 있습니다." />
      {!q.data ? <Skeleton className="h-[360px]" /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {q.data.map((k) => {
            const c = k.config;
            const p = c ? k.providers.find((x) => x.id === c.provider) : null;
            return (
              <section key={k.kind} className="flex flex-col rounded-[6px] border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold">{k.label}</h2>
                    <p className="mt-0.5 text-meta text-muted">{k.description}</p>
                  </div>
                  {c?.enabled ? <Badge tone={c.mode === 'LIVE' ? 'ok' : 'warn'}>{c.mode === 'LIVE' ? '운영' : '테스트'}</Badge> : <Badge tone="muted">미설정</Badge>}
                </div>
                <div className="mt-3 flex-1 text-meta">
                  {c && p ? <p><span className="text-muted">공급업체</span> <b>{p.label}</b>{c.isDefault && <span className="text-faint"> (기본값)</span>}</p> : <p className="text-muted">사용하지 않음 — 엑셀·직접 입력으로 처리</p>}
                  {c?.lastTestAt && <p className={clsx('mt-1 flex items-center gap-1', c.lastTestOk ? 'text-ok' : 'text-seal')}>{c.lastTestOk ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}{dateTime(c.lastTestAt)} 연결 테스트 — {c.lastTestMessage}</p>}
                </div>
                {can('integration:update') && (
                  <div className="mt-3 flex gap-1.5">
                    <Button size="sm" onClick={() => setEdit(k)}>설정</Button>
                    {c && <Button size="sm" icon={<PlugZap className="size-3.5" />} loading={acting === k.kind} onClick={() => run(k.kind, () => api<{ ok: boolean; message: string }>(`/integrations/${k.kind}/test`, { method: 'POST' })).then((res) => { const r = res as { ok: boolean; message: string } | false; if (r && typeof r === 'object') toast(r.ok ? 'ok' : 'error', r.ok ? `연결됨 — ${r.message}` : `연결 실패 — ${r.message}`); })}>연결 테스트</Button>}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
      <section className="mt-6 rounded-[6px] border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-2.5 font-semibold">최근 연동 기록</h2>
        {!jobs.data?.length ? <p className="px-4 py-4 text-meta text-muted">아직 기록이 없습니다.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-body">
              <thead className="bg-surface-2 text-meta text-muted"><tr><th className="px-3 py-1.5 text-left font-medium">시각</th><th className="px-3 py-1.5 text-left font-medium">기능</th><th className="px-3 py-1.5 text-left font-medium">내용</th><th className="px-3 py-1.5 text-left font-medium">상태</th><th className="px-3 py-1.5 text-right font-medium">시도</th></tr></thead>
              <tbody className="divide-y divide-line">
                {jobs.data.map((j) => (
                  <tr key={j.id}>
                    <td className="num px-3 py-1.5 text-meta text-muted">{dateTime(j.startedAt)}</td>
                    <td className="px-3 py-1.5 text-meta">{q.data?.find((k) => k.kind === j.kind)?.label ?? j.kind} · {j.provider}{j.mode === 'TEST' && <span className="text-faint"> (테스트)</span>}</td>
                    <td className="px-3 py-1.5">{j.summary}{j.errorMessage && j.status === 'FAILED' && <span className="block text-meta text-seal">{j.errorMessage}</span>}</td>
                    <td className="px-3 py-1.5"><Badge tone={JOB_STATUS[j.status]?.tone ?? 'outline'}>{JOB_STATUS[j.status]?.label ?? j.status}</Badge></td>
                    <td className="num px-3 py-1.5 text-right">{j.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {edit && <Editor k={edit} onClose={() => setEdit(null)} />}
    </>
  );
}
