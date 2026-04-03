# PSI Multi-Provider Provisioning Architecture

Purpose: make PSI multi-provider-ready by architecture while continuing to implement only `mock` and `hetzner` right now.

This is a design/structure document, not a mandate to build every part immediately.

## Design goals

- Keep current Hetzner work valid
- Prevent Hetzner-specific assumptions from leaking upward
- Keep provider-specific logic behind adapters
- Let PSI orchestration own fallback/placement policy
- Support eventual multi-provider provisioning without a rewrite
- Avoid premature complexity in the first live rollout

## Non-goals for this phase

- Do not implement a second real provider yet
- Do not build full automatic cross-provider fallback yet
- Do not massively expand schema/UI before needed
- Do not move product policy into provider adapters

## Mental model

### PSI orchestration layer
Owns:
- deciding when new host capacity is needed
- building approved placement candidates
- choosing which provider candidate to try first
- classifying result as retryable / non-retryable / terminal
- tracking the full provisioning intent and attempts
- surfacing the result in admin/API/state

### Provider adapters
Own:
- talking to one provider API
- translating PSI requests into provider requests
- translating provider responses into PSI-neutral data
- classifying provider-native errors into PSI error categories

Provider adapters do **not** own global fallback policy.

---

# 1. Proposed directory / module layout

Use the current worker/provider layout as the starting point and split it into clearer orchestration vs adapter responsibilities.

## Current rough shape

- `apps/worker/src/providers/*`
- `apps/worker/src/jobs/provision-host-server.ts`
- `apps/worker/src/jobs/retire-host-server.ts`

## Proposed target shape

```text
apps/worker/src/
  jobs/
    provision-host-server.ts
    retire-host-server.ts
    refresh-host-provider-state.ts

  provisioning/
    plan/
      host-placement-planner.ts
      host-placement-policy.ts
      host-placement-candidate.ts
    execution/
      host-provision-orchestrator.ts
      host-provision-attempt-runner.ts
      host-provider-error-classifier.ts
    registry/
      host-provider-registry.ts
    reconciliation/
      host-provider-state-reconciler.ts
    types/
      host-placement.ts
      host-provision-result.ts
      host-provider-error.ts

  providers/
    host-server-provider.ts
    mock-host-server-provider.ts
    hetzner-host-server-provider.ts
    registry/   (optional if kept under provisioning/registry)

  services/
    ...existing service helpers...
```

## Responsibility split

### `jobs/`
Thin BullMQ entrypoints.
They should:
- load DB context
- call orchestration functions
- persist top-level outcome if needed
- avoid embedding placement policy logic directly

### `provisioning/plan/`
Build ordered candidate lists.
This is where PSI decides:
- preferred provider
- allowed fallback regions
- allowed fallback instance types
- max acceptable cost/risk boundaries

### `provisioning/execution/`
Run the plan.
This layer should:
- iterate candidates in order
- call provider registry to get adapter
- classify failures
- decide continue vs stop
- persist per-candidate attempt results

### `provisioning/registry/`
Resolve provider key to provider adapter implementation.

### `provisioning/reconciliation/`
Provider-neutral refresh/reconcile logic for already-created hosts.

### `providers/`
Raw provider implementations only.

---

# 2. Core interfaces / types

## 2.1 Provider identity

```ts
export type HostProviderKey = 'mock' | 'hetzner' | 'digitalocean' | 'vultr' | 'aws';
```

Only `mock` and `hetzner` need real implementations now.
The type can still anticipate later providers.

## 2.2 Placement candidate

This is the most important future-proof type.

```ts
export type HostPlacementCandidate = {
  provider: HostProviderKey;
  region: string;
  instanceType: string;
  priority: number;
  capacityProfile?: {
    cpuMillicores: number;
    memoryMb: number;
    diskGb: number;
  };
  constraints?: {
    architecture?: 'arm64' | 'x86_64';
    maxCostWeight?: number;
    tags?: string[];
  };
  source: 'primary-template' | 'fallback-policy' | 'manual-override';
};
```

For now, PSI may only generate one candidate.
That is okay.
The type shape is the important part.

## 2.3 Placement plan

```ts
export type HostProvisionPlan = {
  scaleEventId: string;
  candidates: HostPlacementCandidate[];
  strategy: 'single-candidate' | 'ordered-fallback';
};
```

## 2.4 Provider request

Today’s `provisionHostServer` params are already close, but should become more explicitly neutral.

```ts
export type ProvisionHostServerRequest = {
  name: string;
  candidate: HostPlacementCandidate;
  sshPublicKeys: string[];
  cloudInitScript: string;
};
```

Adapters may still internally convert `sshPublicKeys` into provider-native key refs.

## 2.5 Provider result

Current `HostServerDetails` is a good base. Keep it.
Possibly separate create-result from details-result later.

