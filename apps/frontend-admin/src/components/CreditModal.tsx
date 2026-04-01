import { useState } from 'react';

export function CreditModal({
  open,
  onClose,
  onSubmit,
  loading,
  title = 'Add subscription credit',
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { amount_cents: number; reason: string }) => Promise<void>;
  loading: boolean;
  title?: string;
}) {
  const [amount, setAmount] = useState('500');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const amountCents = Number(amount);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError('Enter a valid positive amount in cents.');
      return;
    }
    try {
      await onSubmit({ amount_cents: amountCents, reason });
      setReason('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add credit');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-xl font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-slate-400">Create a manual credit entry.</p>
        <div className="mt-6 space-y-4">
          <label className="block text-sm"><span className="mb-1 block text-slate-300">Amount (cents)</span><input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" required /></label>
          <label className="block text-sm"><span className="mb-1 block text-slate-300">Reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-28 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" required /></label>
        </div>
        {error ? <p className="mt-4 text-sm text-rose-400">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200">Cancel</button><button type="submit" disabled={loading} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 disabled:opacity-60">{loading ? 'Saving…' : 'Add credit'}</button></div>
      </form>
    </div>
  );
}
