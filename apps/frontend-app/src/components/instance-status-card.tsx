import { useQuery } from '@tanstack/react-query';

import { getInstanceStatus, type UserSubscription } from '../lib/dashboard-api';

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium' }).format(new Date(value));
}

function getStatusBadge(status: string | null) {
  switch (status) {
    case 'pending_verification':
      return { label: 'Awaiting email verification', className: 'bg-slate-700 text-slate-200 border border-slate-600' };
    case 'queued':
      return { label: 'Waiting for capacity', className: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' };
    case 'allocating':
    case 'deploying':
    case 'starting':
      return { label: 'Starting up...', className: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' };
    case 'running':
      return { label: 'Running', className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' };
    case 'unhealthy':
      return { label: 'Unhealthy', className: 'bg-rose-500/15 text-rose-300 border border-rose-500/30' };
    case 'stopping':
      return { label: 'Pausing...', className: 'bg-slate-700 text-slate-200 border border-slate-600' };
    case 'stopped':
      return { label: 'Paused', className: 'bg-slate-700 text-slate-200 border border-slate-600' };
    case 'deleting':
      return { label: 'Decommissioning...', className: 'bg-slate-700 text-slate-200 border border-slate-600' };
    case 'deleted':
      return { label: 'Decommissioned', className: 'bg-slate-700 text-slate-200 border border-slate-600' };
    case 'failed':
      return { label: 'Setup failed', className: 'bg-rose-500/15 text-rose-300 border border-rose-500/30' };
    default:
      return { label: status ?? 'Unknown', className: 'bg-slate-700 text-slate-200 border border-slate-600' };
  }
}

export function InstanceStatusCard({
  subscription,
  accessToken,
}: {
  subscription: UserSubscription;
  accessToken: string;
}) {
  const shouldPoll =
    Boolean(subscription.containerInstanceId) &&
    ['pending_verification', 'queued', 'allocating', 'deploying', 'starting', 'stopping', 'deleting'].includes(
      subscription.containerStatus ?? '',
    );

  const statusQuery = useQuery({
    queryKey: ['instance-status', subscription.containerInstanceId],
    queryFn: () => getInstanceStatus(accessToken, subscription.containerInstanceId!),
    enabled: Boolean(accessToken && shouldPoll),
    refetchInterval: shouldPoll ? 5000 : false,
  });

  const badge = getStatusBadge(subscription.containerStatus ?? subscription.status);
  const currentStep = statusQuery.data?.provisioningJob?.currentStep;
  const agentUrl = subscription.agentUrl ?? null;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">{subscription.productName}</h2>
          <p className="mt-2 text-sm text-slate-400">Renewal: {formatDate(subscription.currentPeriodEnd)}</p>
        </div>
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${badge.className}`}>{badge.label}</span>
      </div>

      {currentStep ? <p className="mt-4 text-sm text-amber-300">Current step: {currentStep}</p> : null}

      <div className="mt-4 space-y-2 text-sm text-slate-300">
        {subscription.startedAt ? <p>Started at: {formatDate(subscription.startedAt)}</p> : null}
        {agentUrl ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <p>Agent URL</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(agentUrl)}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200"
              >
                Copy URL
              </button>
              {subscription.containerStatus === 'running' ? (
                <a
                  className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950"
                  href={agentUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open agent
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
