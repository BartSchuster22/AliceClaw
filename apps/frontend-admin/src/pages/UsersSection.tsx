import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AdminRole } from '../App';
import { CreditModal } from '../components/CreditModal';
import { StatusBadge } from '../components/StatusBadge';
import { useAuthorizedFetch } from '../lib/api';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

type UserListItem = {
  id: string;
  email: string;
  full_name: string;
  status: 'active' | 'suspended';
  subscription_status: string | null;
  join_date: string;
};

type UserListResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: UserListItem[];
};

type UserDetailResponse = {
  profile: {
    id: string;
    email: string;
    full_name: string;
    referral_code: string | null;
    email_verified: boolean;
    status: string;
    created_at: string;
    account_type: string | null;
    company_name: string | null;
    tax_id: string | null;
    phone: string | null;
    country: string | null;
    onboarding_state: string | null;
  };
  subscription_history: Array<{
    id: string;
    status: string;
    current_period_start: string;
    current_period_end: string;
    cancel_at_period_end: boolean;
    created_at: string;
    status_timeline: Array<{ status: string; at: string }>;
  }>;
  referral_history: {
    referred_by: { id: string; email: string; full_name: string } | null;
    referred_count: number;
    referrals_made: Array<{
      id: string;
      referred_user_id: string;
      referred_email: string;
      referred_full_name: string;
      referral_code: string;
      status: string;
      order_id: string | null;
      fraud_reason: string | null;
      created_at: string;
    }>;
    credit_history: Array<{
      id: string;
      amountCents: number;
      status: string;
      reason: string;
      createdAt: string;
    }>;
  };
  audit_trail: Array<{
    id: string;
    admin_user_id: string;
    admin_email: string;
    admin_full_name: string;
    action: string;
    payload_summary: Record<string, unknown>;
    ip_address: string;
    created_at: string;
  }>;
};

