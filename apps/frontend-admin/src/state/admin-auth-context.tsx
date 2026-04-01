import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

type AdminIdentity = {
  email: string;
  role: string;
};

type AdminAuthContextValue = {
  accessToken: string | null;
  admin: AdminIdentity | null;
  login: (params: { email: string; password: string }) => Promise<void>;
  logout: () => void;
};

const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api';
const ACCESS_TOKEN_STORAGE_KEY = 'admin_access_token';

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function getIdentityFromToken(token: string | null): AdminIdentity | null {
  if (!token) {
    return null;
  }

  const payload = decodeJwtPayload(token);

  return {
    email: String(payload?.email ?? ''),
    role: String(payload?.role ?? 'unknown'),
  };
}

export function AdminAuthProvider({ children }: PropsWithChildren) {
  const [accessToken, setAccessTokenState] = useState<string | null>(() => localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY));
  const [admin, setAdmin] = useState<AdminIdentity | null>(() => getIdentityFromToken(localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)));

  useEffect(() => {
    if (!accessToken) {
      localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
      setAdmin(null);
      return;
    }

    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
    setAdmin(getIdentityFromToken(accessToken));
  }, [accessToken]);

  const login = useCallback(async ({ email, password }: { email: string; password: string }) => {
    const response = await fetch(`${API_BASE_URL}/admin/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error ?? 'Admin login failed');
    }

    const body = (await response.json()) as { accessToken: string };
    setAccessTokenState(body.accessToken);
  }, []);

  const logout = useCallback(() => {
    setAccessTokenState(null);
    setAdmin(null);
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({
      accessToken,
      admin,
      login,
      logout,
    }),
    [accessToken, admin, login, logout],
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);

  if (!context) {
    throw new Error('useAdminAuth must be used inside AdminAuthProvider');
  }

  return context;
}
