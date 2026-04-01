import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';

import {
  createOrder,
  getProduct,
  getProducts,
  getPublicCms,
  loginUser,
  registerUser,
  type Product,
} from './lib/api';

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

function getReferralCode() {
  return sessionStorage.getItem('referral_code') ?? undefined;
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
          href={`https://app.aquiero.com/checkout?product_id=${product.id}`}
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
              href="https://app.aquiero.com/dashboard/referrals"
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
                href={`https://app.aquiero.com/checkout?product_id=${product.id}`}
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
                href={`https://app.aquiero.com/checkout?product_id=${product.id}`}
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

function LegacyCheckoutPageOld() {
  const [searchParams] = useSearchParams();
  const productId = searchParams.get('product_id') ?? '';
  const referralCode = getReferralCode();
  const [mode, setMode] = useState<'signin' | 'create'>('create');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', password: '', fullName: '' });
  const [error, setError] = useState<string | null>(null);

  const productsQuery = useQuery({ queryKey: ['products'], queryFn: getProducts });
  const product = useMemo(
    () => (productsQuery.data ?? []).find((item) => item.id === productId),
    [productsQuery.data, productId],
  );

  const registerMutation = useMutation({
    mutationFn: registerUser,
    onSuccess: (data) => {
      sessionStorage.setItem('access_token', data.accessToken);
      setAccessToken(data.accessToken);
      setError(null);
      setStep(2);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Registration failed');
    },
  });

  const loginMutation = useMutation({
    mutationFn: loginUser,
    onSuccess: (data) => {
      sessionStorage.setItem('access_token', data.accessToken);
      setAccessToken(data.accessToken);
      setError(null);
      setStep(2);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Login failed');
    },
  });

  const orderMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken || !productId) {
        throw new Error('Missing product or auth state');
      }

      return createOrder({ productId, referralCodeUsed: referralCode }, accessToken);
    },
    onSuccess: (data) => {
      setStep(3);
      window.location.href = data.checkoutUrl;
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Checkout failed');
    },
  });

  const submitAccountStep = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (mode === 'create') {
      await registerMutation.mutateAsync({
        email: form.email,
        password: form.password,
        full_name: form.fullName,
        referral_code_used: referralCode,
      });
      return;
    }

    await loginMutation.mutateAsync({
      email: form.email,
      password: form.password,
    });
  };

  return (
    <AppShell>
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mb-10">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">Checkout</p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-white">Get your PSI live</h1>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            {step === 1 ? (
              <form className="space-y-4" onSubmit={submitAccountStep}>
                <div className="flex gap-2 rounded-lg bg-slate-800 p-1 text-sm">
                  <button
                    type="button"
                    onClick={() => setMode('create')}
                    className={`flex-1 rounded-md px-3 py-2 ${mode === 'create' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}
                  >
                    Create account
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('signin')}
                    className={`flex-1 rounded-md px-3 py-2 ${mode === 'signin' ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}
                  >
                    Sign in
                  </button>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-slate-300">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-slate-300">Password</label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                    minLength={8}
                    required
                  />
                </div>

                {mode === 'create' ? (
                  <div>
                    <label className="mb-2 block text-sm text-slate-300">Full name</label>
                    <input
                      type="text"
                      value={form.fullName}
                      onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                      required
                    />
                  </div>
                ) : null}

                {error ? <p className="text-sm text-rose-400">{error}</p> : null}

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  Continue
                </button>
              </form>
            ) : (
              <div className="space-y-6">
                <div>
                  <p className="text-sm text-emerald-400">Step 2</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Order summary</h2>
                </div>

                {product ? (
                  <div className="rounded-xl border border-slate-800 bg-slate-950 p-5">
                    <h3 className="text-xl font-semibold text-white">{product.name}</h3>
                    <p className="mt-2 text-sm text-slate-300">{product.description}</p>
                    <p className="mt-4 text-2xl font-bold text-emerald-400">
                      {formatPrice(product.price_cents, product.billing_cycle)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Loading product…</p>
                )}

                {referralCode ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                    Referral discount applied.
                  </div>
                ) : null}

                {error ? <p className="text-sm text-rose-400">{error}</p> : null}

                <button
                  type="button"
                  onClick={() => orderMutation.mutate()}
                  className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  Confirm and pay
                </button>
              </div>
            )}
          </div>

          <aside className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Progress</h2>
            <ol className="mt-4 space-y-4 text-sm text-slate-300">
              {[
                'Account',
                'Order summary',
                'Payment',
              ].map((label, index) => {
                const currentStep = index + 1;
                return (
                  <li key={label} className="flex items-center gap-3">
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${step >= currentStep ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}
                    >
                      {currentStep}
                    </span>
                    <span>{label}</span>
                  </li>
                );
              })}
            </ol>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}

function LegacyCheckoutRedirectPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.toString();
  const target = query ? `https://app.aquiero.com/checkout?${query}` : 'https://app.aquiero.com/checkout';

  useEffect(() => {
    window.location.replace(target);
  }, [target]);

  return (
    <AppShell>
      <main className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <h1 className="text-3xl font-semibold text-white">Redirecting to secure checkout…</h1>
          <p className="mt-4 text-sm text-slate-300">
            Checkout now lives on app.aquiero.com so the full customer flow stays in one place.
          </p>
          <a href={target} className="mt-6 inline-flex rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">
            Continue to checkout
          </a>
        </div>
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
      <Route path="/checkout" element={<LegacyCheckoutRedirectPage />} />
    </Routes>
  );
}
