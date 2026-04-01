import { useEffect, useMemo, useState } from 'react';
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
import {
  completeOnboarding,
  createOrder,
  getDeployStatus,
  getOnboardingSession,
  getProducts,
  loginUser,
  registerUser,
  saveOnboardingStep,
} from './lib/api';

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
  const { accessToken, setAccessToken } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: loginUser,
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      setError(null);
      navigate('/dashboard');
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : 'Login failed');
    },
  });

  if (accessToken) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-2xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <h1 className="text-3xl font-semibold text-white">Sign in</h1>
          <p className="mt-4 text-sm text-slate-300">
            Sign in to continue to your dashboard, onboarding, and referral area.
          </p>

          <form
            className="mt-8 space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);
              await loginMutation.mutateAsync(form);
            }}
          >
            <input
              type="email"
              required
              placeholder="Email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
            />
            <input
              type="password"
              required
              placeholder="Password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
            />
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60"
            >
              {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {error ? <p className="mt-4 text-sm text-rose-400">{error}</p> : null}

          <p className="mt-6 text-sm text-slate-400">
            Need a new instance first? Go to checkout from the marketing site.
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
  const activeInstancesCount = subscriptions.filter((item) => item.containerStatus === 'running').length;
  const pausedInstancesCount = subscriptions.filter((item) => item.containerStatus === 'stopped').length;
  const settingUpCount = subscriptions.filter((item) =>
    ['pending_verification', 'queued', 'allocating', 'deploying', 'starting'].includes(item.containerStatus ?? ''),
  ).length;
  const latestRenewal = subscriptions.map((item) => item.currentPeriodEnd).sort().at(0) ?? null;

  return (
    <DashboardLayout>
      <div className="grid gap-6 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm text-slate-400">Active agents</p>
          <p className="mt-3 text-3xl font-semibold text-white">{activeInstancesCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm text-slate-400">Paused agents</p>
          <p className="mt-3 text-3xl font-semibold text-white">{pausedInstancesCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm text-slate-400">Setting up</p>
          <p className="mt-3 text-3xl font-semibold text-white">{settingUpCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm text-slate-400">Next renewal date</p>
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
              Referral rewards are paid as subscription credit only. Credits move through a cooling period before they are applied, and can be voided if fraud is detected.
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
            <QRCodeSVG value={referrals?.referralLink ?? 'https://aquiero.com'} size={180} />
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
  const subscriptionId = searchParams.get('subscriptionId') ?? '';
  const deploying = searchParams.get('deploying') === 'true';
  const { accessToken } = useAuth();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);
  const [error, setError] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ['onboarding-session', subscriptionId],
    queryFn: () => getOnboardingSession(subscriptionId, accessToken!),
    enabled: Boolean(subscriptionId && accessToken),
  });

  const deployStatusQuery = useQuery({
    queryKey: ['deploy-status', subscriptionId],
    queryFn: () => getDeployStatus(subscriptionId, accessToken!),
    enabled: Boolean(subscriptionId && accessToken && deploying),
    refetchInterval: 5000,
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
      accepted_terms: Boolean(answers.accepted_terms ?? current.accepted_terms),
      accepted_provisioning_notice: Boolean(answers.accepted_provisioning_notice ?? current.accepted_provisioning_notice),
    }));
  }, [sessionQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: { subscriptionId: string; step: number; answers: Record<string, unknown> }) =>
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
    mutationFn: () => completeOnboarding({ subscriptionId }, accessToken!),
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
    await saveMutation.mutateAsync({ subscriptionId, step: stepNumber, answers });
  };

  const deployStatus = deployStatusQuery.data;
  const showDeployPhase = deploying;
  const deployTitleMap: Record<string, string> = {
    pending_verification: 'Confirm your email to begin setup',
    queued: 'Preparing capacity for your agent...',
    allocating: 'Finding the best host for your agent...',
    deploying: 'Starting your agent...',
    starting: 'Finishing setup...',
    running: 'Your agent is ready!',
    failed: 'Setup failed',
  };
  const deploySubtitleMap: Record<string, string> = {
    pending_verification: 'Check your inbox and click the verification link to start deploying your agent.',
    queued: 'Your setup is queued and will begin automatically as soon as a host is available.',
    allocating: 'We are assigning your agent to the best available host.',
    deploying: 'Your container is being created now.',
    starting: 'Your agent is starting up and passing health checks.',
    running: 'Open your agent or continue with optional preferences.',
    failed: 'We were unable to finish setup. Please contact support if this persists.',
  };

  return (
    <AppShell>
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        {showDeployPhase ? (
          <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">Deployment</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-white">
              {deployTitleMap[deployStatus?.containerStatus ?? 'pending_verification'] ?? 'Setting up your agent...'}
            </h1>
            <p className="mt-4 text-sm text-slate-300">
              {deploySubtitleMap[deployStatus?.containerStatus ?? 'pending_verification'] ?? 'Preparing your setup...'}
            </p>
            {deployStatus?.currentStep ? (
              <p className="mt-4 text-xs uppercase tracking-[0.2em] text-slate-500">{deployStatus.currentStep}</p>
            ) : null}
            {deployStatus?.recentLogs?.length ? (
              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
                {deployStatus.recentLogs.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            ) : null}
            {deployStatus?.containerStatus === 'running' && deployStatus.agentUrl ? (
              <div className="mt-6 flex gap-3">
                <a
                  href={deployStatus.agentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950"
                >
                  Open your agent
                </a>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(deployStatus.agentUrl ?? '')}
                  className="rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-200"
                >
                  Copy agent URL
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mb-8">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">Onboarding</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white">Set up your PSI agent</h1>
          <p className="mt-4 text-sm text-slate-300">Step {step} of {TOTAL_STEPS}</p>
          <div className="mt-4 h-2 rounded-full bg-slate-800">
            <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.round((step / TOTAL_STEPS) * 100)}%` }} />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
          {step === 1 ? <div className="space-y-6"><h2 className="text-2xl font-semibold text-white">Welcome</h2><button type="button" onClick={() => setStep(2)} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Start preferences</button></div> : null}
          {step === 2 ? <div className="space-y-4"><h2 className="text-2xl font-semibold text-white">Your profile</h2><input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Full name" value={state.full_name} onChange={(e) => setState((s) => ({ ...s, full_name: e.target.value }))} /><input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Phone (optional)" value={state.phone} onChange={(e) => setState((s) => ({ ...s, phone: e.target.value }))} /><select className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={state.country} onChange={(e) => setState((s) => ({ ...s, country: e.target.value }))}><option value="">Select country</option><option value="ES">Spain</option><option value="DE">Germany</option><option value="US">United States</option><option value="SG">Singapore</option></select><div className="flex gap-3"><button type="button" onClick={() => saveStep(2, { full_name: state.full_name, phone: state.phone, country: state.country })} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Next</button><button type="button" onClick={() => setStep(3)} className="rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-200">Skip for now</button></div></div> : null}
          {step === 3 ? <div className="space-y-4"><h2 className="text-2xl font-semibold text-white">Account type</h2><div className="flex gap-2 rounded-lg bg-slate-800 p-1">{(['private','business'] as const).map((value)=><button key={value} type="button" onClick={() => setState((s) => ({ ...s, account_type: value }))} className={`flex-1 rounded-md px-4 py-3 text-sm ${state.account_type === value ? 'bg-emerald-500 text-slate-950' : 'text-slate-300'}`}>{value === 'private' ? 'Personal' : 'Business'}</button>)}</div>{state.account_type === 'business' ? <><input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Company name" value={state.company_name} onChange={(e) => setState((s) => ({ ...s, company_name: e.target.value }))} /><input className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Tax ID (optional)" value={state.tax_id} onChange={(e) => setState((s) => ({ ...s, tax_id: e.target.value }))} /></> : null}<div className="flex gap-3"><button type="button" onClick={() => saveStep(3, { account_type: state.account_type, company_name: state.company_name, tax_id: state.tax_id })} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Next</button><button type="button" onClick={() => setStep(4)} className="rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-200">Skip for now</button></div></div> : null}
          {step === 4 ? <div className="space-y-4"><h2 className="text-2xl font-semibold text-white">Use case</h2><textarea maxLength={200} className="min-h-32 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Examples: personal AI assistant, research agent, internal automation helper" value={state.intended_use_case} onChange={(e) => setState((s) => ({ ...s, intended_use_case: e.target.value }))} /><div className="flex gap-3"><button type="button" onClick={() => saveStep(4, { intended_use_case: state.intended_use_case })} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Next</button><button type="button" onClick={() => setStep(5)} className="rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-200">Skip for now</button></div></div> : null}
          {step === 5 ? <div className="space-y-4"><h2 className="text-2xl font-semibold text-white">Preferences</h2><select className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3" value={state.preferred_region} onChange={(e) => setState((s) => ({ ...s, preferred_region: e.target.value }))}><option value="EU">EU</option><option value="US">US</option><option value="APAC">APAC</option></select><div className="flex gap-3"><button type="button" onClick={() => saveStep(5, { preferred_region: state.preferred_region })} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Next</button><button type="button" onClick={() => completeMutation.mutate()} className="rounded-lg border border-slate-700 px-4 py-3 text-sm text-slate-200">Skip all and finish</button></div></div> : null}
          {step > 5 ? <div className="space-y-5"><h2 className="text-2xl font-semibold text-white">Setup complete</h2><p className="text-sm text-slate-300">Your agent is already running. You can always adjust preferences later.</p><button type="button" onClick={() => completeMutation.mutate()} className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-slate-950">Finish</button></div> : null}
          {error ? <p className="mt-6 text-sm text-rose-400">{error}</p> : null}
        </div>
      </main>
    </AppShell>
  );
}

function CheckoutPage() {
  const [searchParams] = useSearchParams();
  const productId = searchParams.get('product_id') ?? '';
  const referralCode = searchParams.get('ref') ?? undefined;
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
                    <p className="mt-4 text-2xl font-bold text-emerald-400">{formatMoney(product.price_cents)}</p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Loading product…</p>
                )}

                {referralCode ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                    Referral code applied.
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
              {['Account', 'Order summary', 'Payment'].map((label, index) => {
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

function AppRoutes() {
  const { accessToken, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AppShell><main className="px-6 py-20 text-slate-300">Loading…</main></AppShell>;
  }

  if (!accessToken && location.pathname !== '/login' && location.pathname !== '/checkout') {
    return <Navigate to="/login" replace />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
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
