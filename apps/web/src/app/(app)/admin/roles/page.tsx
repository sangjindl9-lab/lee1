'use client';

import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Button, Dialog, EmptyState, Field, Input, PageHeader, Select, Skeleton, useConfirm, useToast } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { SCOPE_LABEL } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Role { id: string; key: string; name: string; description: string | null; scope: keyof typeof SCOPE_LABEL; isSystem: boolean; permissions: string[]; memberCount: number; version: number }
interface Catalog { actions: { key: string; label: string }[]; resources: { key: string; label: string; group: string; stage: number; live: boolean }[] }

const SCOPE_HINT = {
  COMPANY: '회사의 모든 현장 자료를 봅니다',
  ASSIGNED: '담당으로 지정된 현장 자료만 봅니다',
  CONFIRMED_ONLY: '승인·확정된 자료만 봅니다 (외부 세무사 등)',
};

export default function RolesPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const { ask, node } = useConfirm();
  const roles = useQuery({ queryKey: ['roles', company.id], queryFn: () => api<Role[]>('/roles') });
  const catalog = useQuery({ queryKey: ['role-catalog'], queryFn: () => api<Catalog>('/roles/catalog'), staleTime: Infinity });
  const [selId, setSelId] = useState<string | null>(null);
  const sel = roles.data?.find((r) => r.id === selId) ?? roles.data?.[0];
  const [draft, setDraft] = useState<{ name: string; description: string; scope: Role['scope']; perms: Set<string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const editable = can('role:update');

  useEffect(() => {
    if (sel) setDraft({ name: sel.name, description: sel.description ?? '', scope: sel.scope, perms: new Set(sel.permissions) });
  }, [sel]);

  const groups = useMemo(() => {
    const m = new Map<string, Catalog['resources']>();
    for (const r of catalog.data?.resources ?? []) m.set(r.group, [...(m.get(r.group) ?? []), r]);
    return [...m.entries()];
  }, [catalog.data]);
  const dirty = !!sel && !!draft && (draft.name !== sel.name || (draft.description || '') !== (sel.description || '') || draft.scope !== sel.scope || draft.perms.size !== sel.permissions.length || sel.permissions.some((p) => !draft.perms.has(p)));
  const locked = sel?.key === 'ADMIN';

  const toggle = (p: string) => setDraft((d) => {
    if (!d) return d;
    const n = new Set(d.perms);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    return { ...d, perms: n };
  });
  const toggleRow = (res: string, on: boolean) => setDraft((d) => {
    if (!d || !catalog.data) return d;
    const n = new Set(d.perms);
    for (const a of catalog.data.actions) on ? n.add(`${res}:${a.key}`) : n.delete(`${res}:${a.key}`);
    return { ...d, perms: n };
  });

  async function save() {
    if (!sel || !draft) return;
    setBusy(true);
    try {
      await api(`/roles/${sel.id}`, { method: 'PUT', json: { name: draft.name, description: draft.description, scope: draft.scope, permissions: [...draft.perms], version: sel.version } });
      toast('ok', `'${draft.name}' 역할 권한을 저장했습니다. 해당 사용자에게 바로 적용됩니다`);
      qc.invalidateQueries({ queryKey: ['roles'] });
      qc.invalidateQueries({ queryKey: ['perms'] });
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    try {
      const r = await api<Role>('/roles', { method: 'POST', json: { name: newName, scope: 'ASSIGNED', permissions: ['dashboard:read', 'project:read'] } });
      toast('ok', '역할을 만들었습니다. 필요한 권한을 체크해 주세요');
      setCreating(false);
      setNewName('');
      await qc.invalidateQueries({ queryKey: ['roles'] });
      setSelId(r.id);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '만들지 못했습니다');
    }
  }
  async function remove() {
    if (!sel) return;
    if (!(await ask({ title: '역할을 삭제할까요?', danger: true, confirm: '삭제', body: `'${sel.name}' 역할을 삭제합니다.` }))) return;
    try {
      await api(`/roles/${sel.id}`, { method: 'DELETE' });
      setSelId(null);
      qc.invalidateQueries({ queryKey: ['roles'] });
      toast('ok', '역할을 삭제했습니다');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '삭제하지 못했습니다');
    }
  }

  if (!can('role:read')) return <EmptyState title="역할·권한 관리 권한이 없습니다" />;

  return (
    <>
      {node}
      <PageHeader
        title="역할·권한"
        description="역할마다 메뉴별 조회·등록·수정·삭제·승인·출력·API 권한과 볼 수 있는 자료 범위를 정합니다."
        actions={can('role:create') && <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>역할 추가</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="역할 목록" className="h-fit rounded-[6px] border border-line bg-surface py-1">
          {roles.isLoading && <div className="space-y-2 p-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>}
          {roles.data?.map((r) => (
            <button key={r.id} type="button" onClick={() => setSelId(r.id)} aria-current={sel?.id === r.id} className={clsx('flex w-full items-center gap-2 px-3 py-2 text-left', sel?.id === r.id ? 'bg-steel-soft' : 'hover:bg-surface-hover')}>
              <span className="min-w-0 flex-1">
                <span className={clsx('block truncate', sel?.id === r.id && 'font-medium')}>{r.name}</span>
                <span className="block text-meta text-muted">{SCOPE_LABEL[r.scope]}</span>
              </span>
              <span className="num shrink-0 text-meta text-faint" title="사용자 수">{r.memberCount}명</span>
            </button>
          ))}
        </nav>

        {sel && draft && catalog.data ? (
          <section className="min-w-0 rounded-[6px] border border-line bg-surface">
            <header className="grid gap-3 border-b border-line p-4 md:grid-cols-[1fr_1fr_220px]">
              <Field label="역할 이름"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={!editable} /></Field>
              <Field label="설명"><Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} disabled={!editable} /></Field>
              <Field label="자료 범위" hint={SCOPE_HINT[draft.scope]}>
                <Select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value as Role['scope'] })} disabled={!editable || locked}>
                  {(Object.keys(SCOPE_LABEL) as Role['scope'][]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
                </Select>
              </Field>
            </header>
            {locked && <p className="flex items-center gap-1.5 border-b border-line bg-surface-2 px-4 py-2 text-meta text-muted"><Lock className="size-3.5" />최고관리자 역할의 사용자·권한 관리 권한은 뺄 수 없습니다 (관리 불능 방지).</p>}
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[720px] text-body">
                <thead className="sticky top-0">
                  <tr className="bg-surface-2 text-meta text-muted">
                    <th scope="col" className="px-4 py-2 text-left font-medium">메뉴</th>
                    {catalog.data.actions.map((a) => <th key={a.key} scope="col" className="w-[68px] px-1 py-2 text-center font-medium">{a.label}</th>)}
                    <th scope="col" className="w-[64px] px-2 py-2 text-center font-medium">전체</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([group, items]) => (
                    <Fragment key={group}>
                      <tr><th colSpan={catalog.data!.actions.length + 2} scope="colgroup" className="border-t border-line bg-surface px-4 pt-3 pb-1 text-left text-meta font-semibold text-ink-2">{group}</th></tr>
                      {items.map((r) => {
                        const all = catalog.data!.actions.every((a) => draft.perms.has(`${r.key}:${a.key}`));
                        const some = catalog.data!.actions.some((a) => draft.perms.has(`${r.key}:${a.key}`));
                        return (
                          <tr key={r.key} className="border-t border-line/60 hover:bg-surface-hover">
                            <th scope="row" className="px-4 py-1.5 text-left font-normal">
                              {r.label}
                              {!r.live && <span className="ml-1.5 text-[11px] text-faint">{r.stage}단계</span>}
                            </th>
                            {catalog.data!.actions.map((a) => {
                              const p = `${r.key}:${a.key}`;
                              const on = draft.perms.has(p);
                              return (
                                <td key={a.key} className="px-1 py-1 text-center">
                                  <label className={clsx('mx-auto grid size-7 place-items-center rounded-[4px]', editable ? 'cursor-pointer hover:bg-surface-2' : '')}>
                                    <input type="checkbox" checked={on} disabled={!editable} onChange={() => toggle(p)} className="size-3.5 accent-[var(--steel)]" aria-label={`${r.label} ${a.label}`} />
                                  </label>
                                </td>
                              );
                            })}
                            <td className="px-2 py-1 text-center">
                              <input type="checkbox" checked={all} ref={(el) => { if (el) el.indeterminate = some && !all; }} disabled={!editable} onChange={(e) => toggleRow(r.key, e.target.checked)} className="size-3.5 accent-[var(--steel)]" aria-label={`${r.label} 전체`} />
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {editable && (
              <footer className="sticky bottom-0 flex items-center gap-2 border-t border-line bg-surface px-4 py-3 max-lg:bottom-14">
                {!sel.isSystem && can('role:delete') && <Button variant="danger" icon={<Trash2 className="size-3.5" />} onClick={remove}>역할 삭제</Button>}
                <span className="ml-auto text-meta text-muted">{dirty ? '저장하지 않은 변경이 있습니다' : `${draft.perms.size}개 권한`}</span>
                <Button disabled={!dirty} onClick={() => setDraft({ name: sel.name, description: sel.description ?? '', scope: sel.scope, perms: new Set(sel.permissions) })}>되돌리기</Button>
                <Button variant="primary" disabled={!dirty} loading={busy} onClick={save}>권한 저장</Button>
              </footer>
            )}
          </section>
        ) : (
          <Skeleton className="h-96" />
        )}
      </div>
      <Dialog open={creating} onClose={() => setCreating(false)} title="역할 추가" footer={<><Button onClick={() => setCreating(false)}>취소</Button><Button variant="primary" disabled={!newName.trim()} onClick={create}>만들기</Button></>}>
        <Field label="역할 이름" hint="예: 현장 공무보조"><Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && newName.trim() && create()} /></Field>
      </Dialog>
    </>
  );
}
