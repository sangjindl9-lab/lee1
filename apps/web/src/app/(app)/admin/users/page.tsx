'use client';

import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Copy, KeyRound, Lock, LogOut, Plus, ShieldCheck, Unlock } from 'lucide-react';
import { FormEvent, useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { Badge, Button, Checkbox, Dialog, Drawer, EmptyState, Field, Input, PageHeader, useConfirm, useToast } from '@/components/ui';
import { MemberStampCard } from '@/components/seal-bits';
import { api, ApiError } from '@/lib/api';
import { relative } from '@/lib/format';
import { SCOPE_LABEL, TRADE } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Member {
  membershipId: string; userId: string; loginId: string; name: string; email: string | null; phone: string | null; department: string | null; position: string | null;
  isActive: boolean; status: string; locked: boolean; mfaEnabled: boolean; lastLoginAt: string | null; mustChangePassword: boolean;
  roles: { id: string; name: string; key: string }[]; projects: { id: string; code: string; name: string }[];
}
interface Role { id: string; key: string; name: string; description: string | null; scope: keyof typeof SCOPE_LABEL; isSystem: boolean }

function TempPassword({ value, name, onClose }: { value: string; name: string; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog open onClose={onClose} title="임시 비밀번호" footer={<Button variant="primary" onClick={onClose}>확인했습니다</Button>}>
      <p className="text-ink-2">{name}님에게 아래 임시 비밀번호를 직접 전달하세요. 이 창을 닫으면 다시 볼 수 없습니다. 첫 로그인 때 비밀번호를 바꾸도록 안내됩니다.</p>
      <div className="mt-4 flex items-center gap-2 rounded-[4px] border border-line-strong bg-surface-2 px-3 py-2.5">
        <code className="num flex-1 text-[17px] font-semibold tracking-[0.06em] select-all">{value}</code>
        <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(value).then(() => toast('ok', '복사했습니다'))}>복사</Button>
      </div>
    </Dialog>
  );
}

