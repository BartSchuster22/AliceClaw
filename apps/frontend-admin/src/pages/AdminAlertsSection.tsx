import { useEffect, useState } from 'react';

import type { AdminRole } from '../App';
import { useAuthorizedFetch } from '../lib/api';

type AlertRow = {
  id: string;
  type: string;
  severity: string;
  entityType: string;
  entityId: string;
  message: string;
  resolvedAt: string | null;
  createdAt: string;
};

export function AdminAlertsSection({ adminRole: _adminRole }: { adminRole: AdminRole }) {
  const authorizedFetch = useAuthorizedFetch();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await authorizedFetch('/admin/alerts');
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    setAlerts((await response.json()) as AlertRow[]);
  }

  useEffect(() => {
    void load();
    const interval = setInterval(() => {
      void load();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  async function resolveAlert(alertId: string) {
    const response = await authorizedFetch(`/admin/alerts/${alertId}/resolve`, { method: 'PATCH' });
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    await load();
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <p className="text-sm uppercase tracking-[0.2em] text-sky-400">Alerts</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-100">Operational alerts</h2>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <table className="min-w-full text-left text-sm text-slate-300">
          <thead className="text-slate-500">
            <tr>
              <th className="pb-3">Type</th>
              <th className="pb-3">Severity</th>
              <th className="pb-3">Entity</th>
              <th className="pb-3">Message</th>
              <th className="pb-3">Created</th>
              <th className="pb-3">Status</th>
              <th className="pb-3"></th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr key={alert.id} className="border-t border-slate-800">
                <td className="py-3">{alert.type}</td>
                <td className="py-3">{alert.severity}</td>
                <td className="py-3">{alert.entityType}:{alert.entityId}</td>
                <td className="py-3">{alert.message}</td>
                <td className="py-3">{new Date(alert.createdAt).toLocaleString()}</td>
                <td className="py-3">{alert.resolvedAt ? 'Resolved' : 'Open'}</td>
                <td className="py-3">
                  {!alert.resolvedAt ? (
                    <button type="button" onClick={() => void resolveAlert(alert.id)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200">
                      Resolve
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
    </section>
  );
}
