import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { TopBar } from '../TopBar.jsx';
import { api, fmtD, nightsBetween, won, man, photo } from '../lib.js';
import { useApp, Icon, P, Star, CATS, Calendar, Stepper, useNarrow, Loading, ErrorBox } from '../ui.jsx';

export function Card({ l, onLike, hl, onHover }) {
  return (
    <article className={'card' + (hl ? ' hl' : '')} onMouseEnter={() => onHover?.(l.id)} onMouseLeave={() => onHover?.(null)}>
      <Link to={`/rooms/${l.id}`} className="thumb" aria-label={l.title}>
        {l.cover ? <img src={photo(l.cover, true)} alt="" loading="lazy" /> : <span className="noimg">사진 없음</span>}
        {l.instant_book && <span className="badge">즉시 예약</span>}
      </Link>
      {onLike && (
        <button type="button" className={'heart' + (l.liked ? ' on' : '')} onClick={() => onLike(l)} aria-label={l.liked ? '위시리스트에서 빼기' : '위시리스트에 담기'}>
          <Icon d={P.heart} />
        </button>
      )}
      <Link to={`/rooms/${l.id}`} className="meta">
        <div className="r1"><span>{l.region} · {l.area}</span>{l.rating ? <span className="star num"><Star />{Number(l.rating).toFixed(2)}</span> : <span className="muted" style={{ fontWeight: 500 }}>새 숙소</span>}</div>
        <span className="sub">{l.title}</span>
        <span className="sub">최대 {l.max_guests}명 · 침대 {l.beds}개</span>
        <span className="price num"><b>{won(l.price)}</b> /박</span>
      </Link>
    </article>
  );
}

export function useLike(setItems) {
  const { me, notify } = useApp();
  const nav = useNavigate();
  return async l => {
    if (!me) { nav('/login?next=' + encodeURIComponent(location.pathname + location.search)); return; }
    const on = !l.liked;
    setItems(xs => xs.map(x => (x.id === l.id ? { ...x, liked: on } : x)));
    try {
      await api(`/api/wishlist/${l.id}`, { method: on ? 'POST' : 'DELETE' });
      notify(on ? '위시리스트에 담았어요' : '위시리스트에서 뺐어요');
    } catch (e) {
      setItems(xs => xs.map(x => (x.id === l.id ? { ...x, liked: !on } : x)));
      notify(e.message, true);
    }
  };
}

const px = lng => (lng - 126) / 3.6 * 100, py = lat => (38.3 - lat) / 5.2 * 100;
const LAND = 'M11 12 L40 4 L67 0 L69 0 L78 6 L86 15 L94 35 L96 54 L90 60 L83 62 L74 66 L67 67 L56 70 L47 69 L36 72 L24 74 L17 75 L8 71 L9 63 L11 56 L15 50 L17 44 L12 36 L6 27 L12 21 L17 17Z';
function MapView({ items, hover, setHover }) {
  return (
    <div className="mapbox" aria-label="숙소 위치 지도">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {[20, 40, 60, 80].map(v => <path key={'h' + v} d={`M0 ${v}H100`} stroke="var(--map-line)" strokeWidth=".15" />)}
        {[25, 50, 75].map(v => <path key={'v' + v} d={`M${v} 0V100`} stroke="var(--map-line)" strokeWidth=".15" />)}
        <path d={LAND} fill="var(--map-land)" stroke="var(--map-line)" strokeWidth=".4" strokeLinejoin="round" />
        <ellipse cx="15" cy="94.5" rx="7" ry="2.4" fill="var(--map-land)" stroke="var(--map-line)" strokeWidth=".4" />
      </svg>
      {items.filter(l => l.lat && l.lng).map(l => (
        <Link key={l.id} to={`/rooms/${l.id}`} className={'pin num' + (hover === l.id ? ' on' : '')}
          style={{ left: Math.min(96, Math.max(4, px(l.lng))) + '%', top: Math.min(97, Math.max(3, py(l.lat))) + '%' }}
          onMouseEnter={() => setHover(l.id)} onMouseLeave={() => setHover(null)}>{man(l.price)}</Link>
      ))}
    </div>
  );
}

