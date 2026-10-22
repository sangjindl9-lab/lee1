'use client';

import { Plus, Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { ProjectPicker } from './pickers';
import { Button, Field, IconButton, Input, Textarea } from './ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

interface L { key: string; name: string; spec: string; unit: string; qty: string; memo: string }
let n = 0;
const blank = (): L => ({ key: `r${++n}`, name: '', spec: '', unit: 'EA', qty: '', memo: '' });

export interface RequestInitial { id: string; version: number; projectId: string; title: string; neededBy: string | null; memo: string | null; lines: { name: string; spec: string | null; unit: string; qty: string; memo: string | null }[] }

/** 구매요청 — 현장에서 휴대폰으로도 쉽게 쓰도록 단순한 목록 입력 */
export function RequestForm({ initial, onSaved, onCancel }: { initial?: RequestInitial; onSaved: (id: string) => void; onCancel: () => void }) {
  const { project } = useSession();
  const [projectId, setProjectId] = useState<string | null>(initial?.projectId ?? project?.id ?? null);
  const [h, setH] = useState({ title: initial?.title ?? '', neededBy: initial?.neededBy ?? '', memo: initial?.memo ?? '' });
  const [lines, setLines] = useState<L[]>(initial?.lines.map((l) => ({ key: `r${++n}`, name: l.name, spec: l.spec ?? '', unit: l.unit, qty: l.qty.replace(/\.?0+$/, ''), memo: l.memo ?? '' })) ?? [blank(), blank(), blank()]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, p: Partial<L>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const used = lines.filter((l) => l.name.trim() || l.qty);
    if (!projectId) return setErr('현장을 선택해 주세요');
    if (!h.title.trim()) return setErr('제목을 입력해 주세요');
    if (!used.length) return setErr('필요한 자재를 하나 이상 적어 주세요');
    if (used.some((l) => !l.name.trim() || !(Number(l.qty) > 0))) return setErr('품명과 수량을 모두 입력해 주세요');
    setBusy(true);
    try {
      const body = { projectId, title: h.title, neededBy: h.neededBy || null, memo: h.memo, lines: used.map((l) => ({ name: l.name, spec: l.spec, unit: l.unit || 'EA', qty: l.qty, memo: l.memo })) };
      const r = initial ? await api<{ id: string }>(`/purchase-requests/${initial.id}`, { method: 'PUT', json: { ...body, version: initial.version } }) : await api<{ id: string }>('/purchase-requests', { method: 'POST', json: body });
      onSaved(r.id);
    } catch (x) {
      setErr(x instanceof ApiError ? x.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} noValidate className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="현장" required className="sm:col-span-2"><ProjectPicker value={projectId} onChange={setProjectId} /></Field>
        <Field label="제목" required><Input value={h.title} onChange={(e) => setH({ ...h, title: e.target.value })} placeholder="예: 3층 분전반 교체 자재" /></Field>
        <Field label="필요한 날"><Input type="date" value={h.neededBy} onChange={(e) => setH({ ...h, neededBy: e.target.value })} /></Field>
      </div>
      <div className="rounded-[4px] border border-line">
        <div className="hidden grid-cols-[1.4fr_1fr_70px_90px_1fr_36px] gap-1.5 bg-surface-2 px-2 py-1.5 text-meta text-muted md:grid"><span>품명</span><span>규격</span><span>단위</span><span className="text-right">수량</span><span>비고</span><span /></div>
        <ul className="divide-y divide-line">
          {lines.map((l) => (
            <li key={l.key} className="grid grid-cols-2 gap-1.5 p-2 md:grid-cols-[1.4fr_1fr_70px_90px_1fr_36px]">
              <Input className="col-span-2 md:col-span-1" value={l.name} onChange={(e) => set(l.key, { name: e.target.value })} placeholder="품명" aria-label="품명" />
              <Input value={l.spec} onChange={(e) => set(l.key, { spec: e.target.value })} placeholder="규격" aria-label="규격" />
              <Input value={l.unit} onChange={(e) => set(l.key, { unit: e.target.value })} aria-label="단위" />
              <Input className="num text-right" inputMode="decimal" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="수량" aria-label="수량" />
              <Input value={l.memo} onChange={(e) => set(l.key, { memo: e.target.value })} placeholder="비고" aria-label="비고" />
              <IconButton label="삭제" onClick={() => setLines((ls) => (ls.length === 1 ? [blank()] : ls.filter((x) => x.key !== l.key)))}><Trash2 className="size-4" /></IconButton>
            </li>
          ))}
        </ul>
        <div className="border-t border-line p-2"><Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setLines((ls) => [...ls, blank()])}>줄 추가</Button></div>
      </div>
      <Field label="메모"><Textarea rows={2} value={h.memo} onChange={(e) => setH({ ...h, memo: e.target.value })} placeholder="납품 장소, 급한 정도 등" /></Field>
      {err && <p role="alert" className="rounded-[4px] bg-seal-soft px-3 py-2 text-seal">{err}</p>}
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onCancel}>취소</Button><Button type="submit" variant="primary" loading={busy}>요청 보내기</Button></div>
    </form>
  );
}
