import { useEffect, useState } from 'react';
import { BrandMark, brandStyle, Logo } from '../components/Brand';
import { t } from '../i18n';

// 고객사 쇼룸: /c/<쇼룸주소> — 그 회사가 공개한 3D 제품 전체를 한 페이지에서 (로그인 없음)
export default function CompanyShowroom({ slug }: { slug: string }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [cat, setCat] = useState<string>('all');
  useEffect(() => {
    fetch(`/api/public/companies/${encodeURIComponent(slug)}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setD(j); document.title = `${j.brand?.programName || j.name} · 3D 쇼룸`;
    }).catch((e) => setErr(e.message));
  }, [slug]);
  if (err) return <div className="grid h-full place-items-center p-6 text-center"><div><div className="text-lg font-semibold">{err}</div><div className="mt-1 text-sm text-mute">주소를 다시 확인하세요.</div></div></div>;
  if (!d) return <div className="grid h-full place-items-center text-sm text-mute">쇼룸 불러오는 중…</div>;
  const cats = [...new Set(d.items.map((i: any) => i.industry))] as string[];
  const items = d.items.filter((i: any) => cat === 'all' || i.industry === cat);
  const b = d.brand || {};
  return (
    <div className="h-full overflow-y-auto" style={brandStyle(b.color)} data-testid="company-showroom">
      <header className="sticky top-0 z-10 border-b border-line bg-panel/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <BrandMark brand={b} name={d.name} size={30} />
          <div className="ml-auto flex items-center gap-2 text-xs">
            {b.phone && <a className="btn h-8" href={`tel:${b.phone}`}>☎ <span className="hidden sm:inline">{b.phone}</span></a>}
            {b.website && <a className="btn btn-accent h-8" href={b.website} target="_blank" rel="noreferrer">홈페이지</a>}
          </div>
        </div>
      </header>
      <section className="border-b border-line" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 14%, transparent), transparent)' }}>
        <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-accent">3D Digital Showroom</div>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{b.tagline || `${d.name} 제품 3D 쇼룸`}</h1>
          {b.intro && <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm text-mute">{b.intro}</p>}
          <p className="mt-3 text-sm text-mute">제품을 눌러 360° 회전·확대, 분해·조립 애니메이션, 부품 설명을 바로 볼 수 있습니다.</p>
        </div>
      </section>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {cats.length > 1 && <div className="mb-4 flex flex-wrap gap-1.5">
          <button className={`btn h-8 ${cat === 'all' ? 'btn-on' : ''}`} onClick={() => setCat('all')}>전체 {d.items.length}</button>
          {cats.map((c) => <button key={c} className={`btn h-8 ${cat === c ? 'btn-on' : ''}`} onClick={() => setCat(c)}>{t(`industry.${c}` as any)}</button>)}
        </div>}
        {!items.length ? <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-mute">아직 공개된 제품이 없습니다.</div> : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="showroom-items">
            {items.map((i: any) => (
              <a key={i.token} href={`/s/${i.token}`} className="group overflow-hidden rounded-xl border border-line bg-panel transition hover:border-accent" data-testid="showroom-item">
                <div className="relative aspect-[4/3] bg-panel2">
                  {i.thumb ? <img src={i.thumb} alt={i.title} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                    : <div className="grid h-full place-items-center text-mute"><div className="flex flex-col items-center gap-2"><Logo size={36} /><span className="text-xs">{i.locked ? '비밀번호 보호' : '3D 보기'}</span></div></div>}
                  <div className="absolute left-2 top-2 flex gap-1">
                    <span className="chip bg-panel/90">{t(`industry.${i.industry}` as any)}</span>
                    {i.locked && <span className="chip bg-panel/90">🔒</span>}
                  </div>
                  {i.reference && <span className="absolute bottom-2 left-2 rounded border border-ai/60 bg-panel/90 px-1.5 py-0.5 text-[10px] font-semibold text-ai">참고용 AI 3D</span>}
                </div>
                <div className="flex items-center gap-2 p-3">
                  <div className="min-w-0"><div className="truncate font-semibold group-hover:text-accent">{i.title}</div><div className="text-xs text-mute">부품 {i.parts}개</div></div>
                  <span className="ml-auto text-accent">→</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-5 text-xs text-mute">
          <b className="text-ink">{d.name}</b>
          {b.address && <span>{b.address}</span>}{b.phone && <span>☎ {b.phone}</span>}{b.email && <a href={`mailto:${b.email}`}>{b.email}</a>}
          <span className="ml-auto">Powered by EUM 3D SHOWROOM PRO</span>
        </div>
      </footer>
    </div>
  );
}
