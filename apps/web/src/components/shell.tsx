'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Building, Check, ChevronDown, ChevronsUpDown, CornerDownLeft, KeyRound, LogOut, Menu, Monitor, Moon, PanelLeftClose,
  PanelLeftOpen, Search, Star, Sun, X, LayoutDashboard, Building2, Package, Settings2, Stamp,
} from 'lucide-react';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, qs } from '@/lib/api';
import { TRADE } from '@/lib/labels';
import { ALL_ITEMS, isLiveItem, NAV, type NavItem } from '@/lib/nav';
import { applyTheme, useSession, type ProjectOption } from '@/lib/session';
import { Kbd, TradeTag } from './ui';

/* ─────────────── 브랜드 ─────────────── */
export function BrandMark({ compact, tone = 'nav' }: { compact?: boolean; tone?: 'nav' | 'paper' }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span aria-hidden className="grid size-7 -rotate-[8deg] place-items-center rounded-full border-2 border-[#d9402f] text-[10px] font-bold tracking-tight text-[#e2523f]" style={{ boxShadow: `inset 0 0 0 1.5px ${tone === 'nav' ? 'var(--nav)' : 'var(--surface)'}, inset 0 0 0 2.5px #d9402f` }}>
        SS
      </span>
      {!compact && (
        <span className={clsx('text-[15px] font-semibold tracking-[-0.01em]', tone === 'nav' ? 'text-nav-ink-strong' : 'text-ink')}>
          SS-ERP
        </span>
      )}
    </span>
  );
}

/* ─────────────── 사이드바 ─────────────── */
function useVisibleNav() {
  const { can, me } = useSession();
  const sys = me.user.isSystemAdmin;
  return useMemo(() => NAV.map((g) => ({ ...g, items: g.items.filter((i) => (!i.perm || can(i.perm)) && (!i.systemAdmin || sys)) })).filter((g) => g.items.length), [can, sys]);
}

function useApprovalCount() {
  const { company, can } = useSession();
  return useQuery({ queryKey: ['approval-counts', company.id], queryFn: () => api<{ todo: number; minePending: number }>('/approvals/counts'), enabled: can('approval:create'), refetchInterval: 60_000 }).data?.todo ?? 0;
}

/** 현재 주소의 쿼리 — 경로가 바뀌거나 앞뒤로 이동할 때 다시 읽는다 */
function useSearch(path: string) {
  const [s, setS] = useState('');
  useEffect(() => {
    const read = () => setS(window.location.search.slice(1));
    read();
    const t = setInterval(read, 700);
    window.addEventListener('popstate', read);
    return () => (clearInterval(t), window.removeEventListener('popstate', read));
  }, [path]);
  return s;
}

