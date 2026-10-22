'use client';

import clsx from 'clsx';
import { useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { Download, Eye, Plus, Search, Store, Trash2 } from 'lucide-react';
import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { Attachments, History } from '@/components/records';
import { Badge, Button, Drawer, EmptyState, Field, Input, PageHeader, Select, Spinner, Tabs, Textarea, useConfirm, useToast } from '@/components/ui';
import { api, ApiError, download, qs } from '@/lib/api';
import { bizNo } from '@/lib/format';
import { BIZ_STATUS, VENDOR_TYPE, type BizStatus, type VendorType } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { VendorDetail, VendorRow } from '@/lib/types';

interface ListResp { total: number; page: number; size: number; rows: VendorRow[] }

/** 사업자등록번호 검증 (화면 즉시 확인용 — 서버가 다시 검증) */
function validBizNo(v: string) {
  const n = v.replace(/\D/g, '');
  if (n.length !== 10) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(n[i]) * w[i];
  s += Math.floor((Number(n[8]) * 5) / 10);
  return (10 - (s % 10)) % 10 === Number(n[9]);
}
function fmtBizInput(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 10);
  return d.length > 5 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d;
}

type Form = Record<'name' | 'bizRegNo' | 'ceoName' | 'address' | 'businessType' | 'businessItem' | 'contactName' | 'contactPhone' | 'email' | 'phone' | 'fax' | 'bankName' | 'bankAccount' | 'bankHolder' | 'paymentTerms' | 'memo', string> & { vendorType: VendorType; bizStatus: BizStatus };
const empty: Form = { name: '', vendorType: 'SUPPLIER', bizRegNo: '', ceoName: '', address: '', businessType: '', businessItem: '', contactName: '', contactPhone: '', email: '', phone: '', fax: '', bankName: '', bankAccount: '', bankHolder: '', paymentTerms: '', bizStatus: 'UNKNOWN', memo: '' };
const fromVendor = (v: VendorDetail): Form => ({
  name: v.name, vendorType: v.vendorType, bizRegNo: v.bizRegNo ? bizNo(v.bizRegNo) : '', ceoName: v.ceoName ?? '', address: v.address ?? '', businessType: v.businessType ?? '', businessItem: v.businessItem ?? '',
  contactName: v.contactName ?? '', contactPhone: v.contactPhone ?? '', email: v.email ?? '', phone: v.phone ?? '', fax: v.fax ?? '', bankName: v.bankName ?? '', bankAccount: '', bankHolder: v.bankHolder ?? '',
  paymentTerms: v.paymentTerms ?? '', bizStatus: v.bizStatus, memo: v.memo ?? '',
});

const BANKS = ['국민은행', '신한은행', '우리은행', '하나은행', '농협은행', '기업은행', 'SC제일은행', '씨티은행', '수협은행', '대구은행', '부산은행', '경남은행', '광주은행', '전북은행', '제주은행', '카카오뱅크', '케이뱅크', '토스뱅크', '새마을금고', '신협', '우체국'];

