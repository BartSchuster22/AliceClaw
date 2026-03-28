import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { refreshAccessToken } from './lib/dashboard-api';

type AuthContextValue = {
  accessToken: string | null;
  loading: boolean;
  setAccessToken: (token: string | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refreshAccessToken()
      .then((result) => {
        setAccessToken(result.accessToken);
      })
      .catch(() => {
        setAccessToken(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

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
