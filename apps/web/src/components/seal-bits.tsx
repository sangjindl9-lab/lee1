'use client';

/**
 * 도장 — 등록 카드(회사 직인·대표자 도장·개인 도장)와 문서 끝 서명란
 * 사진이나 스캔 파일을 올리면 흰 배경을 지우고 여백을 잘라 PNG 로 만든 뒤 저장한다.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import clsx from 'clsx';
import { Button, Checkbox, useToast } from './ui';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

export interface SealMeta { id: string; url: string; updatedAt: string; width: number | null; height: number | null }
export interface CompanySeals { company: SealMeta | null; ceo: SealMeta | null }

export function useCompanySeals(enabled = true) {
  const { company } = useSession();
  return useQuery({ queryKey: ['seals', 'company', company.id], queryFn: () => api<CompanySeals>('/seals/company'), enabled, staleTime: 5 * 60_000 });
}

/* ─────────────── 이미지 다듬기 ─────────────── */
const MAX_SIDE = 400;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => (URL.revokeObjectURL(url), res(img));
    img.onerror = () => (URL.revokeObjectURL(url), rej(new Error('이미지를 읽지 못했습니다')));
    img.src = url;
  });
}

/** 흰 배경 → 투명, 여백 잘라내기, 최대 400px PNG */
export async function prepareSeal(file: File, removeWhite: boolean): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) throw new Error('PNG·JPG 이미지 파일을 올려 주세요');
  if (file.size > 15 * 1024 * 1024) throw new Error('15MB 이하 이미지를 올려 주세요');
  const img = await loadImage(file);
  // 원본을 먼저 적당한 크기로 줄여서 처리
  const scale0 = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
  const w0 = Math.max(1, Math.round(img.naturalWidth * scale0));
  const h0 = Math.max(1, Math.round(img.naturalHeight * scale0));
  const c0 = document.createElement('canvas');
  c0.width = w0;
  c0.height = h0;
  const g0 = c0.getContext('2d', { willReadFrequently: true })!;
  g0.drawImage(img, 0, 0, w0, h0);
  const data = g0.getImageData(0, 0, w0, h0);
  const px = data.data;
  if (removeWhite) {
    for (let i = 0; i < px.length; i += 4) {
      const min = Math.min(px[i], px[i + 1], px[i + 2]);
      // 밝은 회색·흰색은 지우고, 경계는 부드럽게
      if (min >= 228) px[i + 3] = 0;
      else if (min > 190) px[i + 3] = Math.round(px[i + 3] * ((228 - min) / 38));
    }
    g0.putImageData(data, 0, 0);
  }
  // 여백 잘라내기
  let x1 = w0, y1 = h0, x2 = -1, y2 = -1;
  for (let y = 0; y < h0; y++) {
    for (let x = 0; x < w0; x++) {
      if (px[(y * w0 + x) * 4 + 3] > 24) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  if (x2 < 0) throw new Error('도장 모양을 찾지 못했습니다. 흰 종이에 찍은 도장을 밝게 찍어 올려 주세요');
  const pad = 4;
  x1 = Math.max(0, x1 - pad);
  y1 = Math.max(0, y1 - pad);
  x2 = Math.min(w0 - 1, x2 + pad);
  y2 = Math.min(h0 - 1, y2 + pad);
  const cw = x2 - x1 + 1;
  const ch = y2 - y1 + 1;
  if (cw < 16 || ch < 16) throw new Error('도장이 너무 작게 찍혔습니다. 더 가까이에서 찍어 주세요');
  let side = MAX_SIDE;
  for (let tries = 0; tries < 4; tries++) {
    const s = Math.min(1, side / Math.max(cw, ch));
    const c = document.createElement('canvas');
    c.width = Math.max(16, Math.round(cw * s));
    c.height = Math.max(16, Math.round(ch * s));
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(c0, x1, y1, cw, ch, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/png');
    if (url.length * 0.75 < 380 * 1024) return url;
    side = Math.round(side * 0.75);
  }
  throw new Error('이미지가 너무 복잡합니다. 도장 부분만 잘라서 올려 주세요');
}

/* ─────────────── 등록 카드 ─────────────── */
const CHECKER = { backgroundImage: 'conic-gradient(var(--surface-2) 25%, transparent 0 50%, var(--surface-2) 0 75%, transparent 0)', backgroundSize: '16px 16px' };

export function SealCard({ title, hint, current, editable, onSave, onRemove }: {
  title: string;
  hint: string;
  current: SealMeta | null | undefined;
  editable: boolean;
  onSave: (dataUrl: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeWhite, setRemoveWhite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  async function pick(f: File | null | undefined, rw = removeWhite) {
    if (!f) return;
    try {
      setFile(f);
      setPreview(await prepareSeal(f, rw));
    } catch (e) {
      setFile(null);
      setPreview(null);
      toast('error', e instanceof Error ? e.message : '이미지를 처리하지 못했습니다');
    }
  }
  async function save() {
    if (!preview) return;
    setBusy(true);
    try {
      await onSave(preview);
      toast('ok', `${title}을 저장했습니다`);
      setFile(null);
      setPreview(null);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await onRemove();
      toast('ok', `${title}을 삭제했습니다`);
      setConfirmDel(false);
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '삭제하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? current?.url ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[6px] border border-line bg-surface p-4">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-meta text-muted">{hint}</p>
      </div>
      <div
        className={clsx('grid h-36 place-items-center rounded-[4px] border border-dashed border-line-strong', editable && 'cursor-pointer')}
        style={CHECKER}
        onClick={() => editable && !preview && input.current?.click()}
        onDragOver={(e) => editable && e.preventDefault()}
        onDrop={(e) => {
          if (!editable) return;
          e.preventDefault();
          pick(e.dataTransfer.files?.[0]);
        }}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={`${title} 미리보기`} className="max-h-28 max-w-[80%] object-contain" draggable={false} />
        ) : (
          <span className="flex flex-col items-center gap-1 text-meta text-faint">
            <ImageUp className="size-5" />
            {editable ? '여기를 눌러 도장 사진을 올리세요' : '등록된 도장이 없습니다'}
          </span>
        )}
      </div>
      {preview && <p className="text-meta text-steel-ink">미리보기입니다. 저장을 눌러야 적용됩니다.</p>}
      {!preview && current && <p className="num text-meta text-muted">등록 {new Date(current.updatedAt).toLocaleDateString('ko-KR')}</p>}
      {editable && (
        <>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
          {preview ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Checkbox checked={removeWhite} onChange={(v) => (setRemoveWhite(v), pick(file, v))} label="흰 배경 지우기" />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => (setFile(null), setPreview(null))} disabled={busy}>취소</Button>
                <Button size="sm" variant="primary" loading={busy} onClick={save}>저장</Button>
              </div>
            </div>
          ) : confirmDel ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] bg-seal-soft px-3 py-2">
              <span className="text-meta text-seal">삭제하면 앞으로 출력하는 문서에 찍히지 않습니다.</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setConfirmDel(false)} disabled={busy}>취소</Button>
                <Button size="sm" variant="danger" loading={busy} onClick={remove}>삭제</Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              {current && <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDel(true)}>삭제</Button>}
              <Button size="sm" icon={<ImageUp className="size-3.5" />} onClick={() => input.current?.click()}>{current ? '바꾸기' : '이미지 올리기'}</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 관리 > 회사 정보 아래: 회사 직인·대표자 도장 */
export function CompanySealsPanel() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useCompanySeals();
  const editable = can('company:update');
  const refresh = () => qc.invalidateQueries({ queryKey: ['seals'] });
  const kinds = [
    { k: 'company', title: '회사 직인', hint: '법인 인감·사용인감 등 회사 도장. 결재가 끝난 발주서·기성청구서의 회사명 옆에 찍힙니다.', cur: q.data?.company },
    { k: 'ceo', title: '대표자 도장', hint: '대표이사 개인 도장. 결재가 끝난 문서의 "대표이사 ○○○ (인)" 자리에 찍힙니다.', cur: q.data?.ceo },
  ] as const;
  return (
    <section className="mt-6 max-w-3xl">
      <h2 className="text-section font-semibold">도장</h2>
      <p className="mt-1 text-meta text-muted">흰 종이에 찍은 도장을 사진이나 스캔으로 올리면 배경을 지워 저장합니다. 결재 전 문서에는 찍히지 않습니다.</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {kinds.map((s) => (
          <SealCard
            key={s.k}
            title={s.title}
            hint={s.hint}
            current={s.cur}
            editable={editable}
            onSave={async (image) => (await api(`/seals/company/${s.k}`, { method: 'PUT', json: { image } }), refresh())}
            onRemove={async () => (await api(`/seals/company/${s.k}`, { method: 'DELETE' }), refresh())}
          />
        ))}
      </div>
    </section>
  );
}

/** 내 계정: 개인 도장 */
export function MyStampCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['seals', 'me'], queryFn: () => api<{ stamp: SealMeta | null }>('/seals/me', { noCompany: true }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['seals', 'me'] });
  return (
    <SealCard
      title="내 도장"
      hint="결재란의 내 칸에 이름 도장 대신 찍힙니다. 바꿔도 이미 결재한 문서에는 그때 도장이 그대로 남습니다."
      current={q.data?.stamp}
      editable
      onSave={async (image) => (await api('/seals/me', { method: 'PUT', json: { image }, noCompany: true }), refresh())}
      onRemove={async () => (await api('/seals/me', { method: 'DELETE', noCompany: true }), refresh())}
    />
  );
}

