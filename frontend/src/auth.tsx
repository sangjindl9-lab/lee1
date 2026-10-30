import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { get, post, setCsrf, setUnauthorizedHandler } from "./api";

export type Me = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  role_label: string;
  permissions: string[];
  site_ids: number[] | null;
  must_change_password: boolean;
  csrf_token: string;
};

type Ctx = {
  me: Me | null;
  loading: boolean;
  login: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (perm: string) => boolean;
  isSuper: boolean;
};

const AuthCtx = createContext<Ctx>(null as unknown as Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = (m: Me | null) => {
    setMe(m);
    setCsrf(m?.csrf_token ?? "");
  };

  const refresh = useCallback(async () => {
    try {
      apply(await get<Me>("/api/auth/me"));
    } catch {
      apply(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => apply(null));
    refresh();
  }, [refresh]);

  const login = async (u: string, p: string) => apply(await post<Me>("/api/auth/login", { username: u, password: p }));
  const logout = async () => {
    try {
      await post("/api/auth/logout");
    } finally {
      apply(null);
    }
  };
  const can = (perm: string) => !!me?.permissions.includes(perm);
  return (
    <AuthCtx.Provider value={{ me, loading, login, logout, refresh, can, isSuper: me?.role === "superadmin" }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
