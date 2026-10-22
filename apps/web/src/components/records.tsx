'use client';

import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { Download, FileImage, FileSpreadsheet, FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { DragEvent, useRef, useState } from 'react';
import { Button, EmptyState, Select, Spinner, useConfirm, useToast } from '@/components/ui';
import { api, ApiError, download, qs, upload } from '@/lib/api';
import { dateTime, relative } from '@/lib/format';
import { AUDIT_ACTION } from '@/lib/labels';
import type { FileItem } from '@/lib/types';

const CATEGORY: Record<string, string> = { contract: '계약서', drawing: '설계도서', estimate: '견적·내역서', bizreg: '사업자등록증', bankbook: '통장사본', photo: '현장사진', etc: '기타' };
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.docx,.pptx,.hwp,.hwpx,.dwg,.zip';

function size(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
function Icon({ mime }: { mime: string }) {
  const c = 'size-5 shrink-0 text-faint';
  if (mime.startsWith('image/')) return <FileImage className={c} strokeWidth={1.5} />;
  if (mime.includes('sheet') || mime.includes('excel')) return <FileSpreadsheet className={c} strokeWidth={1.5} />;
  return <FileText className={c} strokeWidth={1.5} />;
}

/** 첨부파일 — 끌어 놓기 업로드, 실제 파일 서명 검사는 서버가 한다 */
export function Attachments({ files, target, canEdit, categories, onChange }: { files: FileItem[]; target: { projectId?: string; vendorId?: string }; canEdit: boolean; categories: string[]; onChange: () => void }) {
  const toast = useToast();
  const { ask, node } = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(categories[0]);
  const [busy, setBusy] = useState(0);
  const [over, setOver] = useState(false);

  async function send(list: FileList | File[]) {
    const arr = [...list];
    if (!arr.length) return;
    setBusy(arr.length);
    let ok = 0;
    for (const f of arr) {
      const fd = new FormData();
      fd.append('category', category);
      if (target.projectId) fd.append('projectId', target.projectId);
      if (target.vendorId) fd.append('vendorId', target.vendorId);
      fd.append('file', f);
      try {
        await upload('/files', fd);
        ok++;
      } catch (e) {
        toast('error', `${f.name}: ${e instanceof ApiError ? e.body.message : '올리지 못했습니다'}`);
      }
      setBusy((b) => b - 1);
    }
    if (ok) {
      toast('ok', `${ok}개 파일을 첨부했습니다`);
      onChange();
    }
    if (input.current) input.current.value = '';
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (canEdit) send(e.dataTransfer.files);
  };

  async function remove(f: FileItem) {
    if (!(await ask({ title: '첨부를 해제할까요?', body: <><b>{f.originalName}</b> 파일이 목록에서 빠집니다. 원본은 감사 목적으로 서버에 보존됩니다.</>, confirm: '첨부 해제', danger: true }))) return;
    try {
      await api(`/files/${f.id}`, { method: 'DELETE' });
      toast('ok', '첨부를 해제했습니다');
      onChange();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '처리하지 못했습니다');
    }
  }

  return (
    <div onDragOver={(e) => (e.preventDefault(), canEdit && setOver(true))} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      {node}
      {canEdit && (
        <div className={clsx('mb-3 flex flex-wrap items-center gap-2 rounded-[4px] border border-dashed p-3', over ? 'border-steel bg-steel-soft' : 'border-line-strong')}>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-[140px]" aria-label="파일 종류">
            {categories.map((c) => <option key={c} value={c}>{CATEGORY[c]}</option>)}
          </Select>
          <Button icon={busy ? <Spinner className="size-3.5" /> : <Upload className="size-3.5" />} onClick={() => input.current?.click()} disabled={!!busy}>
            {busy ? `올리는 중 (${busy})` : '파일 선택'}
          </Button>
          <span className="text-meta text-muted">또는 여기에 끌어 놓기 · PDF·이미지·엑셀·한글·DWG, 20MB 이하</span>
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => e.target.files && send(e.target.files)} />
        </div>
      )}
      {files.length ? (
        <ul className="divide-y divide-line rounded-[4px] border border-line">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2">
              <Icon mime={f.mimeType} />
              <div className="min-w-0 flex-1">
                <p className="truncate">{f.originalName}</p>
                <p className="text-meta text-muted">{CATEGORY[f.category] ?? f.category} · {size(f.size)} · {relative(f.createdAt)}</p>
              </div>
              <button type="button" className="grid size-8 place-items-center rounded-[4px] text-muted hover:bg-surface-2 hover:text-ink" aria-label={`${f.originalName} 내려받기`} onClick={() => download(`/files/${f.id}/download`, f.originalName).catch((e: ApiError) => toast('error', e.body.message))}>
                <Download className="size-4" />
              </button>
              {canEdit && (
                <button type="button" className="grid size-8 place-items-center rounded-[4px] text-muted hover:bg-seal-soft hover:text-seal" aria-label={`${f.originalName} 첨부 해제`} onClick={() => remove(f)}>
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Paperclip className="size-6" strokeWidth={1.5} />} title="첨부된 파일이 없습니다" description={canEdit ? '계약서·도면·내역서를 올려 두면 현장 자료를 한곳에서 찾을 수 있습니다.' : undefined} />
      )}
    </div>
  );
}

interface AuditRow { id: number; createdAt: string; userName: string | null; action: string; resource: string; summary: string | null; before: Record<string, unknown> | null; after: Record<string, unknown> | null }

const FIELD: Record<string, string> = {
  name: '이름', status: '상태', tradeType: '공사구분', supplyAmount: '공급가액', vatAmount: '부가세', totalAmount: '계약총액', executionBudget: '실행예산',
  progressRate: '공정률', contractDate: '계약일', startDate: '착공일', plannedEndDate: '준공예정일', actualEndDate: '실제 준공일', clientName: '발주처',
  siteAddress: '현장주소', siteManagerName: '현장소장', managerName: '현장담당자', memo: '메모', contractRole: '도급구분', clientSector: '발주구분',
  bizRegNo: '사업자번호', vendorType: '구분', bankName: '은행', bankAccountMask: '계좌', paymentTerms: '결제조건', bizStatus: '사업자상태', contactName: '담당자',
  contactPhone: '연락처', email: '이메일', ceoName: '대표자', address: '주소', primeContractor: '원도급사', subContractor: '하도급사', contractType: '계약형태',
};
function show(v: unknown) {
  if (v === null || v === undefined || v === '') return '(없음)';
  if (typeof v === 'string' && /^-?\d+\.\d{2}$/.test(v)) return Number(v).toLocaleString('ko-KR');
  return String(v);
}

/** 변경 이력 — 누가 언제 무엇을 바꿨는지 (감사로그) */
export function History({ resourceId }: { resourceId: string }) {
  const q = useQuery({ queryKey: ['history', resourceId], queryFn: () => api<{ rows: AuditRow[] }>(`/audit-logs${qs({ resourceId, size: 100 })}`) });
  if (q.isLoading) return <div className="py-8 text-center"><Spinner /></div>;
  if (!q.data?.rows.length) return <EmptyState title="변경 이력이 없습니다" />;
  return (
    <ol className="relative ml-2 border-l border-line">
      {q.data.rows.map((r) => {
        const keys = r.action === 'UPDATE' && r.after ? Object.keys(r.after).filter((k) => FIELD[k]) : [];
        return (
          <li key={r.id} className="relative pb-4 pl-5">
            <span aria-hidden className={clsx('absolute top-1.5 -left-[5px] size-2.5 rounded-full border-2 border-surface', r.action === 'DELETE' ? 'bg-seal' : r.action === 'CREATE' ? 'bg-ok' : 'bg-steel')} />
            <p><span className="font-medium">{r.userName ?? '시스템'}</span> <span className="text-muted">{AUDIT_ACTION[r.action] ?? r.action}</span></p>
            <p className="text-meta text-faint" title={dateTime(r.createdAt)}>{dateTime(r.createdAt)}</p>
            {keys.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 rounded-[4px] bg-surface-2 px-3 py-2 text-meta">
                {keys.map((k) => (
                  <li key={k} className="flex flex-wrap gap-x-1.5">
                    <span className="text-muted">{FIELD[k]}</span>
                    <span className="num text-faint line-through">{show(r.before?.[k])}</span>
                    <span className="text-faint">→</span>
                    <span className="num text-ink">{show(r.after?.[k])}</span>
                  </li>
                ))}
              </ul>
            )}
            {!keys.length && r.summary && <p className="mt-0.5 text-meta text-ink-2">{r.summary}</p>}
          </li>
        );
      })}
    </ol>
  );
}
