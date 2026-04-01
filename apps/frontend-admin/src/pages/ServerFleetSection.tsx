import { useEffect, useState } from 'react';

const defaultTemplateForm = {
  name: '',
  provider: 'hetzner',
  instanceType: 'cx22',
  region: 'fsn1',
  capacityThresholdPercent: 80,
  managementOverheadPercent: 15,
  expectedCpuMillicores: 4000,
  expectedMemoryMb: 8192,
  expectedDiskGb: 80,
};

import { useAuthorizedFetch } from '../lib/api';
import type { AdminRole } from '../App';

type ProvisionAttempt = {
  id: string;
  status: string;
  failureReason: string | null;
  cleanupStatus: string;
  workerRunId?: string | null;
  providerInstanceId?: string | null;
  finishedAt?: string | null;
  createdAt?: string;
};

type HostRow = {
  id: string;
  name: string;
  provider: string;
  region: string;
  ipAddress: string | null;
  instanceType: string;
  totalCpuMillicores: number;
  totalMemoryMb: number;
  reservedCpuMillicores: number;
  reservedMemoryMb: number;
  status: string;
  utilPercent: number;
  usedCpu: number;
  usedMemory: number;
  containerCount: number;
  latestProvisionAttempt?: ProvisionAttempt | null;
};

type ServerTemplate = {
  id: string;
  name: string;
  provider: string;
  instanceType: string;
  region: string;
  capacityThresholdPercent: number;
  managementOverheadPercent: number;
  expectedCpuMillicores: number;
  expectedMemoryMb: number;
  expectedDiskGb: number;
  isActive: boolean;
};

type ScaleEvent = {
  id: string;
  triggerReason: string;
  status: string;
  createdAt: string;
  failedReason: string | null;
  latestProvisionAttempt?: ProvisionAttempt | null;
};

function formatCpu(value: number) {
  return `${(value / 1000).toFixed(1)} CPU`;
}

function formatMemory(value: number) {
  if (value >= 1024) {
    return `${value / 1024} GB`;
  }
  return `${value} MB`;
}

function getStatusStyle(status: string) {
  switch (status) {
    case 'ready':
      return 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30';
    case 'provisioning':
      return 'bg-sky-500/10 text-sky-300 border border-sky-500/30';
    case 'draining':
      return 'bg-amber-500/10 text-amber-300 border border-amber-500/30';
    case 'failed':
    case 'unreachable':
      return 'bg-rose-500/10 text-rose-300 border border-rose-500/30';
    default:
      return 'bg-slate-700 text-slate-200 border border-slate-600';
  }
}

