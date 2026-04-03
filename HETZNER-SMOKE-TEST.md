# Hetzner Smoke Test Prep

Use this before the first intentional live PSI host provisioning test with real Hetzner credentials.

## Goal

Verify that PSI can safely create, observe, refresh, and clean up exactly one real Hetzner host through the provider boundary without widening scope into full production rollout.

This is a smoke test, not a launch.

## Current implementation assumptions

- Real provider selection is controlled by `HOST_SERVER_PROVIDER=hetzner`.
- Hetzner credentials are expected via `HETZNER_API_TOKEN`.
- Host provisioning uses the active server template from the DB.
- Worker cloud-init expects a provisioning SSH key via `PROVISIONING_SSH_PUBLIC_KEY`.
- Provisioning now persists provider action/status metadata during create, polling, and cleanup.
- Manual refresh path exists via `POST /admin/servers/:id/refresh-provider-state`.

## Go / no-go rules

Proceed only if all are true:

- test uses a dedicated Hetzner project/token, not a shared production token
- test uses a dedicated low-cost server type
- test uses a clearly labelled disposable server template
- `PROVISIONING_SSH_PUBLIC_KEY` is present and corresponds to a key you control
- expected cleanup path is agreed in advance
- someone is available to observe the run and confirm cleanup

Do **not** proceed if any are false.

## Required env for the worker

Minimum additional env beyond the current dev stack:

- `HOST_SERVER_PROVIDER=hetzner`
- `HETZNER_API_TOKEN=<dedicated test token>`
- `PROVISIONING_SSH_PUBLIC_KEY=<single test public key>`

Recommended conservative settings for the first live run:

- `HOST_PROVIDER_STATUS_POLL_INTERVAL_MS=5000`
- `HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS=24`
- `HOST_PROVIDER_READY_STABILIZATION_DELAY_MS=15000`
- `HOST_PROVISION_ATTEMPT_STALE_MS=600000`

Reasoning:
- slower polling reduces provider churn/noise
- 24 x 5s gives ~2 minutes for creation observation before timeout
- shorter stabilization than production is acceptable for a smoke test, but not near-zero

## Dedicated live test template

Create or patch exactly one active test template with:

- `provider=hetzner`
- cheapest acceptable non-burstable instance type that PSI supports intentionally
- explicit low-risk region/location
- realistic but small capacity values
- obvious test name, for example:
  - `hetzner-smoke-fsn1-cax11`

Important:
- do not reuse an existing broad production-intent template for the first smoke test
- if needed, temporarily mark only the smoke template as active

## Safe label expectations

The provider currently labels created Hetzner resources with:

- `project=psi`
- `managed_by=openclaw`

Before running, verify that this is acceptable for the Hetzner test project and enough to identify/delete leftovers manually if needed.

## Pre-flight checklist

### 1. Runtime/config

- backend, worker, postgres, redis can all start cleanly
- DB migrations required by host/provider work are already applied
- worker is using `HOST_SERVER_PROVIDER=hetzner`
- worker has `HETZNER_API_TOKEN`
- worker has `PROVISIONING_SSH_PUBLIC_KEY`

### 2. Hetzner account/project

- dedicated test project exists
- API token scoped to that test project
- project has quota for 1 server + SSH key import
- chosen location and server type are valid in that project

### 3. PSI app state

- exactly one active server template for the smoke test
- no unrelated queued/triggered provisioning work
- admin can access:
  - `POST /admin/servers/provision`
  - `GET /admin/servers`
  - `GET /admin/scale-events`
  - `POST /admin/servers/:id/refresh-provider-state`
  - `POST /admin/servers/:id/retire`

### 4. Cleanup readiness

- manual Hetzner console access available
- confirm who will delete leftovers if PSI cleanup stalls
- confirm acceptable cost window for a failed cleanup case

## First live smoke-test sequence

### Phase A — create exactly one host

1. Start PSI with Hetzner env enabled for the worker.
2. Confirm the smoke test template is the only active template.
3. Trigger manual provisioning:
   - `POST /admin/servers/provision`
4. Watch:
   - `server_scale_events`
   - `host_provision_attempts`
   - `host_servers`
   - worker logs
   - Hetzner project activity

Expected outcomes:
- one scale event enters `provisioning`
- one provision attempt is created
- one host row is created with provider instance id
- provider action metadata becomes populated
- host eventually reaches `ready`
- Hetzner shows exactly one created server

### Phase B — refresh state

5. Call `POST /admin/servers/:id/refresh-provider-state` for the new host.
6. Confirm host state still looks consistent afterward.

Expected outcomes:
- refresh job is queued and completed
- host remains consistent (`ready` or another explainable state)
- provider action/status fields remain sane
- no unexpected archival or status regression

### Phase C — retire and verify cleanup

7. If no containers are attached, queue retirement:
   - `POST /admin/servers/:id/retire`
8. Observe worker + Hetzner activity.
9. If needed, run refresh once more to confirm final state.

Expected outcomes:
- delete call is accepted
- delete action metadata is stored
- host transitions toward `draining`
- once provider reports missing/deleted, PSI state becomes explainable (`decommissioned`/archived)
- Hetzner no longer shows the server

## Success criteria

The smoke test is successful if all are true:

- exactly one real Hetzner host was created
- PSI persisted provider instance + action metadata
- host reached an explainable ready/running state
- manual refresh did not corrupt state
- host deletion was accepted and observed
- no orphaned live server remained in Hetzner after the test

## Failure conditions that should stop further rollout

Stop and investigate before any broader live use if any occur:

- more than one host is created
- host reaches an unexpected provider state not mapped intentionally
- provider metadata is missing/incoherent during create or refresh
- cleanup fails or leaves an orphaned server
- refresh marks a healthy host failed without clear cause
- active template ambiguity creates the wrong host shape/region

## Recommended evidence to capture

For the first run, record:

- scale event id
- host id
- provider instance id
- provider action ids/statuses seen during create/delete
- final PSI host status
- final Hetzner console result
- any manual cleanup taken

## Recommended next step after a successful smoke test

If the first live run succeeds, do one small follow-up before broader rollout:

- document the exact known-good test env/template values
- then decide whether to add periodic fleet reconciliation or proceed to a second live test with slightly broader verification
