import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { AdminRole } from '../App';
import { useAuthorizedFetch } from '../lib/api';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

type AuditLogItem = {
  id: string;
  admin_email: string;
  action: string;
  target_type: string;
  target_id: string | null;
  timestamp: string;
  ip: string;
  payload_summary: Record<string, unknown>;
};

type AuditLogResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: AuditLogItem[];
};

export function AuditLogSection({ adminRole }: { adminRole: AdminRole }) {
  const authorizedFetch = useAuthorizedFetch();
  const [page, setPage] = useState(1);
  const [adminFilter, setAdminFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const auditQuery = useQuery({
    queryKey: ['admin-audit-log', page, adminFilter, actionFilter, fromDate, toDate],
    queryFn: async () => {
      const searchParams = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (adminFilter) searchParams.set('admin', adminFilter);
      if (actionFilter) searchParams.set('action', actionFilter);
      if (fromDate) searchParams.set('from', new Date(fromDate).toISOString());
      if (toDate) searchParams.set('to', new Date(toDate).toISOString());
      const response = await authorizedFetch(`/admin/audit-log?${searchParams.toString()}`);
      if (!response.ok) throw new Error('Failed to load audit log');
      return (await response.json()) as AuditLogResponse;
    },
  });

  const totalPages = Math.max(1, Math.ceil((auditQuery.data?.total ?? 0) / (auditQuery.data?.pageSize ?? 20)));

  if (adminRole !== 'super_admin') {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-slate-300">
        This section is restricted to super admins.
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div>
        <h2 className="text-2xl font-semibold">Audit log</h2>
        <p className="mt-2 text-sm text-slate-400">Read-only view of admin actions across the system.</p>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm"><span className="mb-1 block text-slate-300">Admin</span><input value={adminFilter} onChange={(event) => { setPage(1); setAdminFilter(event.target.value); }} placeholder="admin@example.com" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
        <label className="text-sm"><span className="mb-1 block text-slate-300">Action</span><input value={actionFilter} onChange={(event) => { setPage(1); setActionFilter(event.target.value); }} placeholder="PATCH /admin/..." className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
        <label className="text-sm"><span className="mb-1 block text-slate-300">From</span><input type="date" value={fromDate} onChange={(event) => { setPage(1); setFromDate(event.target.value); }} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
        <label className="text-sm"><span className="mb-1 block text-slate-300">To</span><input type="date" value={toDate} onChange={(event) => { setPage(1); setToDate(event.target.value); }} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-sm">
          <thead className="bg-slate-950/80 text-left text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Admin email</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Target type</th>
              <th className="px-4 py-3 font-medium">Target ID</th>
              <th className="px-4 py-3 font-medium">Timestamp</th>
              <th className="px-4 py-3 font-medium">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-900/40">
            {auditQuery.isLoading ? (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={6}>Loading audit log…</td></tr>
            ) : auditQuery.data?.items.length ? (
              auditQuery.data.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-4 text-slate-100">{item.admin_email}</td>
                  <td className="px-4 py-4 text-slate-100">{item.action}</td>
                  <td className="px-4 py-4 text-slate-300">{item.target_type}</td>
                  <td className="px-4 py-4 text-slate-400">{item.target_id ?? '—'}</td>
                  <td className="px-4 py-4 text-slate-400">{formatDate(item.timestamp)}</td>
                  <td className="px-4 py-4 text-slate-400">{item.ip}</td>
                </tr>
              ))
            ) : (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={6}>No audit log entries match the filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
        <p>Page {page} of {totalPages} · {auditQuery.data?.total ?? 0} entries</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="rounded-xl border border-slate-700 px-3 py-2 disabled:opacity-50">Previous</button>
          <button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} className="rounded-xl border border-slate-700 px-3 py-2 disabled:opacity-50">Next</button>
        </div>
      </div>
    </section>
  );
}
