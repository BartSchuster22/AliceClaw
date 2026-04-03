# PSI Multi-Provider Implementation Plan

This turns `PSI-MULTIPROVIDER-ARCHITECTURE.md` into an execution plan.

Goal: make PSI multi-provider-ready by architecture while preserving current behavior and keeping the live Hetzner smoke path functional.

## Guiding rule

Do the smallest refactors that improve architecture now without forcing premature multi-provider behavior.

## Phase 1 — Low-regret structural extraction

### Goal
Create the future seams without changing provisioning policy yet.

### Deliverables
1. provider registry abstraction
2. provider-neutral placement types
3. planner that currently returns a single candidate
4. orchestration helpers extracted from the large provision worker
5. refresh/reconcile path routed through provider resolution by host/provider

### Expected behavior change
- little or none
- current mock/hetzner behavior should remain functionally equivalent

### Exact refactors

#### 1. Add provider identity + candidate types
Create:
- `apps/worker/src/provisioning/types/host-placement.ts`

Contents:
- `HostProviderKey`
- `HostPlacementCandidate`
- `HostProvisionPlan`

#### 2. Add provider registry
Create:
- `apps/worker/src/provisioning/registry/host-provider-registry.ts`

Behavior:
- resolve provider key to adapter instance
- support `mock` and `hetzner`

#### 3. Add single-candidate planner
Create:
- `apps/worker/src/provisioning/plan/host-placement-planner.ts`

Behavior now:
- take active template + scale event
- return one candidate only

#### 4. Add provider error types
Create:
- `apps/worker/src/provisioning/types/host-provider-error.ts`

Behavior now:
- define types only
- classification can remain mostly unimplemented initially

#### 5. Extract reusable provider-state persistence helpers
Move/centralize the helper logic currently living inside `provision-host-server.ts` into:
- `apps/worker/src/provisioning/execution/host-provider-state-persistence.ts`

This reduces monolith pressure and makes future orchestrator extraction easier.

#### 6. Update refresh reconciliation to use provider registry by `host.provider`
Current refresh job resolves provider globally.
Change it so it resolves provider from the host row through the registry.

This is a meaningful architecture improvement immediately.

## Phase 2 — Provision orchestrator extraction

### Goal
Shrink `jobs/provision-host-server.ts` into a thin BullMQ wrapper.

### Deliverables
1. `host-provision-orchestrator.ts`
2. `host-provision-attempt-runner.ts`
3. job delegates to orchestrator

### Exact refactors

#### 1. Create orchestrator
- `apps/worker/src/provisioning/execution/host-provision-orchestrator.ts`

Responsibilities:
- receive plan
- iterate candidate list
- execute candidate runner
- stop on success
- fail after all candidates exhausted

#### 2. Create candidate runner
- `apps/worker/src/provisioning/execution/host-provision-attempt-runner.ts`

Responsibilities:
- create host through adapter
- persist provider state
- poll until running/terminal
- return success/failure object

#### 3. Simplify worker job
`jobs/provision-host-server.ts` should mainly:
- load scale event/template context
- create attempt row
- invoke planner
- invoke orchestrator
- finalize scale event and attempt summary

## Phase 3 — Hetzner-only fallback readiness

### Goal
Prepare the code for fallback execution within Hetzner before adding any second provider.

### Deliverables
1. structured Hetzner error classification
2. candidate-attempt result model
3. planner support for multiple Hetzner candidates
4. persistence shape for candidate attempt history

### Exact refactors

#### 1. Add Hetzner error classification helper
Possibly:
- `apps/worker/src/provisioning/execution/host-provider-error-classifier.ts`

#### 2. Add candidate attempt result types
Use provider-neutral result objects in orchestrator and runner.

#### 3. Extend planner
Support:
- primary template candidate
- optional fallback candidate list

#### 4. Persist candidate attempt history
Start minimal if needed:
- JSON on `host_provision_attempts`

Later:
- dedicated candidate attempts table

## Phase 4 — Admin and DB evolution

### Goal
Expose fallback/placement decisions cleanly.

### Deliverables
1. admin visibility for chosen candidate / attempted candidates
2. schema support if candidate attempts become first-class
3. operator-friendly failure summaries

## Phase 5 — Second provider enablement

### Goal
Add a second real provider only after Hetzner-only fallback is solid.

---

# Exact first code changes to apply now

These are the recommended first applied refactors from Phase 1:

1. add `host-placement.ts`
2. add `host-provider-registry.ts`
3. add `host-placement-planner.ts` (single candidate)
4. add `host-provider-error.ts`
5. update refresh reconciliation to use provider registry by `host.provider`

These are useful immediately and low risk.

# Success condition for the first refactor block

After the first block:
- current provisioning still works
- refresh no longer assumes one global provider choice
- PSI has explicit provider-neutral placement types
- planner/registry seams exist for later fallback work
