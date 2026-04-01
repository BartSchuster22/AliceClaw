const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export type OnboardingSession = {
  subscriptionId: string;
  currentStep: number;
  answers: Record<string, unknown>;
  completedAt: string | null;
};

export type DeployStatus = {
  containerStatus: string;
  currentStep: string | null;
  recentLogs: string[];
  agentUrl: string | null;
  startedAt: string | null;
};

export type Product = {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_cents: number;
  billing_cycle: 'monthly' | 'annual';
  vps_spec: Record<string, unknown>;
};

export type AuthResponse = {
  accessToken: string;
};

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getProducts() {
  return fetchJson<Product[]>('/products');
}

export function registerUser(input: {
  email: string;
  password: string;
  full_name: string;
  referral_code_used?: string;
}) {
  return fetchJson<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function loginUser(input: { email: string; password: string }) {
  return fetchJson<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createOrder(input: { productId: string; referralCodeUsed?: string }, accessToken: string) {
  return fetchJson<{ checkoutUrl: string; orderId: string }>('/orders/create', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
}

export function getOnboardingSession(subscriptionId: string, accessToken: string) {
  return fetchJson<OnboardingSession>(`/onboarding/session?subscriptionId=${subscriptionId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function getDeployStatus(subscriptionId: string, accessToken: string) {
  return fetchJson<DeployStatus>(`/onboarding/deploy-status?subscriptionId=${subscriptionId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function saveOnboardingStep(
  input: { subscriptionId: string; step: number; answers: Record<string, unknown> },
  accessToken: string,
) {
  return fetchJson<{ success: true; currentStep: number }>('/onboarding/save-step', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
}

export function completeOnboarding(input: { subscriptionId: string }, accessToken: string) {
  return fetchJson<{ success: true; subscriptionId: string }>('/onboarding/complete', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
}
