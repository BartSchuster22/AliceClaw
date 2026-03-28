import { useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { getProduct, getProducts, getPublicCms, type Product } from './lib/api';

function formatPrice(priceCents: number, billingCycle: string) {
  const amount = new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(priceCents / 100);

  return `${amount}/${billingCycle === 'annual' ? 'year' : 'month'}`;
}

function storeReferralCodeFromUrl(search: string) {
  const params = new URLSearchParams(search);
  const ref = params.get('ref');

  if (ref) {
    sessionStorage.setItem('referral_code', ref);
  }
}

function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="text-lg font-semibold tracking-tight text-white">
            PSI Platform
          </Link>
          <nav className="flex items-center gap-4 text-sm text-slate-300">
            <Link to="/pricing" className="hover:text-white">Pricing</Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}

function ProductCard({ product, footerNote }: { product: Product; footerNote?: string }) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-lg shadow-slate-950/40">
      <div className="mb-4">
        <h3 className="text-xl font-semibold text-white">{product.name}</h3>
        <p className="mt-2 text-3xl font-bold text-emerald-400">
          {formatPrice(product.price_cents, product.billing_cycle)}
        </p>
      </div>
      <p className="flex-1 text-sm leading-6 text-slate-300">{product.description}</p>
      {footerNote ? <p className="mt-4 text-xs text-slate-400">{footerNote}</p> : null}
      <div className="mt-6 flex gap-3">
        <a
          href={`/checkout?product_id=${product.id}`}
          className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
        >
          Get started
        </a>
        <Link
          to={`/products/${product.slug}`}
          className="inline-flex items-center justify-center rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-100 transition hover:border-slate-500"
        >
          Learn more
        </Link>
      </div>
    </div>
  );
}

function Homepage() {
  const cmsQuery = useQuery({ queryKey: ['cms-public'], queryFn: getPublicCms });
  const productsQuery = useQuery({ queryKey: ['products'], queryFn: getProducts });

  const cms = cmsQuery.data;
  const products = productsQuery.data ?? [];

  return (
    <AppShell>
      <main>
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">Hosted OpenClaw</p>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
              {cms?.hero_headline ?? 'Deploy your OpenClaw instance in minutes.'}
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-300">
              {cms?.hero_subheadline ?? 'Get a prefabricated OpenClaw software instance without wrestling with server setup.'}
            </p>
            <div className="mt-8">
              <Link
                to="/pricing"
                className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                {cms?.hero_cta_text ?? 'See pricing'}
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-white">Plans that get you live fast</h2>
              <p className="mt-2 text-sm text-slate-400">Choose a plan and move straight into onboarding.</p>
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} footerNote={cms?.product_card_footer_note} />
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-semibold text-white">How it works</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {['Choose a plan', 'Check out', 'Your instance is ready'].map((step, index) => (
              <div key={step} className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
                <p className="text-sm font-semibold text-emerald-400">Step {index + 1}</p>
                <h3 className="mt-3 text-lg font-semibold text-white">{step}</h3>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-emerald-900/50 bg-emerald-500/10 p-8">
            <h2 className="text-2xl font-semibold text-white">Earn credits by referring friends</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Share your referral code and collect subscription credits when someone signs up through you.
            </p>
            <a
              href="/dashboard/referrals"
              className="mt-6 inline-flex items-center justify-center rounded-lg border border-emerald-400/30 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:border-emerald-300 hover:text-emerald-200"
            >
              View referral dashboard
            </a>
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function PricingPage() {
  const cmsQuery = useQuery({ queryKey: ['cms-public'], queryFn: getPublicCms });
  const productsQuery = useQuery({ queryKey: ['products'], queryFn: getProducts });

  const cms = cmsQuery.data;
  const products = productsQuery.data ?? [];

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-4xl font-bold tracking-tight text-white">Pricing</h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-300">
          Pick the plan that fits your workload today. You can always contact support for tailored help later.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {products.map((product) => (
            <div key={product.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex flex-col gap-4 border-b border-slate-800 pb-6">
                <h2 className="text-2xl font-semibold text-white">{product.name}</h2>
                <p className="text-3xl font-bold text-emerald-400">{formatPrice(product.price_cents, product.billing_cycle)}</p>
                <p className="text-sm leading-6 text-slate-300">{product.description}</p>
              </div>
              <ul className="mt-6 space-y-3 text-sm text-slate-300">
                {Object.entries(product.vps_spec).map(([key, value]) => (
                  <li key={key} className="flex justify-between gap-4 border-b border-slate-800/70 pb-2 last:border-b-0">
                    <span className="capitalize text-slate-400">{key.replace(/_/g, ' ')}</span>
                    <span className="text-right text-white">{String(value)}</span>
                  </li>
                ))}
              </ul>
              <a
                href={`/checkout?product_id=${product.id}`}
                className="mt-6 inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                Get started
              </a>
            </div>
          ))}
        </div>

        <section className="mt-16">
          <h2 className="text-2xl font-semibold text-white">Frequently asked questions</h2>
          <div className="mt-6 space-y-4">
            {(cms?.faq_entries ?? []).map((entry) => (
              <div key={entry.q} className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
                <h3 className="text-lg font-semibold text-white">{entry.q}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{entry.a}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function ProductPage() {
  const location = useLocation();
  const slug = location.pathname.split('/').at(-1) ?? '';
  const productQuery = useQuery({ queryKey: ['product', slug], queryFn: () => getProduct(slug), enabled: Boolean(slug) });
  const product = productQuery.data;

  return (
    <AppShell>
      <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        {!product ? (
          <p className="text-sm text-slate-400">Loading product...</p>
        ) : (
          <div className="grid gap-10 lg:grid-cols-[1.3fr_0.7fr]">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">{product.name}</p>
              <h1 className="mt-4 text-4xl font-bold tracking-tight text-white">{product.description}</h1>
              <p className="mt-6 text-lg text-slate-300">
                {formatPrice(product.price_cents, product.billing_cycle)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-lg font-semibold text-white">Technical specs</h2>
              <ul className="mt-4 space-y-3 text-sm text-slate-300">
                {Object.entries(product.vps_spec).map(([key, value]) => (
                  <li key={key} className="flex justify-between gap-4 border-b border-slate-800/70 pb-2 last:border-b-0">
                    <span className="capitalize text-slate-400">{key.replace(/_/g, ' ')}</span>
                    <span className="text-right text-white">{String(value)}</span>
                  </li>
                ))}
              </ul>
              <a
                href={`/checkout?product_id=${product.id}`}
                className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                Get started
              </a>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}

export default function App() {
  const location = useLocation();

  useEffect(() => {
    storeReferralCodeFromUrl(location.search);
  }, [location.search]);

  return (
    <Routes>
      <Route path="/" element={<Homepage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/products/:slug" element={<ProductPage />} />
    </Routes>
  );
}
