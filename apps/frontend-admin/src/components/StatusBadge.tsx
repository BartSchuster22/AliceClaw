export function StatusBadge({ status }: { status: string }) {
  const style =
    status === 'active'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : status === 'running' || status === 'provisioning'
        ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
        : status === 'queued' || status === 'pending' || status === 'converted'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          : status === 'suspended'
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
            : status === 'cancelled' || status === 'fraud_flagged' || status === 'failed' || status === 'voided'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              : status === 'completed' || status === 'rewarded'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-slate-700 bg-slate-800 text-slate-200';

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium uppercase tracking-wide ${style}`}>
      {status}
    </span>
  );
}
