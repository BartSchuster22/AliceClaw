# Hetzner Live Smoke Test Runbook

This is the exact admin/API execution runbook for the first live Hetzner smoke test.

Use this only after completing:
- `HETZNER-SMOKE-TEST.md`
- `HETZNER-LIVE-RUN-DELTA.md`

## Goal

Run exactly one controlled live cycle:
1. create one host
2. verify state
3. refresh provider state once
4. retire the host
5. confirm cleanup

## Operator assumptions

- PSI stack is running
- worker is using live Hetzner env injection
- DB migrations are applied
- exactly one disposable active Hetzner server template exists
- you have admin credentials for PSI
- you can also view the Hetzner test project console

## Values to fill in before starting

- `BASE_URL` = PSI API base, for example `https://aquiero.com/api`
- `ADMIN_EMAIL` = admin login email
- `ADMIN_PASSWORD` = admin login password
- `PROVISION_REASON` = short reason string, for example `hetzner-smoke-test-1`

## Authentication

### 1. Login and get bearer token

Request:

```http
POST /admin/auth/login
Content-Type: application/json

{
  "email": "<ADMIN_EMAIL>",
  "password": "<ADMIN_PASSWORD>"
}
```

Expected response:

```json
{
  "accessToken": "..."
}
```

Save:
- `ADMIN_BEARER=<accessToken>`

All subsequent admin API requests use:

```http
Authorization: Bearer <ADMIN_BEARER>
```

## Phase 0 — pre-run verification

### 2. Confirm server templates

Request:

```http
GET /admin/server-templates
Authorization: Bearer <ADMIN_BEARER>
```

Operator checks:
- exactly one active template is intended for this test
- template is disposable
- template provider is `hetzner`
- template instance type and region match intended Hetzner values

Stop if:
- more than one active template exists
- template points to the wrong region/type
- template is not clearly disposable

### 3. Confirm no active accidental fleet churn

Request:

```http
GET /admin/scale-events
Authorization: Bearer <ADMIN_BEARER>
```

Operator checks:
- no unrelated fresh `triggered` or `provisioning` scale events are in flight

Request:

```http
GET /admin/servers
Authorization: Bearer <ADMIN_BEARER>
```

Operator checks:
- no confusing existing provisioning host state that could be mistaken for this run

## Phase 1 — create one host

### 4. Trigger manual provisioning

Request:

```http
POST /admin/servers/provision
Authorization: Bearer <ADMIN_BEARER>
Content-Type: application/json

{
  "reason": "<PROVISION_REASON>"
}
```

Expected response:

```json
{
  "success": true,
  "scaleEventId": "<uuid>"
}
```

Record immediately:
- `scaleEventId`
- timestamp

Stop if:
- request returns 409 `No active server template configured`
- request returns any auth/validation failure

### 5. Watch scale events

Request:

```http
GET /admin/scale-events
Authorization: Bearer <ADMIN_BEARER>
```

Find the event with the returned `scaleEventId`.

Expected progression:
- `triggered`
- `provisioning`
- eventually `ready` or `failed`

Record:
- event status transitions
- `latestProvisionAttempt.id` if present
- failure reason if any

### 6. Watch fleet hosts

Request:

```http
GET /admin/servers
Authorization: Bearer <ADMIN_BEARER>
```

Expected outcomes:
- one new host appears
- host has:
  - PSI host id
  - provider instance id
  - provider action fields populated or becoming populated
  - status moving toward `ready`

Record:
- host id
- host name
- provider instance id
- provider action id / status / command if present

### 7. Inspect the specific host detail

Request:

```http
GET /admin/servers/<HOST_ID>
Authorization: Bearer <ADMIN_BEARER>
```

Expected outcomes:
- `host` object exists
- `provisionAttempts` contains at least one row
- latest attempt shows provider metadata / status progress

Record:
- latest provision attempt id
- attempt status
- provider action metadata on host and/or attempt

### 8. Parallel operator observation outside PSI

While PSI is moving the create flow, also check Hetzner console.

Expected Hetzner-side outcomes:
- exactly one server appears
- server has expected labels:
  - `project=psi`
  - `managed_by=openclaw`
- server type/location match intended smoke template
- SSH key import/reuse looks sane

Stop if:
- more than one server appears
- wrong region/type appears
- labels are missing in a way that breaks cleanup confidence

## Phase 2 — verify ready state

### 9. Wait for explainable ready state

Repeat as needed:

```http
GET /admin/servers/<HOST_ID>
Authorization: Bearer <ADMIN_BEARER>
```

Expected good state:
- `host.status = "ready"`
- `host.providerInstanceId` is populated
- `host.providerActionStatus` is populated or historically populated
- latest attempt is `completed`

Acceptable warning state:
- host still transitioning but all metadata is coherent and Hetzner console agrees