function UserEditor({ member, roles, onClose, onSaved }: { member: Member | null; roles: Role[]; onClose: () => void; onSaved: (tempPw?: { value: string; name: string }) => void }) {
  const toast = useToast();
  const { projects, me, can } = useSession();
  const isNew = !member;
  const [f, setF] = useState({
    loginId: member?.loginId ?? '', name: member?.name ?? '', email: member?.email ?? '', phone: member?.phone ?? '', department: member?.department ?? '', position: member?.position ?? '',
    isActive: member?.isActive ?? true, roleIds: member?.roles.map((r) => r.id) ?? [], projectIds: member?.projects.map((p) => p.id) ?? [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pq, setPq] = useState('');
  const selectedRoles = roles.filter((r) => f.roleIds.includes(r.id));
  const needsProjects = selectedRoles.length > 0 && selectedRoles.every((r) => r.scope === 'ASSIGNED');
  const toggle = (k: 'roleIds' | 'projectIds', id: string) => setF((o) => ({ ...o, [k]: o[k].includes(id) ? o[k].filter((x) => x !== id) : [...o[k], id] }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const body = { name: f.name, email: f.email || null, phone: f.phone || null, department: f.department || null, position: f.position || null, roleIds: f.roleIds, projectIds: f.projectIds };
      if (isNew) {
        const r = await api<{ tempPassword: string }>('/users', { method: 'POST', json: { ...body, loginId: f.loginId } });
        toast('ok', `${f.name}님을 등록했습니다`);
        onSaved({ value: r.tempPassword, name: f.name });
      } else {
        await api(`/users/${member!.membershipId}`, { method: 'PUT', json: { ...body, isActive: f.isActive } });
        toast('ok', '변경 내용을 저장했습니다');
        onSaved();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        toast('error', err.body.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const self = member?.userId === me.user.id;
  const editable = isNew ? can('user:create') : can('user:update');
  return (
    <Drawer
      open
      onClose={onClose}
      width={600}
      title={isNew ? '사용자 등록' : member!.name}
      subtitle={isNew ? '등록하면 임시 비밀번호가 한 번 표시됩니다' : member!.loginId}
      footer={<><Button onClick={onClose}>취소</Button>{editable && <Button type="submit" form="user-form" variant="primary" loading={busy}>{isNew ? '사용자 등록' : '변경 저장'}</Button>}</>}
    >
      <form id="user-form" onSubmit={save} noValidate className="space-y-5">
        <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
          <Field label="아이디" required error={errors.loginId} hint={isNew ? '영문 소문자·숫자 4~32자, 나중에 바꿀 수 없습니다' : undefined}>
            <Input value={f.loginId} onChange={(e) => setF({ ...f, loginId: e.target.value.toLowerCase() })} disabled={!isNew} autoCapitalize="none" spellCheck={false} autoFocus={isNew} aria-invalid={!!errors.loginId} />
          </Field>
          <Field label="이름" required error={errors.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-invalid={!!errors.name} /></Field>
          <Field label="부서"><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} /></Field>
          <Field label="직급"><Input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /></Field>
          <Field label="이메일" error={errors.email}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="휴대폰"><Input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          {!isNew && (
            <div className="sm:col-span-2">
              <Checkbox checked={f.isActive} disabled={self} onChange={(c) => setF({ ...f, isActive: c })} label={<span>이 회사에서 사용 중 {self && <span className="text-meta text-muted">(본인 계정은 끌 수 없습니다)</span>}</span>} />
            </div>
          )}
        </fieldset>

        <fieldset disabled={!editable} className="border-t border-line pt-5">
          <h3 className="text-section font-semibold">역할</h3>
          <p className="mt-0.5 mb-3 text-meta text-muted">여러 역할을 주면 권한이 합쳐집니다. 본인보다 넓은 권한의 역할은 줄 수 없습니다.</p>
          {errors.roleIds && <p className="mb-2 text-meta text-seal">{errors.roleIds}</p>}
          <div className="grid gap-1.5 sm:grid-cols-2">
            {roles.map((r) => (
              <label key={r.id} className={clsx('flex cursor-pointer gap-2.5 rounded-[4px] border px-3 py-2', f.roleIds.includes(r.id) ? 'border-steel bg-steel-soft' : 'border-line hover:border-line-strong')}>
                <input type="checkbox" className="mt-0.5 size-3.5 accent-[var(--steel)]" checked={f.roleIds.includes(r.id)} onChange={() => toggle('roleIds', r.id)} />
                <span className="min-w-0">
                  <span className="font-medium">{r.name}</span>
                  <span className="block truncate text-meta text-muted">{SCOPE_LABEL[r.scope]} · {r.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset disabled={!editable} className="border-t border-line pt-5">
          <h3 className="text-section font-semibold">담당 현장 <span className="num font-normal text-muted">{f.projectIds.length}</span></h3>
          <p className={clsx('mt-0.5 mb-3 text-meta', needsProjects && !f.projectIds.length ? 'text-warn' : 'text-muted')}>
            {needsProjects ? (f.projectIds.length ? '선택한 현장만 볼 수 있습니다.' : '선택한 역할이 모두 "배정 현장만" 범위라서, 담당 현장을 지정하지 않으면 아무 현장도 보이지 않습니다.') : '회사 전체 범위 역할은 담당 현장과 관계없이 모든 현장을 봅니다.'}
          </p>
          <Input value={pq} onChange={(e) => setPq(e.target.value)} placeholder="현장 찾기" className="mb-2" />
          <ul className="scrollbar-thin max-h-56 divide-y divide-line overflow-y-auto rounded-[4px] border border-line">
            {projects.filter((p) => !pq || p.name.includes(pq) || p.code.includes(pq)).map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-surface-hover">
                  <input type="checkbox" className="size-3.5 accent-[var(--steel)]" checked={f.projectIds.includes(p.id)} onChange={() => toggle('projectIds', p.id)} />
                  <span aria-hidden className="h-3.5 w-1 rounded-[1px]" style={{ background: TRADE[p.tradeType].color }} />
                  <span className="num w-16 text-meta text-muted">{p.code}</span>
                  <span className="truncate">{p.name}</span>
                </label>
              </li>
            ))}
            {!projects.length && <li className="px-3 py-4 text-center text-muted">등록된 현장이 없습니다</li>}
          </ul>
        </fieldset>
      </form>
      {!isNew && <div className="mt-5 border-t border-line pt-5"><MemberStampCard membershipId={member!.membershipId} name={member!.name} editable={can('user:update')} /></div>}
    </Drawer>
  );
}

export default function UsersPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company, me } = useSession();
  const { ask, node } = useConfirm();
  const users = useQuery({ queryKey: ['users', company.id], queryFn: () => api<Member[]>('/users'), enabled: can('user:read') });
  const roles = useQuery({ queryKey: ['roles', company.id], queryFn: () => api<Role[]>('/roles'), enabled: can('role:read') });
  const lic = useQuery({ queryKey: ['license'], queryFn: () => api<{ maxUsers: number; activeUsers: number }>('/license', { noCompany: true }) });
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [temp, setTemp] = useState<{ value: string; name: string } | null>(null);
  const refresh = () => (qc.invalidateQueries({ queryKey: ['users'] }), qc.invalidateQueries({ queryKey: ['license'] }));

  async function act(m: Member, kind: 'reset' | 'unlock' | 'revoke') {
    const text = { reset: ['비밀번호를 초기화할까요?', `${m.name}님의 비밀번호를 임시 비밀번호로 바꾸고 모든 기기에서 로그아웃합니다.`, '초기화'], unlock: ['로그인 잠금을 해제할까요?', `${m.name}님이 바로 다시 로그인할 수 있게 됩니다.`, '잠금 해제'], revoke: ['모든 기기에서 로그아웃할까요?', `${m.name}님의 모든 접속을 끊습니다. 분실한 휴대폰 등에서 접속을 막을 때 사용하세요.`, '로그아웃'] }[kind];
    if (!(await ask({ title: text[0], body: text[1], confirm: text[2], danger: kind !== 'unlock' }))) return;
    try {
      const path = { reset: 'reset-password', unlock: 'unlock', revoke: 'revoke-sessions' }[kind];
      const r = await api<{ tempPassword?: string }>(`/users/${m.membershipId}/${path}`, { method: 'POST' });
      if (r.tempPassword) setTemp({ value: r.tempPassword, name: m.name });
      else toast('ok', '처리했습니다');
      refresh();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '처리하지 못했습니다');
    }
  }

  const columns = useMemo<ColumnDef<Member>[]>(
    () => [
      {
        id: 'name', header: '사용자',
        cell: ({ row: { original: m } }) => (
          <div className="flex items-center gap-2.5">
            <span className={clsx('grid size-7 shrink-0 place-items-center rounded-full text-meta font-semibold', m.isActive ? 'bg-steel-soft text-steel-ink' : 'bg-surface-2 text-faint')}>{m.name.slice(0, 1)}</span>
            <div className="min-w-0">
              <p className={clsx('font-medium', !m.isActive && 'text-muted line-through')}>{m.name}{m.userId === me.user.id && <span className="ml-1 text-meta font-normal text-muted">(나)</span>}</p>
              <p className="text-meta text-muted">{m.loginId}</p>
            </div>
          </div>
        ),
      },
      { id: 'dept', header: '부서·직급', meta: { hideBelow: 'md' }, cell: ({ row: { original: m } }) => <span className="text-ink-2">{[m.department, m.position].filter(Boolean).join(' · ')}</span> },
      { id: 'roles', header: '역할', cell: ({ row }) => <div className="flex flex-wrap gap-1">{row.original.roles.map((r) => <Badge key={r.id} tone={r.key === 'ADMIN' ? 'ink' : 'muted'}>{r.name}</Badge>)}</div> },
      { id: 'projects', header: '담당 현장', meta: { hideBelow: 'lg', align: 'right', width: 88 }, cell: ({ row }) => (row.original.projects.length ? <span title={row.original.projects.map((p) => p.name).join('\n')}>{row.original.projects.length}곳</span> : <span className="text-faint">–</span>) },
      {
        id: 'state', header: '상태', meta: { width: 160 },
        cell: ({ row: { original: m } }) => (
          <div className="flex flex-wrap items-center gap-1">
            {!m.isActive ? <Badge tone="outline">사용 안 함</Badge> : m.locked ? <Badge tone="seal"><Lock className="size-3" />잠김</Badge> : m.mustChangePassword ? <Badge tone="warn">비밀번호 변경 대기</Badge> : <Badge tone="ok">사용 중</Badge>}
            {m.mfaEnabled && <span title="2단계 인증 사용"><ShieldCheck className="size-4 text-ok" aria-label="2단계 인증 사용" /></span>}
          </div>
        ),
      },
      { id: 'last', header: '마지막 로그인', meta: { hideBelow: 'lg', width: 110 }, cell: ({ row }) => <span className="text-muted">{row.original.lastLoginAt ? relative(row.original.lastLoginAt) : '없음'}</span> },
      {
        id: 'actions', header: '', meta: { width: 112, align: 'right' },
        cell: ({ row: { original: m } }) =>
          can('user:update') && m.userId !== me.user.id ? (
            <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
              {m.locked && <button type="button" className="grid size-7 place-items-center rounded-[4px] text-muted hover:bg-surface-2 hover:text-ink" title="잠금 해제" aria-label="잠금 해제" onClick={() => act(m, 'unlock')}><Unlock className="size-4" /></button>}
              <button type="button" className="grid size-7 place-items-center rounded-[4px] text-muted hover:bg-surface-2 hover:text-ink" title="비밀번호 초기화" aria-label="비밀번호 초기화" onClick={() => act(m, 'reset')}><KeyRound className="size-4" /></button>
              <button type="button" className="grid size-7 place-items-center rounded-[4px] text-muted hover:bg-surface-2 hover:text-ink" title="모든 기기에서 로그아웃" aria-label="모든 기기에서 로그아웃" onClick={() => act(m, 'revoke')}><LogOut className="size-4" /></button>
            </div>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, me.user.id],
  );

  if (!can('user:read')) return <EmptyState title="사용자 관리 권한이 없습니다" />;
  const seatsFull = lic.data && lic.data.activeUsers >= lic.data.maxUsers;
  return (
    <>
      {node}
      <PageHeader
        title="사용자"
        description={lic.data ? <span className={clsx('num', seatsFull && 'text-seal')}>라이선스 {lic.data.activeUsers} / {lic.data.maxUsers}명 사용 중</span> : ' '}
        actions={can('user:create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')} disabled={!!seatsFull} title={seatsFull ? '라이선스 사용자 수를 모두 사용 중입니다' : undefined}>사용자 등록</Button>}
      />
      <div className="rounded-[6px] border border-line bg-surface">
        <DataTable columns={columns} data={users.data} loading={users.isLoading} getRowId={(r) => r.membershipId} onRowClick={(m) => setEditing(m)} />
      </div>
      {editing && roles.data && (
        <UserEditor
          member={editing === 'new' ? null : editing}
          roles={roles.data}
          onClose={() => setEditing(null)}
          onSaved={(pw) => {
            setEditing(null);
            refresh();
            if (pw) setTemp(pw);
          }}
        />
      )}
      {temp && <TempPassword value={temp.value} name={temp.name} onClose={() => setTemp(null)} />}
    </>
  );
}