/** 관리 > 사용자 편집: 다른 직원 도장 */
export function MemberStampCard({ membershipId, name, editable }: { membershipId: string; name: string; editable: boolean }) {
  const qc = useQueryClient();
  const { company } = useSession();
  const key = ['seals', 'member', company.id, membershipId];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ stamp: SealMeta | null }>(`/seals/members/${membershipId}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  return (
    <SealCard
      title={`${name} 님 도장`}
      hint="결재란에 이름 도장 대신 찍힙니다. 본인도 내 계정에서 등록할 수 있습니다."
      current={q.data?.stamp}
      editable={editable}
      onSave={async (image) => (await api(`/seals/members/${membershipId}`, { method: 'PUT', json: { image } }), refresh())}
      onRemove={async () => (await api(`/seals/members/${membershipId}`, { method: 'DELETE' }), refresh())}
    />
  );
}

/** 화면용 문서 끝: 회사명 / 대표이사 ○○○ (인) + 결재가 끝났으면 직인·대표자 도장 */
export function CompanySignature({ name, ceoName, stamped }: { name: string; ceoName: string | null; stamped: boolean }) {
  const q = useCompanySeals(stamped);
  const seals = stamped ? q.data : undefined;
  return (
    <div className="mt-2 inline-flex items-center gap-2">
      <div>
        <p className="text-[14px] font-bold">{name}</p>
        <p className="mt-0.5">
          대표이사 {ceoName}{' '}
          <span className="relative inline-block">
            (인)
            {seals?.ceo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={seals.ceo.url} alt="대표자 도장" className="pointer-events-none absolute top-1/2 left-1/2 size-11 max-w-none -translate-x-1/2 -translate-y-1/2 object-contain" />
            )}
          </span>
        </p>
      </div>
      {seals?.company && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={seals.company.url} alt="회사 직인" className="pointer-events-none size-14 object-contain" />
      )}
    </div>
  );
}
