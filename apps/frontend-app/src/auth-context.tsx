import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { refreshAccessToken } from './lib/dashboard-api';

const ACCESS_TOKEN_STORAGE_KEY = 'access_token';

type AuthContextValue = {
  accessToken: string | null;
  loading: boolean;
  setAccessToken: (token: string | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessTokenState] = useState<string | null>(() => sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refreshAccessToken()
      .then((result) => {
        setAccessTokenState(result.accessToken);
        sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, result.accessToken);
      })
      .catch(() => {
        const storedToken = sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
        setAccessTokenState(storedToken);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const setAccessToken = (token: string | null) => {
    setAccessTokenState(token);

    if (token) {
      sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
      return;
    }

    sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  };

  const value = useMemo(
    () => ({ accessToken, loading, setAccessToken }),
    [accessToken, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return value;
}