function NavLink({ item, collapsed, onNavigate, fav, onFav }: { item: NavItem; collapsed?: boolean; onNavigate?: () => void; fav?: boolean; onFav?: () => void }) {
  const path = usePathname();
  const todo = useApprovalCount();
  const live = isLiveItem(item);
  const search = useSearch(path);
  const [ipath, iquery] = item.href.split('?');
  // 같은 경로를 쿼리로 나눈 메뉴(매입·매출)는 쿼리까지 맞아야, 더 구체적인 하위 메뉴가 있으면 그쪽만 활성
  const sibling = ALL_ITEMS.some((o) => o.href !== item.href && o.href.split('?')[0] === ipath);
  const deeper = ALL_ITEMS.some((o) => o.href !== item.href && o.href.startsWith(ipath + '/') && (path === o.href || path.startsWith(o.href + '/')));
  const active = iquery
    ? path === ipath && iquery.split('&').every((kv) => search.includes(kv))
    : !deeper && (path === ipath ? !(sibling && ALL_ITEMS.some((o) => o.href.startsWith(ipath + '?') && o.href.split('?')[1].split('&').every((kv) => search.includes(kv)))) : ipath !== '/dashboard' && path.startsWith(ipath + '/'));
  return (
    <div className="group/item relative">
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        className={clsx(
          'relative flex h-8 items-center gap-2 rounded-[4px] pr-7 pl-3 text-[13px] transition-colors',
          active ? 'bg-nav-2 font-medium text-nav-ink-strong' : 'text-nav-ink hover:bg-nav-2/60 hover:text-nav-ink-strong',
          !live && !active && 'text-nav-ink/70',
        )}
      >
        {active && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r bg-[#7fa6cf]" />}
        <span className="truncate">{item.label}</span>
        {!live && <span className="ml-auto shrink-0 rounded-[3px] border border-nav-line px-1 text-[10px] leading-4 text-nav-ink/60">{item.stage}단계</span>}
        {item.badge === 'approvals' && todo > 0 && <span className="num ml-auto shrink-0 rounded-full bg-[#d9402f] px-1.5 text-[11px] leading-[18px] font-semibold text-white" aria-label={`결재할 문서 ${todo}건`}>{todo}</span>}
      </Link>
      {onFav && (
        <button
          type="button"
          onClick={onFav}
          aria-label={fav ? '즐겨찾기 해제' : '즐겨찾기 추가'}
          className={clsx('absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-[3px] text-nav-ink/60 hover:text-[#e3ae5a]', fav ? 'text-[#e3ae5a] opacity-100' : 'opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100')}
        >
          <Star className="size-3" fill={fav ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  );
}

function SidebarBody({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const groups = useVisibleNav();
  const { prefs, savePrefs } = useSession();
  const path = usePathname();
  const favorites = prefs.favorites ?? [];
  const favItems = ALL_ITEMS.filter((i) => favorites.includes(i.href) && groups.some((g) => g.items.some((x) => x.href === i.href)));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggleFav = (href: string) => savePrefs({ favorites: favorites.includes(href) ? favorites.filter((f) => f !== href) : [...favorites, href] });

  if (collapsed) {
    return (
      <nav className="flex flex-col items-center gap-1 py-2" aria-label="주 메뉴">
        {groups.map((g) => {
          const first = g.items.find(isLiveItem) ?? g.items[0];
          const active = g.items.some((i) => path === i.href || path.startsWith(i.href + '/'));
          const Icon = g.icon;
          return (
            <Link key={g.key} href={first.href} title={g.label} aria-label={g.label} className={clsx('grid size-9 place-items-center rounded-[4px]', active ? 'bg-nav-2 text-nav-ink-strong' : 'text-nav-ink hover:bg-nav-2/60 hover:text-nav-ink-strong')}>
              <Icon className="size-[18px]" strokeWidth={1.75} />
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-3 px-2 py-3" aria-label="주 메뉴">
      {favItems.length > 0 && (
        <div>
          <p className="mb-1 px-3 text-[11px] text-nav-ink/55">즐겨찾기</p>
          {favItems.map((i) => <NavLink key={i.href} item={i} onNavigate={onNavigate} fav onFav={() => toggleFav(i.href)} />)}
        </div>
      )}
      {groups.map((g) => {
        const Icon = g.icon;
        const single = g.items.length === 1;
        const containsActive = g.items.some((i) => path === i.href || path.startsWith(i.href + '/'));
        const isOpen = open[g.key] ?? (containsActive || g.items.some(isLiveItem));
        if (single) {
          const i = g.items[0];
          return (
            <div key={g.key} className="-mb-2">
              <NavLink item={{ ...i, label: g.label }} onNavigate={onNavigate} fav={favorites.includes(i.href)} onFav={() => toggleFav(i.href)} />
            </div>
          );
        }
        return (
          <div key={g.key}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen((o) => ({ ...o, [g.key]: !isOpen }))}
              className="flex h-7 w-full items-center gap-2 rounded-[4px] px-3 text-[12px] font-medium text-nav-ink/75 hover:text-nav-ink-strong"
            >
              <Icon className="size-3.5" strokeWidth={1.75} />
              {g.label}
              <ChevronDown className={clsx('ml-auto size-3.5 transition-transform', !isOpen && '-rotate-90')} />
            </button>
            {isOpen && (
              <div className="mt-0.5 space-y-px">
                {g.items.map((i) => <NavLink key={i.href} item={i} onNavigate={onNavigate} fav={favorites.includes(i.href)} onFav={() => toggleFav(i.href)} />)}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/* ─────────────── 회사·현장 선택 ─────────────── */
function Popover({ open, onClose, anchor, children, width = 320, align = 'left' }: { open: boolean; onClose: () => void; anchor: React.RefObject<HTMLElement | null>; children: ReactNode; width?: number; align?: 'left' | 'right' }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const left = align === 'right' ? r.right - width : r.left;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
    const close = (e: MouseEvent) => {
      const el = document.getElementById('erp-popover');
      if (el && !el.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open, anchor, onClose, width, align]);
  if (!open || !pos) return null;
  return createPortal(
    <div id="erp-popover" className="animate-pop fixed z-50 overflow-hidden rounded-[6px] border border-line bg-surface shadow-pop" style={{ top: pos.top, left: pos.left, width: Math.min(width, window.innerWidth - 16) }}>
      {children}
    </div>,
    document.body,
  );
}

function CompanySwitcher() {
  const { me, company, switchCompany } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const multi = me.companies.length > 1;
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => multi && setOpen((v) => !v)}
        className={clsx('flex h-8 max-w-[200px] items-center gap-2 rounded-[4px] px-2 text-body font-semibold', multi ? 'hover:bg-surface-2' : 'cursor-default')}
        aria-haspopup={multi ? 'listbox' : undefined}
      >
        <Building className="size-4 shrink-0 text-muted" strokeWidth={1.75} />
        <span className="truncate">{company.name}</span>
        {multi && <ChevronsUpDown className="size-3.5 shrink-0 text-faint" />}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} width={280}>
        <p className="border-b border-line px-3 py-2 text-meta text-muted">회사 전환 — 다른 회사 자료는 화면에서 모두 비워집니다</p>
        <ul role="listbox" className="max-h-80 overflow-y-auto py-1">
          {me.companies.map((c) => (
            <li key={c.id}>
              <button type="button" role="option" aria-selected={c.id === company.id} onClick={() => (setOpen(false), c.id !== company.id && switchCompany(c.id))} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover">
                <span className="grid size-6 place-items-center rounded-[3px] bg-surface-2 text-[10px] font-semibold text-muted">{c.code}</span>
                <span className="flex-1 truncate">{c.name}</span>
                {c.id === company.id && <Check className="size-4 text-steel" />}
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}

function ProjectSwitcher() {
  const { projects, project, setProject, can } = useSession();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLButtonElement>(null);
  if (!can('project:read')) return null;
  const list = projects.filter((p) => !q || p.name.includes(q) || p.code.toLowerCase().includes(q.toLowerCase()));
  const active = list.filter((p) => p.status === 'IN_PROGRESS' || p.status === 'PLANNED' || p.status === 'SUSPENDED');
  const done = list.filter((p) => p.status === 'COMPLETED' || p.status === 'SETTLED');
  const row = (p: ProjectOption) => (
    <li key={p.id}>
      <button type="button" role="option" aria-selected={project?.id === p.id} onClick={() => (setProject(p.id), setOpen(false))} className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-surface-hover">
        <span aria-hidden className="h-4 w-1 shrink-0 rounded-[1px]" style={{ background: TRADE[p.tradeType].color }} />
        <span className="num w-[62px] shrink-0 text-meta text-muted">{p.code}</span>
        <span className="flex-1 truncate">{p.name}</span>
        {project?.id === p.id && <Check className="size-4 text-steel" />}
      </button>
    </li>
  );
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        className={clsx('flex h-8 min-w-0 max-w-[340px] items-center gap-2 rounded-[4px] border px-2.5 text-body', project ? 'border-line-strong bg-surface' : 'border-dashed border-line-strong text-muted', 'hover:border-faint')}
      >
        {project ? (
          <>
            <span aria-hidden className="h-3.5 w-1 shrink-0 rounded-[1px]" style={{ background: TRADE[project.tradeType].color }} />
            <span className="num shrink-0 text-meta text-muted max-sm:hidden">{project.code}</span>
            <span className="truncate font-medium text-ink">{project.name}</span>
          </>
        ) : (
          <span className="truncate">전체 현장</span>
        )}
        <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-faint" />
      </button>
      <Popover open={open} onClose={() => (setOpen(false), setQ(''))} anchor={ref} width={400}>
        <div className="border-b border-line p-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="공사명 또는 번호로 찾기" className="h-8 w-full rounded-[4px] border border-line-strong bg-surface px-2.5 focus:border-steel focus:outline-none" />
        </div>
        <ul role="listbox" className="scrollbar-thin max-h-[360px] overflow-y-auto py-1">
          <li>
            <button type="button" onClick={() => (setProject(null), setOpen(false))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-muted hover:bg-surface-hover">
              <span className="flex-1">전체 현장 보기</span>
              {!project && <Check className="size-4 text-steel" />}
            </button>
          </li>
          {!!active.length && <li className="px-3 pt-2 pb-1 text-meta text-faint">진행·예정</li>}
          {active.map(row)}
          {!!done.length && <li className="px-3 pt-2 pb-1 text-meta text-faint">준공·정산</li>}
          {done.map(row)}
          {!list.length && <li className="px-3 py-6 text-center text-muted">{projects.length ? '찾는 현장이 없습니다' : '접근할 수 있는 현장이 없습니다'}</li>}
        </ul>
      </Popover>
    </>
  );
}

/* ─────────────── 통합 검색 ─────────────── */
function CommandSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { projects, can, setProject } = useSession();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const vendorQ = useQuery({
    queryKey: ['cmd-vendors', q],
    queryFn: () => api<{ rows: { id: string; name: string; code: string }[] }>(`/vendors${qs({ q, size: 5 })}`),
    enabled: open && q.length >= 2 && can('vendor:read'),
  });
  useEffect(() => {
    if (!open) setQ('');
    setIdx(0);
  }, [open, q]);
  const visibleNav = ALL_ITEMS.filter((i) => (!i.perm || can(i.perm)) && (!q || i.label.includes(q) || i.group.includes(q)));
  type Hit = { key: string; group: string; label: ReactNode; go: () => void };
  const hits: Hit[] = [
    ...projects.filter((p) => q && (p.name.includes(q) || p.code.toLowerCase().includes(q.toLowerCase()))).slice(0, 6).map((p) => ({
      key: 'p' + p.id, group: '현장', label: <span className="flex items-center gap-2"><TradeTag trade={p.tradeType} short /><span className="num text-muted">{p.code}</span><span className="truncate">{p.name}</span></span>,
      go: () => (setProject(p.id), router.push(`/projects/${p.id}`)),
    })),
    ...(vendorQ.data?.rows ?? []).map((v) => ({ key: 'v' + v.id, group: '거래처', label: <span><span className="num mr-2 text-muted">{v.code}</span>{v.name}</span>, go: () => router.push(`/vendors?open=${v.id}`) })),
    ...visibleNav.slice(0, q ? 8 : 12).map((i) => ({ key: 'n' + i.href, group: '메뉴', label: <span>{i.label} <span className="text-faint">· {i.group}</span></span>, go: () => router.push(i.href) })),
  ];
  const run = (h: Hit) => (h.go(), onClose());
  if (!open) return null;
  let last = '';
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-center bg-[rgb(10_16_24/0.45)] px-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal aria-label="통합 검색" className="animate-pop h-fit w-full max-w-xl overflow-hidden rounded-[6px] bg-surface shadow-pop">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-4 text-faint" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(hits.length - 1, i + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)));
              if (e.key === 'Enter' && hits[idx]) run(hits[idx]);
            }}
            placeholder="현장, 거래처, 메뉴 검색"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="scrollbar-thin max-h-[50vh] overflow-y-auto py-1">
          {hits.map((h, i) => {
            const head = h.group !== last ? ((last = h.group), <li key={h.group} className="px-3 pt-2 pb-1 text-meta text-faint">{h.group}</li>) : null;
            return [
              head,
              <li key={h.key}>
                <button type="button" onMouseEnter={() => setIdx(i)} onClick={() => run(h)} className={clsx('flex w-full items-center gap-2 px-3 py-2 text-left', i === idx && 'bg-steel-soft')}>
                  <span className="min-w-0 flex-1 truncate">{h.label}</span>
                  {i === idx && <CornerDownLeft className="size-3.5 text-faint" />}
                </button>
              </li>,
            ];
          })}
          {!hits.length && <li className="px-3 py-8 text-center text-muted">검색 결과가 없습니다</li>}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/* ─────────────── 사용자 메뉴 ─────────────── */
function UserMenu() {
  const { me, prefs, savePrefs, logout, perms } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const theme = prefs.theme ?? 'system';
  const setTheme = (t: 'light' | 'dark' | 'system') => (applyTheme(t), savePrefs({ theme: t }));
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen((v) => !v)} className="flex h-8 items-center gap-2 rounded-[4px] pr-1.5 pl-1 hover:bg-surface-2" aria-haspopup="menu">
        <span className="grid size-6 place-items-center rounded-full bg-steel-soft text-[11px] font-semibold text-steel-ink">{me.user.name.slice(0, 1)}</span>
        <span className="text-body max-md:hidden">{me.user.name}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} width={260} align="right">
        <div className="border-b border-line px-3 py-2.5">
          <p className="font-medium">{me.user.name}</p>
          <p className="text-meta text-muted">{me.user.loginId}{perms?.scope === 'ASSIGNED' ? ' · 배정 현장만 조회' : ''}</p>
        </div>
        <div className="border-b border-line px-3 py-2.5">
          <p className="mb-1.5 text-meta text-muted">화면 모드</p>
          <div className="grid grid-cols-3 gap-1 rounded-[4px] bg-surface-2 p-0.5">
            {([['light', '밝게', Sun], ['dark', '어둡게', Moon], ['system', '시스템', Monitor]] as const).map(([v, l, I]) => (
              <button key={v} type="button" onClick={() => setTheme(v)} aria-pressed={theme === v} className={clsx('flex h-7 items-center justify-center gap-1 rounded-[3px] text-meta', theme === v ? 'bg-surface font-medium text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                <I className="size-3.5" />{l}
              </button>
            ))}
          </div>
        </div>
        <div className="py-1">
          <Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-hover"><KeyRound className="size-4 text-muted" />비밀번호·2단계 인증</Link>
          <button type="button" onClick={logout} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"><LogOut className="size-4 text-muted" />로그아웃</button>
        </div>
      </Popover>
    </>
  );
}

/* ─────────────── 셸 ─────────────── */
export function AppShell({ children }: { children: ReactNode }) {
  const { prefs, savePrefs, can } = useSession();
  const collapsed = !!prefs.sidebarCollapsed;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmd, setCmd] = useState(false);
  const path = usePathname();

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable;
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        setCmd(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => setMobileOpen(false), [path]);

  const todo = useApprovalCount();
  const tabs = [
    { href: '/dashboard', label: '대시보드', icon: LayoutDashboard, perm: 'dashboard:read' },
    { href: '/projects', label: '현장', icon: Building2, perm: 'project:read' },
    { href: '/purchase-orders', label: '발주', icon: Package, perm: 'purchase:read' },
    { href: '/approvals', label: '결재', icon: Stamp, perm: 'approval:create', badge: todo },
    { href: '/admin/users', label: '관리', icon: Settings2, perm: 'user:read' },
  ].filter((t) => can(t.perm));

  return (
    <div className="min-h-dvh lg:flex">
      <a href="#main" className="sr-only z-50 bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">본문 바로가기</a>
      {/* 넓은 화면: 고정 사이드바 */}
      <aside className={clsx('sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-nav-line bg-nav lg:flex', collapsed ? 'w-16' : 'w-[232px]')}>
        <div className={clsx('flex h-[52px] shrink-0 items-center border-b border-nav-line', collapsed ? 'justify-center' : 'justify-between pr-2 pl-4')}>
          <Link href="/dashboard" aria-label="대시보드로"><BrandMark compact={collapsed} /></Link>
          {!collapsed && (
            <button type="button" onClick={() => savePrefs({ sidebarCollapsed: true })} className="grid size-7 place-items-center rounded-[4px] text-nav-ink hover:bg-nav-2 hover:text-nav-ink-strong" aria-label="메뉴 접기">
              <PanelLeftClose className="size-4" />
            </button>
          )}
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto">
          <SidebarBody collapsed={collapsed} />
        </div>
        {collapsed && (
          <button type="button" onClick={() => savePrefs({ sidebarCollapsed: false })} className="mx-auto mb-3 grid size-9 place-items-center rounded-[4px] text-nav-ink hover:bg-nav-2" aria-label="메뉴 펼치기">
            <PanelLeftOpen className="size-4" />
          </button>
        )}
      </aside>

      {/* 좁은 화면: 서랍 메뉴 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-[rgb(10_16_24/0.5)] lg:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="animate-drawer flex h-full w-[280px] flex-col bg-nav" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-[52px] items-center justify-between border-b border-nav-line pr-2 pl-4">
              <BrandMark />
              <button type="button" onClick={() => setMobileOpen(false)} className="grid size-8 place-items-center text-nav-ink" aria-label="메뉴 닫기"><X className="size-5" /></button>
            </div>
            <div className="scrollbar-thin flex-1 overflow-y-auto"><SidebarBody onNavigate={() => setMobileOpen(false)} /></div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[52px] shrink-0 items-center gap-1.5 border-b border-line bg-surface/95 px-2 backdrop-blur sm:gap-2 sm:px-4">
          <button type="button" onClick={() => setMobileOpen(true)} className="grid size-8 place-items-center rounded-[4px] text-muted hover:bg-surface-2 lg:hidden" aria-label="메뉴 열기">
            <Menu className="size-5" />
          </button>
          <CompanySwitcher />
          <span aria-hidden className="h-5 w-px bg-line max-sm:hidden" />
          <div className="min-w-0 flex-1 sm:flex-none"><ProjectSwitcher /></div>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => setCmd(true)} className="flex h-8 items-center gap-2 rounded-[4px] border border-line bg-surface-2/60 px-2.5 text-muted hover:border-line-strong max-md:w-8 max-md:justify-center max-md:border-0 max-md:bg-transparent max-md:px-0">
              <Search className="size-4" />
              <span className="w-40 text-left max-md:hidden">통합 검색</span>
              <span className="max-md:hidden"><Kbd>/</Kbd></span>
            </button>
            <UserMenu />
          </div>
        </header>
        <LicenseBanner />
        <main id="main" className="min-w-0 flex-1 px-3 pt-4 pb-24 sm:px-6 sm:pt-5 lg:pb-10">{children}</main>
      </div>

      {/* 모바일 하단 탭 */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }} aria-label="빠른 메뉴">
        {tabs.map((t) => {
          const active = path === t.href || path.startsWith(t.href + '/') || (t.href === '/admin/users' && path.startsWith('/admin'));
          const I = t.icon;
          return (
            <Link key={t.href} href={t.href} className={clsx('relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]', active ? 'font-medium text-steel' : 'text-muted')}>
              <I className="size-5" strokeWidth={active ? 2 : 1.75} />
              {!!t.badge && <span className="num absolute top-1.5 left-1/2 ml-1.5 rounded-full bg-seal px-1 text-[10px] leading-4 font-semibold text-white" aria-label={`결재할 문서 ${t.badge}건`}>{t.badge}</span>}
              {t.label}
            </Link>
          );
        })}
      </nav>
      <CommandSearch open={cmd} onClose={() => setCmd(false)} />
    </div>
  );
}

/** 라이선스 만료 임박·만료·확인 불가일 때 모든 화면 위에 안내 (관리자는 라이선스 화면으로 바로 이동) */
function LicenseBanner() {
  const { can } = useSession();
  const q = useQuery({
    queryKey: ['license'],
    queryFn: () => api<{ mode: string; renewSoon: boolean; daysLeft: number; message: string }>('/license', { noCompany: true }),
    refetchInterval: 30 * 60_000,
    staleTime: 5 * 60_000,
  });
  const s = q.data;
  if (!s) return null;
  const blocked = s.mode === 'EXPIRED' || s.mode === 'INVALID';
  if (!blocked && !s.renewSoon) return null;
  return (
    <div role="status" className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-meta sm:px-6', blocked ? 'border-seal/30 bg-seal-soft text-seal' : 'border-warn/30 bg-warn-soft text-warn')}>
      <span className="font-medium">{blocked ? (s.mode === 'TRIAL' ? '평가판 종료' : '라이선스 확인 필요') : '라이선스 갱신 안내'}</span>
      <span className="min-w-0 flex-1">{s.message}</span>
      {can('license:read') && <Link href="/admin/license" className="font-medium underline underline-offset-2">라이선스 관리</Link>}
    </div>
  );
}