function VendorEditor({ id, onClose, onSaved }: { id: string | 'new'; onClose: () => void; onSaved: (v: VendorRow) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const { ask, node } = useConfirm();
  const isNew = id === 'new';
  const q = useQuery({ queryKey: ['vendor', company.id, id], queryFn: () => api<VendorDetail>(`/vendors/${id}`), enabled: !isNew });
  const [f, setF] = useState<Form>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [tab, setTab] = useState<'info' | 'files' | 'history'>('info');
  useEffect(() => {
    if (q.data) setF(fromVendor(q.data));
  }, [q.data]);
  const editable = isNew ? can('vendor:create') : can('vendor:update');
  const set = (k: keyof Form, v: string) => {
    setF((o) => ({ ...o, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };
  const bizErr = f.bizRegNo && f.bizRegNo.replace(/\D/g, '').length === 10 && !validBizNo(f.bizRegNo) ? '검증번호가 맞지 않습니다. 번호를 다시 확인해 주세요' : undefined;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return setErrors({ name: '업체명을 입력해 주세요' });
    setBusy(true);
    try {
      const body: Record<string, unknown> = { ...f, bizRegNo: f.bizRegNo || null, bankAccount: f.bankAccount || undefined };
      const v = isNew ? await api<VendorRow>('/vendors', { method: 'POST', json: body }) : await api<VendorRow>(`/vendors/${id}`, { method: 'PUT', json: { ...body, version: q.data!.version } });
      toast('ok', isNew ? `${v.code} 거래처를 등록했습니다` : '변경 내용을 저장했습니다');
      qc.invalidateQueries({ queryKey: ['vendor', company.id, v.id] });
      qc.invalidateQueries({ queryKey: ['history', v.id] });
      onSaved(v);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        toast('error', err.body.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    try {
      const r = await api<{ bankAccount: string | null }>(`/vendors/${id}/reveal-account`, { method: 'POST' });
      setRevealed(r.bankAccount);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '조회하지 못했습니다');
    }
  }

  async function remove() {
    if (!q.data) return;
    if (!(await ask({ title: '거래처를 삭제할까요?', danger: true, confirm: '삭제', body: <><b>{q.data.name}</b>을(를) 목록에서 삭제합니다. 삭제 기록은 감사로그에 남습니다.</> }))) return;
    try {
      await api(`/vendors/${id}?version=${q.data.version}`, { method: 'DELETE' });
      toast('ok', '거래처를 삭제했습니다');
      onSaved(q.data);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '삭제하지 못했습니다');
    }
  }

  const v = q.data;
  const ro = !editable;
  const field = (k: keyof Form, label: string, props: Partial<React.ComponentProps<typeof Input>> = {}, cls?: string) => (
    <Field label={label} error={errors[k]} className={cls} htmlFor={`v-${k}`}>
      <Input id={`v-${k}`} value={f[k]} onChange={(e) => set(k, e.target.value)} readOnly={ro} aria-invalid={!!errors[k]} {...props} />
    </Field>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      width={620}
      title={isNew ? '거래처 등록' : v ? v.name : '불러오는 중'}
      subtitle={v ? <span className="num">{v.code} · {VENDOR_TYPE[v.vendorType]}</span> : isNew ? '거래처코드는 저장할 때 자동으로 붙습니다' : undefined}
      footer={
        tab === 'info' && (
          <>
            {!isNew && can('vendor:delete') && <Button variant="danger" icon={<Trash2 className="size-3.5" />} onClick={remove} className="mr-auto">삭제</Button>}
            <Button onClick={onClose}>{editable ? '취소' : '닫기'}</Button>
            {editable && <Button variant="primary" type="submit" form="vendor-form" loading={busy}>{isNew ? '거래처 등록' : '변경 저장'}</Button>}
          </>
        )
      }
    >
      {node}
      {!isNew && !v ? (
        <div className="py-10 text-center"><Spinner /></div>
      ) : (
        <>
          {!isNew && (
            <div className="-mt-1 mb-4">
              <Tabs value={tab} onChange={setTab} items={[{ value: 'info', label: '기본 정보' }, { value: 'files', label: <>첨부 <span className="num text-faint">{v?.files.length ?? 0}</span></> }, ...(can('audit:read') ? [{ value: 'history' as const, label: '변경 이력' }] : [])]} />
            </div>
          )}
          {tab === 'info' && (
            <form id="vendor-form" onSubmit={save} noValidate className="space-y-5">
              <fieldset className="grid gap-4 sm:grid-cols-2" disabled={ro}>
                {field('name', '업체명', { autoFocus: isNew, required: true }, 'sm:col-span-2')}
                <Field label="거래처 구분">
                  <Select value={f.vendorType} onChange={(e) => set('vendorType', e.target.value)}>
                    {(Object.keys(VENDOR_TYPE) as VendorType[]).map((t) => <option key={t} value={t}>{VENDOR_TYPE[t]}</option>)}
                  </Select>
                </Field>
                <Field label="사업자등록번호" error={errors.bizRegNo || bizErr} hint={f.bizRegNo && validBizNo(f.bizRegNo) ? <span className="text-ok">형식 확인됨</span> : '숫자 10자리'}>
                  <Input value={f.bizRegNo} onChange={(e) => set('bizRegNo', fmtBizInput(e.target.value))} inputMode="numeric" className="num" placeholder="000-00-00000" aria-invalid={!!(errors.bizRegNo || bizErr)} />
                </Field>
                {field('ceoName', '대표자')}
                <Field label="사업자 상태" hint="3단계에서 국세청 상태조회로 자동 확인">
                  <Select value={f.bizStatus} onChange={(e) => set('bizStatus', e.target.value)}>
                    {(Object.keys(BIZ_STATUS) as BizStatus[]).map((t) => <option key={t} value={t}>{BIZ_STATUS[t].label}</option>)}
                  </Select>
                </Field>
                {field('businessType', '업태')}
                {field('businessItem', '종목')}
                {field('address', '주소', {}, 'sm:col-span-2')}
              </fieldset>

              <fieldset className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2" disabled={ro}>
                <h3 className="text-section font-semibold sm:col-span-2">연락처</h3>
                {field('contactName', '담당자')}
                {field('contactPhone', '담당자 연락처', { inputMode: 'tel' })}
                {field('phone', '대표 전화', { inputMode: 'tel' })}
                {field('fax', '팩스', { inputMode: 'tel' })}
                {field('email', '이메일', { type: 'email', inputMode: 'email' }, 'sm:col-span-2')}
              </fieldset>

              <fieldset className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2" disabled={ro}>
                <h3 className="text-section font-semibold sm:col-span-2">대금 지급</h3>
                <Field label="은행">
                  <Input value={f.bankName} onChange={(e) => set('bankName', e.target.value)} list="banks" readOnly={ro} />
                  <datalist id="banks">{BANKS.map((b) => <option key={b} value={b} />)}</datalist>
                </Field>
                {field('bankHolder', '예금주')}
                <Field
                  label="계좌번호"
                  error={errors.bankAccount}
                  className="sm:col-span-2"
                  hint={v?.hasBankAccount ? <>저장된 계좌는 암호화되어 있습니다. 바꿀 때만 새 번호를 입력하세요.</> : '암호화되어 저장되고, 화면에는 가려서 표시됩니다'}
                >
                  {v?.hasBankAccount && (
                    <div className="mb-1.5 flex items-center gap-2 rounded-[4px] bg-surface-2 px-2.5 py-1.5">
                      <span className="num flex-1">{revealed ?? v.bankAccountMask}</span>
                      {!revealed && can('vendor:update') && (
                        <Button type="button" size="sm" variant="ghost" icon={<Eye className="size-3.5" />} onClick={reveal} title="조회 기록이 감사로그에 남습니다">원문 보기</Button>
                      )}
                    </div>
                  )}
                  <Input value={f.bankAccount} onChange={(e) => set('bankAccount', e.target.value.replace(/[^0-9-]/g, ''))} inputMode="numeric" className="num" placeholder={v?.hasBankAccount ? '새 계좌번호 (변경 시에만)' : '숫자와 - 만'} autoComplete="off" readOnly={ro} />
                </Field>
                {field('paymentTerms', '결제조건', { placeholder: '예: 월말 마감 익월 15일' }, 'sm:col-span-2')}
              </fieldset>

              <fieldset className="border-t border-line pt-5" disabled={ro}>
                <Field label="메모"><Textarea value={f.memo} onChange={(e) => set('memo', e.target.value)} rows={3} readOnly={ro} /></Field>
              </fieldset>
            </form>
          )}
          {tab === 'files' && v && (
            <Attachments files={v.files} target={{ vendorId: v.id }} canEdit={can('vendor:update')} categories={['bizreg', 'bankbook', 'contract', 'estimate', 'etc']} onChange={() => qc.invalidateQueries({ queryKey: ['vendor', company.id, id] })} />
          )}
          {tab === 'history' && v && <History resourceId={v.id} />}
        </>
      )}
    </Drawer>
  );
}

function VendorsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const { can, company } = useSession();
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | VendorType>('');
  const [page, setPage] = useState(1);
  const [debounced, setDebounced] = useState('');
  const open = sp.get('open');
  useEffect(() => {
    const t = setTimeout(() => (setDebounced(q), setPage(1)), 250);
    return () => clearTimeout(t);
  }, [q]);
  const params = { q: debounced, vendorType: type, page, size: 50 };
  const list = useQuery({ queryKey: ['vendors', company.id, params], queryFn: () => api<ListResp>(`/vendors${qs(params)}`), placeholderData: keepPreviousData });
  const setOpen = (id: string | null) => router.replace(id ? `/vendors?open=${id}` : '/vendors', { scroll: false });

  const columns = useMemo<ColumnDef<VendorRow>[]>(
    () => [
      { id: 'code', header: '코드', meta: { width: 80 }, cell: ({ row }) => <span className="num text-muted">{row.original.code}</span> },
      { id: 'name', header: '업체명', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
      { id: 'type', header: '구분', meta: { width: 92 }, cell: ({ row }) => <span className="text-ink-2">{VENDOR_TYPE[row.original.vendorType]}</span> },
      { id: 'biz', header: '사업자등록번호', meta: { width: 128 }, cell: ({ row }) => <span className="num">{bizNo(row.original.bizRegNo) || <span className="text-faint">–</span>}</span> },
      { id: 'ceo', header: '대표자', meta: { width: 84, hideBelow: 'lg' }, cell: ({ row }) => row.original.ceoName },
      { id: 'contact', header: '담당자', meta: { hideBelow: 'md' }, cell: ({ row: { original: v } }) => (v.contactName ? <span>{v.contactName} <span className="num text-muted">{v.contactPhone}</span></span> : <span className="text-faint">–</span>) },
      { id: 'bank', header: '계좌', meta: { hideBelow: 'xl' }, cell: ({ row: { original: v } }) => (v.bankAccountMask ? <span className="text-ink-2">{v.bankName} <span className="num">{v.bankAccountMask}</span></span> : <span className="text-faint">–</span>) },
      { id: 'terms', header: '결제조건', meta: { hideBelow: 'xl' }, cell: ({ row }) => <span className="text-ink-2">{row.original.paymentTerms}</span> },
      { id: 'st', header: '사업자 상태', meta: { width: 96 }, cell: ({ row }) => <Badge tone={BIZ_STATUS[row.original.bizStatus].tone}>{BIZ_STATUS[row.original.bizStatus].label}</Badge> },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="거래처"
        description={list.data ? <span className="num">총 {list.data.total.toLocaleString('ko-KR')}곳</span> : ' '}
        actions={
          <>
            {can('vendor:export') && <Button icon={<Download className="size-3.5" />} onClick={() => download(`/vendors/export.xlsx${qs({ q: debounced, vendorType: type })}`, '거래처목록.xlsx').catch((e: ApiError) => toast('error', e.body.message))}>엑셀</Button>}
            {can('vendor:create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen('new')}>거래처 등록</Button>}
          </>
        }
      />
      <div className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <div role="radiogroup" aria-label="구분" className="flex overflow-x-auto rounded-[4px] bg-surface-2 p-0.5">
            {([['', '전체'], ...Object.entries(VENDOR_TYPE)] as [string, string][]).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={type === k} onClick={() => (setType(k as VendorType | ''), setPage(1))} className={clsx('h-7 shrink-0 rounded-[3px] px-2.5 text-meta', type === k ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink')}>{l}</button>
            ))}
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="업체명·코드·담당자·사업자번호" className="pl-8" aria-label="검색" />
          </div>
        </div>
        <DataTable
          columns={columns}
          data={list.data?.rows}
          loading={list.isLoading}
          getRowId={(r) => r.id}
          onRowClick={(r) => setOpen(r.id)}
          rowClassName={(r) => (r.bizStatus === 'CLOSED' ? 'text-muted' : r.id === open ? 'bg-steel-soft' : undefined)}
          page={list.data ? { page: list.data.page, size: list.data.size, total: list.data.total, onPage: setPage } : undefined}
          mobileRow={(v) => (
            <div>
              <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{v.name}</span><Badge tone={BIZ_STATUS[v.bizStatus].tone}>{BIZ_STATUS[v.bizStatus].label}</Badge></div>
              <p className="num mt-1 text-meta text-muted">{v.code} · {VENDOR_TYPE[v.vendorType]} · {bizNo(v.bizRegNo)}</p>
            </div>
          )}
          empty={
            debounced || type ? (
              <EmptyState title="조건에 맞는 거래처가 없습니다" />
            ) : (
              <EmptyState icon={<Store className="size-8" strokeWidth={1.25} />} title="등록된 거래처가 없습니다" description="자재 매입처·협력업체·발주처를 등록하면 발주와 세금계산서에 바로 쓸 수 있습니다." action={can('vendor:create') ? <Button variant="primary" onClick={() => setOpen('new')}>첫 거래처 등록</Button> : undefined} />
            )
          }
        />
      </div>
      {open && (
        <VendorEditor
          key={open}
          id={open}
          onClose={() => setOpen(null)}
          onSaved={(v) => {
            qc.invalidateQueries({ queryKey: ['vendors'] });
            qc.invalidateQueries({ queryKey: ['dashboard'] });
            setOpen(open === 'new' ? v.id : null);
          }}
        />
      )}
    </>
  );
}

export default function VendorsPage() {
  return (
    <Suspense>
      <VendorsInner />
    </Suspense>
  );
}