export function ServerFleetSection({ adminRole }: { adminRole: AdminRole }) {
  const authorizedFetch = useAuthorizedFetch();
  const [mode, setMode] = useState<'fleet' | 'templates' | 'scale-events'>('fleet');
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [templates, setTemplates] = useState<ServerTemplate[]>([]);
  const [scaleEvents, setScaleEvents] = useState<ScaleEvent[]>([]);
  const [selectedHost, setSelectedHost] = useState<HostRow | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [templateForm, setTemplateForm] = useState(defaultTemplateForm);

  async function loadFleet() {
    const [hostsResponse, templatesResponse, scaleEventsResponse] = await Promise.all([
      authorizedFetch('/admin/servers'),
      authorizedFetch('/admin/server-templates'),
      authorizedFetch('/admin/scale-events'),
    ]);

    setHosts((await hostsResponse.json()) as HostRow[]);
    setTemplates((await templatesResponse.json()) as ServerTemplate[]);
    setScaleEvents((await scaleEventsResponse.json()) as ScaleEvent[]);
  }

  useEffect(() => {
    void loadFleet();
    const interval = setInterval(() => {
      void loadFleet();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  async function openHostDetail(host: HostRow) {
    setSelectedHost(host);
    const response = await authorizedFetch(`/admin/servers/${host.id}`);
    setDetail(await response.json());
  }

  async function drainHost(hostId: string) {
    const response = await authorizedFetch(`/admin/servers/${hostId}/drain`, { method: 'POST' });
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    await loadFleet();
  }

  async function manualProvision() {
    const response = await authorizedFetch('/admin/servers/provision', {
      method: 'POST',
      body: JSON.stringify({ reason: 'manual admin trigger' }),
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    await loadFleet();
  }

  async function saveTemplate() {
    setError(null);
    const response = await authorizedFetch('/admin/server-templates', {
      method: 'POST',
      body: JSON.stringify({
        ...templateForm,
        capacityThresholdPercent: Number(templateForm.capacityThresholdPercent),
        managementOverheadPercent: Number(templateForm.managementOverheadPercent),
        expectedCpuMillicores: Number(templateForm.expectedCpuMillicores),
        expectedMemoryMb: Number(templateForm.expectedMemoryMb),
        expectedDiskGb: Number(templateForm.expectedDiskGb),
      }),
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    setTemplateForm(defaultTemplateForm);
    await loadFleet();
  }

  async function activateTemplate(templateId: string) {
    setError(null);
    const response = await authorizedFetch(`/admin/server-templates/${templateId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: true }),
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    await loadFleet();
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-sky-400">Server Fleet</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-100">Fleet, templates, and scale events</h2>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode('fleet')} className={`rounded-xl px-4 py-2 text-sm ${mode === 'fleet' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>Fleet</button>
          <button type="button" onClick={() => setMode('templates')} className={`rounded-xl px-4 py-2 text-sm ${mode === 'templates' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>Templates</button>
          <button type="button" onClick={() => setMode('scale-events')} className={`rounded-xl px-4 py-2 text-sm ${mode === 'scale-events' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>Scale Events</button>
        </div>
      </div>

      {mode === 'fleet' ? (
        <>
          {adminRole === 'super_admin' ? (
            <div>
              <button type="button" onClick={() => void manualProvision()} className="rounded-xl bg-sky-500 px-4 py-3 text-sm font-medium text-slate-950">Provision new server</button>
            </div>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {hosts.map((host) => (
              <button
                key={host.id}
                type="button"
                onClick={() => void openHostDetail(host)}
                className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-left"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-100">{host.name}</h3>
                    <p className="text-sm text-slate-400">{host.region}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs ${getStatusStyle(host.status)}`}>{host.status}</span>
                </div>
                <p className="mt-4 text-xs text-slate-500">{host.ipAddress ?? '—'}</p>
                <div className="mt-4 space-y-3 text-sm text-slate-300">
                  <p>CPU: {formatCpu(host.usedCpu)} / {formatCpu(host.totalCpuMillicores - host.reservedCpuMillicores)}</p>
                  <p>Memory: {formatMemory(host.usedMemory)} / {formatMemory(host.totalMemoryMb - host.reservedMemoryMb)}</p>
                  <p>{host.containerCount} active containers</p>
                  <p>Utilization: {Math.round(host.utilPercent)}%</p>
                  {host.latestProvisionAttempt ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
                      <p>Latest attempt: <span className="text-slate-200">{host.latestProvisionAttempt.status}</span></p>
                      <p>Cleanup: <span className="text-slate-200">{host.latestProvisionAttempt.cleanupStatus}</span></p>
                      <p>Failure: <span className="text-slate-200">{host.latestProvisionAttempt.failureReason ?? '—'}</span></p>
                    </div>
                  ) : null}
                </div>
              </button>
            ))}
          </div>

          {selectedHost && detail ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-slate-100">{selectedHost.name}</h3>
                  <p className="text-sm text-slate-400">{selectedHost.provider} · {selectedHost.instanceType}</p>
                </div>
                {adminRole === 'super_admin' ? (
                  <button type="button" onClick={() => void drainHost(selectedHost.id)} className="rounded-xl border border-amber-500/40 px-4 py-2 text-sm text-amber-300">Drain server</button>
                ) : null}
              </div>
              <div className="mt-6 space-y-4 text-sm text-slate-300">
                {(detail.provisionAttempts ?? []).length ? (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-slate-200">Provision attempts</h4>
                    {(detail.provisionAttempts ?? []).map((attempt: any) => (
                      <div key={attempt.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
                        <p>Attempt: <span className="text-slate-200">{attempt.id}</span></p>
                        <p>Status: <span className="text-slate-200">{attempt.status}</span></p>
                        <p>Cleanup: <span className="text-slate-200">{attempt.cleanupStatus}</span></p>
                        <p>Failure: <span className="text-slate-200">{attempt.failureReason ?? '—'}</span></p>
                        <p>Worker run: <span className="text-slate-200">{attempt.workerRunId ?? '—'}</span></p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {(detail.containers ?? []).map((container: any) => (
                  <div key={container.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                    <p>Container: {container.id}</p>
                    <p>Status: {container.status}</p>
                    <p>Subscription: {container.subscriptionId}</p>
                    <p>Agent URL: {container.agentUrl ?? '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {mode === 'templates' ? (
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-4 lg:grid-cols-2">
            {templates.map((template) => (
              <div key={template.id} className={`rounded-2xl border p-6 ${template.isActive ? 'border-sky-500 bg-sky-500/5' : 'border-slate-800 bg-slate-900/70'}`}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-slate-100">{template.name}</h3>
                  <div className="flex items-center gap-2">
                    {template.isActive ? <span className="rounded-full bg-sky-500 px-3 py-1 text-xs text-slate-950">Active</span> : null}
                    {!template.isActive && adminRole === 'super_admin' ? (
                      <button type="button" onClick={() => void activateTemplate(template.id)} className="rounded-lg border border-sky-500/40 px-3 py-1 text-xs text-sky-300">
                        Set active
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 space-y-2 text-sm text-slate-300">
                  <p>Provider: {template.provider}</p>
                  <p>Instance type: {template.instanceType}</p>
                  <p>Region: {template.region}</p>
                  <p>Threshold: {template.capacityThresholdPercent}%</p>
                  <p>Overhead: {template.managementOverheadPercent}%</p>
                  <p>Capacity: {formatCpu(template.expectedCpuMillicores)} / {formatMemory(template.expectedMemoryMb)}</p>
                </div>
              </div>
            ))}
          </div>

          {adminRole === 'super_admin' ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
              <h3 className="text-lg font-semibold text-slate-100">Create server template</h3>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Template name" value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} />
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Provider" value={templateForm.provider} onChange={(event) => setTemplateForm((current) => ({ ...current, provider: event.target.value }))} />
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Instance type" value={templateForm.instanceType} onChange={(event) => setTemplateForm((current) => ({ ...current, instanceType: event.target.value }))} />
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Region" value={templateForm.region} onChange={(event) => setTemplateForm((current) => ({ ...current, region: event.target.value }))} />
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" type="number" placeholder="Capacity threshold %" value={templateForm.capacityThresholdPercent} onChange={(event) => setTemplateForm((current) => ({ ...current, capacityThresholdPercent: Number(event.target.value) }))} />
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" type="number" placeholder="Management overhead %" value={templateForm.managementOverheadPercent} onChange={(event) => setTemplateForm((current) => ({ ...current, managementOverheadPercent: Number(event.target.value) }))} />
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" type="number" placeholder="Expected CPU millicores" value={templateForm.expectedCpuMillicores} onChange={(event) => setTemplateForm((current) => ({ ...current, expectedCpuMillicores: Number(event.target.value) }))} />
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" type="number" placeholder="Expected memory MB" value={templateForm.expectedMemoryMb} onChange={(event) => setTemplateForm((current) => ({ ...current, expectedMemoryMb: Number(event.target.value) }))} />
                <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" type="number" placeholder="Expected disk GB" value={templateForm.expectedDiskGb} onChange={(event) => setTemplateForm((current) => ({ ...current, expectedDiskGb: Number(event.target.value) }))} />
                <button type="button" onClick={() => void saveTemplate()} className="rounded-xl bg-sky-500 px-4 py-3 text-sm font-medium text-slate-950">Create template</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {mode === 'scale-events' ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <table className="min-w-full text-left text-sm text-slate-300">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-3">Reason</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Created</th>
                <th className="pb-3">Error</th>
              </tr>
            </thead>
            <tbody>
              {scaleEvents.map((event) => (
                <tr key={event.id} className="border-t border-slate-800 align-top">
                  <td className="py-3">{event.triggerReason}</td>
                  <td className="py-3">{event.status}</td>
                  <td className="py-3">{new Date(event.createdAt).toLocaleString()}</td>
                  <td className="py-3">
                    <div>{event.failedReason ?? '—'}</div>
                    {event.latestProvisionAttempt ? (
                      <div className="mt-2 text-xs text-slate-500">
                        <div>Attempt: {event.latestProvisionAttempt.status}</div>
                        <div>Cleanup: {event.latestProvisionAttempt.cleanupStatus}</div>
                        {event.latestProvisionAttempt.failureReason ? <div>Attempt error: {event.latestProvisionAttempt.failureReason}</div> : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
    </section>
  );
}
