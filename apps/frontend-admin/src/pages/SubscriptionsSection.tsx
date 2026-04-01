import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AdminRole } from '../App';
import { CreditModal } from '../components/CreditModal';
import { StatusBadge } from '../components/StatusBadge';
import { useAuthorizedFetch } from '../lib/api';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

type SubscriptionListItem = {
  id: string;
  user_email: string;
  product: string;
  product_id: string;
  status: string;
  billing_provider: string;
  period_end: string;
  created: string;
  stripe_url: string | null;
};

type SubscriptionListResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: SubscriptionListItem[];
};

export function SubscriptionsSection({ adminRole }: { adminRole: AdminRole }) {
  const authorizedFetch = useAuthorizedFetch();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(null);
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const canManageSubscriptions = adminRole === 'super_admin' || adminRole === 'billing_admin';

  const subscriptionsQuery = useQuery({
    queryKey: ['admin-subscriptions', page, statusFilter, productFilter, createdFrom, createdTo],
    queryFn: async () => {
      const searchParams = new URLSearchParams({ page: String(page), pageSize: '10' });
      if (statusFilter) searchParams.set('status', statusFilter);
      if (productFilter) searchParams.set('product_id', productFilter);
      if (createdFrom) searchParams.set('created_from', new Date(createdFrom).toISOString());
      if (createdTo) searchParams.set('created_to', new Date(createdTo).toISOString());
      const response = await authorizedFetch(`/admin/subscriptions?${searchParams.toString()}`);
      if (!response.ok) throw new Error('Failed to load subscriptions');
      return (await response.json()) as SubscriptionListResponse;
    },
  });

  const productOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of subscriptionsQuery.data?.items ?? []) map.set(item.product_id, item.product);
    return [...map.entries()];
  }, [subscriptionsQuery.data?.items]);

  const cancelMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const response = await authorizedFetch(`/admin/subscriptions/${subscriptionId}/cancel`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to cancel subscription');
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] });
    },
  });

  const creditMutation = useMutation({
    mutationFn: async (input: { amount_cents: number; reason: string }) => {
      if (!selectedSubscriptionId) throw new Error('No subscription selected');
      const response = await authorizedFetch(`/admin/subscriptions/${selectedSubscriptionId}/credit`, { method: 'POST', body: JSON.stringify(input) });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to add credit');
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] });
    },
  });

  const totalPages = Math.max(1, Math.ceil((subscriptionsQuery.data?.total ?? 0) / (subscriptionsQuery.data?.pageSize ?? 10)));

  return (
    <>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div><h2 className="text-2xl font-semibold">Subscriptions</h2><p className="mt-2 text-sm text-slate-400">Manage billing lifecycle, visibility, and subscription credit actions.</p></div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm"><span className="mb-1 block text-slate-300">Status</span><select value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value); }} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option><option value="expired">Expired</option><option value="provisioning_failed">Provisioning failed</option></select></label>
          <label className="text-sm"><span className="mb-1 block text-slate-300">Product</span><select value={productFilter} onChange={(event) => { setPage(1); setProductFilter(event.target.value); }} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"><option value="">All</option>{productOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label className="text-sm"><span className="mb-1 block text-slate-300">Created from</span><input type="date" value={createdFrom} onChange={(event) => { setPage(1); setCreatedFrom(event.target.value); }} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
          <label className="text-sm"><span className="mb-1 block text-slate-300">Created to</span><input type="date" value={createdTo} onChange={(event) => { setPage(1); setCreatedTo(event.target.value); }} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
        </div>
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-800"><table className="min-w-full divide-y divide-slate-800 text-sm"><thead className="bg-slate-950/80 text-left text-slate-400"><tr><th className="px-4 py-3 font-medium">User email</th><th className="px-4 py-3 font-medium">Product</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Billing provider</th><th className="px-4 py-3 font-medium">Period end</th><th className="px-4 py-3 font-medium">Created</th><th className="px-4 py-3 font-medium">Actions</th></tr></thead><tbody className="divide-y divide-slate-800 bg-slate-900/40">{subscriptionsQuery.isLoading ? <tr><td className="px-4 py-6 text-slate-400" colSpan={7}>Loading subscriptions…</td></tr> : subscriptionsQuery.data?.items.length ? subscriptionsQuery.data.items.map((item) => <tr key={item.id}><td className="px-4 py-4 text-slate-100">{item.user_email}</td><td className="px-4 py-4 text-slate-200">{item.product}</td><td className="px-4 py-4"><StatusBadge status={item.status} /></td><td className="px-4 py-4 text-slate-300">{item.billing_provider}</td><td className="px-4 py-4 text-slate-400">{formatDate(item.period_end)}</td><td className="px-4 py-4 text-slate-400">{formatDate(item.created)}</td><td className="px-4 py-4"><div className="flex flex-wrap gap-2">{item.stripe_url ? <a href={item.stripe_url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200">View in Stripe</a> : <span className="rounded-xl border border-slate-800 px-3 py-2 text-xs text-slate-500">No Stripe link</span>}{canManageSubscriptions ? <button type="button" onClick={() => cancelMutation.mutate(item.id)} className="rounded-xl border border-rose-700 px-3 py-2 text-xs text-rose-200" disabled={cancelMutation.isPending}>{cancelMutation.isPending ? 'Cancelling…' : 'Cancel'}</button> : null}{canManageSubscriptions ? <button type="button" onClick={() => { setSelectedSubscriptionId(item.id); setCreditModalOpen(true); }} className="rounded-xl bg-sky-500 px-3 py-2 text-xs font-medium text-slate-950">Apply credit</button> : null}</div></td></tr>) : <tr><td className="px-4 py-6 text-slate-400" colSpan={7}>No subscriptions match the current filters.</td></tr>}</tbody></table></div>
        <div className="mt-4 flex items-center justify-between text-sm text-slate-400"><p>Page {page} of {totalPages} · {subscriptionsQuery.data?.total ?? 0} subscriptions</p><div className="flex gap-2"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="rounded-xl border border-slate-700 px-3 py-2 disabled:opacity-50">Previous</button><button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} className="rounded-xl border border-slate-700 px-3 py-2 disabled:opacity-50">Next</button></div></div>
      </section>

      <CreditModal open={creditModalOpen} onClose={() => setCreditModalOpen(false)} onSubmit={(input) => creditMutation.mutateAsync(input).then(() => undefined)} loading={creditMutation.isPending} title="Apply subscription credit" />
    </>
  );
}