Stop if:
- host becomes `failed`
- refresh/provision metadata is incoherent
- provider instance id disappears unexpectedly

## Phase 3 — manual refresh test

### 10. Trigger refresh-provider-state once

Request:

```http
POST /admin/servers/<HOST_ID>/refresh-provider-state
Authorization: Bearer <ADMIN_BEARER>
```

Expected response:

```json
{
  "success": true,
  "queued": true
}
```

### 11. Re-read host detail after refresh

Request:

```http
GET /admin/servers/<HOST_ID>
Authorization: Bearer <ADMIN_BEARER>
```

Expected outcomes:
- host remains in an explainable state
- no unexpected archival
- no invalid regression caused by refresh
- provider metadata remains sane

Pass condition for refresh slice:
- refresh did not corrupt a healthy host state

Stop if:
- refresh pushes a healthy host into unexplained `failed`
- provider metadata becomes less coherent after refresh

## Phase 4 — retire and cleanup

### 12. Confirm no active containers are attached

Check in host detail response:
- `containers` should be empty or at least not active

Do not retire if active containers are attached.

### 13. Trigger retire

Request:

```http
POST /admin/servers/<HOST_ID>/retire
Authorization: Bearer <ADMIN_BEARER>
```

Expected response:

```json
{
  "success": true,
  "queued": true
}
```

Possible expected block:
- `409 Host still has active containers`

Operator rule:
- retire is now expected to work for an idle healthy smoke-test host
- if blocked for active containers, stop and inspect rather than forcing anything

### 14. Watch host state after retire

Request:

```http
GET /admin/servers/<HOST_ID>
Authorization: Bearer <ADMIN_BEARER>
```

Expected outcomes:
- host moves toward `draining`
- delete action metadata appears or updates
- provider instance may remain temporarily until provider-side delete completes

### 15. Refresh once more if needed

If final state is unclear, run exactly one targeted refresh:

```http
POST /admin/servers/<HOST_ID>/refresh-provider-state
Authorization: Bearer <ADMIN_BEARER>
```

Then re-read host detail.

### 16. Verify Hetzner-side cleanup

In Hetzner console, confirm:
- test server no longer exists
- no unexpected extra server was created
- no manual cleanup is still pending

If PSI state and Hetzner reality disagree, Hetzner reality wins for cleanup decisions.

## Success criteria

Mark the smoke test successful only if all are true:
- one and only one Hetzner server was created
- PSI host row got a provider instance id
- provider action metadata was visible during create and/or delete
- host reached an explainable ready state
- refresh call did not destabilize host state
- retire/delete completed or was verified cleanly
- Hetzner project shows no leftover test server afterward

## Failure handling

Stop broader rollout and record details if any happen:
- duplicate server creation
- wrong instance type or region
- host stuck in unexplained failed/unknown behavior
- cleanup leaves orphaned server
- refresh causes regression without clear explanation
- PSI and Hetzner disagree on the final resource state

## Evidence to capture during the run

Record these exact values:
- admin login time
- scale event id
- host id
- provider instance id
- latest provision attempt id
- provider action ids/statuses seen during create/delete
- host status transitions observed
- final Hetzner console outcome
- whether manual cleanup was required

## Minimal curl-style request map

### Login

```bash
curl -sS -X POST "$BASE_URL/admin/auth/login" \
  -H 'content-type: application/json' \
  -d '{"email":"'$ADMIN_EMAIL'","password":"'$ADMIN_PASSWORD'"}'
```

### List templates

```bash
curl -sS "$BASE_URL/admin/server-templates" \
  -H "authorization: Bearer $ADMIN_BEARER"
```

### Trigger provision

```bash
curl -sS -X POST "$BASE_URL/admin/servers/provision" \
  -H "authorization: Bearer $ADMIN_BEARER" \
  -H 'content-type: application/json' \
  -d '{"reason":"'$PROVISION_REASON'"}'
```

### List scale events

```bash
curl -sS "$BASE_URL/admin/scale-events" \
  -H "authorization: Bearer $ADMIN_BEARER"
```

### List servers

```bash
curl -sS "$BASE_URL/admin/servers" \
  -H "authorization: Bearer $ADMIN_BEARER"
```

### Host detail

```bash
curl -sS "$BASE_URL/admin/servers/$HOST_ID" \
  -H "authorization: Bearer $ADMIN_BEARER"
```

### Refresh provider state

```bash
curl -sS -X POST "$BASE_URL/admin/servers/$HOST_ID/refresh-provider-state" \
  -H "authorization: Bearer $ADMIN_BEARER"
```

### Retire host

```bash
curl -sS -X POST "$BASE_URL/admin/servers/$HOST_ID/retire" \
  -H "authorization: Bearer $ADMIN_BEARER"
```
