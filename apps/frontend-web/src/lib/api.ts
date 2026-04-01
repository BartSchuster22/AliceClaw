const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api';

export type Product = {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_cents: number;
  billing_cycle: 'monthly' | 'annual';
  vps_spec: Record<string, unknown>;
};

export type CmsPublic = {
  hero_headline: string;
  hero_subheadline?: string;
  hero_cta_text?: string;
  product_card_footer_note?: string;
  faq_entries?: Array<{ q: string; a: string }>;
  footer_tagline?: string;
};

export type AuthResponse = {
  accessToken: string;
};

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
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

export function getProduct(slug: string) {
  return fetchJson<Product>(`/products/${slug}`);
}

export function getPublicCms() {
  return fetchJson<CmsPublic>('/cms/public');
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

export { API_BASE_URL };
