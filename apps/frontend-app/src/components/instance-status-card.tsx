import { useQuery } from '@tanstack/react-query';

import { getInstanceStatus, type UserSubscription } from '../lib/dashboard-api';

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IE', { dateStyle: 'medium' }).format(new Date(value));
}

function getStatusBadge(status: string | null) {
  if (!status) return { label: 'Unknown', className: 'bg-slate-700 text-slate-200' };
  if (['queued', 'creating_server', 'server_ready', 'provisioning'].includes(status)) {
    return { label: 'Setting up', className: 'bg-amber-500/15 text-amber-300 border border-amber-500/30' };
  }
  if (status === 'completed') {
    return { label: 'Running', className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' };
  }
  if (status === 'failed') {
    return { label: 'Setup failed', className: 'bg-rose-500/15 text-rose-300 border border-rose-500/30' };
  }
  if (status === 'suspended') {
    return { label: 'Suspended', className: 'bg-slate-700 text-slate-200 border border-slate-600' };
  }
  return { label: status, className: 'bg-slate-700 text-slate-200 border border-slate-600' };
}

export function InstanceStatusCard({
  subscription,
  accessToken,
}: {
  subscription: UserSubscription;
  accessToken: string;
}) {
  const shouldPoll =
    Boolean(subscription.vpsInstanceId) &&
    ['queued', 'creating_server', 'server_ready', 'provisioning'].includes(subscription.vpsStatus ?? '');

  const statusQuery = useQuery({
    queryKey: ['instance-status', subscription.vpsInstanceId],
    queryFn: () => getInstanceStatus(accessToken, subscription.vpsInstanceId!),
    enabled: Boolean(accessToken && shouldPoll),
    refetchInterval: shouldPoll ? 8000 : false,
  });

  const badge = getStatusBadge(subscription.vpsStatus ?? subscription.status);
  const currentStep = statusQuery.data?.provisioningJob?.currentStep;
  const ipAddress = statusQuery.data?.instance.ipAddress ?? subscription.ipAddress;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">{subscription.productName}</h2>
          <p className="mt-2 text-sm text-slate-400">
            Region: {subscription.region ?? '—'} · Renewal: {formatDate(subscription.currentPeriodEnd)}
          </p>
        </div>
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${badge.className}`}>{badge.label}</span>
      </div>

      {currentStep ? <p className="mt-4 text-sm text-amber-300">Current step: {currentStep}</p> : null}

      {(subscription.vpsStatus ?? '') === 'completed' && ipAddress ? (
        <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm text-slate-300">
          <p>IP address: {ipAddress}</p>
          <a
            className="mt-2 block text-emerald-300 hover:text-emerald-200"
            href={`http://${ipAddress}:8080`}
            target="_blank"
            rel="noreferrer"
          >
            OpenClaw URL: http://{ipAddress}:8080
          </a>
          <p className="mt-2 text-slate-400">Your credentials were emailed to you.</p>
        </div>
      ) : null}
    </div>
  );
}
