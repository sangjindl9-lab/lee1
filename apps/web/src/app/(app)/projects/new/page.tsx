'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Search } from 'lucide-react';
import { useState } from 'react';
import { ProjectForm, type ProjectFormValues } from '@/components/project-form';
import { Button, Dialog, EmptyState, Field, Input, PageHeader, Spinner, useToast, Won } from '@/components/ui';
import { api, ApiError, qs } from '@/lib/api';
import { previewVat } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { ProjectDetail } from '@/lib/types';

interface G2b { contractNo: string; title: string; contractDate: string | null; institution: string | null; demandInstitution: string | null; supplyAmount: string | null; totalAmount: string | null; startDate: string | null; endDate: string | null; companies: string | null }

function G2bDialog({ onClose, onPick }: { onClose: () => void; onPick: (c: G2b) => void }) {
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const [q, setQ] = useState({ from: today.slice(0, 8) + '01', to: today, keyword: '' });
  const [rows, setRows] = useState<G2b[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function search() {
    setBusy(true);
    setErr(null);
    try {
      setRows(await api<G2b[]>(`/integrations/g2b/contracts${qs({ ...q, keyword: q.keyword || undefined })}`));
    } catch (e) {
      setErr(e instanceof ApiError ? e.body.message : '조회하지 못했습니다');
      setRows(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onClose={onClose} title="나라장터 계약에서 불러오기" width={720} footer={<Button onClick={onClose}>닫기</Button>}>
      <p className="mb-3 text-ink-2">조달청 나라장터의 공사 계약을 찾아 현장 정보를 채웁니다. 불러온 값은 저장 전에 꼭 확인하세요. 한 번에 1개월까지 조회할 수 있습니다.</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => (e.preventDefault(), search())}>
        <Field label="계약일 시작"><Input type="date" value={q.from} onChange={(e) => setQ({ ...q, from: e.target.value })} className="w-[140px]" /></Field>
        <Field label="끝"><Input type="date" value={q.to} onChange={(e) => setQ({ ...q, to: e.target.value })} className="w-[140px]" /></Field>
        <Field label="공사명·기관" className="min-w-[160px] flex-1"><Input value={q.keyword} onChange={(e) => setQ({ ...q, keyword: e.target.value })} placeholder="예: 초등학교" /></Field>
        <Button type="submit" variant="primary" loading={busy} icon={<Search className="size-4" />}>조회</Button>
      </form>
      {err && <p className="mt-3 rounded-[4px] bg-seal-soft px-3 py-2 text-meta text-seal">{err}{/설정|연동/.test(err) && <> — <Link href="/admin/integrations" className="underline">외부 연동 설정</Link></>}</p>}
      {busy && !rows && <div className="mt-6 flex justify-center"><Spinner /></div>}
      {rows && (rows.length === 0 ? <p className="mt-4 text-center text-muted">조건에 맞는 공사 계약이 없습니다</p> : (
        <ul className="mt-4 max-h-[360px] divide-y divide-line overflow-auto rounded-[4px] border border-line">
          {rows.map((r) => (
            <li key={r.contractNo}>
              <button type="button" onClick={() => onPick(r)} className="block w-full px-3 py-2.5 text-left hover:bg-steel-soft/40">
                <span className="flex items-baseline justify-between gap-3"><b className="min-w-0 truncate">{r.title}</b><Won value={r.supplyAmount} className="shrink-0 font-medium" unit /></span>
                <span className="mt-0.5 block text-meta text-muted">{r.demandInstitution ?? r.institution} · 계약 {r.contractDate ?? '–'} · <span className="num">{r.contractNo}</span></span>
              </button>
            </li>
          ))}
        </ul>
      ))}
    </Dialog>
  );
}

export default function NewProjectPage() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { can, setProject } = useSession();
  const [g2b, setG2b] = useState(false);
  const [seed, setSeed] = useState<{ key: string; v: Partial<ProjectFormValues> } | null>(null);
  if (!can('project:create')) return <EmptyState title="현장을 등록할 권한이 없습니다" description="관리자에게 '현장 등록' 권한을 요청하세요." />;
  return (
    <>
      <PageHeader title="현장 등록" actions={<Button icon={<Search className="size-4" />} onClick={() => setG2b(true)}>나라장터에서 불러오기</Button>}>
        <Link href="/projects" className="mb-1 inline-flex items-center gap-0.5 text-meta text-muted hover:text-ink"><ChevronLeft className="size-3.5" />현장 목록</Link>
      </PageHeader>
      {seed && <p className="mb-3 rounded-[4px] border border-steel/40 bg-steel-soft/50 px-3 py-2 text-meta text-steel-ink">나라장터 계약 <span className="num">{seed.key}</span>의 정보를 채웠습니다. 공종·발주처 거래처·담당자를 확인한 뒤 저장하세요.</p>}
      <ProjectForm
        key={seed?.key ?? 'blank'}
        seed={seed?.v}
        submitLabel="현장 등록"
        onCancel={() => router.back()}
        onSubmit={async (body) => {
          const p = await api<ProjectDetail>('/projects', { method: 'POST', json: body });
          await qc.invalidateQueries({ queryKey: ['project-options'] });
          qc.invalidateQueries({ queryKey: ['projects'] });
          qc.invalidateQueries({ queryKey: ['dashboard'] });
          setProject(p.id);
          toast('ok', `${p.code} 현장을 등록했습니다`);
          router.replace(`/projects/${p.id}`);
        }}
      />
      {g2b && (
        <G2bDialog
          onClose={() => setG2b(false)}
          onPick={(c) => {
            const supply = c.supplyAmount ?? (c.totalAmount ? String(Math.round(Number(c.totalAmount) / 1.1)) : '');
            setSeed({
              key: c.contractNo,
              v: {
                name: c.title, clientSector: 'PUBLIC', clientName: c.demandInstitution ?? c.institution ?? '', contractType: '조달청 나라장터',
                contractDate: c.contractDate ?? '', startDate: c.startDate ?? '', plannedEndDate: c.endDate ?? '', supplyAmount: supply, vatAmount: supply ? previewVat(supply) : '',
                memo: `나라장터 계약번호 ${c.contractNo}${c.institution ? ` · 계약기관 ${c.institution}` : ''}${c.companies ? `\n계약업체: ${c.companies}` : ''}`,
              },
            });
            setG2b(false);
          }}
        />
      )}
    </>
  );
}
