import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { AdminRole } from '../App';
import { useAuthorizedFetch } from '../lib/api';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

type CmsRow = {
  key:
    | 'hero_headline'
    | 'hero_subheadline'
    | 'hero_cta_text'
    | 'product_card_footer_note'
    | 'faq_entries'
    | 'footer_tagline';
  value: string | Array<{ q: string; a: string }>;
  updated_at: string;
  updated_by_admin_id: string;
};

const fieldMeta: Array<{ key: CmsRow['key']; label: string; kind: 'text' | 'faq' }> = [
  { key: 'hero_headline', label: 'Hero headline', kind: 'text' },
  { key: 'hero_subheadline', label: 'Hero subheadline', kind: 'text' },
  { key: 'hero_cta_text', label: 'Hero CTA text', kind: 'text' },
  { key: 'product_card_footer_note', label: 'Product card footer note', kind: 'text' },
  { key: 'faq_entries', label: 'FAQ entries', kind: 'faq' },
  { key: 'footer_tagline', label: 'Footer tagline', kind: 'text' },
];

export function CmsSection({ adminRole }: { adminRole: AdminRole }) {
  const authorizedFetch = useAuthorizedFetch();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const canManageCms = adminRole === 'super_admin' || adminRole === 'content_admin';

  const cmsQuery = useQuery({
    queryKey: ['admin-cms'],
    queryFn: async () => {
      const response = await authorizedFetch('/admin/cms');
      if (!response.ok) throw new Error('Failed to load CMS fields');
      return (await response.json()) as CmsRow[];
    },
  });

  const rowsByKey = useMemo(() => {
    const map = new Map<CmsRow['key'], CmsRow>();
    for (const row of cmsQuery.data ?? []) map.set(row.key, row);
    return map;
  }, [cmsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (input: { key: CmsRow['key']; value: unknown }) => {
      const response = await authorizedFetch(`/admin/cms/${input.key}`, {
        method: 'PATCH',
        body: JSON.stringify({ value: input.value }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'Failed to save CMS field');
      }
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-cms'] });
    },
  });

  function getDraftValue(row: CmsRow) {
    return drafts[row.key] ?? row.value;
  }

  function setDraft(key: CmsRow['key'], value: unknown) {
    setDrafts((current) => ({ ...current, [key]: value }));
  }

  function updateFaqEntry(index: number, field: 'q' | 'a', value: string) {
    const faq = [...((getDraftValue(rowsByKey.get('faq_entries')!) as Array<{ q: string; a: string }>) ?? [])];
    faq[index] = { ...faq[index], [field]: value };
    setDraft('faq_entries', faq);
  }

  function addFaqEntry() {
    const row = rowsByKey.get('faq_entries');
    if (!row) return;
    const faq = [...((getDraftValue(row) as Array<{ q: string; a: string }>) ?? [])];
    faq.push({ q: '', a: '' });
    setDraft('faq_entries', faq);
  }

  function removeFaqEntry(index: number) {
    const row = rowsByKey.get('faq_entries');
    if (!row) return;
    const faq = [...((getDraftValue(row) as Array<{ q: string; a: string }>) ?? [])];
    faq.splice(index, 1);
    setDraft('faq_entries', faq);
  }

  function moveFaqEntry(index: number, direction: -1 | 1) {
    const row = rowsByKey.get('faq_entries');
    if (!row) return;
    const faq = [...((getDraftValue(row) as Array<{ q: string; a: string }>) ?? [])];
    const target = index + direction;
    if (target < 0 || target >= faq.length) return;
    const temp = faq[index];
    faq[index] = faq[target];
    faq[target] = temp;
    setDraft('faq_entries', faq);
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">CMS</h2>
        <p className="mt-2 text-sm text-slate-400">Edit exactly the six approved public content fields.</p>
      </div>

      {cmsQuery.isLoading ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 text-slate-400">Loading CMS fields…</div>
      ) : (
        fieldMeta.map((field) => {
          const row = rowsByKey.get(field.key);
          if (!row) return null;
          const value = getDraftValue(row);

          return (
            <div key={field.key} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{field.label}</h3>
                  <p className="mt-1 text-sm text-slate-400">Last updated: {formatDate(row.updated_at)}</p>
                </div>
                {canManageCms ? (
                  <button
                    type="button"
                    onClick={() => saveMutation.mutate({ key: field.key, value })}
                    className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950"
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                ) : null}
              </div>

              {field.kind === 'text' ? (
                <input
                  value={String(value ?? '')}
                  onChange={(event) => setDraft(field.key, event.target.value)}
                  className="mt-5 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100"
                />
              ) : (
                <div className="mt-5 space-y-4">
                  {((value as Array<{ q: string; a: string }>) ?? []).map((entry, index) => (
                    <div key={`${field.key}-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="text-sm"><span className="mb-1 block text-slate-300">Question</span><input value={entry.q} onChange={(event) => updateFaqEntry(index, 'q', event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
                        <label className="text-sm"><span className="mb-1 block text-slate-300">Answer</span><input value={entry.a} onChange={(event) => updateFaqEntry(index, 'a', event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100" /></label>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" onClick={() => moveFaqEntry(index, -1)} className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200">Move up</button>
                        <button type="button" onClick={() => moveFaqEntry(index, 1)} className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200">Move down</button>
                        <button type="button" onClick={() => removeFaqEntry(index)} className="rounded-xl border border-rose-700 px-3 py-2 text-xs text-rose-200">Remove</button>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={addFaqEntry} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200">Add Q+A pair</button>
                </div>
              )}
            </div>
          );
        })
      )}
    </section>
  );
}
