import { useState } from 'react';

export function OverrideRateModal({
  open,
  onClose,
  onSubmit,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { custom_reward_rate_percent: number; reason: string }) => Promise<void>;
  loading: boolean;
}) {
  const [rate, setRate] = useState('15');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const rateValue = Number(rate);
    if (!Number.isFinite(rateValue) || rateValue < 0 || rateValue > 100) {
      setError('Enter a valid reward rate between 0 and 100.');
      return;
    }
    try {
      await onSubmit({ custom_reward_rate_percent: rateValue, reason });
      setReason('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save override');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-xl font-semibold">Set user override rate</h3>
        <p className="mt-2 text-sm text-slate-400">Assign a custom referral reward rate for this referrer.</p>
        <div className="mt-6 space-y-4">
          <label className="block text-sm"><span className="mb-1 block text-slate-300">Custom reward rate %</span><input type="number" min="0" max="100" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" required /></label>
          <label className="block text-sm"><span className="mb-1 block text-slate-300">Reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-28 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" required /></label>
        </div>
        {error ? <p className="mt-4 text-sm text-rose-400">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200">Cancel</button><button type="submit" disabled={loading} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-60">{loading ? 'Saving…' : 'Save override'}</button></div>
      </form>
    </div>
  );
}
