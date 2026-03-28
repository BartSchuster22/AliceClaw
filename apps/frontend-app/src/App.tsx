import { useEffect, useMemo, useState } from 'react';
import { Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';

import { completeOnboarding, getOnboardingSession, saveOnboardingStep } from './lib/api';

const TOTAL_STEPS = 7;

type Answers = Record<string, unknown>;

type WizardState = {
  full_name: string;
  phone: string;
  country: string;
  account_type: 'private' | 'business';
  company_name: string;
  tax_id: string;
  intended_use_case: string;
  preferred_region: string;
  ssh_public_key: string;
  accepted_terms: boolean;
  accepted_provisioning_notice: boolean;
};

const DEFAULT_STATE: WizardState = {
  full_name: '',
  phone: '',
  country: '',
  account_type: 'private',
  company_name: '',
  tax_id: '',
  intended_use_case: '',
  preferred_region: 'EU',
  ssh_public_key: '',
  accepted_terms: false,
  accepted_provisioning_notice: false,
};

function getAccessToken() {
  return sessionStorage.getItem('access_token') ?? '';
}

function looksLikeSshKey(value: string) {
  return /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521)\s+[A-Za-z0-9+/=]+(?:\s+.+)?$/.test(
    value.trim(),
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-950 text-slate-100">{children}</div>;
}

function OnboardingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get('orderId') ?? '';
  const accessToken = getAccessToken();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);
  const [error, setError] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ['onboarding-session', orderId],
    queryFn: () => getOnboardingSession(orderId, accessToken),
    enabled: Boolean(orderId && accessToken),
  });

  useEffect(() => {
    if (!sessionQuery.data) return;

    const answers = sessionQuery.data.answers as Answers;
    setStep(Math.min(Math.max(sessionQuery.data.currentStep, 1), TOTAL_STEPS));
    setState((current) => ({
      ...current,
      full_name: String(answers.full_name ?? current.full_name),
      phone: String(answers.phone ?? current.phone),
      country: String(answers.country ?? current.country),
      account_type: (answers.account_type === 'business' ? 'business' : 'private') as 'private' | 'business',
      company_name: String(answers.company_name ?? current.company_name),
      tax_id: String(answers.tax_id ?? current.tax_id),
      intended_use_case: String(answers.intended_use_case ?? current.intended_use_case),
      preferred_region: String(answers.preferred_region ?? current.preferred_region),
      ssh_public_key: String(answers.ssh_public_key ?? current.ssh_public_key),
      accepted_terms: Boolean(answers.accepted_terms ?? current.accepted_terms),
      accepted_provisioning_notice: Boolean(
        answers.accepted_provisioning_notice ?? current.accepted_provisioning_notice,
      ),
    }));
  }, [sessionQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: { orderId: string; step: number; answers: Record<string, unknown> }) =>
      saveOnboardingStep(payload, accessToken),
    onSuccess: (data) => {
      setStep(Math.min(data.currentStep + 1, TOTAL_STEPS));
      setError(null);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to save step');
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => completeOnboarding({ orderId }, accessToken),
    onSuccess: () => {
      navigate('/dashboard/instances?new=true');
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to complete onboarding');
    },
  });

  const progress = useMemo(() => Math.round((step / TOTAL_STEPS) * 100), [step]);

  const saveStep = async (stepNumber: number, answers: Record<string, unknown>) => {
    setError(null);
    await saveMutation.mutateAsync({ orderId, step: stepNumber, answers });
  };

  const nextButton = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
    >
      {label}
    </button>
  );

  if (!accessToken) {
    return (
      <AppShell>
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
          <p className="text-sm text-rose-400">Missing access token. Start from checkout first.</p>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">Onboarding</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white">Set up your OpenClaw instance</h1>
          <p className="mt-4 text-sm text-slate-300">Step {step} of {TOTAL_STEPS}</p>
          <div className="mt-4 h-2 rounded-full bg-slate-800">
            <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
          {step === 1 ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-white">Welcome</h2>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Your order is confirmed. We just need a few setup preferences before provisioning begins.
                </p>
              </div>
              {nextButton('Start setup', () => setStep(2))}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-white">Your profile</h2>
              <input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Full name" value={state.full_name} onChange={(e) => setState((s) => ({ ...s, full_name: e.target.value }))} />
              <input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Phone (optional)" value={state.phone} onChange={(e) => setState((s) => ({ ...s, phone: e.target.value }))} />
              <select className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={state.country} onChange={(e) => setState((s) => ({ ...s, country: e.target.value }))}>
                <option value="">Select country</option>
                <option value="ES">Spain</option>
                <option value="DE">Germany</option>
                <option value="US">United States</option>
                <option value="SG">Singapore</option>
              </select>
              {nextButton('Next', () => saveStep(2, { full_name: state.full_name, phone: state.phone, country: state.country }))}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-white">Account type</h2>
              <div className="flex gap-2 rounded-lg bg-slate-800 p-1">
                {(['private', 'business'] as const).map((value) => (
                  <button key={value} type="button" onClick={() => setState((s) => ({ ...s, account_type: value }))} className={`flex-1 rounded-md px-4 py-3 text-sm ${state.account_type === value ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}>
                    {value === 'private' ? 'Personal' : 'Business'}
                  </button>
                ))}
              </div>
              {state.account_type === 'business' ? (
                <>
                  <input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Company name" value={state.company_name} onChange={(e) => setState((s) => ({ ...s, company_name: e.target.value }))} />
                  <input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Tax ID (optional)" value={state.tax_id} onChange={(e) => setState((s) => ({ ...s, tax_id: e.target.value }))} />
                </>
              ) : null}
              {nextButton('Next', () => saveStep(3, { account_type: state.account_type, company_name: state.company_name, tax_id: state.tax_id }))}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-white">How will you use OpenClaw?</h2>
              <textarea maxLength={200} className="min-h-32 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Examples: personal AI assistant, research agent, internal automation helper" value={state.intended_use_case} onChange={(e) => setState((s) => ({ ...s, intended_use_case: e.target.value }))} />
              {nextButton('Next', () => saveStep(4, { intended_use_case: state.intended_use_case }))}
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-white">Infrastructure preferences</h2>
              <select className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={state.preferred_region} onChange={(e) => setState((s) => ({ ...s, preferred_region: e.target.value }))}>
                <option value="EU">EU (Frankfurt)</option>
                <option value="US">US (Ashburn)</option>
                <option value="APAC">APAC (Singapore)</option>
              </select>
              {nextButton('Next', () => saveStep(5, { preferred_region: state.preferred_region }))}
            </div>
          ) : null}

          {step === 6 ? (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-white">SSH access</h2>
              <p className="text-sm text-slate-300">Paste your public key (starts with ssh-rsa or ssh-ed25519) to enable direct SSH access.</p>
              <textarea className="min-h-32 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={state.ssh_public_key} onChange={(e) => setState((s) => ({ ...s, ssh_public_key: e.target.value }))} />
              {state.ssh_public_key && !looksLikeSshKey(state.ssh_public_key) ? <p className="text-sm text-amber-400">This key looks unusual. You can continue, but double-check it.</p> : null}
              {nextButton('Next', () => saveStep(6, { ssh_public_key: state.ssh_public_key }))}
            </div>
          ) : null}

          {step === 7 ? (
            <div className="space-y-5">
              <h2 className="text-2xl font-semibold text-white">Terms and confirmation</h2>
              <label className="flex items-start gap-3 text-sm text-slate-300">
                <input type="checkbox" checked={state.accepted_terms} onChange={(e) => setState((s) => ({ ...s, accepted_terms: e.target.checked }))} className="mt-1" />
                <span>I accept the Terms of Service and Privacy Policy.</span>
              </label>
              <label className="flex items-start gap-3 text-sm text-slate-300">
                <input type="checkbox" checked={state.accepted_provisioning_notice} onChange={(e) => setState((s) => ({ ...s, accepted_provisioning_notice: e.target.checked }))} className="mt-1" />
                <span>I understand provisioning takes 5–10 minutes.</span>
              </label>
              <button type="button" onClick={() => completeMutation.mutate()} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400">
                Launch my instance
              </button>
            </div>
          ) : null}

          {error ? <p className="mt-6 text-sm text-rose-400">{error}</p> : null}
        </div>
      </main>
    </AppShell>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <AppShell>
      <main className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-semibold text-white">{title}</h1>
      </main>
    </AppShell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/dashboard/instances" element={<PlaceholderPage title="Instances dashboard" />} />
      <Route path="*" element={<PlaceholderPage title="frontend-app" />} />
    </Routes>
  );
}
