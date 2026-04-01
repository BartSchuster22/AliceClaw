import { useState } from 'react';

export function FraudModal({
  open,
  onClose,
  onSubmit,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { reason: string }) => Promise<void>;
  loading: boolean;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }
    try {
      await onSubmit({ reason });
      setReason('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to flag referral');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-xl font-semibold">Flag referral as fraud</h3>
        <p className="mt-2 text-sm text-slate-400">Provide a reason for the fraud flag.</p>
        <div className="mt-6"><label className="block text-sm"><span className="mb-1 block text-slate-300">Reason</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-28 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" required /></label></div>
        {error ? <p className="mt-4 text-sm text-rose-400">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200">Cancel</button><button type="submit" disabled={loading} className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{loading ? 'Saving…' : 'Flag fraud'}</button></div>
      </form>
    </div>
  );
}
