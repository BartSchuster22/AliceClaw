# Hetzner Live Run Delta vs Current Compose Setup

This translates `HETZNER-SMOKE-TEST.md` into the exact minimum changes needed from the current `docker-compose.yml` stack before the first live Hetzner smoke test.

## Summary

Current stack status:
- backend-api / worker / postgres / redis shape is usable for a smoke test
- DB migration entrypoint exists (`pnpm --filter @psi/db migrate`)
- current worker config is still mock-oriented and must be changed before any live Hetzner call

## What can stay as-is for the first smoke test

These are fine for the first live run:
- `backend-api` service shape
- `postgres` service shape
- `redis` service shape
- frontend services and Caddy do not need Hetzner-specific changes for the smoke test
- current DB connection wiring
- current API/admin routes for manual provisioning and refresh

## What must change before the first live run

### 1. Worker provider mode

Current:
- `MOCK_HOST_PROVIDER_MODE: success`

Required:
- add `HOST_SERVER_PROVIDER: hetzner`
- keep mock-only vars irrelevant or remove them for clarity

Recommended action:
- remove or ignore:
  - `MOCK_HOST_PROVIDER_MODE`
  - `MOCK_HOST_PROVISION_DELAY_MS`
  - `MOCK_HOST_READY_AFTER_CALLS`
  - `MOCK_HOST_LOG_VERBOSE`

### 2. Hetzner credentials

Currently missing:
- `HETZNER_API_TOKEN`
- `PROVISIONING_SSH_PUBLIC_KEY`

Required additions in worker env:
- `HETZNER_API_TOKEN=<dedicated test token>`
- `PROVISIONING_SSH_PUBLIC_KEY=<single test public key>`

Do not hardcode real secrets into committed files.
Use local env injection / compose override / secret handling.

### 3. Polling/stale timing

Current worker values are too aggressive for a live provider smoke test:
- `HOST_PROVIDER_STATUS_POLL_INTERVAL_MS: 1000`
- `HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS: 5`
- `HOST_PROVIDER_READY_STABILIZATION_DELAY_MS: 1000`
- `HOST_PROVISION_ATTEMPT_STALE_MS: 2000`

Recommended live smoke-test values:
- `HOST_PROVIDER_STATUS_POLL_INTERVAL_MS: 5000`
- `HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS: 24`
- `HOST_PROVIDER_READY_STABILIZATION_DELAY_MS: 15000`
- `HOST_PROVISION_ATTEMPT_STALE_MS: 600000`

Why:
- current values are tuned for mock speed, not real provider behavior
- current stale timeout would incorrectly mark a normal live run as stale/failing

### 4. DB migrations

Current code expects migrations from:
- `packages/db/drizzle`

Before the first live run, confirm migrations are applied in the running DB.

Expected command path already exists:
- `pnpm --filter @psi/db migrate`

### 5. Active server template discipline

Before the first live run:
- ensure exactly one active `server_templates` row exists for the smoke test
- it should be disposable and clearly named
- it must use:
  - `provider=hetzner`
  - intended low-cost instance type
  - intended Hetzner location string

Do not run the first live test with multiple active templates.

## Recommended worker env block for the first live smoke test

Target shape:

```yaml
worker:
  environment:
    CI: "true"
    DATABASE_URL: postgres://openclaw:dev_password@postgres:5432/openclaw
    REDIS_URL: redis://redis:6379
    POSTMARK_API_TOKEN: 3d0b921d-6c3c-4eaf-830c-f7088bbb52b8
    POSTMARK_FROM_EMAIL: postmark@aquiero.com
    HOST_SERVER_PROVIDER: hetzner
    HETZNER_API_TOKEN: ${HETZNER_API_TOKEN}
    PROVISIONING_SSH_PUBLIC_KEY: ${PROVISIONING_SSH_PUBLIC_KEY}
    HOST_PROVIDER_STATUS_POLL_INTERVAL_MS: 5000
    HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS: 24
    HOST_PROVIDER_READY_STABILIZATION_DELAY_MS: 15000
    HOST_PROVISION_ATTEMPT_STALE_MS: 600000
```

Notes:
- env-substitution is preferred over committing live token/key values
- Postmark can stay configured or be omitted if email is not relevant to this smoke path

## Suggested local execution order

### Phase 0 — config prep

1. Prepare non-committed env source for:
   - `HETZNER_API_TOKEN`
   - `PROVISIONING_SSH_PUBLIC_KEY`
2. Update runtime injection so worker gets:
   - `HOST_SERVER_PROVIDER=hetzner`
   - recommended live timing values
3. Confirm exactly one active Hetzner smoke-test template exists

### Phase 1 — runtime prep

4. Start stack cleanly
5. Apply DB migrations
6. Verify worker starts without immediately throwing:
   - missing token
   - missing SSH public key
   - unsupported provider mode

### Phase 2 — live smoke test

7. Trigger `POST /admin/servers/provision`
8. Observe create path
9. Trigger one `POST /admin/servers/:id/refresh-provider-state`
10. Trigger retire path after verification
11. Confirm no orphaned server remains in Hetzner

## Exact pre-run checks against the current stack

Before live execution, verify all of these:

- worker no longer uses mock provider assumptions
- worker has real Hetzner token via env injection
- worker has real SSH public key via env injection
- migrations have been applied successfully
- only one active server template exists
- template region matches Hetzner location naming expected by adapter
- template instance type matches Hetzner `server_type` naming expected by adapter
- manual admin provisioning route is reachable
- manual refresh route is reachable
- manual retire route is reachable

## Biggest current risk in the compose file

The current compose file is dangerous for a live smoke test if left unchanged because:
- it is still tuned for mock timing
- it does not inject `HOST_SERVER_PROVIDER=hetzner`
- it does not inject `HETZNER_API_TOKEN`
- it does not inject `PROVISIONING_SSH_PUBLIC_KEY`

If someone simply reuses the current worker block as-is, the live test will either fail immediately or behave misleadingly.

## Recommended implementation style

For the first live run, prefer one of these approaches:

1. `docker-compose.yml` unchanged + a local override file for live smoke test env
2. `docker-compose.yml` updated to use `${...}` env substitution with local uncommitted values

Preferred: local override / env substitution, not committed secrets.

## Go signal for first live execution

You are ready to attempt the first live run only when:
- worker env has been switched to Hetzner safely
- live timing values replaced mock timing values
- migrations confirmed
- exactly one disposable active Hetzner template exists
- Hetzner token + SSH key are injected non-destructively
- manual cleanup path is ready if PSI cleanup fails

## Retire-path note

The retire-path limitation for healthy idle hosts has now been addressed in code:
- admin retire route can retire idle `ready` hosts as well as failed/draining ones
- retire worker now marks a host `draining` before delete and only archives immediately when provider already reports it missing
- refresh reconciliation can now move a draining host to `decommissioned` + archived when the provider no longer has the server
