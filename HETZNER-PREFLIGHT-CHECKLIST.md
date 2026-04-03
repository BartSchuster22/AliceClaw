# Hetzner Live Smoke Test — Operator Preflight Checklist

Use this immediately before running the first live PSI Hetzner smoke test.

If any required item is not true, stop.

## 1. Scope / safety

- [ ] This run is for exactly **one** disposable Hetzner smoke-test host
- [ ] Dedicated Hetzner **test** project is being used
- [ ] Dedicated Hetzner **test** API token is ready
- [ ] Manual Hetzner console access is available in case cleanup needs intervention
- [ ] Someone is actively watching the run

## 2. Worker env

- [ ] Worker is using `HOST_SERVER_PROVIDER=hetzner`
- [ ] Worker has `HETZNER_API_TOKEN`
- [ ] Worker has `PROVISIONING_SSH_PUBLIC_KEY`
- [ ] Live timing values are set (not mock-fast values):
  - [ ] `HOST_PROVIDER_STATUS_POLL_INTERVAL_MS=5000`
  - [ ] `HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS=24`
  - [ ] `HOST_PROVIDER_READY_STABILIZATION_DELAY_MS=15000`
  - [ ] `HOST_PROVISION_ATTEMPT_STALE_MS=600000`

## 3. Stack / runtime

- [ ] `backend-api` starts cleanly
- [ ] `worker` starts cleanly
- [ ] `postgres` is healthy
- [ ] `redis` is healthy
- [ ] DB migrations have been applied successfully
- [ ] Admin API is reachable

## 4. PSI fleet state

- [ ] Exactly one active smoke-test server template exists
- [ ] Active template is clearly disposable
- [ ] Active template uses `provider=hetzner`
- [ ] Active template region is the intended Hetzner location string
- [ ] Active template instance type is the intended Hetzner server type string
- [ ] No unrelated fresh scale/provision activity is in flight

## 5. Expected provider behavior

- [ ] Hetzner labels `project=psi` and `managed_by=openclaw` are acceptable for the test project
- [ ] Hetzner project has quota for 1 server + SSH key import/reuse
- [ ] Expected cost/risk for one short-lived test server is acceptable

## 6. PSI API path readiness

- [ ] Admin login works
- [ ] `GET /admin/server-templates` works
- [ ] `GET /admin/servers` works
- [ ] `GET /admin/scale-events` works
- [ ] `POST /admin/servers/provision` is reachable
- [ ] `POST /admin/servers/:id/refresh-provider-state` is reachable
- [ ] `POST /admin/servers/:id/retire` is reachable

## 7. Expected execution path

The intended flow for this run is:

- [ ] create one host
- [ ] verify host reaches explainable `ready`
- [ ] run one provider refresh
- [ ] retire the host
- [ ] confirm provider-side deletion / decommissioned final state

## 8. Stop conditions agreed in advance

Stop immediately if any happen:

- [ ] more than one Hetzner server is created
- [ ] wrong region or wrong server type appears
- [ ] provider metadata is incoherent/missing during create
- [ ] host enters unexplained failed/unknown state
- [ ] cleanup appears stuck or leaves an orphaned server

## 9. Evidence capture ready

Be ready to record:

- [ ] scale event id
- [ ] host id
- [ ] provider instance id
- [ ] provider action id(s)
- [ ] host status transitions
- [ ] final Hetzner console result
- [ ] any manual cleanup performed

## 10. Run / no-run decision

- [ ] All required boxes above are checked
- [ ] If yes: proceed to `HETZNER-LIVE-TEST-RUNBOOK.md`
- [ ] If no: do not run the live smoke test yet
