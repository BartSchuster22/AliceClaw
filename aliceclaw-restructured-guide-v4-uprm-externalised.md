# AliceClaw Platform — Restructured Build Guide
# Version 4 — UPRM Externalised Architecture
# April 2026

---

## Document purpose

This guide defines the complete architecture and build plan for the AliceClaw platform.

User management, authentication, payment processing, and referral management are
fully externalised to a dedicated standalone service: **UPRM**
(User / Payment / Referral Management).

AliceClaw connects to UPRM as a **tenant** via API.
AliceClaw owns no user records, no payment logic, and no referral logic.
AliceClaw trusts identity tokens issued by UPRM and reacts to lifecycle events
delivered by UPRM via webhook.

Everything in this guide reflects that boundary as a hard architectural rule.

---

## Part 0 — What exists, what is reused, what changes

### Confirmed existing (keep as-is)

From the repo (BartSchuster22/AliceClaw, 71 commits, package name: psi-platform):

- pnpm monorepo scaffold (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`)
- `packages/db` — Drizzle ORM, `@psi/db` with migrate + seed scripts
- `packages/types` — shared TypeScript interfaces
- `apps/backend-api` — Fastify API, admin fleet routes, billing webhook skeleton
- `apps/worker` — BullMQ worker, HostServerProvider interface, HetznerAdapter scaffold,
  provider-action tracking (migration 0007), MockHostServerProvider
- `docker-compose.yml` — service shape for api / worker / postgres / redis
- `Caddyfile` — Caddy reverse proxy
- `DECISIONS.md`, `HETZNER-PREFLIGHT-CHECKLIST.md`, `HETZNER-LIVE-RUN-DELTA.md`
- `tests/smoke/`

### What is removed from the previous architecture

- All local auth implementation (login, register, password hashing, JWT generation)
- All Stripe SDK usage
- All local subscription management
- All referral tracking and reward logic
- The `upr_api_tokens` table (tokens are managed by UPRM, not AliceClaw)
- The `frontend-uprm` app (UPRM has its own admin interface)
- The `upr-service-local.ts` concept entirely

These responsibilities now belong 100% to UPRM.

### What replaces them

- `UPRMClient` — a typed HTTP client that AliceClaw uses to communicate with UPRM
- UPRM webhook handler — AliceClaw receives lifecycle events from UPRM and acts on them
- Identity middleware — AliceClaw validates JWT tokens issued by UPRM, no local token generation
- Tenant registration — AliceClaw registers itself as a UPRM tenant at startup
  and receives a `UPRM_TENANT_ID` and `UPRM_TENANT_SECRET` used for all server-to-server calls

---

## Part 1 — Architectural boundary: AliceClaw ↔ UPRM

### What UPRM owns (AliceClaw never touches)

- User accounts, credentials, password management
- Email verification flows
- Payment processing and subscription billing
- Referral codes and reward distribution
- Session tokens and refresh token lifecycle
- Subscription status changes driven by payment events

### What AliceClaw owns

- CAI (Container Agent Image) product catalogue and definitions
- Host server fleet provisioning and management
- Container deployment, routing, and lifecycle per subscription
- Workspace access URLs per user
- Platform-level admin: CAI definitions, host fleet, provisioning queue
- CMS content: landing page, white-label configurations

### The data AliceClaw holds locally

AliceClaw maintains a **local reference** to users and subscriptions received from UPRM.
These are shadow records — copies of the minimum data needed to operate.
They are never the source of truth. UPRM is.

When UPRM sends a webhook event, AliceClaw:
1. Validates the webhook signature using `UPRM_WEBHOOK_SECRET`
2. Updates its local shadow record
3. Triggers the appropriate infrastructure action (deploy, stop, delete container)

### How identity works

Users authenticate with UPRM directly.
UPRM issues a signed JWT containing: `{ sub: userId, tenantId, email, role, exp }`
AliceClaw validates this JWT using `UPRM_JWT_PUBLIC_KEY` (RSA public key provided by UPRM).
AliceClaw never generates tokens. It only verifies them.

### How checkout works

When a user selects a product on AliceClaw:
1. AliceClaw calls `UPRM POST /tenants/{tenantId}/checkout/session`
   with: `{ userId, productRef, successUrl, cancelUrl }`
2. UPRM creates a Stripe session and returns `{ checkoutUrl }`
3. AliceClaw redirects the user to `checkoutUrl`
4. After payment: UPRM sends `subscription.activated` webhook to AliceClaw
5. AliceClaw deploys the CAI

AliceClaw never touches Stripe. It requests a checkout URL and waits for the webhook.

---

## Part 2 — UPRM API contract (what AliceClaw calls)

These are the UPRM endpoints AliceClaw uses.
The UPRM team implements these. AliceClaw consumes them.
All calls use: `Authorization: Bearer {UPRM_TENANT_SECRET}` and `X-Tenant-Id: {UPRM_TENANT_ID}`.

### Authentication and identity

```
POST /tenants/{tenantId}/auth/verify-token
  Body: { token: string }
  Returns: { valid: boolean, userId: string, email: string, role: string } | { valid: false }
  Purpose: AliceClaw calls this to validate a user's JWT on sensitive operations.
           In normal flow, AliceClaw validates the JWT locally using the public key.
           This endpoint is used for revocation checks when needed.

GET /tenants/{tenantId}/users/{userId}
  Returns: { id, email, fullName, status, emailVerified, createdAt }
  Purpose: load user data for display in workspace dashboard or admin

GET /tenants/{tenantId}/users/{userId}/subscriptions
  Returns: [{ id, productRef, status, currentPeriodEnd, cancelAtPeriodEnd }]
  Purpose: AliceClaw checks subscription status before allowing workspace actions

GET /tenants/{tenantId}/users
  Query params: page, limit, search, status
  Returns: paginated user list
  Purpose: AliceClaw admin support view (read-only)
```

### Checkout

```
POST /tenants/{tenantId}/checkout/session
  Body: { userId: string, productRef: string, successUrl: string, cancelUrl: string }
  Returns: { checkoutUrl: string, sessionId: string }
  Purpose: AliceClaw requests a Stripe checkout session for a product purchase.
           productRef is AliceClaw's product identifier — UPRM maps it to a Stripe price.

POST /tenants/{tenantId}/products/register
  Body: { ref: string, name: string, priceDescription: string }
  Purpose: AliceClaw registers its products with UPRM so UPRM can map them to Stripe prices.
           Called at startup or when a new product is created.
```

### Subscription lifecycle

```
GET /tenants/{tenantId}/subscriptions/{subscriptionId}
  Returns: { id, userId, productRef, status, currentPeriodEnd }

PATCH /tenants/{tenantId}/subscriptions/{subscriptionId}/metadata
  Body: { workspaceUrl: string, containerStatus: string }
  Purpose: AliceClaw reports back to UPRM what workspace URL was assigned.
           UPRM can then surface this in its own user dashboard.
```

### Webhooks from UPRM → AliceClaw

UPRM delivers signed webhook events to:
`POST https://api.[ALICECLAW_DOMAIN]/uprm/webhook`

Signature header: `X-UPRM-Signature: sha256={hmac}`
Verified using `UPRM_WEBHOOK_SECRET`.

Event types AliceClaw handles:

```
subscription.activated
  Payload: { subscriptionId, userId, productRef, currentPeriodEnd }
  AliceClaw action: create container_instance + provisioning_job, enqueue deploy-cai

subscription.renewed
  Payload: { subscriptionId, userId, currentPeriodEnd }
  AliceClaw action: update local subscription shadow record, no infra change

subscription.payment_failed
  Payload: { subscriptionId, userId, gracePeriodEnd }
  AliceClaw action: update local subscription record, no immediate infra change
  (If grace period ends without recovery: UPRM sends subscription.deactivated)

subscription.deactivated
  Payload: { subscriptionId, userId, reason }
  AliceClaw action: stop container (pause workspace)

subscription.cancelled
  Payload: { subscriptionId, userId, effectiveAt }
  AliceClaw action: schedule container deletion at effectiveAt

subscription.reactivated
  Payload: { subscriptionId, userId, currentPeriodEnd }
  AliceClaw action: restart container if stopped

user.email_verified
  Payload: { userId, email }
  AliceClaw action: update local user shadow record email_verified = true,
                    if container is running: send workspace_ready notification

user.deleted
  Payload: { userId }
  AliceClaw action: delete all container_instances for this user
```

---

## Part 3 — AliceClaw local data schema

### What AliceClaw stores locally

AliceClaw keeps the minimum shadow data needed to operate without calling UPRM
on every request. These are not authoritative records. They are operational caches.

### local_users (shadow of UPRM user)
```
id                  varchar PK    (= UPRM userId — not generated by AliceClaw)
email               varchar
full_name           varchar
email_verified      boolean default false
status              enum(active, suspended)
uprm_synced_at      timestamp
created_at          timestamp
```
No password. No auth credentials. These are never used for login.

### local_subscriptions (shadow of UPRM subscription)
```
id                   varchar PK   (= UPRM subscriptionId)
user_id              varchar FK → local_users.id
product_ref          varchar      (AliceClaw product identifier)
status               enum(active, paused, cancelled, expired, provisioning_failed)
current_period_end   timestamp nullable
uprm_synced_at       timestamp
created_at           timestamp
```

### products (AliceClaw-owned)
```
id            uuid PK
ref           varchar unique    AliceClaw product identifier, sent to UPRM
name          varchar
slug          varchar unique
description   text
active        boolean
created_at    timestamp
```
Price and billing cycle are owned by UPRM. AliceClaw stores only the product definition.

### cai_definitions (AliceClaw-owned)
```
id                       uuid PK
product_id               uuid FK → products.id unique
docker_image             varchar
docker_tag               varchar default 'latest'
size_tier                enum(nano, standard, pro)
cpu_millicores           integer
memory_mb                integer
disk_gb                  integer
env_template             jsonb
container_port           integer
health_check_path        varchar default '/health'
startup_timeout_seconds  integer default 120
agent_type               varchar    (openclaw | hermes | nano | custom)
active                   boolean default true
created_at               timestamp
```

### host_servers (AliceClaw-owned)
```
id                        uuid PK
name                      varchar
subdomain                 varchar unique
provider                  varchar default 'hetzner'
provider_instance_id      varchar
region                    varchar
ip_address                inet
hetzner_type              varchar
total_cpu_millicores      integer
total_memory_mb           integer
total_disk_gb             integer
reserved_cpu_millicores   integer
reserved_memory_mb        integer
status                    enum(provisioning, ready, draining, decommissioned)
capacity_threshold_percent integer default 80
caddy_configured          boolean default false
created_at                timestamp
ready_at                  timestamp nullable
```

### container_instances (AliceClaw-owned)
```
id                   uuid PK
subscription_id      varchar FK → local_subscriptions.id
user_id              varchar FK → local_users.id
cai_definition_id    uuid FK → cai_definitions.id
host_server_id       uuid FK → host_servers.id nullable
container_id         varchar nullable
container_name       varchar
assigned_port        integer nullable
subdomain_prefix     varchar nullable
workspace_url        varchar nullable
status               enum(pending, deploying, running, unhealthy, stopped, deleted, failed)
created_at           timestamp
started_at           timestamp nullable
stopped_at           timestamp nullable
```

### provisioning_jobs (AliceClaw-owned)
```
id                    uuid PK
container_instance_id uuid FK
subscription_id       varchar
status                enum(queued, running, completed, failed)
current_step          varchar nullable
log_lines             text[] default '{}'
retry_count           integer default 0
error_message         text nullable
started_at            timestamp nullable
finished_at           timestamp nullable
created_at            timestamp
```

### server_templates (AliceClaw-owned)
```
id                           uuid PK
name                         varchar
provider                     varchar default 'hetzner'
hetzner_type                 varchar
region                       varchar
subdomain_prefix             varchar default 'h'
capacity_threshold_percent   integer default 80
management_overhead_percent  integer default 15
is_active                    boolean default false
created_at                   timestamp
```

### server_scale_events (AliceClaw-owned)
```
id                      uuid PK
trigger_host_server_id  uuid FK → host_servers.id
trigger_reason          varchar
new_host_server_id      uuid FK nullable
status                  enum(triggered, provisioning, ready, failed)
created_at              timestamp
```

### white_label_configs (AliceClaw-owned)
```
id                  uuid PK
slug                varchar unique
name                varchar
logo_url            varchar nullable
primary_color       varchar nullable
headline            text nullable
target_product_refs jsonb
active              boolean default true
created_at          timestamp
```

### cms_content (AliceClaw-owned)
```
key    enum(hero_headline, hero_subheadline, hero_cta_text,
            product_card_footer_note, faq_entries, footer_tagline) PK
value  text
updated_at          timestamp
updated_by_admin_id uuid FK → admin_users.id
```

### admin_users (AliceClaw-owned — platform operators only)
```
id            uuid PK
email         varchar unique
password_hash varchar
full_name     varchar
role          enum(super_admin, provisioning_admin, content_admin, support_admin)
status        enum(active, suspended)
created_at    timestamp
```
These are AliceClaw operators (people who manage the platform).
They are separate from UPRM users (people who buy workspaces).
Admin login is local to AliceClaw.

### admin_alerts (AliceClaw-owned)
```
id           uuid PK
type         varchar
entity_id    uuid
message      text
resolved_at  timestamp nullable
created_at   timestamp
```

### admin_audit_log (AliceClaw-owned)
```
id              uuid PK
admin_user_id   uuid FK → admin_users.id
action          varchar
target_type     varchar
target_id       varchar nullable
payload_summary jsonb
ip_address      inet
created_at      timestamp
```

---

## Part 4 — Monorepo target structure

```
/apps
  /backend-api          ← existing, extended
  /worker               ← existing, extended
  /frontend-landing     ← NEW — project-domain.com
  /frontend-app         ← NEW — app.project-domain.com
  /frontend-cms         ← NEW — cms.project-domain.com (IP-restricted)
  /frontend-admin       ← NEW — admin.project-domain.com (IP-restricted)

/packages
  /db                   ← existing, schema updated per Part 3
  /types                ← existing, UPRM client types added
  /ui                   ← shared React components

/infrastructure
  /caddy                ← platform-level Caddyfile
  /caddy-host           ← Caddyfile template deployed to each host server
  /scripts              ← deploy, backup, smoke-test scripts
  /cloud-init           ← host server cloud-init template

/tests
  /smoke                ← existing, extended
  /e2e                  ← Playwright suite

Makefile
docker-compose.yml
DECISIONS.md
PROJECT-STATE.md
```

Note: `frontend-uprm` is removed. UPRM has its own admin interface.
The UPRM admin surface is `uprm.project-domain.com` but it is served by
the UPRM service itself, not by this repo.

---

## Part 5 — Domain and routing architecture

### Platform domains

| Domain | App | Access |
|---|---|---|
| `project-domain.com` | `frontend-landing` | Public |
| `app.project-domain.com` | `frontend-app` | Public (authenticated by UPRM tokens) |
| `cms.project-domain.com` | `frontend-cms` | IP-restricted (AliceClaw operators) |
| `admin.project-domain.com` | `frontend-admin` | IP-restricted (AliceClaw operators) |
| `api.project-domain.com` | `backend-api` | Public (token-gated) |
| `uprm.project-domain.com` | **UPRM service** | IP-restricted (UPRM operators — not this repo) |

### Platform-level Caddyfile

```caddyfile
project-domain.com {
  reverse_proxy frontend-landing:3000
}

app.project-domain.com {
  reverse_proxy frontend-app:3001
}

cms.project-domain.com {
  @notadmin not remote_ip YOUR.ADMIN.IP.HERE
  abort @notadmin
  reverse_proxy frontend-cms:3002
}

admin.project-domain.com {
  @notadmin not remote_ip YOUR.ADMIN.IP.HERE
  abort @notadmin
  reverse_proxy frontend-admin:3003
}

api.project-domain.com {
  reverse_proxy backend-api:4000
}
```

### Host-level Caddy (deployed to each host server)

Each provisioned host gets:
- `h1.project-domain.com` → direct host health check
- `*.h1.project-domain.com` → routes to container ports via per-container snippets
  written to `/etc/caddy/routes/{prefix}.caddy` at deploy time

TLS for wildcards: ACME DNS challenge using Hetzner DNS API.

---

## Part 6 — UPRM client module

This is AliceClaw's only interface to UPRM.
Everything UPRM-related goes through this client.
No other module calls UPRM directly.

### Location

`apps/backend-api/src/modules/uprm-client/`

### Configuration (environment variables)

```
UPRM_BASE_URL          Base URL of the UPRM service (e.g. https://uprm.yourdomain.com)
UPRM_TENANT_ID         AliceClaw's tenant identifier registered in UPRM
UPRM_TENANT_SECRET     Secret used for server-to-server calls to UPRM
UPRM_JWT_PUBLIC_KEY    RSA public key (PEM) for validating user tokens issued by UPRM
UPRM_WEBHOOK_SECRET    HMAC secret for verifying incoming UPRM webhook signatures
```

### UPRMClient interface

```typescript
interface UPRMClient {

  // Identity
  verifyToken(token: string): Promise<TokenPayload | null>
  getUser(userId: string): Promise<UPRMUser | null>
  getUserSubscriptions(userId: string): Promise<UPRMSubscription[]>
  listUsers(params: { page: number; limit: number; search?: string }): Promise<UPRMUserList>

  // Checkout
  createCheckoutSession(params: {
    userId: string
    productRef: string
    successUrl: string
    cancelUrl: string
  }): Promise<{ checkoutUrl: string; sessionId: string }>

  // Subscription
  getSubscription(subscriptionId: string): Promise<UPRMSubscription | null>
  reportWorkspaceUrl(subscriptionId: string, workspaceUrl: string): Promise<void>

  // Product registration
  registerProduct(product: {
    ref: string
    name: string
    priceDescription: string
  }): Promise<void>
}
```

### Shared types

```typescript
interface TokenPayload {
  userId: string
  tenantId: string
  email: string
  role: string
  exp: number
}

interface UPRMUser {
  id: string
  email: string
  fullName: string
  status: 'active' | 'suspended'
  emailVerified: boolean
  createdAt: string
}

interface UPRMSubscription {
  id: string
  userId: string
  productRef: string
  status: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
}
```

### Authentication middleware (replaces local JWT middleware)

`requireUser` middleware:
1. Reads `Authorization: Bearer {token}` header
2. Verifies JWT signature using `UPRM_JWT_PUBLIC_KEY` (local, no network call)
3. Checks `tenantId` claim matches `UPRM_TENANT_ID`
4. Checks token is not expired
5. Attaches `{ userId, email, role }` to request
6. Returns 401 if any check fails

No password validation, no token generation, no session storage.

### UPRM webhook handler

`POST /uprm/webhook` (public, no auth):
1. Read raw request body
2. Validate `X-UPRM-Signature` header using HMAC-SHA256 with `UPRM_WEBHOOK_SECRET`
3. Return 400 if signature invalid
4. Parse event type and payload
5. Update local shadow records
6. Trigger infrastructure actions
7. Return 200 immediately

---

## Part 7 — Event handling: UPRM webhooks → AliceClaw actions

This is the heart of the integration.
AliceClaw reacts to UPRM events. It does not poll.

### subscription.activated

```
Received: { subscriptionId, userId, productRef, currentPeriodEnd }

AliceClaw:
  1. Upsert local_users from UPRM userId (fetch via UPRMClient if not cached)
  2. Upsert local_subscriptions: status → active
  3. Load products by ref = productRef, then cai_definitions by product_id
  4. INSERT container_instances: status → pending
  5. INSERT provisioning_jobs: status → queued
  6. Enqueue deploy-cai job immediately
  7. Call UPRMClient.reportWorkspaceUrl once deploy completes (in post-deploy step)
```

### subscription.deactivated

```
Received: { subscriptionId, userId, reason }

AliceClaw:
  1. Update local_subscriptions.status → paused
  2. Load container_instances where subscription_id = X and status IN (running, unhealthy)
  3. Enqueue stop-cai for each
```

### subscription.reactivated

```
Received: { subscriptionId, userId, currentPeriodEnd }

AliceClaw:
  1. Update local_subscriptions: status → active, currentPeriodEnd
  2. Load container_instances where subscription_id = X and status = stopped
  3. Enqueue restart-cai for each
```

### subscription.cancelled

```
Received: { subscriptionId, userId, effectiveAt }

AliceClaw:
  1. Update local_subscriptions.status → cancelled
  2. If effectiveAt is in the past: enqueue delete-cai immediately
  3. If effectiveAt is in the future: schedule delete-cai delayed to effectiveAt
```

### subscription.renewed

```
Received: { subscriptionId, userId, currentPeriodEnd }

AliceClaw:
  1. Update local_subscriptions.currentPeriodEnd
  No infrastructure action.
```

### subscription.payment_failed

```
Received: { subscriptionId, userId, gracePeriodEnd }

AliceClaw:
  1. Update local_subscriptions — note grace period end
  No immediate infrastructure action.
  (deactivation will come via subscription.deactivated if not resolved)
```

### user.email_verified

```
Received: { userId, email }

AliceClaw:
  1. Update local_users.email_verified = true
  2. Load container_instances for this user where status = running
  3. For each: send workspace_ready notification to user (via email or in-app)
     This is when the workspace URL is first revealed to the user.
```

### user.deleted

```
Received: { userId }

AliceClaw:
  1. Enqueue delete-cai for all non-deleted container_instances of this user
  2. Update local_users.status → suspended (do not hard-delete — preserve infra audit trail)
```

---

## Part 8 — Frontend architecture and flows

### frontend-landing (project-domain.com)

Public site. Reads CMS content from AliceClaw API. Links to UPRM for signup and login.

User flow entry points:
- "Get started" → links to UPRM signup/login page with `?redirect=app.project-domain.com/checkout&product_ref={ref}`
- UPRM handles registration and login, then redirects back with a token

AliceClaw does not host a signup or login form.
UPRM does.

### frontend-app (app.project-domain.com)

Authenticated user area. Receives UPRM token via redirect from UPRM.
Validates token locally using UPRM public key.

Entry points:
- `/checkout?product_ref=X&token=Y` — received from UPRM redirect after login
  AliceClaw calls UPRMClient.createCheckoutSession, redirects to Stripe via UPRM
- `/onboarding?subscriptionId=X` — post-payment, UPRM sends webhook, AliceClaw deploys
- `/dashboard` — workspace management, status polling, stop/start controls

### frontend-cms (cms.project-domain.com)

AliceClaw operator area. Local admin auth (separate from UPRM).
CMS fields, product catalogue, white-label configuration.
6 CMS fields maximum (hero_headline, hero_subheadline, hero_cta_text,
product_card_footer_note, faq_entries, footer_tagline).

### frontend-admin (admin.project-domain.com)

AliceClaw operator area. Local admin auth.
CAI definitions, host fleet, provisioning queue, alerts, audit log.
Does NOT contain user management or payment information.
For user/payment queries: link to UPRM admin interface at uprm.project-domain.com.

---

## Part 9 — Sprint-by-sprint build plan

---

### SPRINT A — Infrastructure completion

**A1 — Add frontend app scaffolds**

Add four new apps to the monorepo:
`frontend-landing` (port 3000), `frontend-app` (port 3001),
`frontend-cms` (port 3002), `frontend-admin` (port 3003).
Each: Vite + React + TypeScript + Tailwind CSS.
Placeholder page only. Update docker-compose.yml and pnpm-workspace.yaml.

**A2 — Schema migration**

Create Drizzle migration for the schema defined in Part 3:
- Rename or create `cai_definitions` with all fields including `size_tier`, `agent_type`
- Add `subdomain` and `caddy_configured` to `host_servers`
- Add `subdomain_prefix` to `server_templates`
- Create `local_users` table
- Create `local_subscriptions` table
- Rename `users.id` references to `local_users.id` where applicable
- Create `products` with `ref` field (no price — price lives in UPRM)
- Create `white_label_configs` with `target_product_refs` (not `target_product_ids`)
- Create `container_instances` with `subscription_id` as varchar FK to `local_subscriptions`
- Ensure `admin_users` exists with AliceClaw operator role enum
- Drop: any existing tables that held payment data, stripe keys, referral rewards, auth tokens

Run `pnpm db:migrate` and `pnpm db:seed` cleanly.

**A3 — Infrastructure directory**

Create `infrastructure/` with:
- `caddy/Caddyfile.platform` — platform-level routing
- `caddy-host/Caddyfile.template` — host-level routing template
- `caddy-host/route.caddy.template` — per-container route snippet template
- `cloud-init/host-init.yaml.template` — host server cloud-init
- `scripts/backup-db.sh`
- `DNS-SETUP.md`

**A4 — Host provision orchestrator**

Create `apps/worker/src/provisioning/host-provision-orchestrator.ts`.
Full step machine: create → poll → stabilise → configure Caddy → mark ready.
Generates subdomain from server_templates.subdomain_prefix + next available number.
Calls internal alerts endpoint on failure.
Idempotent: checks scaleEvent.status before acting.

**A5 — Live Hetzner smoke test**

Follow `HETZNER-PREFLIGHT-CHECKLIST.md`.
One real host provisioned, subdomain recorded, Caddy installed, host retired.
Do not proceed to Sprint B until this passes.

---

### SPRINT B — Container deployment layer

**B1 — Docker adapter**

`apps/worker/src/providers/docker-adapter.ts`
Interface: `deployContainer`, `getContainerStatus`, `stopContainer`, `removeContainer`,
`updateCaddyRoute`, `removeCaddyRoute`.
`MockDockerAdapter`: fake responses, logs actions.
`SshDockerAdapter`: stub only (implemented in Sprint E).
Factory: `getDockerAdapter()` → mock in dev, SSH in production.

**B2 — Slot allocator**

`apps/worker/src/services/slot-allocator.ts`
`findAvailableHost(caiDefinition)` — bin-packing, most-utilised first.
`checkAndTriggerScaleOut(host)` — triggers when largest CAI tier no longer fits.
`assignPort(host)` — next available port 3000–3500.
`assignSubdomainPrefix(host)` — next available alphabetic prefix.

**B3 — Deploy-CAI job**

`apps/worker/src/jobs/deploy-cai.ts`
Steps: allocate → deploy → register Caddy route → post-deploy.
Post-deploy: trigger scale-out check, report workspaceUrl back to UPRM via `UPRMClient.reportWorkspaceUrl`.
Idempotent at each step.
Capacity-wait logic: if no host available and scale in progress, delay and retry up to 10 times.

**B4 — Container lifecycle jobs**

`stop-cai`, `delete-cai`, `restart-cai` jobs.
Each removes Caddy route on stop/delete.
restart-cai re-enqueues deploy-cai (skips allocation, reuses existing host/port).
User API routes: `POST /user/workspaces/:id/stop` and `/start`.

**B5 — Health monitor**

Repeatable job every 2 minutes.
Polls all running containers via DockerAdapter.
On unhealthy/missing: updates status, inserts admin alert.

---

### SPRINT C — UPRM integration layer

**C1 — UPRM client module**

`apps/backend-api/src/modules/uprm-client/uprm-client.ts`
Implements `UPRMClient` interface from Part 6.
All HTTP calls use `UPRM_TENANT_ID` and `UPRM_TENANT_SECRET`.
`UPRMClientMock` for development: returns seeded test data, no real HTTP calls.
Factory: `getUPRMClient()` → mock when `UPRM_MODE=mock`, real when `UPRM_MODE=live`.

**C2 — Identity middleware**

`apps/backend-api/src/middleware/require-user.ts`
Validates JWT using `UPRM_JWT_PUBLIC_KEY` (RS256, local verification, no network call).
Checks `tenantId` matches `UPRM_TENANT_ID`.
Attaches `{ userId, email, role }` to request context.
Returns 401 on any failure.

Remove all existing local JWT generation code.
Remove all bcrypt / password hashing code from non-admin paths.
Admin auth (AliceClaw operators) keeps local auth — this is separate.

**C3 — UPRM webhook handler**

`apps/backend-api/src/modules/uprm-client/webhook-handler.ts`
Mounted at `POST /uprm/webhook` (public, no auth middleware).
Validates `X-UPRM-Signature` header.
Dispatches to event handlers defined in Part 7.
Returns 200 immediately. All processing is async.

Each event handler:
- `subscription.activated` → upsert local_users, upsert local_subscriptions,
  find cai_definition by productRef, create container_instance + provisioning_job,
  enqueue deploy-cai
- `subscription.deactivated` → update local_subscriptions, enqueue stop-cai
- `subscription.reactivated` → update local_subscriptions, enqueue restart-cai
- `subscription.cancelled` → update local_subscriptions, schedule delete-cai
- `subscription.renewed` → update local_subscriptions.currentPeriodEnd
- `subscription.payment_failed` → update local_subscriptions, no infra action
- `user.email_verified` → update local_users.email_verified, send workspace notification
- `user.deleted` → enqueue delete-cai for all user containers

**C4 — Product registration on startup**

On AliceClaw backend-api startup:
Read all active `products` from DB.
Call `UPRMClient.registerProduct` for each.
This ensures UPRM knows all AliceClaw products and can map them to Stripe prices.
New products created in admin: call `registerProduct` immediately on create.

**C5 — Workspace and onboarding routes**

```
GET /onboarding/deploy-status?subscriptionId=X  (requireUser)
  Load container_instances + provisioning_jobs
  Return: { containerStatus, currentStep, workspaceUrl, emailVerified }
  emailVerified comes from local_users.email_verified

GET /onboarding/session?subscriptionId=X  (requireUser)
POST /onboarding/save-step  (requireUser)
POST /onboarding/complete   (requireUser)

GET /user/workspaces          (requireUser)
GET /user/workspaces/:id/status  (requireUser)
POST /user/workspaces/:id/stop   (requireUser)
POST /user/workspaces/:id/start  (requireUser)

GET /user/profile             (requireUser)
  Calls UPRMClient.getUser(userId) for live data
  Returns: { id, email, fullName, emailVerified }

GET /user/subscriptions       (requireUser)
  Calls UPRMClient.getUserSubscriptions(userId)
  Returns: array of UPRM subscription objects with productRef and status
```

**C6 — Checkout initiation route**

```
POST /checkout/session  (requireUser)
  Body: { productRef: string }
  Verify product exists in AliceClaw products table and is active
  Call UPRMClient.createCheckoutSession({
    userId: req.user.userId,
    productRef,
    successUrl: 'https://app.project-domain.com/onboarding?pending=true',
    cancelUrl: 'https://project-domain.com/pricing'
  })
  Return { checkoutUrl }
  Frontend redirects user to checkoutUrl (Stripe hosted checkout via UPRM)
```

**C7 — CAI definitions admin API**

```
GET  /admin/cai-definitions       [super_admin, content_admin]
POST /admin/cai-definitions       [super_admin, content_admin]
  On create: call UPRMClient.registerProduct for linked product
PATCH /admin/cai-definitions/:id  [super_admin, content_admin]
DELETE /admin/cai-definitions/:id [super_admin] — blocks if running instances > 0
GET  /admin/cai-definitions/:id/instances
```

**C8 — Fleet admin API extensions**

Extend existing admin fleet routes:
- Include `subdomain` and `caddy_configured` in all host_server responses
- Include computed utilisation (usedCpu, usedMemory, containerCount, utilPercent) per host
- Include container list with workspaceUrl per host detail endpoint
- Provisioning retry: `POST /admin/provisioning/:jobId/retry`
- Admin alerts: `GET /admin/alerts`, `PATCH /admin/alerts/:id/resolve`

**C9 — CMS and white-label routes**

```
GET  /cms/public          (public, no auth) — cached in Redis 5min
GET  /admin/cms           (requireAdmin)
PATCH /admin/cms/:key     (requireAdminRole content_admin or super_admin)

GET  /admin/white-labels
POST /admin/white-labels
PATCH /admin/white-labels/:id
DELETE /admin/white-labels/:id

GET  /white-labels/:slug  (public) — for landing page white-label rendering
```

**C10 — Internal worker communication**

```
POST /internal/alerts  (X-Internal-Secret header required)
  INSERT admin_alerts

POST /internal/notify  (X-Internal-Secret header required)
  type: 'workspace_ready' → send email to user with workspaceUrl
  Uses UPRMClient.getUser to get email address
```

---

### SPRINT D — Frontends

One session per frontend.

**D1 — frontend-landing**

Pages: `/`, `/pricing`, `/products/:slug`, `/wl/:slug` (white-label).
CMS content from `GET /cms/public`.
Products from `GET /products` (AliceClaw public route).
All CTAs link to UPRM signup: `{UPRM_BASE_URL}/signup?tenant={UPRM_TENANT_ID}&redirect=app.project-domain.com/checkout&product_ref={ref}`
or UPRM login: `{UPRM_BASE_URL}/login?tenant={UPRM_TENANT_ID}&redirect=...`

If URL contains `?ref=CODE`: store referral code in sessionStorage and pass it
to UPRM signup URL as `&referral_code={code}`.
AliceClaw does not process referrals — it passes the code to UPRM.

**D2 — frontend-app: checkout**

Entry: `/checkout?product_ref=X` (user arrives here with UPRM JWT in query or cookie).
Validate token via `requireUser` middleware (client-side token check).
If no token: redirect to UPRM login with this URL as redirect target.
Call `POST /checkout/session { productRef }`.
Redirect to returned `checkoutUrl`.

**D3 — frontend-app: onboarding**

Entry: `/onboarding?pending=true` (Stripe success redirect from UPRM checkout).
Also entry: `/onboarding?subscriptionId=X` (direct link).

Phase A — deploy status screen:
Poll `GET /onboarding/deploy-status?subscriptionId=X` every 5 seconds.

Status display:
- `pending` or `deploying`: spinner + current_step human label
- `running` + emailVerified = false:
  "Your workspace is ready! Check your inbox to access it."
  Note: email verification is handled by UPRM. When UPRM sends `user.email_verified`
  webhook, AliceClaw updates local_users.email_verified = true.
  Until then, workspace URL is not shown.
- `running` + emailVerified = true: "Open workspace" button → workspaceUrl
- `failed`: error state + support contact

Phase B — preferences wizard:
Profile, account type, use-case, terms.
Optional — user can skip and go directly to dashboard.

**D4 — frontend-app: dashboard**

Sidebar: Workspaces, Overview, Profile.
No referral section — referrals are managed in UPRM's own interface.
No billing section — billing is managed in UPRM's own interface.

Workspaces page: workspace cards with status, stop/start, workspace URL.
Profile page: reads from `GET /user/profile` (calls UPRM for live data).
  Display only. Edit links to UPRM profile page.

**D5 — frontend-cms**

CMS content editor (6 fields).
Product catalogue management (name, description, ref — no price editing).
White-label config management.
Admin auth: local AliceClaw operator login.

**D6 — frontend-admin**

CAI definitions management.
Host fleet monitoring (cards with CPU/RAM bars, subdomain, Caddy status).
Server templates configuration.
Scale events timeline.
Provisioning queue with retry capability.
Alerts panel with resolve capability.
Audit log (read-only).
Link to UPRM admin: "For user and payment management, open UPRM admin →"
Admin auth: local AliceClaw operator login.

---

### SPRINT E — Caddy host configuration

**E1 — SshDockerAdapter implementation**

Implement the real `SshDockerAdapter` using `node-ssh`.
`deployContainer`: build and run `docker run` command via SSH, poll until healthy.
`getContainerStatus`: `docker inspect` via SSH, parse status + health.
`stopContainer`, `removeContainer`: SSH commands, ignore errors.
`updateCaddyRoute`: write per-container `.caddy` snippet to `/etc/caddy/routes/`,
  run `caddy reload`.
`removeCaddyRoute`: remove snippet file, reload Caddy.

**E2 — Host Caddy configurator**

`apps/worker/src/provisioning/caddy/host-caddy-configurator.ts`
Deploys Caddy to new host via SSH during orchestrator Step 4.
Installs Caddy if not present.
Writes Caddyfile from template.
Creates `/etc/caddy/routes/` directory.
Starts and enables Caddy service.
Verifies health check passes.
Sets `host_servers.caddy_configured = true`.

---

### SPRINT F — Testing and go-live

**F1 — E2E test suite**

Playwright tests using mock UPRM client and mock Docker adapter:

Test 1: full flow — UPRM sends `subscription.activated` webhook → deploy-cai runs →
container status = running → workspaceUrl generated → reportWorkspaceUrl called.

Test 2: email verified → workspace URL revealed on onboarding screen.
Simulate by sending `user.email_verified` webhook → local_users.email_verified = true.

Test 3: scale-out — host at capacity → checkAndTriggerScaleOut fires →
server_scale_events created → provision-host-server enqueued.

Test 4: lifecycle — stop → restart → delete via subscription.cancelled webhook.

Test 5: admin retry — force deploy failure → admin calls retry endpoint →
second attempt succeeds.

Test 6: production smoke (read-only, run against staging/production).

**F2 — Staging environment**

`docker-compose.staging.yml` with all services, env substitution, built images.
`infrastructure/scripts/deploy-staging.sh`.
`infrastructure/scripts/STAGING-CHECKLIST.md`.

**F3 — Production pre-launch**

`docker-compose.production.yml` with persistence volumes and health checks.
`infrastructure/scripts/deploy-production.sh` with branch and confirmation guards.
`infrastructure/scripts/PRODUCTION-LAUNCH-CHECKLIST.md`.

**F4 — Operations runbook**

`docs/RUNBOOK.md` with daily checks, incident scenarios, maintenance procedures,
useful SSH commands for fleet management.

---

## Part 10 — Environment variables

### apps/backend-api

```
# Database
DATABASE_URL

# Redis
REDIS_URL

# UPRM integration — the only external user/payment dependency
UPRM_BASE_URL           URL of the UPRM service
UPRM_TENANT_ID          AliceClaw's tenant ID registered in UPRM
UPRM_TENANT_SECRET      Server-to-server secret for UPRM API calls
UPRM_JWT_PUBLIC_KEY     RSA public key (PEM) for validating user JWTs
UPRM_WEBHOOK_SECRET     HMAC secret for validating incoming UPRM webhooks
UPRM_MODE               mock | live (default: mock in development)

# Internal worker communication
INTERNAL_SECRET         Shared secret for /internal/* endpoints

# Email (direct from AliceClaw for workspace notifications only)
POSTMARK_API_TOKEN
POSTMARK_FROM_EMAIL

# Platform
PLATFORM_DOMAIN
FRONTEND_APP_URL        https://app.project-domain.com

# Admin auth (AliceClaw operators — local, not UPRM)
ADMIN_JWT_SECRET
```

### apps/worker

```
DATABASE_URL
REDIS_URL
NODE_ENV

# Host provisioning
HOST_SERVER_PROVIDER    mock | hetzner
HETZNER_API_TOKEN
PROVISIONING_SSH_PRIVATE_KEY
PROVISIONING_SSH_PUBLIC_KEY
AGENT_IMAGES            comma-separated image:tag list to pre-pull on new hosts
PLATFORM_DOMAIN
BACKEND_API_URL         http://backend-api:4000

# Timing
HOST_PROVIDER_STATUS_POLL_INTERVAL_MS
HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS
HOST_PROVIDER_READY_STABILIZATION_DELAY_MS
```

### frontend apps

```
VITE_API_URL            https://api.project-domain.com
VITE_UPRM_BASE_URL      https://uprm.project-domain.com  (for login/signup redirect links)
VITE_UPRM_TENANT_ID     AliceClaw's tenant ID (for redirect parameters)
VITE_PLATFORM_DOMAIN    project-domain.com
```

---

## Part 11 — What AliceClaw does NOT implement

This list is fixed. If an agent session starts building any of the following,
stop and redirect immediately.

**Never in this repo:**
- Password hashing or credential storage for end users
- JWT generation for end users
- Stripe SDK integration
- Payment session creation (AliceClaw requests a URL from UPRM — that is all)
- Subscription billing cycles or renewal logic
- Referral tracking, reward calculation, or referral ledger
- User registration or login forms (UPRM hosts these)
- Password reset flows
- A `frontend-uprm` app (UPRM has its own)

**Deferred to V2:**
- Subdomain routing for workspaces (IP:port is the MVP access model)
- Multi-region fleet
- Plan upgrade/downgrade
- Multiple VPS providers
- Container resource auto-scaling

---

## Part 12 — UPRM integration checklist (before first user)

Before going live, confirm the following with the UPRM team:

```
[ ] AliceClaw tenant ID and secret issued by UPRM
[ ] UPRM JWT public key provided and loaded in backend-api env
[ ] UPRM webhook secret set and matching on both sides
[ ] UPRM webhook endpoint registered: https://api.project-domain.com/uprm/webhook
[ ] UPRM webhook events enabled:
    subscription.activated, subscription.renewed, subscription.payment_failed,
    subscription.deactivated, subscription.cancelled, subscription.reactivated,
    user.email_verified, user.deleted
[ ] All AliceClaw products registered in UPRM via registerProduct
[ ] UPRM has Stripe price IDs mapped to each AliceClaw productRef
[ ] Checkout flow tested end-to-end: UPRM login → checkout → webhook received → deploy triggered
[ ] user.email_verified webhook tested: workspace URL revealed after UPRM verifies email
[ ] subscription.cancelled webhook tested: container deleted at period end
[ ] UPRM admin interface accessible at uprm.project-domain.com (UPRM team manages this)
```

---

## Part 13 — Session start checklist

Before every agent session:

```
[ ] Read PROJECT-STATE.md — what is the last completed step?
[ ] Which sprint and phase am I in?
[ ] Did the previous phase pass its acceptance check?
[ ] Am I on a clean git branch?
[ ] Have I opened this document for the relevant schema and interface specs?
[ ] Am I prompting ONE module at a time?

HARD RULES:
[ ] No Stripe SDK usage anywhere in this repo
[ ] No bcrypt or password handling for end users
[ ] No local JWT generation for end users (admin JWT is the only exception)
[ ] No referral logic
[ ] All UPRM calls go through UPRMClient — never direct HTTP in other modules
[ ] If building a user-facing feature: check that identity comes from UPRM JWT, not local DB

After session:
[ ] pnpm dev starts cleanly
[ ] pnpm --filter @psi/api build passes
[ ] pnpm --filter @psi/worker build passes
[ ] Update PROJECT-STATE.md
```