```ts
export type HostServerDetails = {
  providerId: string;
  exists: boolean;
  lifecycleStatus: 'creating' | 'starting' | 'running' | 'deleting' | 'deleted' | 'error' | 'unknown';
  ipAddress: string | null;
  rawStatus?: string | null;
  providerMetadata?: Record<string, unknown>;
  action?: ProviderActionInfo | null;
};
```

## 2.6 Structured provider error

This is the next critical type.

```ts
export type ProviderErrorCode =
  | 'capacity_unavailable'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'auth_failed'
  | 'invalid_region'
  | 'invalid_instance_type'
  | 'invalid_ssh_key'
  | 'invalid_request'
  | 'provider_unavailable'
  | 'network_error'
  | 'unknown';

export type ProviderErrorClassification = {
  code: ProviderErrorCode;
  retryable: boolean;
  fallbackAllowed: boolean;
  rawMessage: string;
  providerStatusCode?: number;
  providerBodySnippet?: string;
};
```

This should be produced by each adapter or by a shared classifier helper that understands provider-native responses.

## 2.7 Candidate attempt result

```ts
export type HostProvisionCandidateAttemptResult = {
  candidate: HostPlacementCandidate;
  outcome: 'success' | 'failed';
  classification?: ProviderErrorClassification;
  hostDetails?: HostServerDetails;
  startedAt: Date;
  finishedAt: Date;
};
```

## 2.8 Provider registry interface

```ts
export interface HostProviderRegistry {
  get(provider: HostProviderKey): HostServerProvider;
}
```

## 2.9 Planner interface

```ts
export interface HostPlacementPlanner {
  buildPlan(input: {
    scaleEventId: string;
    activeTemplateId?: string;
    triggerReason: string;
  }): Promise<HostProvisionPlan>;
}
```

## 2.10 Orchestrator interface

```ts
export interface HostProvisionOrchestrator {
  executePlan(plan: HostProvisionPlan): Promise<{
    outcome: 'success' | 'failed';
    chosenCandidate?: HostPlacementCandidate;
    hostDetails?: HostServerDetails;
    attempts: HostProvisionCandidateAttemptResult[];
    failureSummary?: string;
  }>;
}
```

---

# 3. Worker flow

## Current flow

Today `provision-host-server.ts` roughly does:
1. read active template
2. create cloud-init
3. call selected provider
4. poll until running
5. persist host ready/failure

That is fine for a single provider.

## Proposed target flow

### Step 1 — job bootstrap
`jobs/provision-host-server.ts`
- load scale event
- validate triggered state
- create top-level provision attempt record
- call planner

### Step 2 — planning
`host-placement-planner.ts`
- build ordered candidate list
- for now, usually returns one candidate derived from active template
- later can add fallback candidates from policy

### Step 3 — execution
`host-provision-orchestrator.ts`
- iterate candidates in priority order
- for each candidate:
  - get adapter from registry
  - run provider create path
  - if success, poll provider state until running or terminal
  - persist candidate attempt details
  - stop on success
  - continue only if failure classification allows fallback

### Step 4 — finalization
- if success:
  - create/update host row
  - mark scale event ready
  - mark attempt completed
- if all candidates fail:
  - mark scale event failed
  - persist summarized failure reason
  - preserve all candidate attempt history

## Decision logic

Pseudo-flow:

```ts
for (const candidate of plan.candidates) {
  const provider = registry.get(candidate.provider);
  const result = await tryCandidate(candidate, provider);

  persistCandidateAttempt(result);

  if (result.outcome === 'success') {
    return success;
  }

  if (!result.classification?.fallbackAllowed) {
    return failImmediately;
  }
}

return failAfterAllCandidates;
```

## Why this matters

This means PSI can later support:
- same provider / different region
- same provider / different type
- different provider / different region/type

without rewriting the worker from scratch.

---

# 4. Planner / registry roles

## 4.1 Provider registry

### Responsibility
A simple mapping layer from provider key to provider adapter.

### Example

```ts
export function getHostProviderRegistry(): HostProviderRegistry {
  return {
    get(provider) {
      switch (provider) {
        case 'mock':
          return new MockHostServerProvider();
        case 'hetzner':
          return new HetznerHostServerProvider();
        default:
          throw new Error(`Unsupported host provider: ${provider}`);
      }
    },
  };
}
```

### Why separate it
Today `getHostServerProvider()` is environment-global.
That is okay for one-provider mode, but not for future per-candidate provider selection.

Future PSI needs:
- many possible providers available at once
- planner chooses candidate provider
- registry resolves that provider dynamically

So current `getHostServerProvider()` should eventually become either:
- a convenience wrapper for the single configured default provider, or
- replaced by registry usage in provisioning flows

## 4.2 Placement planner

### Responsibility
Build approved candidates from PSI policy.

### Inputs
- scale event / trigger reason
- active template
- future fallback policy config
- optional operator override

### Output
Ordered candidate list.

