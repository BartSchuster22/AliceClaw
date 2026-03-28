import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';

import { useAuth } from './auth-context';
import { InstanceStatusCard } from './components/instance-status-card';
import {
  changePassword,
  getUserProfile,
  getUserReferrals,
  getUserSubscriptions,
  logout,
  updateUserProfile,
} from './lib/dashboard-api';
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

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium' }).format(new Date(value));
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}

function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-950 text-slate-100">{children}</div>;
}

function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { accessToken, setAccessToken } = useAuth();
  const navigate = useNavigate();
  const profileQuery = useQuery({
    queryKey: ['user-profile-shell'],
    queryFn: () => getUserProfile(accessToken!),
    enabled: Boolean(accessToken),
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      setAccessToken(null);
      navigate('/login');
    },
  });

  return (
    <AppShell>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-slate-800 bg-slate-900 lg:min-h-screen lg:w-72 lg:border-b-0 lg:border-r">
          <div className="px-6 py-6 text-lg font-semibold text-white">Dashboard</div>
          <nav className="space-y-1 px-3 pb-6">
            {[
              ['/dashboard', 'Overview'],
              ['/dashboard/instances', 'My Instances'],
              ['/dashboard/referrals', 'Referrals'],
              ['/dashboard/profile', 'Profile'],
              ['/dashboard/support', 'Support'],
            ].map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/dashboard'}
                className={({ isActive }) =>
                  `block rounded-lg px-4 py-3 text-sm transition ${isActive ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex-1">
          <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur">
            <div className="flex items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
              <div>
                <p className="text-sm text-slate-400">Signed in as</p>
                <p className="font-medium text-white">{profileQuery.data?.fullName ?? 'Loading…'}</p>
              </div>
              <button
                type="button"
                onClick={() => logoutMutation.mutate()}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Logout
              </button>
            </div>
          </header>
          <main className="px-4 py-8 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
    </AppShell>
  );
}

function LoginPage() {
  return (
    <AppShell>
      <main className="mx-auto max-w-2xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <h1 className="text-3xl font-semibold text-white">Login required</h1>
          <p className="mt-4 text-sm text-slate-300">
            Your refresh session is missing or expired. Go back through checkout or sign in again from the main web app.
          </p>
        </div>
      </main>
    </AppShell>
  );
}

function OverviewPage() {
  const { accessToken } = useAuth();
  const subscriptionsQuery = useQuery({
    queryKey: ['dashboard-subscriptions'],
    queryFn: () => getUserSubscriptions(accessToken!),
    enabled: Boolean(accessToken),
  });
  const referralsQuery = useQuery({
    queryKey: ['dashboard-referrals'],
    queryFn: () => getUserReferrals(accessToken!),
    enabled: Boolean(accessToken),
  });

  const subscriptions = subscriptionsQuery.data ?? [];
  const activeInstancesCount = subscriptions.filter((item) => item.vpsStatus === 'completed').length;
  const latestRenewal = subscriptions.map((item) => item.currentPeriodEnd).sort().at(0) ?? null;

  return (
    <DashboardLayout>
      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm text-slate-400">Active instances</p>
          <p className="mt-3 text-3xl font-semibold text-white">{activeInstancesCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm text-slate-400">Referral credits earned</p>
          <p className="mt-3 text-3xl font-semibold text-white">{formatMoney(referralsQuery.data?.totalCreditCents ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm text-slate-400">Subscription renewal date</p>
          <p className="mt-3 text-3xl font-semibold text-white">{formatDate(latestRenewal)}</p>
        </div>
      </div>
    </DashboardLayout>
  );
}

function InstancesPage() {
  const { accessToken } = useAuth();
  const location = useLocation();
  const subscriptionsQuery = useQuery({
    queryKey: ['dashboard-subscriptions'],
    queryFn: () => getUserSubscriptions(accessToken!),
    enabled: Boolean(accessToken),
    refetchInterval: 8000,
  });

  const subscriptions = subscriptionsQuery.data ?? [];
  const banner = new URLSearchParams(location.search).get('new') === 'true';

  return (
    <DashboardLayout>
      {banner ? (
        <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm text-emerald-200">
          Your instance is being prepared. This takes 5–10 minutes.
        </div>
      ) : null}

      <div className="space-y-6">
        {subscriptions.map((subscription) => (
          <InstanceStatusCard
            key={subscription.subscriptionId}
            subscription={subscription}
            accessToken={accessToken!}
          />
        ))}
      </div>
    </DashboardLayout>
  );
}

function ReferralsPage() {
  const { accessToken } = useAuth();
  const referralsQuery = useQuery({
    queryKey: ['dashboard-referrals'],
    queryFn: () => getUserReferrals(accessToken!),
    enabled: Boolean(accessToken),
  });

  const referrals = referralsQuery.data;

  return (
    <DashboardLayout>
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold text-white">Referral link</h2>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input readOnly value={referrals?.referralLink ?? ''} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-200" />
              <button type="button" onClick={() => navigator.clipboard.writeText(referrals?.referralLink ?? '')} className="rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Copy</button>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <p className="text-sm text-slate-400">Active referrals</p>
              <p className="mt-3 text-3xl font-semibold text-white">{referrals?.activeCount ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <p className="text-sm text-slate-400">Total credit earned</p>
              <p className="mt-3 text-3xl font-semibold text-white">{formatMoney(referrals?.totalCreditCents ?? 0)}</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold text-white">Reward rules</h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Referral rewards are paid as subscription credit only. Credits are applied after the platform cooling period and can be voided if fraud is detected.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold text-white">Referrals</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm text-slate-300">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-3">Referral code</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {(referrals?.referrals ?? []).map((entry) => (
                    <tr key={entry.id} className="border-t border-slate-800">
                      <td className="py-3">{entry.referralCode}</td>
                      <td className="py-3">{entry.status}</td>
                      <td className="py-3">{formatDate(entry.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold text-white">Credit ledger</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm text-slate-300">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-3">Reason</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(referrals?.ledger ?? []).map((entry) => (
                    <tr key={entry.id} className="border-t border-slate-800">
                      <td className="py-3">{entry.reason}</td>
                      <td className="py-3">{entry.status}</td>
                      <td className="py-3">{formatMoney(entry.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-xl font-semibold text-white">QR code</h2>
          <div className="mt-6 inline-flex rounded-2xl bg-white p-4">
            <QRCodeSVG value={referrals?.referralLink ?? 'https://web.canariaslibre.com'} size={180} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function ProfilePage() {
  const { accessToken } = useAuth();
  const profileQuery = useQuery({
    queryKey: ['profile-page'],
    queryFn: () => getUserProfile(accessToken!),
    enabled: Boolean(accessToken),
  });
  const profile = profileQuery.data;
  const [profileForm, setProfileForm] = useState({ full_name: '', phone: '', country: '', company_name: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '' });

  useEffect(() => {
    if (profile) {
      setProfileForm({
        full_name: profile.fullName,
        phone: profile.phone ?? '',
        country: profile.country ?? '',
        company_name: profile.companyName ?? '',
      });
    }
  }, [profile]);

  const updateProfileMutation = useMutation({
    mutationFn: (input: typeof profileForm) => updateUserProfile(accessToken!, input),
  });
  const changePasswordMutation = useMutation({
    mutationFn: (input: typeof passwordForm) => changePassword(accessToken!, input),
  });

  return (
    <DashboardLayout>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-xl font-semibold text-white">Profile</h2>
          <div className="mt-4 space-y-4">
            <input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={profileForm.full_name} onChange={(e) => setProfileForm((s) => ({ ...s, full_name: e.target.value }))} placeholder="Full name" />
            <input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={profileForm.phone} onChange={(e) => setProfileForm((s) => ({ ...s, phone: e.target.value }))} placeholder="Phone" />
            <input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={profileForm.country} onChange={(e) => setProfileForm((s) => ({ ...s, country: e.target.value }))} placeholder="Country" />
            <input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={profileForm.company_name} onChange={(e) => setProfileForm((s) => ({ ...s, company_name: e.target.value }))} placeholder="Company" />
            <button type="button" onClick={() => updateProfileMutation.mutate(profileForm)} className="rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Save profile</button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-xl font-semibold text-white">Change password</h2>
          <div className="mt-4 space-y-4">
            <input type="password" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm((s) => ({ ...s, currentPassword: e.target.value }))} placeholder="Current password" />
            <input type="password" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={passwordForm.newPassword} onChange={(e) => setPasswordForm((s) => ({ ...s, newPassword: e.target.value }))} placeholder="New password" />
            <button type="button" onClick={() => changePasswordMutation.mutate(passwordForm)} className="rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Change password</button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

function SupportPage() {
  return (
    <DashboardLayout>
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <h1 className="text-2xl font-semibold text-white">Support</h1>
        <p className="mt-4 text-sm text-slate-300">Support center placeholder.</p>
      </div>
    </DashboardLayout>
  );
}

function OnboardingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get('orderId') ?? '';
  const { accessToken } = useAuth();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);
  const [error, setError] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ['onboarding-session', orderId],
    queryFn: () => getOnboardingSession(orderId, accessToken!),
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
      accepted_provisioning_notice: Boolean(answers.accepted_provisioning_notice ?? current.accepted_provisioning_notice),
    }));
  }, [sessionQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: { orderId: string; step: number; answers: Record<string, unknown> }) =>
      saveOnboardingStep(payload, accessToken!),
    onSuccess: (data) => {
      setStep(Math.min(data.currentStep + 1, TOTAL_STEPS));
      setError(null);
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to save step');
    },
  });

  const completeMutation = useMutation({
    mutationFn: () => completeOnboarding({ orderId }, accessToken!),
    onSuccess: () => {
      navigate('/dashboard/instances?new=true');
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Failed to complete onboarding');
    },
  });

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  const saveStep = async (stepNumber: number, answers: Record<string, unknown>) => {
    setError(null);
    await saveMutation.mutateAsync({ orderId, step: stepNumber, answers });
  };

  return (
    <AppShell>
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">Onboarding</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white">Set up your OpenClaw instance</h1>
          <p className="mt-4 text-sm text-slate-300">Step {step} of {TOTAL_STEPS}</p>
          <div className="mt-4 h-2 rounded-full bg-slate-800">
            <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.round((step / TOTAL_STEPS) * 100)}%` }} />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
          {step === 1 ? <div className="space-y-6"><h2 className="text-2xl font-semibold text-white">Welcome</h2><button type="button" onClick={() => setStep(2)} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Start setup</button></div> : null}
          {step === 2 ? <div className="space-y-4"><h2 className="text-2xl font-semibold text-white">Your profile</h2><input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Full name" value={state.full_name} onChange={(e) => setState((s) => ({ ...s, full_name: e.target.value }))} /><input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Phone (optional)" value={state.phone} onChange={(e) => setState((s) => ({ ...s, phone: e.target.value }))} /><select className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={state.country} onChange={(e) => setState((s) => ({ ...s, country: e.target.value }))}><option value="">Select country</option><option value="ES">Spain</option><option value="DE">Germany</option><option value="US">United States</option><option value="SG">Singapore</option></select><button type="button" onClick={() => saveStep(2, { full_name: state.full_name, phone: state.phone, country: state.country })} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Next</button></div> : null}
          {step === 3 ? <div className="space-y-4"><h2 className="text-2xl font-semibold text-white">Account type</h2><div className="flex gap-2 rounded-lg bg-slate-800 p-1">{(['private','business'] as const).map((value)=><button key={value} type="button" onClick={() => setState((s) => ({ ...s, account_type: value }))} className={`flex-1 rounded-md px-4 py-3 text-sm ${state.account_type === value ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}>{value === 'private' ? 'Personal' : 'Business'}</button>)}</div>{state.account_type === 'business' ? <><input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Company name" value={state.company_name} onChange={(e) => setState((s) => ({ ...s, company_name: e.target.value }))} /><input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Tax ID (optional)" value={state.tax_id} onChange={(e) => setState((s) => ({ ...s, tax_id: e.target.value }))} /></> : null}<button type="button" onClick={() => saveStep(3, { account_type: state.account_type, company_name: state.company_name, tax_id: state.tax_id })} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Next</button></div> : null}
          {step === 4 ? <div className="space-y-4"><h2 className="text-2xl font-semibold text-white">How will you use OpenClaw?</h2><textarea maxLength={200} className="min-h-32 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Examples: personal AI assistant, research agent, internal automation helper" value={state.intended_use_case} onChange={(e) => setState((s) => ({ ...s, intended_use_case: e.target.value }))} /><button type="button" onClick={() => saveStep(4, { intended_use_case: state.intended_use_case })} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Next</button></div> : null}
          {step === 5 ? <div className="space-y-4"><h2 className="text-2xl font-semibold text-white">Infrastructure preferences</h2><select className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={state.preferred_region} onChange={(e) => setState((s) => ({ ...s, preferred_region: e.target.value }))}><option value="EU">EU (Frankfurt)</option><option value="US">US (Ashburn)</option><option value="APAC">APAC (Singapore)</option></select><button type="button" onClick={() => saveStep(5, { preferred_region: state.preferred_region })} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Next</button></div> : null}
          {step === 6 ? <div className="space-y-4"><h2 className="text-2xl font-semibold text-white">SSH access</h2><p className="text-sm text-slate-300">Paste your public key (starts with ssh-rsa or ssh-ed25519) to enable direct SSH access.</p><textarea className="min-h-32 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={state.ssh_public_key} onChange={(e) => setState((s) => ({ ...s, ssh_public_key: e.target.value }))} /><button type="button" onClick={() => saveStep(6, { ssh_public_key: state.ssh_public_key })} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Next</button></div> : null}
          {step === 7 ? <div className="space-y-5"><h2 className="text-2xl font-semibold text-white">Terms and confirmation</h2><label className="flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" checked={state.accepted_terms} onChange={(e) => setState((s) => ({ ...s, accepted_terms: e.target.checked }))} className="mt-1" /><span>I accept the Terms of Service and Privacy Policy.</span></label><label className="flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" checked={state.accepted_provisioning_notice} onChange={(e) => setState((s) => ({ ...s, accepted_provisioning_notice: e.target.checked }))} className="mt-1" /><span>I understand provisioning takes 5–10 minutes.</span></label><button type="button" onClick={() => completeMutation.mutate()} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Launch my instance</button></div> : null}
          {error ? <p className="mt-6 text-sm text-rose-400">{error}</p> : null}
        </div>
      </main>
    </AppShell>
  );
}

function AppRoutes() {
  const { accessToken, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AppShell><main className="px-6 py-20 text-slate-300">Loading…</main></AppShell>;
  }

  if (!accessToken && location.pathname !== '/login') {
    return <Navigate to="/login" replace />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/dashboard" element={<OverviewPage />} />
      <Route path="/dashboard/instances" element={<InstancesPage />} />
      <Route path="/dashboard/referrals" element={<ReferralsPage />} />
      <Route path="/dashboard/profile" element={<ProfilePage />} />
      <Route path="/dashboard/support" element={<SupportPage />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return <AppRoutes />;
}
