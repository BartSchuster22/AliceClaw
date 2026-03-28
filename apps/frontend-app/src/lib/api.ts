const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'https://api.canariaslibre.com';

export type OnboardingSession = {
  orderId: string;
  currentStep: number;
  answers: Record<string, unknown>;
  completedAt: string | null;
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

export function getOnboardingSession(orderId: string, accessToken: string) {
  return fetchJson<OnboardingSession>(`/onboarding/session?orderId=${orderId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export function saveOnboardingStep(
  input: { orderId: string; step: number; answers: Record<string, unknown> },
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

export function completeOnboarding(input: { orderId: string }, accessToken: string) {
  return fetchJson<{ success: true; subscriptionId: string; vpsInstanceId: string }>('/onboarding/complete', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });
}