export function UsersSection({ adminRole }: { adminRole: AdminRole }) {
  const authorizedFetch = useAuthorizedFetch();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [subscriptionStatusFilter, setSubscriptionStatusFilter] = useState('');
  const [joinedFrom, setJoinedFrom] = useState('');
  const [joinedTo, setJoinedTo] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [creditModalOpen, setCreditModalOpen] = useState(false);

  const canManageUsers = adminRole === 'super_admin' || adminRole === 'support_admin';
  const canAddCredit = adminRole === 'super_admin' || adminRole === 'billing_admin';

  const usersQuery = useQuery({
    queryKey: ['admin-users', page, query, statusFilter, subscriptionStatusFilter, joinedFrom, joinedTo],
    queryFn: async () => {
      const searchParams = new URLSearchParams({ page: String(page), pageSize: '10' });
      if (query) searchParams.set('query', query);
      if (statusFilter) searchParams.set('status', statusFilter);
      if (subscriptionStatusFilter) searchParams.set('subscription_status', subscriptionStatusFilter);
      if (joinedFrom) searchParams.set('joined_from', new Date(joinedFrom).toISOString());
      if (joinedTo) searchParams.set('joined_to', new Date(joinedTo).toISOString());
      const response = await authorizedFetch(`/admin/users?${searchParams.toString()}`);
      if (!response.ok) throw new Error('Failed to load users');
      return (await response.json()) as UserListResponse;
    },
  });

  const userDetailQuery = useQuery({
    queryKey: ['admin-user-detail', selectedUserId],
    enabled: Boolean(selectedUserId),
    queryFn: async () => {
      const response = await authorizedFetch(`/admin/users/${selectedUserId}`);
      if (!response.ok) throw new Error('Failed to load user detail');
      return (await response.json()) as UserDetailResponse;
    },
  });

  const suspendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) throw new Error('No user selected');
      const response = await authorizedFetch(`/admin/users/${selectedUserId}/suspend`, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to suspend user');
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUserId] });
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) throw new Error('No user selected');
      const response = await authorizedFetch(`/admin/users/${selectedUserId}/reactivate`, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to reactivate user');
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUserId] });
    },
  });

  const creditMutation = useMutation({
    mutationFn: async (input: { amount_cents: number; reason: string }) => {
      if (!selectedUserId) throw new Error('No user selected');
      const response = await authorizedFetch(`/admin/users/${selectedUserId}/subscription-credit`, { method: 'POST', body: JSON.stringify(input) });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to add subscription credit');
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-user-detail', selectedUserId] });
    },
  });

  const totalPages = Math.max(1, Math.ceil((usersQuery.data?.total ?? 0) / (usersQuery.data?.pageSize ?? 10)));
  const selectedUser = userDetailQuery.data;

  return (
    <>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div><h2 className="text-2xl font-semibold">Users</h2><p className="mt-2 text-sm text-slate-400">Search, filter, inspect, and act on user accounts.</p></div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm"><span className="mb-1 block text-slate-300">Search</span><input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" placeholder="Email or full name" /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-300">Status</span><select value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value); }} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
          <label className="text-sm"><span className="mb-1 block text-slate-300">Subscription status</span><select value={subscriptionStatusFilter} onChange={(event) => { setPage(1); setSubscriptionStatusFilter(event.target.value); }} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option><option value="expired">Expired</option><option value="provisioning_failed">Provisioning failed</option></select></label>
          <label className="text-sm"><span className="mb-1 block text-slate-300">Joined from</span><input type="date" value={joinedFrom} onChange={(event) => { setPage(1); setJoinedFrom(event.target.value); }} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-300">Joined to</span><input type="date" value={joinedTo} onChange={(event) => { setPage(1); setJoinedTo(event.target.value); }} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
        </div>
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-800"><table className="min-w-full divide-y divide-slate-800 text-sm"><thead className="bg-slate-950/80 text-left text-slate-400"><tr><th className="px-4 py-3 font-medium">Email</th><th className="px-4 py-3 font-medium">Full name</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Subscription</th><th className="px-4 py-3 font-medium">Join date</th></tr></thead><tbody className="divide-y divide-slate-800 bg-slate-900/40">{usersQuery.isLoading ? <tr><td className="px-4 py-6 text-slate-400" colSpan={5}>Loading users…</td></tr> : usersQuery.data?.items.length ? usersQuery.data.items.map((user) => <tr key={user.id} className="cursor-pointer transition hover:bg-slate-800/70" onClick={() => setSelectedUserId(user.id)}><td className="px-4 py-4 text-slate-100">{user.email}</td><td className="px-4 py-4 text-slate-200">{user.full_name}</td><td className="px-4 py-4"><StatusBadge status={user.status} /></td><td className="px-4 py-4"><StatusBadge status={user.subscription_status ?? 'none'} /></td><td className="px-4 py-4 text-slate-400">{formatDate(user.join_date)}</td></tr>) : <tr><td className="px-4 py-6 text-slate-400" colSpan={5}>No users match the current filters.</td></tr>}</tbody></table></div>
        <div className="mt-4 flex items-center justify-between text-sm text-slate-400"><p>Page {page} of {totalPages} · {usersQuery.data?.total ?? 0} users</p><div className="flex gap-2"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="rounded-xl border border-slate-700 px-3 py-2 disabled:opacity-50">Previous</button><button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} className="rounded-xl border border-slate-700 px-3 py-2 disabled:opacity-50">Next</button></div></div>
      </section>

      {selectedUserId ? <div className="fixed inset-y-0 right-0 z-40 w-full max-w-3xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-6 shadow-2xl shadow-black/30"><div className="flex items-start justify-between gap-4"><div><p className="text-sm uppercase tracking-[0.2em] text-sky-400">User detail</p><h3 className="mt-2 text-2xl font-semibold text-slate-100">{selectedUser?.profile.full_name ?? 'Loading…'}</h3><p className="mt-1 text-sm text-slate-400">{selectedUser?.profile.email ?? ''}</p></div><button type="button" onClick={() => setSelectedUserId(null)} className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200">Close</button></div>{userDetailQuery.isLoading ? <p className="mt-6 text-slate-400">Loading user detail…</p> : selectedUser ? <div className="mt-6 space-y-6"><section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"><div className="flex flex-wrap items-center gap-3"><StatusBadge status={selectedUser.profile.status} /><StatusBadge status={selectedUser.profile.account_type ?? 'no-account-type'} /><StatusBadge status={selectedUser.profile.onboarding_state ?? 'no-onboarding-state'} /></div><dl className="mt-4 grid gap-3 text-sm md:grid-cols-2"><div><dt className="text-slate-400">Referral code</dt><dd className="text-slate-100">{selectedUser.profile.referral_code ?? '—'}</dd></div><div><dt className="text-slate-400">Joined</dt><dd className="text-slate-100">{formatDate(selectedUser.profile.created_at)}</dd></div><div><dt className="text-slate-400">Phone</dt><dd className="text-slate-100">{selectedUser.profile.phone ?? '—'}</dd></div><div><dt className="text-slate-400">Country</dt><dd className="text-slate-100">{selectedUser.profile.country ?? '—'}</dd></div><div><dt className="text-slate-400">Company</dt><dd className="text-slate-100">{selectedUser.profile.company_name ?? '—'}</dd></div><div><dt className="text-slate-400">Email verified</dt><dd className="text-slate-100">{selectedUser.profile.email_verified ? 'Yes' : 'No'}</dd></div></dl><div className="mt-5 flex flex-wrap gap-3">{canManageUsers && selectedUser.profile.status !== 'suspended' ? <button type="button" onClick={() => suspendMutation.mutate()} className="rounded-xl border border-rose-700 px-4 py-2 text-sm text-rose-200" disabled={suspendMutation.isPending}>{suspendMutation.isPending ? 'Suspending…' : 'Suspend account'}</button> : null}{canManageUsers && selectedUser.profile.status === 'suspended' ? <button type="button" onClick={() => reactivateMutation.mutate()} className="rounded-xl border border-emerald-700 px-4 py-2 text-sm text-emerald-200" disabled={reactivateMutation.isPending}>{reactivateMutation.isPending ? 'Reactivating…' : 'Reactivate account'}</button> : null}{canAddCredit ? <button type="button" onClick={() => setCreditModalOpen(true)} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950">Add subscription credit</button> : null}</div></section><section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"><h4 className="text-lg font-semibold">Subscription history</h4><div className="mt-4 space-y-3">{selectedUser.subscription_history.length ? selectedUser.subscription_history.map((item) => <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium text-slate-100">Subscription {item.id.slice(0, 8)}…</p><p className="mt-1 text-sm text-slate-400">{formatDate(item.created_at)}</p></div><StatusBadge status={item.status} /></div><div className="mt-3 text-sm text-slate-300"><p>Current period: {formatDate(item.current_period_start)} → {formatDate(item.current_period_end)}</p><p className="mt-2 text-slate-400">Timeline: {item.status_timeline.map((entry) => `${entry.status} @ ${formatDate(entry.at)}`).join(' · ')}</p></div></div>) : <p className="text-sm text-slate-400">No subscription history.</p>}</div></section><section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"><h4 className="text-lg font-semibold">Referral history</h4><div className="mt-4 grid gap-4 text-sm md:grid-cols-2"><div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><p className="text-slate-400">Referred by</p><p className="mt-2 text-slate-100">{selectedUser.referral_history.referred_by ? `${selectedUser.referral_history.referred_by.full_name} (${selectedUser.referral_history.referred_by.email})` : '—'}</p></div><div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4"><p className="text-slate-400">How many they referred</p><p className="mt-2 text-slate-100">{selectedUser.referral_history.referred_count}</p></div></div><div className="mt-4 space-y-3">{selectedUser.referral_history.referrals_made.length ? selectedUser.referral_history.referrals_made.map((item) => <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-slate-100">{item.referred_full_name} · {item.referred_email}</p><p className="mt-1 text-slate-400">Code {item.referral_code} · {formatDate(item.created_at)}</p></div><StatusBadge status={item.status} /></div>{item.fraud_reason ? <p className="mt-2 text-rose-300">Fraud reason: {item.fraud_reason}</p> : null}</div>) : <p className="text-sm text-slate-400">No referrals made.</p>}</div></section><section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"><h4 className="text-lg font-semibold">Audit trail</h4><div className="mt-4 space-y-3">{selectedUser.audit_trail.length ? selectedUser.audit_trail.map((item) => <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-sm"><div className="flex flex-wrap items-center justify-between gap-3"><p className="font-medium text-slate-100">{item.action}</p><p className="text-slate-400">{formatDate(item.created_at)}</p></div><p className="mt-2 text-slate-300">By {item.admin_full_name} ({item.admin_email}) · IP {item.ip_address}</p><pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-300">{JSON.stringify(item.payload_summary, null, 2)}</pre></div>) : <p className="text-sm text-slate-400">No admin actions recorded yet.</p>}</div></section></div> : <p className="mt-6 text-slate-400">Could not load user detail.</p>}</div> : null}

      <CreditModal open={creditModalOpen} onClose={() => setCreditModalOpen(false)} onSubmit={(input) => creditMutation.mutateAsync(input).then(() => undefined)} loading={creditMutation.isPending} />
    </>
  );
}
