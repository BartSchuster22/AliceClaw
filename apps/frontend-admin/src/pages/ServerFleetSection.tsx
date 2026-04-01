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

function isActiveHostStatus(status: string) {
  return ['ready', 'provisioning', 'draining'].includes(status);
}

function isAttentionHostStatus(status: string) {
  return ['failed', 'unreachable'].includes(status);
}

function getAttemptStatusStyle(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30';
    case 'running':
      return 'bg-sky-500/10 text-sky-300 border border-sky-500/30';
    case 'failed':
      return 'bg-rose-500/10 text-rose-300 border border-rose-500/30';
    default:
      return 'bg-slate-700 text-slate-200 border border-slate-600';
  }
}

function getCleanupStatusStyle(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30';
    case 'failed':
      return 'bg-rose-500/10 text-rose-300 border border-rose-500/30';
    case 'not_required':
      return 'bg-slate-700/60 text-slate-300 border border-slate-600';
    default:
      return 'bg-slate-700 text-slate-200 border border-slate-600';
  }
}

function formatTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
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
  const [showArchivedHosts, setShowArchivedHosts] = useState(false);
  const [showArchivedScaleEvents, setShowArchivedScaleEvents] = useState(false);
  const [fleetFilter, setFleetFilter] = useState<'all' | 'active' | 'attention'>('all');
  const [scaleEventFilter, setScaleEventFilter] = useState<'all' | 'active' | 'failed'>('all');

  async function loadFleet() {
    const [hostsResponse, templatesResponse, scaleEventsResponse] = await Promise.all([
      authorizedFetch(`/admin/servers${showArchivedHosts ? '?includeArchived=true' : ''}`),
      authorizedFetch('/admin/server-templates'),
      authorizedFetch(`/admin/scale-events${showArchivedScaleEvents ? '?includeArchived=true' : ''}`),
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
  }, [showArchivedHosts, showArchivedScaleEvents]);

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

  async function retryScaleEvent(scaleEventId: string) {
    setError(null);
    const response = await authorizedFetch(`/admin/scale-events/${scaleEventId}/retry`, {
      method: 'POST',
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    await loadFleet();
  }

  async function retireHost(hostId: string) {
    setError(null);
    const response = await authorizedFetch(`/admin/servers/${hostId}/retire`, {
      method: 'POST',
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    setSelectedHost(null);
    setDetail(null);
    await loadFleet();
  }

  async function archiveHost(hostId: string) {
    setError(null);
    const response = await authorizedFetch(`/admin/servers/${hostId}/archive`, {
      method: 'POST',
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    setSelectedHost(null);
    setDetail(null);
    await loadFleet();
  }

  async function archiveStaleFailedNoise() {
    setError(null);
    const response = await authorizedFetch('/admin/scale-events/archive-stale-failed', {
      method: 'POST',
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    await loadFleet();
  }

  const activeHosts = hosts.filter((host) => isActiveHostStatus(host.status));
  const attentionHosts = hosts.filter((host) => isAttentionHostStatus(host.status));
  const failedScaleEvents = scaleEvents.filter((event) => event.status === 'failed');
  const activeScaleEvents = scaleEvents.filter((event) => ['triggered', 'provisioning', 'ready'].includes(event.status));
  const fleetHosts = fleetFilter === 'active' ? activeHosts : fleetFilter === 'attention' ? attentionHosts : hosts;
  const visibleScaleEvents =
    scaleEventFilter === 'active'
      ? activeScaleEvents
      : scaleEventFilter === 'failed'
        ? failedScaleEvents
        : scaleEvents;

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
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Active hosts</p>
              <p className="mt-3 text-3xl font-semibold text-slate-100">{activeHosts.length}</p>
            </div>
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-rose-300">Needs attention</p>
              <p className="mt-3 text-3xl font-semibold text-rose-200">{attentionHosts.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Active scale events</p>
              <p className="mt-3 text-3xl font-semibold text-slate-100">{activeScaleEvents.length}</p>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
              <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Failed scale events</p>
              <p className="mt-3 text-3xl font-semibold text-amber-200">{failedScaleEvents.length}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setFleetFilter('all')} className={`rounded-xl px-4 py-2 text-sm ${fleetFilter === 'all' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>All hosts <span className="ml-1 text-xs opacity-70">({hosts.length})</span></button>
              <button type="button" onClick={() => setFleetFilter('active')} className={`rounded-xl px-4 py-2 text-sm ${fleetFilter === 'active' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>Active only <span className="ml-1 text-xs opacity-70">({activeHosts.length})</span></button>
              <button type="button" onClick={() => setFleetFilter('attention')} className={`rounded-xl px-4 py-2 text-sm ${fleetFilter === 'attention' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>Needs attention <span className="ml-1 text-xs opacity-70">({attentionHosts.length})</span></button>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input type="checkbox" checked={showArchivedHosts} onChange={(event) => setShowArchivedHosts(event.target.checked)} />
              Show archived hosts
            </label>
          </div>

          {adminRole === 'super_admin' ? (
            <div>
              <button type="button" onClick={() => void manualProvision()} className="rounded-xl bg-sky-500 px-4 py-3 text-sm font-medium text-slate-950">Provision new server</button>
            </div>
          ) : null}

          <div className="space-y-6">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-100">Active fleet</h3>
                <p className="text-sm text-slate-500">Ready, provisioning, or draining hosts currently in the fleet.</p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {fleetHosts.filter((host) => isActiveHostStatus(host.status)).map((host) => (
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
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-1 ${getAttemptStatusStyle(host.latestProvisionAttempt.status)}`}>Attempt {host.latestProvisionAttempt.status}</span>
                            <span className={`rounded-full px-2 py-1 ${getCleanupStatusStyle(host.latestProvisionAttempt.cleanupStatus)}`}>Cleanup {host.latestProvisionAttempt.cleanupStatus}</span>
                          </div>
                          <p className="mt-2">Last update: <span className="text-slate-200">{formatTime(host.latestProvisionAttempt.finishedAt ?? host.latestProvisionAttempt.createdAt ?? null)}</span></p>
                          <p>Failure: <span className="text-slate-200">{host.latestProvisionAttempt.failureReason ?? '—'}</span></p>
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
              {!fleetHosts.filter((host) => isActiveHostStatus(host.status)).length ? (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-sm text-slate-400">
                  No active hosts match the current filter.
                </div>
              ) : null}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-rose-200">Needs attention</h3>
                <p className="text-sm text-slate-500">Failed or unreachable hosts that may need retry, retirement, or archive actions.</p>
              </div>
              {fleetHosts.some((host) => isAttentionHostStatus(host.status)) ? (
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                  {fleetHosts.filter((host) => isAttentionHostStatus(host.status)).map((host) => (
                    <button
                      key={host.id}
                      type="button"
                      onClick={() => void openHostDetail(host)}
                      className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6 text-left"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-100">{host.name}</h3>
                          <p className="text-sm text-slate-400">{host.region}</p>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs ${getStatusStyle(host.status)}`}>{host.status}</span>
                      </div>
                      <div className="mt-4 space-y-2 text-sm text-slate-300">
                        {host.latestProvisionAttempt ? (
                          <div className="flex flex-wrap gap-2 text-xs">
                            <span className={`rounded-full px-2 py-1 ${getAttemptStatusStyle(host.latestProvisionAttempt.status)}`}>Attempt {host.latestProvisionAttempt.status}</span>
                            <span className={`rounded-full px-2 py-1 ${getCleanupStatusStyle(host.latestProvisionAttempt.cleanupStatus)}`}>Cleanup {host.latestProvisionAttempt.cleanupStatus}</span>
                          </div>
                        ) : null}
                        <p>Failure: {host.latestProvisionAttempt?.failureReason ?? '—'}</p>
                        <p>Last update: {formatTime(host.latestProvisionAttempt?.finishedAt ?? host.latestProvisionAttempt?.createdAt ?? null)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-sm text-slate-400">
                  No hosts currently need attention for the selected filter.
                </div>
              )}
            </div>
          </div>

          {selectedHost && detail ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-slate-100">{selectedHost.name}</h3>
                  <p className="text-sm text-slate-400">{selectedHost.provider} · {selectedHost.instanceType}</p>
                </div>
                {adminRole === 'super_admin' ? (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void drainHost(selectedHost.id)} className="rounded-xl border border-amber-500/40 px-4 py-2 text-sm text-amber-300">Drain server</button>
                    {['failed', 'draining'].includes(selectedHost.status) ? (
                      <>
                        <button type="button" onClick={() => void retireHost(selectedHost.id)} className="rounded-xl border border-rose-500/40 px-4 py-2 text-sm text-rose-300">Retire host</button>
                        <button type="button" onClick={() => void archiveHost(selectedHost.id)} className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-300">Archive host</button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="mt-6 space-y-4 text-sm text-slate-300">
                {(detail.provisionAttempts ?? []).length ? (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-slate-200">Provision attempts</h4>
                    {(detail.provisionAttempts ?? []).map((attempt: any) => (
                      <div key={attempt.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-1 ${getAttemptStatusStyle(attempt.status)}`}>Attempt {attempt.status}</span>
                          <span className={`rounded-full px-2 py-1 ${getCleanupStatusStyle(attempt.cleanupStatus)}`}>Cleanup {attempt.cleanupStatus}</span>
                        </div>
                        <p className="mt-2">Attempt: <span className="text-slate-200">{attempt.id}</span></p>
                        <p>Worker run: <span className="text-slate-200">{attempt.workerRunId ?? '—'}</span></p>
                        <p>Started: <span className="text-slate-200">{formatTime(attempt.startedAt)}</span></p>
                        <p>Finished: <span className="text-slate-200">{formatTime(attempt.finishedAt)}</span></p>
                        <p>Failure: <span className="text-slate-200">{attempt.failureReason ?? '—'}</span></p>
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
        <div className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setScaleEventFilter('all')} className={`rounded-xl px-4 py-2 text-sm ${scaleEventFilter === 'all' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>All events <span className="ml-1 text-xs opacity-70">({scaleEvents.length})</span></button>
              <button type="button" onClick={() => setScaleEventFilter('active')} className={`rounded-xl px-4 py-2 text-sm ${scaleEventFilter === 'active' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>Active only <span className="ml-1 text-xs opacity-70">({activeScaleEvents.length})</span></button>
              <button type="button" onClick={() => setScaleEventFilter('failed')} className={`rounded-xl px-4 py-2 text-sm ${scaleEventFilter === 'failed' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>Failed only <span className="ml-1 text-xs opacity-70">({failedScaleEvents.length})</span></button>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input type="checkbox" checked={showArchivedScaleEvents} onChange={(event) => setShowArchivedScaleEvents(event.target.checked)} />
                Show archived events
              </label>
              {adminRole === 'super_admin' ? (
                <button type="button" onClick={() => void archiveStaleFailedNoise()} className="rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-300">Archive stale failed noise</button>
              ) : null}
            </div>
          </div>

          {visibleScaleEvents.filter((event) => event.status === 'failed').length ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-rose-200">Scale events needing attention</h3>
                <p className="text-sm text-slate-500">Retry or archive failures after reviewing the latest provisioning attempt.</p>
              </div>
              <table className="min-w-full text-left text-sm text-slate-300">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-3">Reason</th>
                    <th className="pb-3">Created</th>
                    <th className="pb-3">Failure</th>
                    <th className="pb-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleScaleEvents.filter((event) => event.status === 'failed').map((event) => (
                    <tr key={event.id} className="border-t border-rose-500/10 align-top">
                      <td className="py-3">{event.triggerReason}</td>
                      <td className="py-3">{new Date(event.createdAt).toLocaleString()}</td>
                      <td className="py-3">
                        <div>{event.failedReason ?? '—'}</div>
                        {event.latestProvisionAttempt ? (
                          <div className="mt-2 space-y-2 text-xs text-slate-500">
                            <div className="flex flex-wrap gap-2">
                              <span className={`rounded-full px-2 py-1 ${getAttemptStatusStyle(event.latestProvisionAttempt.status)}`}>Attempt {event.latestProvisionAttempt.status}</span>
                              <span className={`rounded-full px-2 py-1 ${getCleanupStatusStyle(event.latestProvisionAttempt.cleanupStatus)}`}>Cleanup {event.latestProvisionAttempt.cleanupStatus}</span>
                            </div>
                            <div>Last update: {formatTime(event.latestProvisionAttempt.finishedAt ?? event.latestProvisionAttempt.createdAt ?? null)}</div>
                            {event.latestProvisionAttempt.failureReason ? <div>Attempt error: {event.latestProvisionAttempt.failureReason}</div> : null}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-3">
                        {adminRole === 'super_admin' ? (
                          <button type="button" onClick={() => void retryScaleEvent(event.id)} className="rounded-lg border border-sky-500/40 px-3 py-2 text-xs text-sky-300">
                            Retry
                          </button>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div>
            <h3 className="mb-3 text-lg font-semibold text-slate-100">Recent scale activity</h3>
            {visibleScaleEvents.length ? (
              <table className="min-w-full text-left text-sm text-slate-300">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-3">Reason</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Created</th>
                    <th className="pb-3">Error</th>
                    <th className="pb-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleScaleEvents.map((event) => (
                    <tr key={event.id} className="border-t border-slate-800 align-top">
                      <td className="py-3">{event.triggerReason}</td>
                      <td className="py-3">{event.status}</td>
                      <td className="py-3">{new Date(event.createdAt).toLocaleString()}</td>
                      <td className="py-3">
                        <div>{event.failedReason ?? '—'}</div>
                        {event.latestProvisionAttempt ? (
                          <div className="mt-2 space-y-2 text-xs text-slate-500">
                            <div className="flex flex-wrap gap-2">
                              <span className={`rounded-full px-2 py-1 ${getAttemptStatusStyle(event.latestProvisionAttempt.status)}`}>Attempt {event.latestProvisionAttempt.status}</span>
                              <span className={`rounded-full px-2 py-1 ${getCleanupStatusStyle(event.latestProvisionAttempt.cleanupStatus)}`}>Cleanup {event.latestProvisionAttempt.cleanupStatus}</span>
                            </div>
                            <div>Last update: {formatTime(event.latestProvisionAttempt.finishedAt ?? event.latestProvisionAttempt.createdAt ?? null)}</div>
                            {event.latestProvisionAttempt.failureReason ? <div>Attempt error: {event.latestProvisionAttempt.failureReason}</div> : null}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-3">
                        {adminRole === 'super_admin' && event.status === 'failed' ? (
                          <button type="button" onClick={() => void retryScaleEvent(event.id)} className="rounded-lg border border-sky-500/40 px-3 py-2 text-xs text-sky-300">
                            Retry
                          </button>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-sm text-slate-400">
                No scale events match the current filter.
              </div>
            )}
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
    </section>
  );
}
