import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, getToken, setGlobalErrorHandler, setToken } from '../api/client';
import type { LoginResponse, LoginTokenResponse, User } from '../api/types';

export type AuthStatus = 'loading' | 'anon' | 'authed' | 'mfa_setup' | 'unreachable';

interface AuthValue {
  status: AuthStatus;
  user: User | null;
  token: string | null;
  notice: string | null;
  /** 로그인. MFA가 필요하면 mfa_token을 돌려준다. */
  login(username: string, password: string): Promise<{ mfaToken: string } | null>;
  verifyMfa(mfaToken: string, code: string): Promise<void>;
  /** MFA 활성화 후 상태 재확인 */
  refresh(): Promise<AuthStatus>;
  logout(notice?: string): Promise<void>;
  can(perm: string): boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(getToken() ? 'loading' : 'anon');
  const [user, setUser] = useState<User | null>(null);
  const [token, setTok] = useState<string | null>(getToken());
  const [notice, setNotice] = useState<string | null>(null);

  const clear = useCallback((msg: string | null) => {
    setToken(null);
    setTok(null);
    setUser(null);
    setNotice(msg);
    setStatus('anon');
  }, []);

  const loadMe = useCallback(async (): Promise<AuthStatus> => {
    try {
      const me = await api<User>('/me', { silent: true });
      setUser(me);
      setStatus('authed');
      return 'authed';
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'MFA_SETUP_REQUIRED') {
          setStatus('mfa_setup');
          return 'mfa_setup';
        }
        if (e.status === 401) {
          clear('세션이 만료되었습니다. 다시 로그인하세요.');
          return 'anon';
        }
      }
      setStatus('unreachable');
      return 'unreachable';
    }
  }, [clear]);

  useEffect(() => {
    if (getToken()) void loadMe();
  }, [loadMe]);

  useEffect(() => {
    setGlobalErrorHandler((err) => {
      if (err.status === 401 && getToken()) clear('세션이 만료되었거나 인증이 해제되었습니다. 다시 로그인하세요.');
      else if (err.status === 403 && err.code === 'MFA_SETUP_REQUIRED') setStatus('mfa_setup');
    });
    return () => setGlobalErrorHandler(null);
  }, [clear]);

  const finish = useCallback(
    async (r: LoginTokenResponse) => {
      setToken(r.access_token);
      setTok(r.access_token);
      setUser(r.user);
      setNotice(null);
      await loadMe();
    },
    [loadMe],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      const r = await api<LoginResponse>('/auth/login', { method: 'POST', body: { username, password }, silent: true });
      if ('mfa_required' in r && r.mfa_required) return { mfaToken: r.mfa_token };
      await finish(r as LoginTokenResponse);
      return null;
    },
    [finish],
  );

  const verifyMfa = useCallback(
    async (mfaToken: string, code: string) => {
      const r = await api<LoginTokenResponse>('/auth/mfa/verify', {
        method: 'POST',
        body: { mfa_token: mfaToken, code },
        silent: true,
      });
      await finish(r);
    },
    [finish],
  );

  const logout = useCallback(
    async (msg?: string) => {
      try {
        if (getToken()) await api('/auth/logout', { method: 'POST', silent: true });
      } catch {
        /* 로그아웃 실패는 무시하고 토큰을 지운다 */
      }
      clear(msg ?? null);
    },
    [clear],
  );

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      token,
      notice,
      login,
      verifyMfa,
      refresh: loadMe,
      logout,
      can: (p: string) => !!user && user.permissions.includes(p),
    }),
    [status, user, token, notice, login, verifyMfa, loadMe, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}