### Phase 1 behavior
- generate exactly one candidate from active template

### Phase 2 behavior
- generate primary + approved Hetzner fallback regions/types

### Phase 3 behavior
- include secondary provider candidates if enabled

## 4.3 Reconciler

The refresh/reconcile path should also become provider-neutral.

`host-provider-state-reconciler.ts` should:
- take a host row
- use registry to resolve provider by `host.provider`
- fetch provider details
- apply provider-neutral transition rules

This avoids hardcoding “refresh means Hetzner refresh”.

---

# 5. Migration path from current codebase

This is the important part: how to get there without a rewrite.

## Phase A — structure alignment (now)

Goal: keep behavior almost unchanged, but reshape the code.

### A1. Introduce provider registry
- add `host-provider-registry.ts`
- registry returns `mock` or `hetzner`
- keep existing provider classes unchanged

### A2. Introduce provider error classification type
- add `host-provider-error.ts`
- do not fully implement all classification yet
- at minimum define the PSI-neutral error shape

### A3. Introduce placement candidate/plan types
- add `host-placement.ts`
- planner returns a single candidate derived from active template

### A4. Extract provision orchestration logic
- split large logic out of `jobs/provision-host-server.ts`
- keep job as BullMQ wrapper
- move create/poll/persist logic into `host-provision-orchestrator.ts`

This alone makes the current code more future-proof.

## Phase B — Hetzner-only fallback readiness

Goal: support fallback within Hetzner without second provider.

### B1. Add fallback candidate generation
Possible initial source:
- one primary template + JSON fallback config
or later:
- normalized fallback rows

### B2. Classify Hetzner create failures
Map known Hetzner failures into:
- capacity unavailable
- invalid location
- invalid type
- auth failed
- quota exceeded
- unknown

### B3. Persist candidate attempt history
Could begin as:
- JSON log in `host_provision_attempts`
or better:
- new `host_provision_candidate_attempts` table

### B4. Admin surface
Expose:
- chosen candidate
- tried candidates
- failure reason per candidate

## Phase C — second provider support

Goal: make multi-provider real, not just architectural.

### C1. Add second provider adapter
For example `digitalocean-host-server-provider.ts`

### C2. Extend planner policy
Allow provider-ranked candidates.

### C3. Extend error classification / policy rules
Add explicit rules for:
- provider-specific retryability
- cost/risk boundaries
- allowed provider switch

### C4. Extend admin UI
Show:
- provider chosen
- provider fallback history
- final placement reason

---

# 6. Data model implications

Do not rush full schema expansion, but know where it is heading.

## Current model strengths
You already have:
- `host_servers.provider`
- `server_templates.provider`
- `host_provision_attempts`
- provider action tracking

That is a good base.

## Likely future additions

### Option A — minimal extension
Add fallback config to template as JSON.

Example:
- `server_templates.fallback_policy jsonb`

Fastest path, weaker normalization.

### Option B — normalized candidates
Add a table like:

- `server_template_candidates`
  - `id`
  - `serverTemplateId`
  - `provider`
  - `region`
  - `instanceType`
  - `priority`
  - `enabled`
  - optional cost/arch tags

This is probably the cleaner long-term shape.

### Candidate attempt tracking
Eventually add something like:
- `host_provision_candidate_attempts`
  - parent attempt id
  - provider
  - region
  - instance type
  - priority
  - outcome
  - classified error code
  - raw provider message
  - provider instance id if success

This will matter once fallback is real.

---

# 7. Admin / API design implications

Admin UI/API should eventually speak these concepts:
- preferred placement
- chosen placement
- fallback attempts
- provider classified failure

Not just:
- host created / host failed

For now, no need to build the whole UI.
But avoid language that makes multi-provider awkward later.

---

# 8. Immediate concrete next refactors I recommend

In order:

1. create provider registry abstraction
2. create placement candidate/plan types
3. extract orchestrator from `provision-host-server.ts`
4. make planner return one candidate today
5. define provider error classification types
6. adjust refresh/reconcile to use registry by host.provider

These steps are low-regret and useful even before fallback exists.

---

# 9. Recommended near-term PSI policy

## Right now
- implementation: `mock`, `hetzner`
- planner output: single candidate
- fallback: none yet
- architecture: multi-provider-ready

## Next after smoke test
- Hetzner-only fallback candidates
- structured Hetzner error classification
- candidate attempt tracking

## Later
- second provider adapter
- cross-provider fallback policy

---

# 10. Bottom line

The correct structure is:
- provider adapters stay narrow and provider-specific
- PSI orchestration owns placement and fallback policy
- registry resolves which adapter to use
- planner builds candidates
- orchestrator executes candidates
- reconciler refreshes provider-backed host state neutrally

That gives PSI a clean path from:
- today: single-provider execution
through
- tomorrow: Hetzner-only fallback
into
- later: true multi-provider provisioning

without throwing away the current work.
