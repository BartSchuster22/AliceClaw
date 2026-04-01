import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AdminRole } from '../App';
import { StatusBadge } from '../components/StatusBadge';
import { useAuthorizedFetch } from '../lib/api';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

type ProvisioningListItem = {
  id: string;
  user_email: string;
  product: string;
  status: string;
  current_step: string | null;
  retry_count: number;
  created: string;
  finished: string | null;
  error_message: string | null;
  log_lines: string[];
  vps_instance_id: string;
  subscription_id: string;
};

type ProvisioningListResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: ProvisioningListItem[];
};

export function ProvisioningSection({ adminRole }: { adminRole: AdminRole }) {
  const authorizedFetch = useAuthorizedFetch();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedJob, setSelectedJob] = useState<ProvisioningListItem | null>(null);
  const canManageProvisioning = adminRole === 'super_admin' || adminRole === 'provisioning_admin';

  const provisioningQuery = useQuery({
    queryKey: ['admin-provisioning', page, statusFilter],
    queryFn: async () => {
      const searchParams = new URLSearchParams({ page: String(page), pageSize: '10' });
      if (statusFilter) searchParams.set('status', statusFilter);
      const response = await authorizedFetch(`/admin/provisioning?${searchParams.toString()}`);
      if (!response.ok) throw new Error('Failed to load provisioning jobs');
      return (await response.json()) as ProvisioningListResponse;
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await authorizedFetch(`/admin/provisioning/${jobId}/retry`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to retry provisioning job');
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-provisioning'] });
    },
  });

  const totalPages = Math.max(1, Math.ceil((provisioningQuery.data?.total ?? 0) / (provisioningQuery.data?.pageSize ?? 10)));

  return (
    <>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div><h2 className="text-2xl font-semibold">Provisioning queue</h2><p className="mt-2 text-sm text-slate-400">Inspect provisioning jobs, logs, failures, and retries.</p></div>
        <div className="mt-6 max-w-xs"><label className="text-sm"><span className="mb-1 block text-slate-300">Status</span><select value={statusFilter} onChange={(event) => { setPage(1); setStatusFilter(event.target.value); }} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"><option value="">All</option><option value="queued">Queued</option><option value="running">Running</option><option value="completed">Completed</option><option value="failed">Failed</option></select></label></div>
        <div className="mt-6 overflow-hidden rounded-2xl border border-slate-800"><table className="min-w-full divide-y divide-slate-800 text-sm"><thead className="bg-slate-950/80 text-left text-slate-400"><tr><th className="px-4 py-3 font-medium">User email</th><th className="px-4 py-3 font-medium">Product</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Current step</th><th className="px-4 py-3 font-medium">Retry count</th><th className="px-4 py-3 font-medium">Created</th><th className="px-4 py-3 font-medium">Finished</th></tr></thead><tbody className="divide-y divide-slate-800 bg-slate-900/40">{provisioningQuery.isLoading ? <tr><td className="px-4 py-6 text-slate-400" colSpan={7}>Loading provisioning jobs…</td></tr> : provisioningQuery.data?.items.length ? provisioningQuery.data.items.map((job) => <tr key={job.id} className="cursor-pointer transition hover:bg-slate-800/70" onClick={() => setSelectedJob(job)}><td className="px-4 py-4 text-slate-100">{job.user_email}</td><td className="px-4 py-4 text-slate-200">{job.product}</td><td className="px-4 py-4"><StatusBadge status={job.status} /></td><td className="px-4 py-4 text-slate-300">{job.current_step ?? '—'}</td><td className="px-4 py-4 text-slate-300">{job.retry_count}</td><td className="px-4 py-4 text-slate-400">{formatDate(job.created)}</td><td className="px-4 py-4 text-slate-400">{formatDate(job.finished)}</td></tr>) : <tr><td className="px-4 py-6 text-slate-400" colSpan={7}>No provisioning jobs match the current filter.</td></tr>}</tbody></table></div>
        <div className="mt-4 flex items-center justify-between text-sm text-slate-400"><p>Page {page} of {totalPages} · {provisioningQuery.data?.total ?? 0} jobs</p><div className="flex gap-2"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="rounded-xl border border-slate-700 px-3 py-2 disabled:opacity-50">Previous</button><button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} className="rounded-xl border border-slate-700 px-3 py-2 disabled:opacity-50">Next</button></div></div>
      </section>

      {selectedJob ? <div className="fixed inset-y-0 right-0 z-40 w-full max-w-3xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-6 shadow-2xl shadow-black/30"><div className="flex items-start justify-between gap-4"><div><p className="text-sm uppercase tracking-[0.2em] text-sky-400">Provisioning job detail</p><h3 className="mt-2 text-2xl font-semibold text-slate-100">{selectedJob.user_email}</h3><p className="mt-1 text-sm text-slate-400">Job {selectedJob.id}</p></div><button type="button" onClick={() => setSelectedJob(null)} className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200">Close</button></div><div className="mt-6 space-y-6"><section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"><div className="flex flex-wrap items-center gap-3"><StatusBadge status={selectedJob.status} />{selectedJob.current_step ? <StatusBadge status={selectedJob.current_step} /> : null}</div><dl className="mt-4 grid gap-3 text-sm md:grid-cols-2"><div><dt className="text-slate-400">Product</dt><dd className="text-slate-100">{selectedJob.product}</dd></div><div><dt className="text-slate-400">Retry count</dt><dd className="text-slate-100">{selectedJob.retry_count}</dd></div><div><dt className="text-slate-400">Created</dt><dd className="text-slate-100">{formatDate(selectedJob.created)}</dd></div><div><dt className="text-slate-400">Finished</dt><dd className="text-slate-100">{formatDate(selectedJob.finished)}</dd></div></dl>{selectedJob.error_message ? <div className="mt-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200"><p className="font-medium">Error</p><p className="mt-2">{selectedJob.error_message}</p></div> : null}{canManageProvisioning && selectedJob.status === 'failed' ? <div className="mt-5"><button type="button" onClick={() => retryMutation.mutate(selectedJob.id)} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950" disabled={retryMutation.isPending}>{retryMutation.isPending ? 'Retrying…' : 'Retry job'}</button></div> : null}</section><section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"><h4 className="text-lg font-semibold">Log lines</h4><div className="mt-4 overflow-x-auto rounded-xl bg-slate-950 p-4 text-sm text-slate-300"><pre>{selectedJob.log_lines.length ? selectedJob.log_lines.join('\n') : 'No log lines recorded.'}</pre></div></section></div></div> : null}
    </>
  );
}
