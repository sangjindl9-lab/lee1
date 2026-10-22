'use client';

import clsx from 'clsx';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, Download, FileSpreadsheet, PackageOpen, Plus, Search, Trash2, Upload, XCircle } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { DataTable } from '@/components/data-table';
import { Badge, Button, Checkbox, Dialog, Drawer, EmptyState, Field, Input, MoneyInput, PageHeader, Select, Spinner, Textarea, useConfirm, useToast } from '@/components/ui';
import { api, ApiError, download, qs, upload } from '@/lib/api';
import { won } from '@/lib/format';
import { MAT_TRADE, TAX_TYPE } from '@/lib/labels';
import { useSession } from '@/lib/session';
import type { Material } from '@/lib/types';

interface ListResp { total: number; page: number; size: number; categories: string[]; rows: Material[] }
interface ImportResp { dryRun: boolean; summary: { insert: number; update: number; skip: number; error: number }; results: { row: number; action: 'insert' | 'update' | 'skip' | 'error'; name?: string; code?: string | null; message?: string }[] }

const intPrice = (v: string) => (v ?? '0').split('.')[0];

function MaterialEditor({ m, categories, onClose, onSaved }: { m: Material | null; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { can } = useSession();
  const { ask, node } = useConfirm();
  const isNew = !m;
  const [f, setF] = useState({
    code: m?.code ?? '', name: m?.name ?? '', spec: m?.spec ?? '', maker: m?.maker ?? '', unit: m?.unit ?? 'EA', category: m?.category ?? '',
    tradeType: m?.tradeType ?? '', defaultPrice: m ? intPrice(m.defaultPrice) : '', taxType: m?.taxType ?? 'TAXABLE', memo: m?.memo ?? '', isActive: m?.isActive ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const editable = isNew ? can('material:create') : can('material:update');
  const set = (k: keyof typeof f, v: string | boolean) => (setF((o) => ({ ...o, [k]: v })), setErrors((e) => ({ ...e, [k]: '' })));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...f, tradeType: f.tradeType || null, defaultPrice: f.defaultPrice || '0', code: f.code || null };
      if (isNew) await api('/materials', { method: 'POST', json: body });
      else await api(`/materials/${m!.id}`, { method: 'PUT', json: { ...body, version: m!.version } });
      toast('ok', isNew ? '자재를 등록했습니다' : '변경 내용을 저장했습니다');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) (setErrors(err.fieldErrors()), toast('error', err.body.message));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!m || !(await ask({ title: '자재를 삭제할까요?', danger: true, confirm: '삭제', body: <><b>{m.name}</b>을(를) 목록에서 뺍니다. 이미 작성한 발주서의 품목은 그대로 남습니다.</> }))) return;
    try {
      await api(`/materials/${m.id}?version=${m.version}`, { method: 'DELETE' });
      toast('ok', '자재를 삭제했습니다');
      onSaved();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '삭제하지 못했습니다');
    }
  }
  return (
    <Drawer
      open
      onClose={onClose}
      width={560}
      title={isNew ? '자재 등록' : m!.name}
      subtitle={isNew ? '자재코드를 비워 두면 자동으로 붙습니다' : <span className="num">{m!.code}</span>}
      footer={
        <>
          {!isNew && can('material:delete') && <Button variant="danger" className="mr-auto" icon={<Trash2 className="size-3.5" />} onClick={remove}>삭제</Button>}
          <Button onClick={onClose}>{editable ? '취소' : '닫기'}</Button>
          {editable && <Button type="submit" form="material-form" variant="primary" loading={busy}>{isNew ? '자재 등록' : '변경 저장'}</Button>}
        </>
      }
    >
      {node}
      <form id="material-form" onSubmit={save} noValidate>
        <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
          <Field label="자재명" required error={errors.name} className="sm:col-span-2"><Input value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus={isNew} aria-invalid={!!errors.name} /></Field>
          <Field label="규격" error={errors.spec}><Input value={f.spec} onChange={(e) => set('spec', e.target.value)} placeholder="예: 6sq 2C" /></Field>
          <Field label="단위" required error={errors.unit}>
            <Input value={f.unit} onChange={(e) => set('unit', e.target.value)} list="units" />
            <datalist id="units">{['EA', 'm', 'kg', 'box', '롤', '본', '조', '식', '세트', '개', '봉', 'set'].map((u) => <option key={u} value={u} />)}</datalist>
          </Field>
          <Field label="제조사"><Input value={f.maker} onChange={(e) => set('maker', e.target.value)} /></Field>
          <Field label="품목분류">
            <Input value={f.category} onChange={(e) => set('category', e.target.value)} list="cats" placeholder="예: 전선, 배관, 배전반" />
            <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="관련 공종">
            <Select value={f.tradeType} onChange={(e) => set('tradeType', e.target.value)}>
              <option value="">지정 안 함</option>
              {Object.entries(MAT_TRADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="과세구분">
            <Select value={f.taxType} onChange={(e) => set('taxType', e.target.value)}>
              {Object.entries(TAX_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="기본 매입단가" error={errors.defaultPrice} hint="부가세 별도 · 발주서 작성 때 처음 채워지는 값"><MoneyInput value={f.defaultPrice} onChange={(d) => set('defaultPrice', d)} /></Field>
          <Field label="자재코드" error={errors.code} hint={isNew ? '비워 두면 M00001 형식으로 자동' : undefined}><Input value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} className="num" /></Field>
          <Field label="비고" className="sm:col-span-2"><Textarea value={f.memo} onChange={(e) => set('memo', e.target.value)} rows={2} /></Field>
          {!isNew && <div className="sm:col-span-2"><Checkbox checked={f.isActive} onChange={(c) => set('isActive', c)} label="사용 중 (끄면 발주서 자재 검색에 나오지 않습니다)" /></div>}
        </fieldset>
      </form>
      {m && <MaterialPrices id={m.id} />}
    </Drawer>
  );
}

function MaterialPrices({ id }: { id: string }) {
  const { company } = useSession();
  const q = useQuery({ queryKey: ['material', company.id, id], queryFn: () => api<{ vendorPrices: { vendorId: string; vendorName: string; unitPrice: string; lastOrderDate: string | null }[] }>(`/materials/${id}`) });
  const list = q.data?.vendorPrices ?? [];
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h3 className="mb-2 text-section font-semibold">거래처별 최근 매입단가</h3>
      {q.isLoading ? <Spinner /> : list.length ? (
        <table className="w-full text-body">
          <thead><tr className="text-meta text-muted"><th className="py-1 text-left font-medium">거래처</th><th className="py-1 text-right font-medium">단가</th><th className="py-1 text-right font-medium">최근 발주일</th></tr></thead>
          <tbody>{list.map((p) => <tr key={p.vendorId} className="border-t border-line"><td className="py-1.5">{p.vendorName}</td><td className="num py-1.5 text-right">{won(intPrice(p.unitPrice))}</td><td className="num py-1.5 text-right text-muted">{p.lastOrderDate}</td></tr>)}</tbody>
        </table>
      ) : <p className="text-muted">대표이사 승인된 발주서가 생기면 거래처별 단가가 자동으로 쌓입니다.</p>}
    </section>
  );
}

function ImportDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResp | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) (setFile(null), setPreview(null));
  }, [open]);
  async function check(f: File) {
    setFile(f);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      setPreview(await upload<ImportResp>('/materials/import?dryRun=true', fd));
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '파일을 확인하지 못했습니다');
      setFile(null);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await upload<ImportResp>('/materials/import?dryRun=false', fd);
      toast('ok', `자재 ${r.summary.insert}건 등록, ${r.summary.update}건 갱신했습니다`);
      onDone();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  const s = preview?.summary;
  const problems = preview?.results.filter((r) => r.action === 'error' || r.action === 'skip') ?? [];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="자재 엑셀 대량 등록"
      width={620}
      footer={
        <>
          <Button onClick={onClose}>닫기</Button>
          <Button variant="primary" loading={busy && !!preview} disabled={!s || !!s.error || !(s.insert + s.update)} onClick={commit}>
            {s ? `${s.insert + s.update}건 저장` : '저장'}
          </Button>
        </>
      }
    >
      <ol className="mb-4 space-y-1 text-ink-2">
        <li className="flex items-center gap-2"><span className="num grid size-5 place-items-center rounded-full bg-steel-soft text-meta font-semibold text-steel-ink">1</span>양식을 내려받아 자재를 입력합니다. <button type="button" className="text-steel-ink underline underline-offset-2" onClick={() => download('/materials/template.xlsx', '자재등록_양식.xlsx')}>양식 내려받기</button></li>
        <li className="flex items-center gap-2"><span className="num grid size-5 place-items-center rounded-full bg-steel-soft text-meta font-semibold text-steel-ink">2</span>파일을 올리면 저장 전에 행마다 검사 결과를 보여 줍니다.</li>
        <li className="flex items-center gap-2"><span className="num grid size-5 place-items-center rounded-full bg-steel-soft text-meta font-semibold text-steel-ink">3</span>오류가 없으면 저장합니다. 오류가 하나라도 있으면 아무것도 저장하지 않습니다.</li>
      </ol>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => (e.preventDefault(), e.dataTransfer.files[0] && check(e.dataTransfer.files[0]))}
        className="flex w-full items-center gap-3 rounded-[4px] border border-dashed border-line-strong p-4 text-left hover:border-steel hover:bg-steel-soft/40"
      >
        {busy && !preview ? <Spinner /> : <FileSpreadsheet className="size-6 text-faint" strokeWidth={1.5} />}
        <span>{file ? <><b>{file.name}</b> <span className="text-muted">· 다른 파일로 바꾸려면 누르세요</span></> : <>엑셀 파일(.xlsx) 선택 또는 끌어 놓기</>}</span>
      </button>
      <input ref={input} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && check(e.target.files[0])} />
      {s && (
        <>
          <div className="mt-4 grid grid-cols-4 gap-px overflow-hidden rounded-[4px] border border-line bg-line text-center">
            {([['신규', s.insert, 'text-ok'], ['갱신', s.update, 'text-steel-ink'], ['건너뜀', s.skip, 'text-muted'], ['오류', s.error, s.error ? 'text-seal' : 'text-muted']] as const).map(([l, n, c]) => (
              <div key={l} className="bg-surface py-2.5"><p className="text-meta text-muted">{l}</p><p className={clsx('num text-[18px] font-semibold', c)}>{n}</p></div>
            ))}
          </div>
          {problems.length > 0 && (
            <ul className="scrollbar-thin mt-3 max-h-56 divide-y divide-line overflow-y-auto rounded-[4px] border border-line">
              {problems.map((r) => (
                <li key={r.row} className="flex items-start gap-2 px-3 py-1.5">
                  {r.action === 'error' ? <XCircle className="mt-0.5 size-4 shrink-0 text-seal" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-faint" />}
                  <span className="num w-12 shrink-0 text-muted">{r.row}행</span>
                  <span className="min-w-0 flex-1"><span className="font-medium">{r.name || '(이름 없음)'}</span> <span className={r.action === 'error' ? 'text-seal' : 'text-muted'}>{r.message}</span></span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Dialog>
  );
}

export default function MaterialsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { can, company } = useSession();
  const [q, setQ] = useState('');
  const [deb, setDeb] = useState('');
  const [category, setCategory] = useState('');
  const [tradeType, setTradeType] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Material | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => (setDeb(q), setPage(1)), 250);
    return () => clearTimeout(t);
  }, [q]);
  const params = { q: deb, category, tradeType, page, size: 50 };
  const list = useQuery({ queryKey: ['materials', company.id, params], queryFn: () => api<ListResp>(`/materials${qs(params)}`), placeholderData: keepPreviousData });
  const refresh = () => qc.invalidateQueries({ queryKey: ['materials'] });

  const columns = useMemo<ColumnDef<Material>[]>(
    () => [
      { id: 'code', header: '코드', meta: { width: 84 }, cell: ({ row }) => <span className="num whitespace-nowrap text-muted">{row.original.code}</span> },
      { id: 'name', header: '자재명', cell: ({ row: { original: m } }) => <span className={clsx('font-medium', !m.isActive && 'text-muted line-through')}>{m.name}</span> },
      { id: 'spec', header: '규격', cell: ({ row }) => <span className="text-ink-2">{row.original.spec}</span> },
      { id: 'unit', header: '단위', meta: { width: 64, align: 'center' }, cell: ({ row }) => row.original.unit },
      { id: 'maker', header: '제조사', meta: { hideBelow: 'lg' }, cell: ({ row }) => <span className="text-ink-2">{row.original.maker}</span> },
      { id: 'cat', header: '분류', meta: { hideBelow: 'md' }, cell: ({ row }) => row.original.category && <Badge tone="muted">{row.original.category}</Badge> },
      { id: 'trade', header: '공종', meta: { width: 64, hideBelow: 'lg' }, cell: ({ row }) => <span className="text-ink-2">{row.original.tradeType ? MAT_TRADE[row.original.tradeType] : ''}</span> },
      { id: 'tax', header: '과세', meta: { width: 56, hideBelow: 'xl' }, cell: ({ row }) => (row.original.taxType === 'TAXABLE' ? <span className="text-faint">과세</span> : <Badge tone="warn">{TAX_TYPE[row.original.taxType]}</Badge>) },
      { id: 'price', header: '기본단가', meta: { align: 'right', width: 112 }, cell: ({ row }) => won(intPrice(row.original.defaultPrice), { blankZero: true }) },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="자재마스터"
        description={list.data ? <span className="num">총 {list.data.total.toLocaleString('ko-KR')}개 자재</span> : ' '}
        actions={
          <>
            {can('material:export') && <Button icon={<Download className="size-3.5" />} onClick={() => download(`/materials/export.xlsx${qs({ q: deb, category, tradeType })}`, '자재마스터.xlsx').catch((e: ApiError) => toast('error', e.body.message))}>엑셀</Button>}
            {can('material:create') && <Button icon={<Upload className="size-3.5" />} onClick={() => setImporting(true)}>엑셀 대량 등록</Button>}
            {can('material:create') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>자재 등록</Button>}
          </>
        }
      />
      <div className="rounded-[6px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="자재명·규격·코드·제조사" className="pl-8" aria-label="검색" />
          </div>
          <Select value={category} onChange={(e) => (setCategory(e.target.value), setPage(1))} className="w-[140px]" aria-label="분류">
            <option value="">분류 전체</option>
            {list.data?.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={tradeType} onChange={(e) => (setTradeType(e.target.value), setPage(1))} className="w-[110px]" aria-label="공종">
            <option value="">공종 전체</option>
            {Object.entries(MAT_TRADE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <DataTable
          dense
          columns={columns}
          data={list.data?.rows}
          loading={list.isLoading}
          getRowId={(r) => r.id}
          onRowClick={(m) => setEditing(m)}
          page={list.data ? { page, size: 50, total: list.data.total, onPage: setPage } : undefined}
          mobileRow={(m) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="truncate font-medium">{m.name}</p><p className="truncate text-meta text-muted">{m.code} · {m.spec} · {m.unit}</p></div>
              <span className="num shrink-0">{won(intPrice(m.defaultPrice), { blankZero: true })}</span>
            </div>
          )}
          empty={
            deb || category || tradeType ? <EmptyState title="조건에 맞는 자재가 없습니다" /> : (
              <EmptyState
                icon={<PackageOpen className="size-8" strokeWidth={1.25} />}
                title="등록된 자재가 없습니다"
                description="자주 쓰는 자재를 등록해 두면 발주서 작성 때 검색으로 바로 넣을 수 있습니다. 엑셀로 한꺼번에 올릴 수도 있습니다."
                action={can('material:create') ? <div className="flex gap-2"><Button onClick={() => setImporting(true)} icon={<Upload className="size-3.5" />}>엑셀 대량 등록</Button><Button variant="primary" onClick={() => setEditing('new')}>자재 등록</Button></div> : undefined}
              />
            )
          }
        />
      </div>
      {editing && <MaterialEditor key={editing === 'new' ? 'new' : editing.id} m={editing === 'new' ? null : editing} categories={list.data?.categories ?? []} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), refresh())} />}
      <ImportDialog open={importing} onClose={() => setImporting(false)} onDone={() => (setImporting(false), refresh())} />
    </>
  );
}
