'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setApiCompany, setAuthErrorHandler } from './api';
import type { ProjectStatus, TradeType } from './labels';

export interface Me {
  user: { id: string; loginId: string; name: string; email: string | null; isSystemAdmin: boolean; mfaEnabled: boolean; mustChangePassword: boolean; preferences: Prefs; lastLoginAt: string | null };
  companies: { id: string; name: string; code: string }[];
}
export interface Prefs {
  theme?: 'light' | 'dark' | 'system';
  favorites?: string[];
  lastCompanyId?: string;
  lastProjectId?: string | null;
  sidebarCollapsed?: boolean;
}
export interface Perms {
  companyId: string;
  scope: 'COMPANY' | 'ASSIGNED' | 'CONFIRMED_ONLY' | null;
  permissions: string[];
  assignedProjectIds: string[];
}
export interface ProjectOption {
  id: string;
  code: string;
  name: string;
  tradeType: TradeType;
  status: ProjectStatus;
}

interface Session {
  me: Me;
  company: Me['companies'][number];
  perms: Perms | undefined;
  can: (perm: string) => boolean;
  switchCompany: (id: string) => void;
  projects: ProjectOption[];
  project: ProjectOption | null;
  setProject: (id: string | null) => void;
  prefs: Prefs;
  savePrefs: (p: Partial<Prefs>) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function applyTheme(theme: Prefs['theme']) {
  const t = theme === 'system' || !theme ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('erp-theme', theme ?? 'system');
  } catch {
    /* 저장 불가 환경 무시 */
  }
}

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({});

  useEffect(() => {
    setAuthErrorHandler((e: ApiError) => {
      const reason = e.body.code === 'PASSWORD_CHANGE_REQUIRED' ? '?change=1' : e.body.code === 'UNAUTHENTICATED' ? '?expired=1' : '';
      qc.clear();
      router.replace(`/login${reason}`);
    });
    return () => setAuthErrorHandler(null);
  }, [router, qc]);

  const meQ = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me', { noCompany: true }), retry: false, staleTime: 5 * 60_000 });

  useEffect(() => {
    if (!meQ.data) return;
    const p = meQ.data.user.preferences ?? {};
    setPrefs(p);
    applyTheme(p.theme);
    const ids = meQ.data.companies.map((c) => c.id);
    const pick = p.lastCompanyId && ids.includes(p.lastCompanyId) ? p.lastCompanyId : ids[0] ?? null;
    setApiCompany(pick);
    setCompanyId(pick);
    setProjectId(p.lastProjectId ?? null);
  }, [meQ.data]);

  const permsQ = useQuery({ queryKey: ['perms', companyId], queryFn: () => api<Perms>('/auth/permissions'), enabled: !!companyId, staleTime: 60_000 });
  const can = useCallback((perm: string) => !!permsQ.data?.permissions.includes(perm), [permsQ.data]);
  const projQ = useQuery({
    queryKey: ['project-options', companyId],
    queryFn: () => api<ProjectOption[]>('/projects/options'),
    enabled: !!companyId && can('project:read'),
    staleTime: 60_000,
  });

  const savePrefs = useCallback((p: Partial<Prefs>) => {
    setPrefs((old) => ({ ...old, ...p }));
    api('/auth/preferences', { method: 'POST', json: p, noCompany: true }).catch(() => undefined);
  }, []);

  const switchCompany = useCallback(
    (id: string) => {
      setApiCompany(id);
      setCompanyId(id);
      setProjectId(null);
      savePrefs({ lastCompanyId: id, lastProjectId: null });
      // 다른 회사 자료가 화면에 남지 않도록 캐시를 모두 비운다
      qc.removeQueries({ predicate: (q) => !['me'].includes(q.queryKey[0] as string) });
      router.push('/dashboard');
    },
    [qc, router, savePrefs],
  );

  const setProject = useCallback(
    (id: string | null) => {
      setProjectId(id);
      savePrefs({ lastProjectId: id });
    },
    [savePrefs],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', noCompany: true }).catch(() => undefined);
    setApiCompany(null);
    qc.clear();
    router.replace('/login');
  }, [qc, router]);

  const value = useMemo<Session | null>(() => {
    if (!meQ.data || !companyId) return null;
    const company = meQ.data.companies.find((c) => c.id === companyId)!;
    const projects = projQ.data ?? [];
    return {
      me: meQ.data, company, perms: permsQ.data, can, switchCompany, projects,
      project: projects.find((p) => p.id === projectId) ?? null, setProject, prefs, savePrefs, logout,
    };
  }, [meQ.data, companyId, permsQ.data, can, switchCompany, projQ.data, projectId, setProject, prefs, savePrefs, logout]);

  if (meQ.data && meQ.data.companies.length === 0) {
    return <NoCompany name={meQ.data.user.name} onLogout={logout} />;
  }
  if (!value || !permsQ.data) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function NoCompany({ name, onLogout }: { name: string; onLogout: () => void }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper p-6">
      <div className="max-w-sm rounded-[6px] border border-line bg-surface p-6 text-center">
        <p className="text-section font-semibold">{name}님은 아직 소속된 회사가 없습니다</p>
        <p className="mt-2 text-muted">관리자에게 회사 소속과 역할 지정을 요청해 주세요.</p>
        <button onClick={onLogout} className="mt-5 h-9 rounded-[4px] border border-line px-4 hover:bg-surface-hover">로그아웃</button>
      </div>
    </div>
  );
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('SessionProvider 밖에서 useSession 사용');
  return s;
}
