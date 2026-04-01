import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AdminRole } from '../App';
import { FraudModal } from '../components/FraudModal';
import { OverrideRateModal } from '../components/OverrideRateModal';
import { StatusBadge } from '../components/StatusBadge';
import { useAuthorizedFetch } from '../lib/api';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function formatCurrencyCents(amountCents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(amountCents / 100);
}

type ReferralListItem = {
  id: string;
  referral_code: string;
  order_id: string | null;
  status: string;
  fraud_reason: string | null;
  reward_amount_cents: number;
  created_at: string;
  referrer: { id: string; email: string; full_name: string };
  referred: { id: string; email: string; full_name: string };
};

type ReferralListResponse = {
  page: number;
  pageSize: number;
  total: number;
  stats: {
    total_referrals: number;
    converted: number;
    rewarded: number;
    fraud_flagged: number;
  };
  items: ReferralListItem[];
};

type ReferralSettingsResponse = {
  id: number;
  global_reward_rate_percent: number;
  cooling_period_days: number;
  updated_at: string | null;
  updated_by_admin_id: string | null;
};

export function ReferralsSection({ adminRole }: { adminRole: AdminRole }) {
  const authorizedFetch = useAuthorizedFetch();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedReferral, setSelectedReferral] = useState<ReferralListItem | null>(null);
  const [overrideTargetUserId, setOverrideTargetUserId] = useState<string | null>(null);
  const [fraudReferralId, setFraudReferralId] = useState<string | null>(null);
  const [settingsDraft, setSettingsDraft] = useState({ global_reward_rate_percent: '10', cooling_period_days: '14' });
  const canManageReferrals = adminRole === 'super_admin' || adminRole === 'referral_admin';

  const referralsQuery = useQuery({
    queryKey: ['admin-referrals', page],
    queryFn: async () => {
      const response = await authorizedFetch(`/admin/referrals?page=${page}&pageSize=10`);
      if (!response.ok) throw new Error('Failed to load referrals');
      return (await response.json()) as ReferralListResponse;
    },
  });

  const settingsQuery = useQuery({
    queryKey: ['admin-referrals-settings'],
    queryFn: async () => {
      const response = await authorizedFetch('/admin/referrals/settings');
      if (!response.ok) throw new Error('Failed to load referral settings');
      return (await response.json()) as ReferralSettingsResponse;
    },
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setSettingsDraft({
        global_reward_rate_percent: String(settingsQuery.data.global_reward_rate_percent),
        cooling_period_days: String(settingsQuery.data.cooling_period_days),
      });
    }
  }, [settingsQuery.data]);

  const settingsMutation = useMutation({
    mutationFn: async () => {
      const response = await authorizedFetch('/admin/referrals/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          global_reward_rate_percent: Number(settingsDraft.global_reward_rate_percent),
          cooling_period_days: Number(settingsDraft.cooling_period_days),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to save referral settings');
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-referrals-settings'] });
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async (input: { userId: string; custom_reward_rate_percent: number; reason: string }) => {
      const response = await authorizedFetch(`/admin/referrals/users/${input.userId}/override`, {
        method: 'POST',
        body: JSON.stringify({ custom_reward_rate_percent: input.custom_reward_rate_percent, reason: input.reason }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to save override');
      }
      return response.json();
    },
  });

  const fraudMutation = useMutation({
    mutationFn: async (input: { referralId: string; reason: string }) => {
      const response = await authorizedFetch(`/admin/referrals/${input.referralId}/flag`, {
        method: 'POST',
        body: JSON.stringify({ reason: input.reason }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to flag referral');
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-referrals'] });
    },
  });

  const stats = referralsQuery.data?.stats;
  const totalPages = Math.max(1, Math.ceil((referralsQuery.data?.total ?? 0) / (referralsQuery.data?.pageSize ?? 10)));

  return (
    <>
      <section className="space-y-6">
        <div><h2 className="text-2xl font-semibold">Referrals</h2><p className="mt-2 text-sm text-slate-400">Manage referral performance, fraud handling, and reward settings.</p></div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><p className="text-sm text-slate-400">Total referrals</p><p className="mt-2 text-3xl font-semibold">{stats?.total_referrals ?? 0}</p></div><div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><p className="text-sm text-slate-400">Converted</p><p className="mt-2 text-3xl font-semibold">{stats?.converted ?? 0}</p></div><div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><p className="text-sm text-slate-400">Rewarded</p><p className="mt-2 text-3xl font-semibold">{stats?.rewarded ?? 0}</p></div><div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><p className="text-sm text-slate-400">Fraud-flagged</p><p className="mt-2 text-3xl font-semibold">{stats?.fraud_flagged ?? 0}</p></div></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"><div><h3 className="text-lg font-semibold">Global settings</h3><p className="mt-2 text-sm text-slate-400">Adjust reward rate and cooling period inline.</p></div><button type="button" onClick={() => settingsMutation.mutate()} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950" disabled={settingsMutation.isPending}>{settingsMutation.isPending ? 'Saving…' : 'Save settings'}</button></div><div className="mt-6 grid gap-4 md:grid-cols-2"><label className="text-sm"><span className="mb-1 block text-slate-300">Reward rate %</span><input value={settingsDraft.global_reward_rate_percent} onChange={(event) => setSettingsDraft((current) => ({ ...current, global_reward_rate_percent: event.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label><label className="text-sm"><span className="mb-1 block text-slate-300">Cooling period (days)</span><input value={settingsDraft.cooling_period_days} onChange={(event) => setSettingsDraft((current) => ({ ...current, cooling_period_days: event.target.value }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label></div></div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><div className="overflow-hidden rounded-2xl border border-slate-800"><table className="min-w-full divide-y divide-slate-800 text-sm"><thead className="bg-slate-950/80 text-left text-slate-400"><tr><th className="px-4 py-3 font-medium">Referrer email</th><th className="px-4 py-3 font-medium">Referred email</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Reward amount</th><th className="px-4 py-3 font-medium">Created</th><th className="px-4 py-3 font-medium">Actions</th></tr></thead><tbody className="divide-y divide-slate-800 bg-slate-900/40">{referralsQuery.isLoading ? <tr><td className="px-4 py-6 text-slate-400" colSpan={6}>Loading referrals…</td></tr> : referralsQuery.data?.items.length ? referralsQuery.data.items.map((item) => <tr key={item.id}><td className="px-4 py-4 text-slate-100">{item.referrer.email}</td><td className="px-4 py-4 text-slate-100">{item.referred.email}</td><td className="px-4 py-4"><StatusBadge status={item.status} /></td><td className="px-4 py-4 text-slate-200">{formatCurrencyCents(item.reward_amount_cents)}</td><td className="px-4 py-4 text-slate-400">{formatDate(item.created_at)}</td><td className="px-4 py-4"><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setSelectedReferral(item)} className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200">View user</button>{canManageReferrals ? <button type="button" onClick={() => setFraudReferralId(item.id)} className="rounded-xl border border-rose-700 px-3 py-2 text-xs text-rose-200">Flag as fraud</button> : null}{canManageReferrals ? <button type="button" onClick={() => setOverrideTargetUserId(item.referrer.id)} className="rounded-xl bg-sky-500 px-3 py-2 text-xs font-medium text-slate-950">Override rate</button> : null}</div></td></tr>) : <tr><td className="px-4 py-6 text-slate-400" colSpan={6}>No referrals yet.</td></tr>}</tbody></table></div><div className="mt-4 flex items-center justify-between text-sm text-slate-400"><p>Page {page} of {totalPages} · {referralsQuery.data?.total ?? 0} referrals</p><div className="flex gap-2"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="rounded-xl border border-slate-700 px-3 py-2 disabled:opacity-50">Previous</button><button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} className="rounded-xl border border-slate-700 px-3 py-2 disabled:opacity-50">Next</button></div></div></div>
      </section>

      {selectedReferral ? <div className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-6 shadow-2xl shadow-black/30"><div className="flex items-start justify-between gap-4"><div><p className="text-sm uppercase tracking-[0.2em] text-sky-400">Referral detail</p><h3 className="mt-2 text-2xl font-semibold text-slate-100">{selectedReferral.referrer.full_name}</h3><p className="mt-1 text-sm text-slate-400">{selectedReferral.referrer.email}</p></div><button type="button" onClick={() => setSelectedReferral(null)} className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200">Close</button></div><div className="mt-6 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm"><div><p className="text-slate-400">Referred user</p><p className="mt-1 text-slate-100">{selectedReferral.referred.full_name} ({selectedReferral.referred.email})</p></div><div><p className="text-slate-400">Status</p><div className="mt-2"><StatusBadge status={selectedReferral.status} /></div></div><div><p className="text-slate-400">Reward amount</p><p className="mt-1 text-slate-100">{formatCurrencyCents(selectedReferral.reward_amount_cents)}</p></div><div><p className="text-slate-400">Created</p><p className="mt-1 text-slate-100">{formatDate(selectedReferral.created_at)}</p></div>{selectedReferral.fraud_reason ? <div><p className="text-slate-400">Fraud reason</p><p className="mt-1 text-rose-300">{selectedReferral.fraud_reason}</p></div> : null}</div></div> : null}

      <OverrideRateModal open={Boolean(overrideTargetUserId)} onClose={() => setOverrideTargetUserId(null)} onSubmit={(input) => overrideMutation.mutateAsync({ userId: overrideTargetUserId!, ...input }).then(() => undefined)} loading={overrideMutation.isPending} />
      <FraudModal open={Boolean(fraudReferralId)} onClose={() => setFraudReferralId(null)} onSubmit={(input) => fraudMutation.mutateAsync({ referralId: fraudReferralId!, ...input }).then(() => undefined)} loading={fraudMutation.isPending} />
    </>
  );
}
