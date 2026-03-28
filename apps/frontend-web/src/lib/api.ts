const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'https://api.canariaslibre.com';

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

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
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

export { API_BASE_URL };
