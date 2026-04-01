import { useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { useAdminAuth } from './state/admin-auth-context';
import { UsersSection } from './pages/UsersSection';
import { SubscriptionsSection } from './pages/SubscriptionsSection';
import { ProvisioningSection } from './pages/ProvisioningSection';
import { ReferralsSection } from './pages/ReferralsSection';
import { CmsSection } from './pages/CmsSection';
import { AuditLogSection } from './pages/AuditLogSection';
import { ProductCenterSection } from './pages/ProductCenterSection';
import { ServerFleetSection } from './pages/ServerFleetSection';
import { AdminAlertsSection } from './pages/AdminAlertsSection';

export type AdminRole =
  | 'super_admin'
  | 'support_admin'
  | 'billing_admin'
  | 'content_admin'
  | 'provisioning_admin'
  | 'referral_admin'
  | 'unknown';

const navItems: Array<{ label: string; path: string; roles: AdminRole[] }> = [
  { label: 'Overview', path: '/admin', roles: ['super_admin', 'support_admin', 'billing_admin', 'content_admin', 'provisioning_admin', 'referral_admin'] },
  { label: 'Users', path: '/admin/users', roles: ['super_admin', 'support_admin'] },
  { label: 'Subscriptions', path: '/admin/subscriptions', roles: ['super_admin', 'billing_admin'] },
  { label: 'Product Center', path: '/admin/product-center', roles: ['super_admin', 'content_admin', 'provisioning_admin'] },
  { label: 'Server Fleet', path: '/admin/servers', roles: ['super_admin', 'provisioning_admin'] },
  { label: 'Alerts', path: '/admin/alerts', roles: ['super_admin', 'provisioning_admin'] },
  { label: 'CMS', path: '/admin/cms', roles: ['super_admin', 'content_admin'] },
  { label: 'Provisioning', path: '/admin/provisioning', roles: ['super_admin', 'provisioning_admin'] },
  { label: 'Referrals', path: '/admin/referrals', roles: ['super_admin', 'referral_admin'] },
  { label: 'Audit log', path: '/admin/audit-log', roles: ['super_admin'] },
];

function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAdminAuth();
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <LoginForm onSuccess={() => navigate('/admin')} login={login} />
    </main>
  );
}

function LoginForm({
  login,
  onSuccess,
}: {
  login: (params: { email: string; password: string }) => Promise<void>;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await login({ email, password });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl shadow-black/20">
      <div className="mb-8">
        <p className="text-sm uppercase tracking-[0.2em] text-sky-400">PSI Admin</p>
        <h1 className="mt-2 text-3xl font-semibold">Admin login</h1>
        <p className="mt-2 text-sm text-slate-400">Sign in to manage the platform.</p>
      </div>
      <div className="space-y-4">
        <label className="block text-sm"><span className="mb-1 block text-slate-300">Email</span><input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none ring-0 transition focus:border-sky-500" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label className="block text-sm"><span className="mb-1 block text-slate-300">Password</span><input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none ring-0 transition focus:border-sky-500" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
      </div>
      {error ? <p className="mt-4 text-sm text-rose-400">{error}</p> : null}
      <button type="submit" disabled={loading} className="mt-6 w-full rounded-xl bg-sky-500 px-4 py-3 font-medium text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60">{loading ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

function PlaceholderSection({ title, description }: { title: string; description: string }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
      <p className="mt-2 text-sm text-slate-400">{description}</p>
    </section>
  );
}

function AdminShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { admin, logout } = useAdminAuth();
  const adminRole = (admin?.role ?? 'unknown') as AdminRole;
  const allowedNavItems = navItems.filter((item) => item.roles.includes(adminRole));

  function handleLogout() {
    logout();
    navigate('/admin/login');
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="grid min-h-screen lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-slate-800 bg-slate-900/60 p-6 lg:border-b-0 lg:border-r">
          <div><p className="text-xs uppercase tracking-[0.2em] text-sky-400">PSI Admin</p><h1 className="mt-2 text-2xl font-semibold">Control panel</h1></div>
          <nav className="mt-8 space-y-2">{allowedNavItems.map((item) => { const active = location.pathname === item.path; return <button key={item.path} type="button" onClick={() => navigate(item.path)} className={`flex w-full items-center rounded-xl px-4 py-3 text-left text-sm transition ${active ? 'bg-sky-500 text-slate-950' : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-slate-100'}`}>{item.label}</button>; })}</nav>
        </aside>
        <main className="p-6 lg:p-8">
          <header className="mb-8 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 md:flex-row md:items-center md:justify-between"><div><p className="text-sm text-slate-400">Signed in as</p><p className="text-lg font-medium text-slate-100">{admin?.email ?? 'Unknown admin'}</p></div><div className="flex items-center gap-3"><span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-sky-300">{admin?.role ?? 'unknown'}</span><button type="button" onClick={handleLogout} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-800">Logout</button></div></header>
          <Routes>
            <Route index element={<PlaceholderSection title="Overview" description="Admin overview shell is ready. Section content can now be added incrementally." />} />
            <Route path="users" element={<UsersSection adminRole={adminRole} />} />
            <Route path="subscriptions" element={<SubscriptionsSection adminRole={adminRole} />} />
            <Route path="product-center" element={<ProductCenterSection adminRole={adminRole} />} />
            <Route path="servers" element={<ServerFleetSection adminRole={adminRole} />} />
            <Route path="alerts" element={<AdminAlertsSection adminRole={adminRole} />} />
            <Route path="cms" element={<CmsSection adminRole={adminRole} />} />
            <Route path="provisioning" element={<ProvisioningSection adminRole={adminRole} />} />
            <Route path="referrals" element={<ReferralsSection adminRole={adminRole} />} />
            <Route path="audit-log" element={<AuditLogSection adminRole={adminRole} />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function ProtectedAdminApp() {
  const { accessToken } = useAdminAuth();
  if (!accessToken) return <Navigate to="/admin/login" replace />;
  return <AdminShell />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin/*" element={<ProtectedAdminApp />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
