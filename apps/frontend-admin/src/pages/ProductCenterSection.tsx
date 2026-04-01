import { useEffect, useMemo, useState } from 'react';

import { useAuthorizedFetch } from '../lib/api';
import type { AdminRole } from '../App';

type ProductDefinitionRow = {
  id: string;
  productId: string;
  productName: string;
  dockerImage: string;
  dockerTag: string;
  cpuMillicores: number;
  memoryMb: number;
  diskGb: number;
  port: number;
  healthCheckPath: string;
  startupTimeoutSeconds: number;
  active: boolean;
  activeInstanceCount: number;
};

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  price_cents: number;
};

const defaultForm = {
  productId: '',
  dockerImage: '',
  dockerTag: 'latest',
  cpuMillicores: 500,
  memoryMb: 1024,
  diskGb: 10,
  port: 3000,
  healthCheckPath: '/health',
  startupTimeoutSeconds: 120,
  envTemplate: [{ key: '', value: '' }],
  active: true,
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

function buildEnvTemplate(rows: Array<{ key: string; value: string }>) {
  return Object.fromEntries(rows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]));
}

export function ProductCenterSection({ adminRole }: { adminRole: AdminRole }) {
  const authorizedFetch = useAuthorizedFetch();
  const [catalog, setCatalog] = useState<ProductRow[]>([]);
  const [definitions, setDefinitions] = useState<ProductDefinitionRow[]>([]);
  const [selectedDefinition, setSelectedDefinition] = useState<ProductDefinitionRow | null>(null);
  const [mode, setMode] = useState<'catalog' | 'definitions'>('catalog');
  const [form, setForm] = useState(defaultForm);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [catalogResponse, definitionResponse] = await Promise.all([
      authorizedFetch('/products'),
      authorizedFetch('/admin/product-definitions'),
    ]);

    setCatalog((await catalogResponse.json()) as ProductRow[]);
    setDefinitions((await definitionResponse.json()) as ProductDefinitionRow[]);
  }

  useEffect(() => {
    void load();
  }, []);

  const productsWithoutActiveDefinition = useMemo(() => {
    const activeProductIds = new Set(definitions.filter((row) => row.active).map((row) => row.productId));
    return catalog.filter((product) => !activeProductIds.has(product.id));
  }, [catalog, definitions]);

  function startCreate(productId?: string) {
    setSelectedDefinition(null);
    setForm({ ...defaultForm, productId: productId ?? defaultForm.productId });
    setMode('definitions');
  }

  function startEdit(definition: ProductDefinitionRow) {
    setSelectedDefinition(definition);
    setForm({
      productId: definition.productId,
      dockerImage: definition.dockerImage,
      dockerTag: definition.dockerTag,
      cpuMillicores: definition.cpuMillicores,
      memoryMb: definition.memoryMb,
      diskGb: definition.diskGb,
      port: definition.port,
      healthCheckPath: definition.healthCheckPath,
      startupTimeoutSeconds: definition.startupTimeoutSeconds,
      envTemplate: [{ key: '', value: '' }],
      active: definition.active,
    });
    setMode('definitions');
  }

  async function saveDefinition() {
    setError(null);
    const payload = {
      productId: form.productId,
      dockerImage: form.dockerImage,
      dockerTag: form.dockerTag,
      cpuMillicores: Number(form.cpuMillicores),
      memoryMb: Number(form.memoryMb),
      diskGb: Number(form.diskGb),
      envTemplate: buildEnvTemplate(form.envTemplate),
      port: Number(form.port),
      healthCheckPath: form.healthCheckPath,
      startupTimeoutSeconds: Number(form.startupTimeoutSeconds),
      active: form.active,
    };

    const response = await authorizedFetch(
      selectedDefinition ? `/admin/product-definitions/${selectedDefinition.id}` : '/admin/product-definitions',
      {
        method: selectedDefinition ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    await load();
    setSelectedDefinition(null);
    setForm(defaultForm);
  }

  async function deactivateDefinition(definitionId: string) {
    const response = await authorizedFetch(`/admin/product-definitions/${definitionId}/deactivate`, {
      method: 'POST',
    });

    if (!response.ok) {
      setError(await response.text());
      return;
    }

    await load();
    setSelectedDefinition(null);
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-sky-400">Product Center</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-100">Catalog and runtime definitions</h2>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMode('catalog')} className={`rounded-xl px-4 py-2 text-sm ${mode === 'catalog' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>Catalog</button>
          <button type="button" onClick={() => setMode('definitions')} className={`rounded-xl px-4 py-2 text-sm ${mode === 'definitions' ? 'bg-sky-500 text-slate-950' : 'bg-slate-800 text-slate-200'}`}>Definitions</button>
        </div>
      </div>

      {mode === 'catalog' ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
          <table className="min-w-full text-left text-sm text-slate-300">
            <thead className="text-slate-500">
              <tr>
                <th className="pb-3">Product</th>
                <th className="pb-3">Price</th>
                <th className="pb-3">Definition</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((product) => {
                const definition = definitions.find((row) => row.productId === product.id && row.active);
                return (
                  <tr key={product.id} className="border-t border-slate-800">
                    <td className="py-3">{product.name}</td>
                    <td className="py-3">{(product.price_cents / 100).toFixed(2)} EUR</td>
                    <td className="py-3">
                      {definition ? (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
                          Configured · {definition.dockerImage}:{definition.dockerTag}
                        </span>
                      ) : (
                        <button type="button" onClick={() => startCreate(product.id)} className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
                          Not configured · Add definition
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-100">Definitions</h3>
              <button type="button" onClick={() => startCreate()} className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950">New definition</button>
            </div>
            <table className="min-w-full text-left text-sm text-slate-300">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-3">Product</th>
                  <th className="pb-3">Image</th>
                  <th className="pb-3">CPU</th>
                  <th className="pb-3">RAM</th>
                  <th className="pb-3">Disk</th>
                  <th className="pb-3">Port</th>
                  <th className="pb-3">Active</th>
                </tr>
              </thead>
              <tbody>
                {definitions.map((definition) => (
                  <tr
                    key={definition.id}
                    className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/40"
                    onClick={() => startEdit(definition)}
                  >
                    <td className="py-3">{definition.productName}</td>
                    <td className="py-3">{definition.dockerImage}:{definition.dockerTag}</td>
                    <td className="py-3">{formatCpu(definition.cpuMillicores)}</td>
                    <td className="py-3">{formatMemory(definition.memoryMb)}</td>
                    <td className="py-3">{definition.diskGb} GB</td>
                    <td className="py-3">{definition.port}</td>
                    <td className="py-3">{definition.active ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <h3 className="text-lg font-semibold text-slate-100">{selectedDefinition ? 'Edit definition' : 'Create definition'}</h3>
            <div className="mt-4 space-y-4 text-sm text-slate-300">
              <label className="block">
                <span className="mb-1 block text-slate-400">Product</span>
                <select
                  value={form.productId}
                  onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value }))}
                  disabled={Boolean(selectedDefinition)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"
                >
                  <option value="">Select product</option>
                  {(selectedDefinition ? catalog : productsWithoutActiveDefinition).map((product) => (
                    <option key={product.id} value={product.id}>{product.name}</option>
                  ))}
                </select>
              </label>

              <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Docker image" value={form.dockerImage} onChange={(event) => setForm((current) => ({ ...current, dockerImage: event.target.value }))} />
              <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Docker tag" value={form.dockerTag} onChange={(event) => setForm((current) => ({ ...current, dockerTag: event.target.value }))} />

              <label className="block">
                <span className="mb-1 block text-slate-400">CPU allocation</span>
                <input type="range" min={100} max={4000} step={100} value={form.cpuMillicores} onChange={(event) => setForm((current) => ({ ...current, cpuMillicores: Number(event.target.value) }))} className="w-full" />
                <p className="mt-1 text-xs text-slate-500">{formatCpu(form.cpuMillicores)}</p>
              </label>

              <label className="block">
                <span className="mb-1 block text-slate-400">Memory allocation</span>
                <select value={form.memoryMb} onChange={(event) => setForm((current) => ({ ...current, memoryMb: Number(event.target.value) }))} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3">
                  {[256, 512, 1024, 2048, 4096, 8192].map((value) => <option key={value} value={value}>{formatMemory(value)}</option>)}
                </select>
              </label>

              <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" type="number" placeholder="Disk GB" value={form.diskGb} onChange={(event) => setForm((current) => ({ ...current, diskGb: Number(event.target.value) }))} />
              <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" type="number" placeholder="Container port" value={form.port} onChange={(event) => setForm((current) => ({ ...current, port: Number(event.target.value) }))} />
              <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Health check path" value={form.healthCheckPath} onChange={(event) => setForm((current) => ({ ...current, healthCheckPath: event.target.value }))} />
              <input className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" type="number" placeholder="Startup timeout" value={form.startupTimeoutSeconds} onChange={(event) => setForm((current) => ({ ...current, startupTimeoutSeconds: Number(event.target.value) }))} />

              <div>
                <p className="mb-2 text-slate-400">Environment template</p>
                {form.envTemplate.map((row, index) => (
                  <div key={`${row.key}-${index}`} className="mb-2 flex gap-2">
                    <input className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="KEY" value={row.key} onChange={(event) => setForm((current) => ({ ...current, envTemplate: current.envTemplate.map((entry, entryIndex) => entryIndex === index ? { ...entry, key: event.target.value } : entry) }))} />
                    <input className="flex-[2] rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="VALUE" value={row.value} onChange={(event) => setForm((current) => ({ ...current, envTemplate: current.envTemplate.map((entry, entryIndex) => entryIndex === index ? { ...entry, value: event.target.value } : entry) }))} />
                  </div>
                ))}
                <button type="button" onClick={() => setForm((current) => ({ ...current, envTemplate: [...current.envTemplate, { key: '', value: '' }] }))} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200">Add row</button>
                <p className="mt-2 text-xs text-slate-500">Available variables: {{user_id}}, {{subscription_id}}, {{container_name}}, {{host_ip}}</p>
              </div>

              {selectedDefinition ? (
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />
                  Active
                </label>
              ) : null}

              {error ? <p className="text-sm text-rose-400">{error}</p> : null}

              <div className="flex gap-3">
                <button type="button" onClick={() => void saveDefinition()} className="rounded-xl bg-sky-500 px-4 py-3 text-sm font-medium text-slate-950">Save</button>
                {selectedDefinition && adminRole === 'super_admin' ? (
                  <button type="button" onClick={() => void deactivateDefinition(selectedDefinition.id)} className="rounded-xl border border-rose-500/40 px-4 py-3 text-sm text-rose-300">Deactivate</button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