export default function Home() {
  const { config } = useApp();
  const [sp, setSp] = useSearchParams();
  const narrow = useNarrow();
  const f = {
    region: sp.get('region') || '전체', category: sp.get('category') || 'all', guests: Number(sp.get('guests') || 1),
    checkIn: sp.get('checkIn') || null, checkOut: sp.get('checkOut') || null, sort: sp.get('sort') || 'recommended', view: sp.get('view') || 'grid',
  };
  const set = patch => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) (v == null || v === '' || v === 'all' || v === '전체' || (k === 'guests' && v === 1) || (k === 'sort' && v === 'recommended') || (k === 'view' && v === 'grid')) ? n.delete(k) : n.set(k, v);
    setSp(n, { replace: true });
  };
  const [panel, setPanel] = useState(false);
  const [items, setItems] = useState(null), [err, setErr] = useState(null), [page, setPage] = useState(1), [hasMore, setHasMore] = useState(false);
  const [hover, setHover] = useState(null);
  const like = useLike(setItems);
  const key = [f.region, f.category, f.guests, f.checkIn, f.checkOut, f.sort].join('|');
  const load = async (pg = 1) => {
    setErr(null);
    const qs = new URLSearchParams();
    if (f.region !== '전체') qs.set('region', f.region);
    if (f.category !== 'all') qs.set('category', f.category);
    if (f.guests > 1) qs.set('guests', f.guests);
    if (f.checkIn && f.checkOut) { qs.set('checkIn', f.checkIn); qs.set('checkOut', f.checkOut); }
    if (f.sort !== 'recommended') qs.set('sort', f.sort);
    qs.set('page', pg);
    try {
      const r = await api('/api/listings?' + qs);
      setItems(xs => (pg === 1 ? r.items : [...(xs || []), ...r.items])); setHasMore(r.hasMore); setPage(pg);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { setItems(null); load(1); }, [key]);
  const n = f.checkIn && f.checkOut ? nightsBetween(f.checkIn, f.checkOut) : 0;
  const regions = useMemo(() => ['전체', ...(config?.regions || [])], [config]);

  return (
    <>
      <TopBar>
        <div className="search">
          <div className="pill">
            <button type="button" onClick={() => setPanel(!panel)}><b>어디로</b><span>{f.region === '전체' ? '모든 지역' : f.region}</span></button>
            <button type="button" className="hide-m" onClick={() => setPanel(!panel)}><b>언제</b><span className="num">{n ? `${fmtD(f.checkIn)} – ${fmtD(f.checkOut)}` : '날짜 추가'}</span></button>
            <button type="button" className="hide-m" onClick={() => setPanel(!panel)}><b>누구와</b><span>게스트 {f.guests}명</span></button>
            <button type="button" className="go" onClick={() => setPanel(!panel)} aria-label="검색 조건 열기" aria-expanded={panel}>
              <Icon d={P.search} width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </TopBar>
      <div className="top-sub" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
        {panel && (
          <div className="wrap panel">
            <div><h4>지역</h4><div className="regions">{regions.map(r => <button type="button" key={r} className={'chip' + (f.region === r ? ' on' : '')} onClick={() => set({ region: r })}>{r}</button>)}</div></div>
            <div><h4>날짜</h4><Calendar months={narrow ? 1 : 2} today={config?.today} start={f.checkIn} end={f.checkOut} onChange={(s, e) => set({ checkIn: s, checkOut: e })} /></div>
            <div>
              <h4>인원</h4>
              <Stepper label="게스트" sub="만 2세 이상" value={f.guests} min={1} max={30} onChange={v => set({ guests: v })} />
              <button type="button" className="btn primary block" style={{ marginTop: 16 }} onClick={() => setPanel(false)}>검색 결과 보기</button>
            </div>
          </div>
        )}
        <div className="wrap"><div className="cats" role="tablist">
          {CATS.map(c => (
            <button type="button" role="tab" aria-selected={f.category === c.id} key={c.id} className={'cat' + (f.category === c.id ? ' on' : '')} onClick={() => set({ category: c.id })}>
              <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={c.icon} /></svg>{c.name}
            </button>
          ))}
        </div></div>
      </div>

      <main className="wrap">
        <div className="head">
          <div>
            <h1>{f.region === '전체' ? '머물고 싶은 곳을 찾아보세요' : `${f.region}에서 머물 곳`}</h1>
            <p className="num">{items ? `숙소 ${items.length}${hasMore ? '+' : ''}곳` : '숙소를 찾는 중'}{n ? ` · ${fmtD(f.checkIn)} – ${fmtD(f.checkOut)} (${n}박) 예약 가능` : ''}</p>
          </div>
          <div className="tools">
            <select className="sel" id="sort" aria-label="정렬" value={f.sort} onChange={e => set({ sort: e.target.value })}>
              <option value="recommended">추천순</option><option value="rating">평점순</option><option value="price_asc">낮은 가격순</option><option value="price_desc">높은 가격순</option><option value="new">최신 등록순</option>
            </select>
            <div className="toggle"><button type="button" className={f.view === 'grid' ? 'on' : ''} onClick={() => set({ view: 'grid' })}>목록</button><button type="button" className={f.view === 'map' ? 'on' : ''} onClick={() => set({ view: 'map' })}>지도</button></div>
          </div>
        </div>
        {err ? <ErrorBox error={err} retry={() => load(1)} /> : !items ? <Loading /> : (
          <div className={'split' + (f.view === 'map' ? ' map' : '')}>
            <div>
              {items.length ? <div className="grid">{items.map(l => <Card key={l.id} l={l} onLike={like} hl={hover === l.id} onHover={setHover} />)}</div>
                : <div className="empty"><b>조건에 맞는 숙소가 없어요</b>지역이나 날짜를 바꾸거나 인원을 줄여 보세요.<br /><button type="button" className="link" onClick={() => setSp(new URLSearchParams(), { replace: true })}>조건 모두 지우기</button></div>}
              {hasMore && <div className="more"><button className="btn line" onClick={() => load(page + 1)}>숙소 더 보기</button></div>}
            </div>
            {f.view === 'map' && <MapView items={items} hover={hover} setHover={setHover} />}
          </div>
        )}
      </main>
    </>
  );
}
