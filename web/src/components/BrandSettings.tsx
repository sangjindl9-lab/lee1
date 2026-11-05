import { useEffect, useState } from 'react';
import { api } from '../api';
import { BrandMark, brandStyle } from './Brand';

// 고객사 브랜드·공개 쇼룸 주소 설정 (관리자)
export default function BrandSettings({ onClose, canEdit }: { onClose: () => void; canEdit: boolean }) {
  const [co, setCo] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/company').then((c) => { setCo(c); setF({ name: c.name, slug: c.slug, ...c.brand }); }); }, []);
  const set = (k: string, v: string) => setF((x: any) => ({ ...x, [k]: v }));
  async function pickLogo(file?: File) {
    if (!file) return;
    if (file.type === 'image/svg+xml') { if (file.size > 280_000) return setErr('SVG 로고는 280KB 이하'); set('logo', await toDataUrl(file)); return; }
    // 큰 이미지는 높이 160px 로 줄여 저장 (공유 화면 머리글용)
    const img = new Image(); img.src = URL.createObjectURL(file); await img.decode();
    const h = Math.min(160, img.height), w = Math.round((img.width * h) / img.height);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    set('logo', c.toDataURL('image/png'));
  }
  async function save() {
    setErr(''); setOk(''); setBusy(true);
    try {
      const { name, slug, ...brand } = f;
      const r = await api('/company', { method: 'PUT', body: { name, slug: slug === co.slug ? undefined : slug, brand } });
      setCo(r); setOk('저장했습니다');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const url = co ? `${location.origin}/c/${f.slug || co.slug}` : '';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-panel" onClick={(e) => e.stopPropagation()} data-testid="brand-dialog">
        <div className="flex items-center border-b border-line px-4 py-3"><h2 className="font-semibold">고객사 브랜드 · 쇼룸 주소</h2><button className="btn btn-ghost ml-auto" onClick={onClose}>✕</button></div>
        {!co ? <div className="p-6 text-mute">불러오는 중…</div> : (
          <div className="grid min-h-0 flex-1 overflow-auto md:grid-cols-[1fr_1fr]">
            <div className="space-y-3 p-4 text-sm">
              <L k="회사명"><input className="input" value={f.name || ''} disabled={!canEdit} onChange={(e) => set('name', e.target.value)} /></L>
              <L k="쇼룸 표시 이름 (선택)"><input className="input" value={f.programName || ''} disabled={!canEdit} placeholder="예: ○○금형 3D 쇼룸" onChange={(e) => set('programName', e.target.value)} /></L>
              <L k="한 줄 소개"><input className="input" value={f.tagline || ''} disabled={!canEdit} placeholder="예: 정밀 사출금형 전문 제조" onChange={(e) => set('tagline', e.target.value)} /></L>
              <div className="grid grid-cols-[auto_1fr] items-end gap-2">
                <L k="대표 색상"><input type="color" className="h-9 w-14 cursor-pointer rounded border border-line bg-transparent" value={f.color || '#f59e0b'} disabled={!canEdit} onChange={(e) => set('color', e.target.value)} data-testid="brand-color" /></L>
                <L k="로고 (PNG·JPG·SVG)"><div className="flex gap-1">
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="input py-1 text-xs" disabled={!canEdit} onChange={(e) => pickLogo(e.target.files?.[0])} />
                  {f.logo && canEdit && <button className="btn" onClick={() => set('logo', '')}>삭제</button>}</div></L>
              </div>
              <L k="회사 소개 (쇼룸 첫 화면)"><textarea className="input h-20 py-2" value={f.intro || ''} disabled={!canEdit} onChange={(e) => set('intro', e.target.value)} /></L>
              <div className="grid grid-cols-2 gap-2">
                <L k="전화"><input className="input" value={f.phone || ''} disabled={!canEdit} onChange={(e) => set('phone', e.target.value)} /></L>
                <L k="이메일"><input className="input" value={f.email || ''} disabled={!canEdit} onChange={(e) => set('email', e.target.value)} /></L>
              </div>
              <L k="홈페이지"><input className="input" value={f.website || ''} disabled={!canEdit} placeholder="https://" onChange={(e) => set('website', e.target.value)} /></L>
              <L k="주소"><input className="input" value={f.address || ''} disabled={!canEdit} onChange={(e) => set('address', e.target.value)} /></L>
            </div>
            <div className="space-y-3 border-t border-line bg-bg p-4 text-sm md:border-l md:border-t-0">
              <L k="고객사 쇼룸 주소">
                <div className="flex items-center gap-1"><span className="shrink-0 text-xs text-mute">/c/</span>
                  <input className="input num" value={f.slug || ''} disabled={!canEdit} onChange={(e) => set('slug', e.target.value.toLowerCase())} data-testid="brand-slug" /></div>
                <div className="text-[11px] text-mute">영문 소문자·숫자·하이픈. 회사의 공개 제품을 한 페이지에 모아 보여 줍니다.</div>
              </L>
              <div className="flex gap-1"><input className="input num h-8 flex-1 text-[11px]" readOnly value={url} onFocus={(e) => e.target.select()} />
                <button className="btn h-8" onClick={() => navigator.clipboard?.writeText(url)}>복사</button><a className="btn h-8" href={`/c/${co.slug}`} target="_blank" rel="noreferrer">열기</a></div>
              <div className="label">미리보기 (공유 화면 머리글)</div>
              <div className="overflow-hidden rounded-lg border border-line" style={brandStyle(f.color)}>
                <div className="flex h-12 items-center gap-3 border-b-2 bg-panel px-3" style={{ borderBottomColor: f.color || undefined }}>
                  <BrandMark brand={f} name={f.name || co.name} /><button className="btn btn-accent ml-auto h-7 text-xs">부품</button></div>
                <div className="grid h-24 place-items-center bg-panel2 text-xs text-mute">3D 제품 화면</div>
              </div>
              {err && <div className="text-xs text-bad">{err}</div>}
              {ok && <div className="text-xs text-ok">{ok}</div>}
              {canEdit ? <button className="btn btn-accent h-9 w-full justify-center" disabled={busy} onClick={save} data-testid="brand-save">{busy ? '저장 중…' : '저장'}</button>
                : <div className="text-xs text-mute">관리자만 수정할 수 있습니다.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
const L = ({ k, children }: { k: string; children: React.ReactNode }) => <label className="block space-y-1"><span className="label">{k}</span>{children}</label>;
const toDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
