import { useAdminAuth } from '../state/admin-auth-context';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export function buildApiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

export function useAuthorizedFetch() {
  const { accessToken, logout } = useAdminAuth();

  return async function authorizedFetch(path: string, init?: RequestInit) {
    const response = await fetch(buildApiUrl(path), {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      credentials: 'include',
    });

    if (response.status === 401) {
      logout();
    }

    return response;
  };
}
