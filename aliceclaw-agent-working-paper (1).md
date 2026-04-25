# AliceClaw — Agent Working Paper
# Prompt-by-prompt build instructions
# Based on Restructured Guide v3

---

## HOW TO USE THIS DOCUMENT

- Each numbered prompt is ONE agent session
- Copy the prompt block exactly as written
- Do not start the next prompt until the ACCEPTANCE CHECK passes
- Before every session: read PROJECT-STATE.md and confirm the last step is done
- After every session: update PROJECT-STATE.md with what was built and what comes next
- Placeholders in ALLCAPS are yours to fill in before sending

---

## CONTEXT BLOCK
## Paste this at the top of EVERY prompt session, before the task

```
REPO: BartSchuster22/AliceClaw
STACK: pnpm monorepo, TypeScript, Fastify (backend-api), BullMQ (worker),
       Drizzle ORM (packages/db), Vite+React+Tailwind (frontends), Caddy (reverse proxy)
PACKAGE NAMES: backend = @psi/api, worker = @psi/worker, db = @psi/db, types = @psi/types
PLATFORM DOMAIN: [YOUR_DOMAIN] (replace everywhere you see project-domain.com)
DOCKER REGISTRY: [YOUR_REGISTRY] (e.g. registry.yourdomain.com)
NODE_ENV default: development

EXISTING INFRASTRUCTURE (do not touch unless the prompt says so):
- HostServerProvider interface + HetznerAdapter scaffold (apps/worker/src/providers/)
- MockHostServerProvider (apps/worker/src/providers/)
- Provider-action tracking schema (migration 0007)
- Admin fleet routes: GET/POST /admin/servers, /admin/server-templates, /admin/scale-events
- Billing module skeleton (apps/backend-api/src/modules/billing/)
- Auth module (apps/backend-api/src/modules/auth/)

RULES FOR THIS SESSION:
- Only build what the prompt asks. Nothing else.
- If you are unsure about a field or type, use the schema block provided in the prompt.
- Do not import Stripe SDK outside src/modules/upr/upr-service-local.ts
- Do not create tables that are not in the schema block.
- After completing the task, list exactly which files were created or modified.
```

---

# SPRINT A — COMPLETE INFRASTRUCTURE

---

## PROMPT A1 — Monorepo scaffold: add new apps

```
TASK: Add five new frontend app directories to the existing monorepo.
Do NOT touch any existing apps or packages.

Create the following directories, each as a minimal Vite + React + TypeScript + Tailwind CSS app:
  apps/frontend-landing   (will serve project-domain.com)
  apps/frontend-app       (will serve app.project-domain.com)
  apps/frontend-cms       (will serve cms.project-domain.com)
  apps/frontend-admin     (will serve admin.project-domain.com)
  apps/frontend-uprm      (will serve uprm.project-domain.com)

Each app needs:
  - package.json with name @psi/frontend-{name}, scripts: dev, build, preview
  - vite.config.ts
  - tsconfig.json extending ../../tsconfig.base.json
  - src/main.tsx and src/App.tsx
  - App.tsx renders ONE line: the app name, e.g. <h1>AliceClaw Landing</h1>
  - index.html
  - tailwind.config.js and postcss.config.js
  - VITE_API_URL in a .env.example file

Dev ports (for docker-compose):
  frontend-landing: 3000
  frontend-app:     3001
  frontend-cms:     3002
  frontend-admin:   3003
  frontend-uprm:    3004

Update pnpm-workspace.yaml to include the new apps if not already using glob.

Update docker-compose.yml to add services for each new frontend:
  - Build from their directory
  - Expose the correct port
  - Mount src for hot reload in dev
  - Pass VITE_API_URL from environment

Do NOT add routes, pages, or any logic. Placeholder pages only.
```

**ACCEPTANCE CHECK:**
Run `pnpm dev` — all 5 new frontend containers start and each shows its name in the browser.

---

## PROMPT A2 — Schema migration: new and updated tables

```
TASK: Create a new Drizzle migration in packages/db adding and modifying tables.
Do NOT modify any existing migrations or existing table columns unless listed below.

Read the current schema at packages/db/src/schema.ts before making changes.

CHANGES REQUIRED:

1. Add to host_servers table:
   subdomain        varchar(20) NOT NULL UNIQUE
   caddy_configured boolean NOT NULL DEFAULT false

2. Add to server_templates table:
   subdomain_prefix varchar(10) NOT NULL DEFAULT 'h'

3. Rename product_definitions table to cai_definitions.
   If product_definitions does not exist yet, create cai_definitions fresh.
   Schema for cai_definitions:
     id                      uuid PRIMARY KEY DEFAULT gen_random_uuid()
     product_id              uuid NOT NULL UNIQUE REFERENCES products(id)
     docker_image            varchar NOT NULL
     docker_tag              varchar NOT NULL DEFAULT 'latest'
     size_tier               size_tier_enum NOT NULL  (enum: nano, standard, pro)
     cpu_millicores          integer NOT NULL
     memory_mb               integer NOT NULL
     disk_gb                 integer NOT NULL
     env_template            jsonb NOT NULL DEFAULT '{}'
     container_port          integer NOT NULL
     health_check_path       varchar NOT NULL DEFAULT '/health'
     startup_timeout_seconds integer NOT NULL DEFAULT 120
     agent_type              varchar NOT NULL  (values: openclaw, hermes, nano, custom)
     active                  boolean NOT NULL DEFAULT true
     created_at              timestamp NOT NULL DEFAULT now()

4. Add to container_instances table (create if not exists):
   cai_definition_id  uuid NOT NULL REFERENCES cai_definitions(id)
   subdomain_prefix   varchar(20)
   workspace_url      varchar(500)
   email_verified_at  timestamp
   If the table has an agent_url column, rename it to workspace_url.
   If the table has product_definition_id, rename it to cai_definition_id.

5. CREATE TABLE white_label_configs:
   id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
   slug                varchar(100) NOT NULL UNIQUE
   name                varchar NOT NULL
   logo_url            varchar(500)
   primary_color       varchar(20)
   headline            text
   target_product_ids  jsonb NOT NULL DEFAULT '[]'
   active              boolean NOT NULL DEFAULT true
   created_at          timestamp NOT NULL DEFAULT now()

6. CREATE TABLE upr_api_tokens:
   id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
   name          varchar NOT NULL
   token_hash    varchar NOT NULL UNIQUE
   scopes        jsonb NOT NULL DEFAULT '[]'
   created_by    uuid NOT NULL REFERENCES admin_users(id)
   expires_at    timestamp
   last_used_at  timestamp
   created_at    timestamp NOT NULL DEFAULT now()

Generate the migration file using drizzle-kit generate.
Export all new tables and enums from packages/db/src/schema.ts.
Update the seed file (packages/db/src/seed.ts) to:
  - Add subdomain 'h0' to the existing dev host_server seed record
  - Add subdomain_prefix 'h' to the existing server_template seed record
  - Add 2 sample cai_definitions linked to the seeded products (use placeholder docker images)
```

**ACCEPTANCE CHECK:**
Run `pnpm db:migrate` — no errors.
Run `pnpm db:seed` — no errors.
Run `pnpm db:migrate` a second time — idempotent, no errors.

---

## PROMPT A3 — Infrastructure directory + Caddy templates

```
TASK: Create the infrastructure directory structure and Caddy configuration templates.
This is file creation only — no TypeScript code changes.

Create directory: infrastructure/

Create file: infrastructure/caddy/Caddyfile.platform
Content:
  [YOUR_DOMAIN] {
    reverse_proxy frontend-landing:3000
  }
  app.[YOUR_DOMAIN] {
    reverse_proxy frontend-app:3001
  }
  cms.[YOUR_DOMAIN] {
    @notadmin not remote_ip [YOUR_ADMIN_IP]
    abort @notadmin
    reverse_proxy frontend-cms:3002
  }
  admin.[YOUR_DOMAIN] {
    @notadmin not remote_ip [YOUR_ADMIN_IP]
    abort @notadmin
    reverse_proxy frontend-admin:3003
  }
  uprm.[YOUR_DOMAIN] {
    @notadmin not remote_ip [YOUR_ADMIN_IP]
    abort @notadmin
    reverse_proxy frontend-uprm:3004
  }
  api.[YOUR_DOMAIN] {
    reverse_proxy backend-api:4000
  }

Create file: infrastructure/caddy-host/Caddyfile.template
Content (use literal {HOST_SUBDOMAIN} and {PLATFORM_DOMAIN} as placeholders):
  {HOST_SUBDOMAIN}.{PLATFORM_DOMAIN} {
    respond /health 200
  }
  import /etc/caddy/routes/*.caddy

Create file: infrastructure/caddy-host/route.caddy.template
Content (use literal {PREFIX}, {HOST_SUBDOMAIN}, {PLATFORM_DOMAIN}, {PORT} as placeholders):
  {PREFIX}.{HOST_SUBDOMAIN}.{PLATFORM_DOMAIN} {
    tls {
      dns hetzner {env.HETZNER_DNS_API_TOKEN}
    }
    reverse_proxy localhost:{PORT}
  }

Create file: infrastructure/DNS-SETUP.md
Document the required DNS records:
  Per host server (example for host h1 at IP 1.2.3.4):
    A     h1.[YOUR_DOMAIN]      → 1.2.3.4
    A     *.h1.[YOUR_DOMAIN]    → 1.2.3.4
  Platform server records:
    A     [YOUR_DOMAIN]         → PLATFORM_IP
    A     app.[YOUR_DOMAIN]     → PLATFORM_IP
    A     cms.[YOUR_DOMAIN]     → PLATFORM_IP
    A     admin.[YOUR_DOMAIN]   → PLATFORM_IP
    A     uprm.[YOUR_DOMAIN]    → PLATFORM_IP
    A     api.[YOUR_DOMAIN]     → PLATFORM_IP
  Note: Wildcard DNS must be set for each host server after provisioning.
  Note: TLS for platform handled by Caddy automatic HTTPS.
  Note: TLS for host wildcards handled by Caddy ACME DNS challenge (Hetzner DNS plugin).

Create file: infrastructure/scripts/backup-db.sh
Content: pg_dump $DATABASE_URL | gzip > /backups/aliceclaw-$(date +%Y%m%d-%H%M).sql.gz

Create file: infrastructure/cloud-init/host-init.yaml.template
Content: cloud-init YAML template that:
  - apt-get install -y caddy docker-ce docker-compose-plugin ufw curl
  - ufw allow 22, ufw allow 80, ufw allow 443, ufw --force enable
  - systemctl enable caddy docker
  - mkdir -p /etc/caddy/routes
  - for each SSH_PUBLIC_KEY in {SSH_KEYS}: add to /root/.ssh/authorized_keys
  - echo 'PasswordAuthentication no' >> /etc/ssh/sshd_config
  - for each AGENT_IMAGE in {AGENT_IMAGES}: docker pull {AGENT_IMAGE}
```

**ACCEPTANCE CHECK:**
Files exist at the paths listed. No TypeScript build errors (`pnpm --filter @psi/api build`).

---

## PROMPT A4 — Host provision orchestrator

```
TASK: Create the host provision orchestrator in apps/worker.
This is the documented "next exact step" in PROJECT-STATE.md.

Read existing files before writing:
  apps/worker/src/providers/ (understand HostServerProvider interface)
  apps/worker/src/jobs/ (understand existing job patterns)
  packages/db/src/schema.ts (understand host_servers, server_scale_events, server_templates)

Create file: apps/worker/src/provisioning/host-provision-orchestrator.ts

The orchestrator class:

class HostProvisionOrchestrator {

  async run(scaleEventId: string): Promise<void>
    Step 0 — Idempotency check:
      Load server_scale_events by scaleEventId.
      If not found: log warning and return.
      If status is not 'triggered': log "already processing, skipping" and return.

    Step 1 — Setup:
      Load active server_template (is_active = true).
      If none: throw Error('No active server template configured').
      Generate serverName = template.name + '-' + Date.now()
      Generate subdomain = await this.nextAvailableSubdomain(template.subdomain_prefix)
      Update server_scale_events: status → 'provisioning'

    Step 2 — Provision server:
      Build sshPublicKeys = [process.env.PROVISIONING_SSH_PUBLIC_KEY]
      Read infrastructure/cloud-init/host-init.yaml.template
      Render template: replace {SSH_KEYS} and {AGENT_IMAGES} from env var AGENT_IMAGES
      Call hostServerProvider.provisionHostServer({
        name: serverName,
        hetznerType: template.hetzner_type,
        region: template.region,
        sshPublicKeys,
        cloudInitScript: renderedCloudInit
      })
      Calculate capacity:
        totalCpu = hetznerCpuMap[template.hetzner_type] (cx11→2000, cx21→3000, cx31→4000, cx41→8000, cx51→12000)
        totalMem = hetznerMemMap[template.hetzner_type] (cx11→2048, cx21→4096, cx31→8192, cx41→16384, cx51→32768)
        totalDisk = hetznerDiskMap[template.hetzner_type] (cx11→20, cx21→40, cx31→80, cx41→160, cx51→240)
        overhead = template.management_overhead_percent / 100
        reservedCpu = Math.floor(totalCpu * overhead)
        reservedMem = Math.floor(totalMem * overhead)
      INSERT host_servers: {
        name: serverName, subdomain, provider: 'hetzner',
        provider_instance_id: result.providerId,
        region: template.region, ip_address: result.ip,
        hetzner_type: template.hetzner_type,
        total_cpu_millicores: totalCpu, total_memory_mb: totalMem, total_disk_gb: totalDisk,
        reserved_cpu_millicores: reservedCpu, reserved_memory_mb: reservedMem,
        status: 'provisioning', capacity_threshold_percent: template.capacity_threshold_percent,
        caddy_configured: false
      }

    Step 3 — Wait for running:
      pollIntervalMs = Number(process.env.HOST_PROVIDER_STATUS_POLL_INTERVAL_MS ?? 10000)
      maxAttempts = Number(process.env.HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS ?? 60)
      For each attempt:
        Sleep pollIntervalMs
        status = await hostServerProvider.getServerStatus(result.providerId)
        Update host_servers with latest provider metadata (use existing provider-action tracking pattern)
        If 'running': proceed
        If 'error': throw Error('Provider reports server in error state')
        If maxAttempts exceeded: throw Error('Server did not reach running state in time')

    Step 4 — Stabilise:
      stabilisationMs = Number(process.env.HOST_PROVIDER_READY_STABILIZATION_DELAY_MS ?? 45000)
      Sleep stabilisationMs (Docker + cloud-init need time after OS reports running)

    Step 5 — Mark ready:
      Update host_servers: status → 'ready', ready_at → now()
      Update server_scale_events: new_host_server_id = host.id, status → 'ready'
      Log success: "Host ${serverName} (${subdomain}.[YOUR_DOMAIN]) ready at ${result.ip}"

    Error handler (wrap entire run):
      If host_servers record was inserted: UPDATE status → 'failed'
      UPDATE server_scale_events: status → 'failed'
      Log error details
      Emit admin alert via: fetch(process.env.BACKEND_API_URL + '/internal/alerts', ...)
        body: { type: 'host_provision_failed', entityId: scaleEventId, message: err.message }

  private async nextAvailableSubdomain(prefix: string): Promise<string>
    existingSubdomains = SELECT subdomain FROM host_servers WHERE subdomain IS NOT NULL
    i = 1
    Loop: candidate = prefix + i
      If candidate not in existingSubdomains: return candidate
      i++
}

Update the existing provision-host-server BullMQ job handler to call:
  const orchestrator = new HostProvisionOrchestrator()
  await orchestrator.run(payload.scaleEventId)

Export HostProvisionOrchestrator from the file.
```

**ACCEPTANCE CHECK:**
- `pnpm --filter @psi/worker build` compiles without type errors
- With MockHostServerProvider: enqueue a provision-host-server job manually → host_servers record created with subdomain 'h1', status transitions to 'ready'
- Running a second time with same scaleEventId: does nothing (idempotent)

---

## PROMPT A5 — Live Hetzner smoke test preparation

```
TASK: Update docker-compose.yml worker service to support switching between
mock and live Hetzner provider via environment variables.
Do NOT hardcode any tokens.

In docker-compose.yml, update the worker service environment block to use
variable substitution for provider-sensitive vars. The file should NOT contain
actual token values — only ${VAR_NAME} references:

  HOST_SERVER_PROVIDER: ${HOST_SERVER_PROVIDER:-mock}
  HETZNER_API_TOKEN: ${HETZNER_API_TOKEN:-}
  PROVISIONING_SSH_PUBLIC_KEY: ${PROVISIONING_SSH_PUBLIC_KEY:-}
  HOST_PROVIDER_STATUS_POLL_INTERVAL_MS: ${HOST_PROVIDER_STATUS_POLL_INTERVAL_MS:-1000}
  HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS: ${HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS:-5}
  HOST_PROVIDER_READY_STABILIZATION_DELAY_MS: ${HOST_PROVIDER_READY_STABILIZATION_DELAY_MS:-1000}
  HOST_PROVISION_ATTEMPT_STALE_MS: ${HOST_PROVISION_ATTEMPT_STALE_MS:-2000}
  BACKEND_API_URL: http://backend-api:4000
  AGENT_IMAGES: ${AGENT_IMAGES:-}
  PLATFORM_DOMAIN: ${PLATFORM_DOMAIN:-localhost}

Create file: .env.smoke-test.example
Content: all variables needed for a live Hetzner smoke test, with comments:
  HOST_SERVER_PROVIDER=hetzner
  HETZNER_API_TOKEN=<your-hetzner-test-project-api-token>
  PROVISIONING_SSH_PUBLIC_KEY=<your-ssh-public-key-one-line>
  HOST_PROVIDER_STATUS_POLL_INTERVAL_MS=5000
  HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS=24
  HOST_PROVIDER_READY_STABILIZATION_DELAY_MS=45000
  HOST_PROVISION_ATTEMPT_STALE_MS=600000
  AGENT_IMAGES=ubuntu:22.04  # replace with real CAI image when available
  PLATFORM_DOMAIN=[YOUR_DOMAIN]

Create file: infrastructure/scripts/smoke-test-hetzner.sh
Content: shell script that:
  1. Echoes "Hetzner smoke test — ensure .env.smoke-test is loaded"
  2. Verifies HETZNER_API_TOKEN is set (exits if not)
  3. Verifies PROVISIONING_SSH_PUBLIC_KEY is set (exits if not)
  4. Calls the admin provision endpoint:
     curl -sf -X POST http://localhost:4000/admin/servers/provision \
       -H "Authorization: Bearer $ADMIN_TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"reason":"smoke-test"}' | jq .
  5. Echoes "Monitor the provisioning queue in admin panel"
  6. Echoes "When complete, retire the server via admin panel"
  7. Echoes "Verify no orphaned servers remain in Hetzner console"

Update .gitignore to include: .env.smoke-test (never commit real tokens)
```

**ACCEPTANCE CHECK:**
- `pnpm dev` still starts cleanly with default (mock) settings
- `.env.smoke-test` is in `.gitignore`
- The smoke-test script exits clearly if env vars are missing

> NOTE: Run the actual live smoke test now using HETZNER-PREFLIGHT-CHECKLIST.md.
> Do not proceed to Sprint B until the live smoke test has provisioned and retired one real host.

---

# SPRINT B — CONTAINER DEPLOYMENT

---

## PROMPT B1 — Docker adapter interface and mock

```
TASK: Create the DockerAdapter interface and MockDockerAdapter in apps/worker.

Create file: apps/worker/src/providers/docker-adapter.ts

Export interface DockerAdapter:

  deployContainer(params: {
    hostIp: string
    containerName: string
    dockerImage: string
    dockerTag: string
    hostPort: number
    containerPort: number
    cpuMillicores: number
    memoryMb: number
    envVars: Record<string, string>
    healthCheckPath: string
    startupTimeoutSeconds: number
  }): Promise<{ containerId: string }>

  getContainerStatus(
    hostIp: string,
    containerName: string
  ): Promise<'running' | 'starting' | 'unhealthy' | 'stopped' | 'not_found'>

  stopContainer(hostIp: string, containerName: string): Promise<void>
  removeContainer(hostIp: string, containerName: string): Promise<void>
  updateCaddyRoute(hostIp: string, subdomainPrefix: string, port: number, hostSubdomain: string, platformDomain: string): Promise<void>
  removeCaddyRoute(hostIp: string, subdomainPrefix: string): Promise<void>

Create class MockDockerAdapter implements DockerAdapter:
  deployContainer: logs params, waits 4 seconds, returns { containerId: 'mock-' + randomUUID() }
  getContainerStatus: 
    First call for a given containerName: returns 'starting'
    Second+ call: returns 'running'
    (Use a Map<string, number> to track call counts internally)
  stopContainer: logs "mock stop {containerName}"
  removeContainer: logs "mock remove {containerName}"
  updateCaddyRoute: logs "mock Caddy route: {subdomainPrefix} → {port}"
  removeCaddyRoute: logs "mock remove Caddy route: {subdomainPrefix}"

Create file: apps/worker/src/providers/ssh-docker-adapter.ts
(Stub only for now — real SSH implementation comes in Phase E1)

class SshDockerAdapter implements DockerAdapter:
  All methods: throw new Error('SshDockerAdapter not yet implemented — use mock for now')

Create file: apps/worker/src/providers/docker-adapter-factory.ts

Export function getDockerAdapter(): DockerAdapter
  If NODE_ENV !== 'production': return new MockDockerAdapter()
  Return new SshDockerAdapter()

Export getDockerAdapter as default.
```

**ACCEPTANCE CHECK:**
- `pnpm --filter @psi/worker build` — no errors
- MockDockerAdapter returns 'starting' on first call, 'running' on second — write a small test or console verify

---

## PROMPT B2 — Slot allocator

```
TASK: Create the SlotAllocator service in apps/worker.

Read packages/db/src/schema.ts for the host_servers and container_instances table shapes.
Read the cai_definitions schema from the migration created in Prompt A2.

Create file: apps/worker/src/services/slot-allocator.ts

Import the db client from @psi/db.

Export class SlotAllocator:

  async findAvailableHost(caiDefinition: {
    cpu_millicores: number
    memory_mb: number
  }): Promise<typeof host_servers.$inferSelect | null>
  
    Query: SELECT all host_servers WHERE status = 'ready' AND caddy_configured = true
    For each host:
      Query container_instances:
        usedCpu = SUM(cpu_millicores from joined cai_definitions)
          WHERE host_server_id = host.id
          AND status IN ('deploying', 'running', 'unhealthy')
        usedMemory = SUM(memory_mb from joined cai_definitions)
          WHERE host_server_id = host.id
          AND status IN ('deploying', 'running', 'unhealthy')
      availableCpu = host.total_cpu_millicores - host.reserved_cpu_millicores - usedCpu
      availableMemory = host.total_memory_mb - host.reserved_memory_mb - usedMemory
      isEligible = availableCpu >= caiDefinition.cpu_millicores
                   AND availableMemory >= caiDefinition.memory_mb
    From eligible hosts: return the one with HIGHEST utilisation percentage
      utilPercent = usedCpu / (host.total_cpu_millicores - host.reserved_cpu_millicores) * 100
    Return null if no eligible host found.

  async checkAndTriggerScaleOut(host: typeof host_servers.$inferSelect): Promise<void>
  
    Load all active cai_definitions (where active = true)
    Find the definition requiring the most resources:
      largestCpu = max(cpu_millicores across all definitions)
      largestMem = max(memory_mb across all definitions)
    
    Load current usage for this host:
      usedCpu = SUM(cpu_millicores) WHERE host_server_id = host.id AND status IN (deploying,running,unhealthy)
      usedMem = SUM(memory_mb) WHERE host_server_id = host.id AND status IN (deploying,running,unhealthy)
    
    availableCpu = host.total_cpu_millicores - host.reserved_cpu_millicores - usedCpu
    availableMem = host.total_memory_mb - host.reserved_memory_mb - usedMem
    canFitLargestCai = availableCpu >= largestCpu AND availableMem >= largestMem
    
    If NOT canFitLargestCai:
      Check existing in-progress scale event:
        SELECT from server_scale_events
          WHERE trigger_host_server_id = host.id
          AND status IN ('triggered', 'provisioning')
      If none found:
        INSERT server_scale_events: {
          trigger_host_server_id: host.id,
          trigger_reason: 'largest_cai_no_longer_fits',
          status: 'triggered'
        }
        Enqueue BullMQ job 'provision-host-server' with { scaleEventId: newEvent.id }
        Log: "Scale-out triggered for host ${host.name} — largest CAI no longer fits"
      If found:
        Log: "Scale-out already in progress for ${host.name}, skipping"

  async assignPort(host: typeof host_servers.$inferSelect): Promise<number>
    usedPorts = SELECT assigned_port FROM container_instances
      WHERE host_server_id = host.id AND status != 'deleted' AND assigned_port IS NOT NULL
    For port from 3000 to 3500:
      If port not in usedPorts: return port
    Throw new Error('No ports available on host ' + host.name)

  async assignSubdomainPrefix(host: typeof host_servers.$inferSelect): Promise<string>
    usedPrefixes = SELECT subdomain_prefix FROM container_instances
      WHERE host_server_id = host.id AND status != 'deleted' AND subdomain_prefix IS NOT NULL
    suffixes = ['a','b','c',...,'z','aa','ab',...,'az','ba',...,'zz']
    For each suffix:
      If suffix not in usedPrefixes: return suffix
    Throw new Error('No subdomain prefixes available on host ' + host.name)

Export singleton: export const slotAllocator = new SlotAllocator()
```

**ACCEPTANCE CHECK:**
- Build passes
- findAvailableHost returns null when no ready hosts exist
- findAvailableHost returns the most-utilised eligible host when multiple exist
- checkAndTriggerScaleOut creates exactly one scale event even if called twice (idempotent)
- assignPort returns 3000 for empty host, increments correctly
- assignSubdomainPrefix returns 'a' first, 'b' second, etc.

---

## PROMPT B3 — Deploy-CAI job

```
TASK: Create the deploy-cai BullMQ job in apps/worker.

Read the following before writing:
  - slotAllocator from apps/worker/src/services/slot-allocator.ts (Prompt B2)
  - getDockerAdapter from apps/worker/src/providers/docker-adapter-factory.ts (Prompt B1)
  - DB schema: container_instances, provisioning_jobs, cai_definitions, host_servers, subscriptions

Create file: apps/worker/src/jobs/deploy-cai.ts

Queue name: 'deploy-cai'
Payload type: { subscriptionId: string; containerInstanceId: string; attempt?: number }

Helper function resolveEnvTemplate(
  template: Record<string, string>,
  vars: Record<string, string>
): Record<string, string>
  For each key in template: replace {{varName}} patterns in the value with vars[varName]
  Return resolved object

The job processor:

STEP 0 — Load and validate:
  Load container_instances by containerInstanceId.
  If not found: throw Error('Container instance not found')
  If status is 'deploying' or 'running': skip to STEP 2 (idempotent restart)
  If status is not 'pending': log warning and return (unexpected state)
  Load subscription by subscriptionId.
  Load product linked to subscription.
  Load cai_definitions where product_id = product.id AND active = true.
  If no cai_definition: mark container failed, error 'no_cai_definition_found', return.

STEP 1 — Allocate host:
  host = await slotAllocator.findAvailableHost(caiDefinition)
  If null:
    existingScaleEvent = check for in-progress server_scale_events (status in triggered/provisioning)
    If existingScaleEvent exists:
      attempt = (payload.attempt ?? 0) + 1
      If attempt >= 10:
        Mark container failed, error 'no_capacity_scale_timeout'
        POST /internal/alerts { type: 'deploy_failed_no_capacity', entityId: containerInstanceId }
        return
      Re-enqueue 'deploy-cai' with { ...payload, attempt } delayed by 60 seconds
      Log: "No host available, scale-out in progress. Retry attempt ${attempt} in 60s"
      return
    Else:
      Mark container failed, error 'no_capacity_no_scale_in_progress'
      POST /internal/alerts { type: 'deploy_failed_no_scale', entityId: containerInstanceId }
      return

  port = await slotAllocator.assignPort(host)
  subdomainPrefix = await slotAllocator.assignSubdomainPrefix(host)
  containerName = 'cai-' + subscriptionId.slice(0, 8)
  platformDomain = process.env.PLATFORM_DOMAIN ?? 'localhost'
  workspaceUrl = 'https://' + subdomainPrefix + '.' + host.subdomain + '.' + platformDomain

  UPDATE container_instances: {
    host_server_id: host.id, assigned_port: port, container_name: containerName,
    subdomain_prefix: subdomainPrefix, workspace_url: workspaceUrl, status: 'deploying'
  }
  UPDATE provisioning_jobs: { current_step: 'allocate', append log line }

STEP 2 — Deploy container:
  Reload container_instance (may have been set by idempotent path).
  Reload host_server.
  templateVars = {
    user_id: subscription.user_id,
    subscription_id: subscriptionId,
    container_name: containerInstance.container_name,
    host_ip: host.ip_address,
    workspace_url: containerInstance.workspace_url,
    subdomain_prefix: containerInstance.subdomain_prefix
  }
  envVars = resolveEnvTemplate(caiDefinition.env_template, templateVars)

  const dockerAdapter = getDockerAdapter()
  result = await dockerAdapter.deployContainer({
    hostIp: host.ip_address,
    containerName: containerInstance.container_name,
    dockerImage: caiDefinition.docker_image,
    dockerTag: caiDefinition.docker_tag,
    hostPort: containerInstance.assigned_port,
    containerPort: caiDefinition.container_port,
    cpuMillicores: caiDefinition.cpu_millicores,
    memoryMb: caiDefinition.memory_mb,
    envVars,
    healthCheckPath: caiDefinition.health_check_path,
    startupTimeoutSeconds: caiDefinition.startup_timeout_seconds
  })

  UPDATE container_instances: {
    container_id: result.containerId, status: 'running', started_at: now()
  }
  UPDATE subscriptions: { status: 'active' }
  UPDATE provisioning_jobs: { current_step: 'deploy', append log line }

STEP 3 — Register Caddy route:
  await dockerAdapter.updateCaddyRoute(
    host.ip_address,
    containerInstance.subdomain_prefix,
    containerInstance.assigned_port,
    host.subdomain,
    platformDomain
  )
  UPDATE provisioning_jobs: { current_step: 'caddy_route', append log line }

STEP 4 — Post-deploy:
  slotAllocator.checkAndTriggerScaleOut(host).catch(err =>
    console.error('Scale-out check failed (non-fatal):', err)
  )
  If container_instances.email_verified_at IS NOT NULL:
    Notify user: POST /internal/notify {
      type: 'workspace_ready', userId: subscription.user_id,
      workspaceUrl: containerInstance.workspace_url
    }
  UPDATE provisioning_jobs: { status: 'completed', current_step: 'done', finished_at: now() }

Error handler (wrap entire job):
  UPDATE container_instances: { status: 'failed' }
  UPDATE provisioning_jobs: { status: 'failed', error_message: err.message, finished_at: now() }
  POST /internal/alerts { type: 'deploy_cai_failed', entityId: containerInstanceId, message: err.message }
  Re-throw so BullMQ records the failure

Register this job in the worker's main queue setup file.
The queue name is 'deploy-cai'.
```

**ACCEPTANCE CHECK:**
- Build passes with no type errors
- With MockDockerAdapter: manually enqueue a deploy-cai job → container_instances transitions pending→deploying→running
- slotAllocator.checkAndTriggerScaleOut is called after successful deploy
- A second enqueue with the same containerInstanceId (already running): skips silently

---

## PROMPT B4 — Container lifecycle jobs

```
TASK: Create stop, delete, and restart BullMQ jobs for container lifecycle management.

Create file: apps/worker/src/jobs/stop-cai.ts
Queue name: 'stop-cai'
Payload: { containerInstanceId: string }

Logic:
  Load container_instances by id. If not found or status = 'deleted': return silently.
  Load host_servers by host_server_id.
  const dockerAdapter = getDockerAdapter()
  try: await dockerAdapter.stopContainer(host.ip_address, container.container_name)
  catch: log warning "Stop container failed (continuing): " + err.message
  try: await dockerAdapter.removeContainer(host.ip_address, container.container_name)
  catch: log warning "Remove container failed (continuing): " + err.message
  try: await dockerAdapter.removeCaddyRoute(host.ip_address, container.subdomain_prefix)
  catch: log warning "Remove Caddy route failed (continuing): " + err.message
  UPDATE container_instances: { status: 'stopped', stopped_at: now() }

---

Create file: apps/worker/src/jobs/delete-cai.ts
Queue name: 'delete-cai'
Payload: { containerInstanceId: string }

Logic:
  Load container_instances by id. If not found or already 'deleted': return silently.
  If host_server_id is set: load host_servers.
  const dockerAdapter = getDockerAdapter()
  If host exists:
    try each: stopContainer, removeContainer, removeCaddyRoute — all catch+log, never throw
  UPDATE container_instances: { status: 'deleted', stopped_at: now() }

---

Create file: apps/worker/src/jobs/restart-cai.ts
Queue name: 'restart-cai'
Payload: { containerInstanceId: string; subscriptionId: string }

Logic:
  Load container_instances by id.
  If status is not 'stopped': log "Cannot restart, status is ${status}" and return.
  UPDATE container_instances: { status: 'deploying' }
  Enqueue 'deploy-cai' with { subscriptionId, containerInstanceId }
  (deploy-cai idempotency: host_server_id already set → Step 1 finds host, skips allocation if port still assigned)

---

Register all three jobs in the worker's main queue setup.

Add API routes in apps/backend-api (user-facing, requireAuth):

POST /user/workspaces/:containerInstanceId/stop
  Load container_instances by id.
  Verify container.user_id === req.user.id (ownership check, return 403 if not)
  If status not in ['running', 'unhealthy']: return 400 'Cannot stop a workspace that is not running'
  UPDATE container_instances.status → 'stopping' (intermediate state for UI)
  Enqueue 'stop-cai': { containerInstanceId }
  Return { success: true, message: 'Workspace is stopping' }

POST /user/workspaces/:containerInstanceId/start
  Load container_instances by id.
  Verify container.user_id === req.user.id
  Load subscription by container.subscription_id — verify status = 'active'
  If status is not 'stopped': return 400 'Can only start a paused workspace'
  UPDATE container_instances.status → 'deploying'
  Enqueue 'restart-cai': { containerInstanceId, subscriptionId: container.subscription_id }
  Return { success: true, message: 'Workspace is starting' }
```

**ACCEPTANCE CHECK:**
- Build passes
- stop-cai: running container → status 'stopped', stop/remove/Caddy route all called on MockDockerAdapter
- delete-cai: stopped container → status 'deleted'
- restart-cai: stopped container → status 'deploying', deploy-cai enqueued
- POST /user/workspaces/:id/stop returns 403 for wrong user

---

## PROMPT B5 — Health monitor job

```
TASK: Create the repeating health monitor job for all running containers.

Create file: apps/worker/src/jobs/health-check-cais.ts

This is a BullMQ repeatable job.
Queue name: 'health-check-cais'
No payload.

Job logic:
  Log: "Health check started"
  Load all container_instances where status = 'running'
  Log: "Checking ${containers.length} running containers"

  Process in parallel with concurrency limit of 5 (use p-limit or simple batching):
    For each container:
      Load host_servers by host_server_id. If not found: skip.
      const dockerAdapter = getDockerAdapter()
      dockerStatus = await dockerAdapter.getContainerStatus(
        host.ip_address,
        container.container_name
      ).catch(err => {
        log warning: "Health check SSH failed for ${container.container_name}: " + err.message
        return 'not_found' as const
      })

      Switch on dockerStatus:
        'running': no action
        'starting': no action (transient)
        'unhealthy':
          UPDATE container_instances.status → 'unhealthy'
          INSERT admin_alerts: { type: 'container_unhealthy', entity_id: container.id,
            message: "Container ${container.container_name} on ${host.name} is unhealthy" }
        'stopped':
          UPDATE container_instances.status → 'stopped'
          INSERT admin_alerts: { type: 'container_stopped_unexpectedly', entity_id: container.id,
            message: "Container ${container.container_name} stopped unexpectedly on ${host.name}" }
        'not_found':
          UPDATE container_instances.status → 'failed'
          INSERT admin_alerts: { type: 'container_missing', entity_id: container.id,
            message: "Container ${container.container_name} not found on ${host.name}" }

  Log: "Health check complete"

Register this as a repeatable job in the worker startup:
  queue.add('health-check-cais', {}, {
    repeat: { every: 120000 },  // every 2 minutes
    jobId: 'health-check-cais-repeating'  // stable ID prevents duplicates on restart
  })

Note: MockDockerAdapter returns 'running' after first call, so health checks
will not create alerts in development unless you manually set a container to 'unhealthy' in DB.
```

**ACCEPTANCE CHECK:**
- Build passes
- Job registers as repeatable in BullMQ without error
- Manually trigger the job: it checks all running containers and logs results
- Setting a container status to 'running' with a non-existent containerName: MockDockerAdapter still returns 'running' (expected in dev — full test in staging with real adapter)

---

# SPRINT C — BACKEND API EXTENSIONS

---

## PROMPT C1 — UPR service interface and local implementation

```
TASK: Create the UPR (User/Payment/Referral) service interface and its local implementation.
This establishes the boundary that allows UPR to be extracted later.

Create file: packages/types/src/upr.ts

Export the following TypeScript interfaces:

interface UprUser {
  id: string; email: string; fullName: string; referralCode: string;
  emailVerified: boolean; status: 'active' | 'suspended'; createdAt: Date;
}

interface UprSubscription {
  id: string; userId: string; productId: string; status: string;
  billingProviderSubscriptionId: string | null;
  currentPeriodEnd: Date; cancelAtPeriodEnd: boolean; createdAt: Date;
}

interface UprReferralStats {
  referralCode: string; referralLink: string;
  activeCount: number; convertedCount: number; totalCreditCents: number;
  ledger: Array<{ id: string; amountCents: number; status: string; createdAt: Date }>;
}

interface CheckoutSessionParams {
  userId: string; productId: string; referralCodeUsed?: string;
}

export interface UprService {
  // Users
  getUserById(id: string): Promise<UprUser | null>
  getUserByEmail(email: string): Promise<UprUser | null>
  createUser(data: { email: string; password: string; fullName: string; referralCodeUsed?: string }): Promise<UprUser>
  updateUser(id: string, data: Partial<{ fullName: string; phone: string; country: string; companyName: string }>): Promise<UprUser>
  suspendUser(id: string): Promise<void>
  reactivateUser(id: string): Promise<void>
  verifyEmail(userId: string): Promise<void>
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>

  // Auth
  validateCredentials(email: string, password: string): Promise<UprUser | null>
  generateTokens(userId: string, role?: string): Promise<{ accessToken: string; refreshToken: string }>
  validateRefreshToken(token: string): Promise<{ userId: string } | null>
  invalidateRefreshToken(token: string): Promise<void>

  // Subscriptions
  getSubscription(id: string): Promise<UprSubscription | null>
  getActiveSubscriptionsForUser(userId: string): Promise<UprSubscription[]>
  createSubscription(data: { userId: string; productId: string; orderId: string; billingProviderSubscriptionId?: string }): Promise<UprSubscription>
  updateSubscriptionStatus(id: string, status: string): Promise<void>
  applyCredit(userId: string, amountCents: number, reason: string): Promise<void>

  // Billing
  createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string; sessionId: string }>
  processWebhookEvent(rawBody: Buffer, signature: string): Promise<void>

  // Referrals
  getReferralStats(userId: string): Promise<UprReferralStats>
  applyReferralCode(referredUserId: string, code: string, orderId: string): Promise<void>
  vestReferralReward(referralId: string): Promise<void>
}

---

Create file: apps/backend-api/src/modules/upr/upr-service-local.ts

Implements UprService using the existing DB and Stripe SDK.
Move all existing auth, subscription, and billing logic here.
The class wraps the existing implementations — do not rewrite them,
just reorganise them behind the interface.

Key behaviours (must match interface):
  createUser: bcrypt hash password (rounds 12), generate referral_code, INSERT users + profiles
  validateCredentials: bcrypt compare
  generateTokens: JWT access (15min) + refresh (30 days)
  createCheckoutSession: call StripeAdapter (existing)
  processWebhookEvent: call StripeAdapter webhook handler (existing), emit BillingEvents

---

Create file: apps/backend-api/src/modules/upr/upr-service-remote.ts

Stub implementation only:
  Every method throws: new Error('UprServiceRemote not yet implemented')
  Constructor accepts: baseUrl: string, apiToken: string

---

Create file: apps/backend-api/src/modules/upr/upr-factory.ts

Export function getUprService(): UprService
  If process.env.UPR_MODE === 'remote':
    return new UprServiceRemote(
      process.env.UPR_BASE_URL ?? '',
      process.env.UPR_API_TOKEN ?? ''
    )
  Return new UprServiceLocal()  // default

Export cached singleton: call getUprService() once at startup, cache the result.

---

Update all existing routes in apps/backend-api that directly use DB or Stripe
to instead call getUprService():
  POST /auth/register → uprService.createUser()
  POST /auth/login → uprService.validateCredentials() + uprService.generateTokens()
  POST /auth/refresh → uprService.validateRefreshToken() + uprService.generateTokens()
  POST /auth/logout → uprService.invalidateRefreshToken()
  POST /billing/webhook → uprService.processWebhookEvent()
  POST /orders/create → uprService.createCheckoutSession()

Add UPR API token admin routes (requireAdminRole(['super_admin'])):
  POST /admin/upr/tokens
    Body: { name, scopes: string[] }
    Generate token = crypto.randomBytes(32).toString('hex')
    Store token_hash = sha256(token)
    INSERT upr_api_tokens
    Return { token } (only time plaintext is shown)

  GET /admin/upr/tokens
    Return all upr_api_tokens (never return token_hash or plaintext)

  DELETE /admin/upr/tokens/:id
    DELETE from upr_api_tokens
```

**ACCEPTANCE CHECK:**
- Build passes
- POST /auth/register and POST /auth/login still work via uprService
- getUprService() with UPR_MODE=local returns UprServiceLocal
- Admin token creation returns the plaintext token once

---

## PROMPT C2 — CAI definitions admin API

```
TASK: Create the CAI definitions admin API routes.

In apps/backend-api, create file: src/modules/cai-definitions/routes.ts

Mount at prefix: /admin/cai-definitions

All routes require requireAdmin middleware.
Role restrictions as noted per route.

GET / — [super_admin, content_admin, provisioning_admin]
  Join cai_definitions with products (name, price_cents, active)
  Add computed field: active_instance_count = COUNT of container_instances
    WHERE cai_definition_id = def.id AND status IN ('deploying','running','unhealthy')
  Return array sorted by product name

POST / — [super_admin, content_admin]
  Body: {
    productId: string
    dockerImage: string
    dockerTag: string          default: 'latest'
    sizeTier: 'nano'|'standard'|'pro'
    cpuMillicores: number
    memoryMb: number
    diskGb: number
    envTemplate: Record<string,string>  default: {}
    containerPort: number
    healthCheckPath: string    default: '/health'
    startupTimeoutSeconds: number  default: 120
    agentType: 'openclaw'|'hermes'|'nano'|'custom'
  }
  Validate:
    productId exists
    No existing active cai_definition for this productId
    containerPort between 1000 and 9999
    cpuMillicores > 0
    memoryMb > 0
  INSERT cai_definitions
  Return created record

PATCH /:id — [super_admin, content_admin]
  Allow updating: dockerImage, dockerTag, sizeTier, cpuMillicores, memoryMb,
                  diskGb, envTemplate, containerPort, healthCheckPath,
                  startupTimeoutSeconds, agentType, active
  Do NOT allow changing productId
  Return updated record

DELETE /:id — [super_admin]
  Check active_instance_count > 0 → return 409 "Cannot deactivate: {n} containers are running"
  UPDATE active = false (soft delete)
  Return { success: true }

GET /:id/instances — [super_admin, provisioning_admin, support_admin]
  Return all container_instances for this definition joined with:
    user email (from users), subscription status, host name (from host_servers),
    started_at, workspace_url, status
  Paginated: page, limit query params (default limit 20)
  Sorted by created_at DESC

Register routes in the main app router.
```

**ACCEPTANCE CHECK:**
- Build passes
- GET /admin/cai-definitions returns seeded definitions with active_instance_count
- POST /admin/cai-definitions with duplicate productId returns 409
- DELETE /admin/cai-definitions/:id with running instances returns 409

---

## PROMPT C3 — Billing event handlers update

```
TASK: Update billing event handlers to use the new CAI deployment flow.
Read the existing billing handlers file before modifying it.

In apps/backend-api/src/modules/billing/handlers.ts,
update the subscription.activated handler completely:

OLD behaviour (remove): creates vps_instances, old provisioning flow

NEW behaviour for subscription.activated:
  1. Load subscription with user and product via DB
  2. Load cai_definition where product_id = product.id AND active = true
     If none found: log error "No active cai_definition for product ${product.id}" — continue anyway
  3. INSERT container_instances: {
       subscription_id, user_id: subscription.user_id,
       cai_definition_id: caiDefinition?.id,
       container_name: 'cai-' + subscription.id.slice(0, 8),
       status: 'pending'
     }
  4. INSERT provisioning_jobs: {
       container_instance_id: containerInstance.id,
       subscription_id,
       status: 'queued',
       current_step: 'awaiting_deploy_trigger'
     }
  5. Enqueue 'deploy-cai' immediately: { subscriptionId: subscription.id, containerInstanceId: containerInstance.id }
     Deploy starts NOW on payment — not gated by email verification
  6. Generate verification token: crypto.randomBytes(32).toString('hex')
  7. INSERT email_verifications: { user_id, subscription_id, token, expires_at: now + 7 days }
  8. Call notification service: sendVerificationEmail({ userId, productName, verificationUrl })
     verificationUrl = BACKEND_API_URL + '/auth/verify-email?token=' + token
     This runs in parallel — do not await before returning

Update subscription.cancelled handler:
  Load container_instances where subscription_id = X AND status NOT IN ('deleted', 'failed')
  For each: enqueue 'delete-cai' with { containerInstanceId: container.id }
  Update subscription status if needed

Update subscription.payment_failed handler:
  Log billing event
  Update subscription status (existing logic, keep as-is)

Update subscription.grace_period_ended handler:
  Same as cancelled — delete any non-deleted containers
```

**ACCEPTANCE CHECK:**
- Build passes
- Simulate subscription.activated billing event → container_instances record created with status 'pending', deploy-cai job enqueued, email_verifications record created
- Simulate subscription.cancelled → delete-cai job enqueued for running container

---

## PROMPT C4 — Email verification and onboarding routes

```
TASK: Create email verification routes and onboarding status API.

In apps/backend-api, add to auth routes:

GET /auth/verify-email?token=X  (public, no auth)
  Load email_verifications where token = X AND verified_at IS NULL
  If not found: return 200 with HTML:
    <h1>Link not found</h1><p>This verification link is invalid or has already been used.</p>
  If expires_at <= now(): return 200 with HTML:
    <h1>Link expired</h1>
    <p>Your workspace is already being set up. Log in to your dashboard to check its status.</p>
    <a href="https://app.[YOUR_DOMAIN]/login">Go to dashboard</a>
  UPDATE email_verifications: { verified_at: now() }
  UPDATE users: { email_verified: true }
  UPDATE container_instances: { email_verified_at: now() }
    WHERE subscription_id = verification.subscription_id
  Load container_instances for this subscription
  If container.status = 'running' AND container.workspace_url IS NOT NULL:
    POST /internal/notify { type: 'workspace_ready', userId, workspaceUrl: container.workspace_url }
  Redirect to: https://app.[YOUR_DOMAIN]/onboarding?subscriptionId= + verification.subscription_id

POST /auth/resend-verification  (requireAuth)
  Load email_verifications where user_id = req.user.id AND verified_at IS NULL
    (join with subscriptions to get the most recent unverified one)
  If resend_count >= 5: return 429 { error: 'Maximum resends reached. Contact support.' }
  UPDATE existing token: expires_at = now() (invalidate old token)
  Generate new token: crypto.randomBytes(32).toString('hex')
  INSERT new email_verifications: { user_id, subscription_id, token, expires_at: now + 7 days }
  UPDATE old record: resend_count + 1 (or UPDATE new record)
  Send verification email
  Return { success: true }

---

In apps/backend-api, create onboarding routes (all requireAuth):

GET /onboarding/session?subscriptionId=X
  Verify subscription belongs to req.user.id
  Load or create onboarding_sessions for this subscription_id
  Return: { subscriptionId, currentStep, answers, completedAt }

GET /onboarding/deploy-status?subscriptionId=X
  Verify subscription belongs to req.user.id
  Load container_instances where subscription_id = X
  Load provisioning_jobs where container_instance_id = container.id (latest by created_at)
  Load email_verifications where subscription_id = X (latest)
  Return: {
    containerStatus: container.status,
    currentStep: job.current_step,
    recentLogs: job.log_lines.slice(-5),
    workspaceUrl: container.workspace_url,
    emailVerified: container.email_verified_at IS NOT NULL,
    startedAt: container.started_at
  }

POST /onboarding/save-step
  Body: { subscriptionId, step: number, answers: Record<string, any> }
  Verify subscription belongs to req.user.id
  Upsert onboarding_sessions: merge answers into existing answers jsonb, update current_step
  Return { success: true }

POST /onboarding/complete
  Body: { subscriptionId }
  Verify subscription belongs to req.user.id
  UPDATE onboarding_sessions: { completed_at: now() }
  Return { success: true }

---

In apps/backend-api, create user workspace routes (requireAuth):

GET /user/workspaces
  Load all container_instances where user_id = req.user.id AND status != 'deleted'
  Join with: cai_definitions (docker_image, size_tier, agent_type), products (name, price_cents),
             subscriptions (status, current_period_end), host_servers (name, subdomain)
  Return array sorted by created_at DESC

GET /user/workspaces/:containerInstanceId/status
  Verify ownership
  Return same shape as /onboarding/deploy-status but by container id
```

**ACCEPTANCE CHECK:**
- Build passes
- GET /auth/verify-email with valid token: updates verified_at, redirects
- GET /auth/verify-email with expired token: returns HTML with dashboard link
- GET /onboarding/deploy-status returns correct shape for pending/running containers
- GET /user/workspaces returns containers for authenticated user only

---

## PROMPT C5 — Internal notification and alert endpoints

```
TASK: Create internal endpoints used by the worker to send notifications and alerts.
These are not user-facing. They are called by the worker process using a shared secret.

In apps/backend-api, create file: src/modules/internal/routes.ts
Mount at prefix: /internal

All routes require header: X-Internal-Secret matching env var INTERNAL_SECRET
  Middleware: if header missing or wrong → return 401 immediately

POST /internal/alerts
  Body: { type: string; entityId: string; message: string }
  INSERT admin_alerts: { type, entity_id: entityId, message }
  Return { success: true }

POST /internal/notify
  Body: { type: string; userId: string; [key: string]: any }
  Switch on type:
    'workspace_ready':
      Load user email from DB
      Call Postmark: send workspace ready email with body.workspaceUrl
      Email subject: "Your AI workspace is ready"
      Email body: "Your workspace is running. Open it here: {workspaceUrl}"
                  "Bookmark this link — it is your permanent workspace address."
    default:
      Log "Unknown notification type: " + type

Return { success: true }

---

Create the notification service in apps/backend-api/src/modules/notifications/service.ts

sendVerificationEmail(params: { userId: string; productName: string; verificationUrl: string }):
  Load user from DB (get email and full name)
  Send via Postmark (POSTMARK_API_TOKEN from env, from address POSTMARK_FROM_EMAIL):
  Subject: "Confirm your email — your {productName} workspace is being prepared"
  Text body:
    "Hi {fullName},"
    "Your {productName} workspace is being set up right now."
    "Click the link below to confirm your email and receive your workspace access link."
    verificationUrl
    "This link is valid for 7 days."
    "If you did not make this purchase, you can safely ignore this email."
  Never include: credentials, IPs, port numbers, container names

sendWorkspaceReadyEmail(params: { userEmail: string; workspaceUrl: string }):
  Subject: "Your AI workspace is ready"
  Text body:
    "Your workspace is running."
    workspaceUrl
    "Bookmark this link — it is your permanent workspace address."

Export both functions from the notification service.
```

**ACCEPTANCE CHECK:**
- POST /internal/alerts without X-Internal-Secret header → 401
- POST /internal/alerts with correct header → admin_alerts record created
- POST /internal/notify type 'workspace_ready' → attempts to send email (will fail gracefully if no Postmark token in dev)
- Build passes

---

## PROMPT C6 — Admin fleet and provisioning retry

```
TASK: Update admin fleet routes and add provisioning retry capability.

In apps/backend-api, update existing admin fleet routes:

GET /admin/servers
  Existing route — add computed fields to each host:
    usedCpuMillicores = SUM(cpu_millicores from cai_definitions join container_instances)
      WHERE host_server_id = host.id AND status IN ('deploying','running','unhealthy')
    usedMemoryMb = SUM(memory_mb from cai_definitions join container_instances)
      WHERE same condition
    containerCount = COUNT WHERE same condition
    utilPercent = usedCpuMillicores / (total_cpu_millicores - reserved_cpu_millicores) * 100
  Also include: subdomain, caddy_configured in response

GET /admin/servers/:id
  Existing route — add:
    All container_instances on this host joined with:
      user email, product name, size_tier, workspace_url, status, started_at
  Return both host detail and containers array

---

Create new admin provisioning queue route:

GET /admin/provisioning  [super_admin, provisioning_admin]
  Return all provisioning_jobs joined with container_instances and users
  Fields: job id, status, current_step, retry_count, error_message,
          created_at, finished_at, user email, product name, workspace_url
  Filter params: status (query), page, limit
  Sort: created_at DESC

POST /admin/provisioning/:jobId/retry  [super_admin, provisioning_admin]
  Load provisioning_jobs by jobId
  If status is not 'failed': return 400 'Can only retry failed jobs'
  Load container_instances by container_instance_id
  If container status is not 'failed': return 400 'Container is not in failed state'
  UPDATE provisioning_jobs: {
    status: 'queued', current_step: 'awaiting_retry',
    error_message: null, finished_at: null, retry_count: retry_count + 1
  }
  UPDATE container_instances: { status: 'pending' }
  Enqueue 'deploy-cai': { subscriptionId: container.subscription_id, containerInstanceId: container.id }
  Return { success: true }

---

GET /admin/alerts  [super_admin, provisioning_admin]
  Return admin_alerts newest first, paginated
  Filter: type, resolved (boolean), page, limit

PATCH /admin/alerts/:id/resolve  [super_admin, provisioning_admin]
  UPDATE admin_alerts: { resolved_at: now() }
  Return { success: true }
```

**ACCEPTANCE CHECK:**
- GET /admin/servers returns utilPercent for each host
- POST /admin/provisioning/:jobId/retry on a failed job → deploy-cai re-enqueued, container status → 'pending'
- POST /admin/provisioning/:jobId/retry on a non-failed job → 400
- GET /admin/alerts returns unresolved alerts

---

# SPRINT D — FRONTENDS

---

## PROMPT D1 — frontend-landing: homepage and product pages

```
TASK: Build the public-facing landing site in apps/frontend-landing.
This frontend serves project-domain.com.

API base: read from VITE_API_URL env var (default http://localhost:4000)

Build these pages using React Router:

/ — Homepage
  Hero section:
    Headline from GET /cms/public (key: hero_headline)
    Subheadline from GET /cms/public (key: hero_subheadline)
    CTA button text from GET /cms/public (key: hero_cta_text)
    CTA button links to: https://app.[YOUR_DOMAIN]/checkout (or /checkout if same domain)
  Product cards section:
    Fetch GET /products (public, active only)
    For each product: name, price formatted as €XX/month, description, size badge (nano/standard/pro from cai_definition if available), "Get started" button
    "Get started" links to: https://app.[YOUR_DOMAIN]/checkout?product_id={id}
  How it works section (static):
    Step 1: Choose your AI workspace
    Step 2: Set up your account
    Step 3: Access your agent instantly
  FAQ section:
    Fetch GET /cms/public (key: faq_entries) — renders Q+A list
  If URL contains ?ref=CODE: store code in sessionStorage key 'referral_code'

/pricing — Pricing page
  Full product cards comparison layout (same data as homepage)
  More detail per product: size tier, resource specs if available

/products/:slug — Product detail page
  Fetch GET /products/:slug
  Full description
  Resource specs (from cai_definition linked to this product)
  CTA: "Get started" → app subdomain checkout

/wl/:slug — White-label landing
  Fetch GET /white-labels/:slug (public)
  If not found: redirect to /
  Render with config: custom headline, logo, primary colour override
  Show only the products in target_product_ids
  Same CTA flow

Use React Query for all data fetching.
Use Tailwind CSS. Mobile-first. Clean, professional design.
No authentication on this frontend.
```

**ACCEPTANCE CHECK:**
- Homepage loads and shows CMS hero text
- Product cards render from API
- ?ref=CODE stores in sessionStorage
- /wl/nonexistent redirects to /

---

## PROMPT D2 — frontend-app: checkout and onboarding

```
TASK: Build checkout and onboarding flows in apps/frontend-app.
This frontend serves app.project-domain.com.
API base: VITE_API_URL env var.

AUTH HANDLING (set up first, used by all pages):
  React Context: AuthContext stores { accessToken, user, isLoading }
  On app mount: call POST /auth/refresh (cookie-based) to get access token
  Store access token in memory ONLY (never localStorage)
  If refresh fails: accessToken = null (user is not logged in)
  All authenticated API calls: Authorization: Bearer {accessToken}
  Axios or fetch wrapper that automatically retries with refresh on 401

Pages to build:

/login
  Email + password form
  POST /auth/login → store access token → redirect to /dashboard

/register
  Email + password + full name
  Include referral code from sessionStorage if present
  POST /auth/register → auto-login → redirect to checkout if came from there

/checkout?product_id=X
  If not logged in: show login/register toggle form first
  After auth: show order summary (product name, price, "referral applied" if code in sessionStorage)
  "Pay now" button: POST /orders/create { productId } → receive { checkoutUrl } → redirect to Stripe
  Stripe returns user to /onboarding?subscriptionId=X (configured in Stripe dashboard)

/onboarding?subscriptionId=X
  PHASE A — Deploy status screen (always shown first):
    Poll GET /onboarding/deploy-status?subscriptionId=X every 5 seconds

    Render based on containerStatus:
      'pending' or 'deploying':
        Spinner animation
        Text: current_step mapped to human label:
          'awaiting_deploy_trigger' → "Preparing your workspace..."
          'allocate' → "Finding the best server..."
          'deploy' → "Starting your AI agent..."
          'caddy_route' → "Configuring access..."
          'done' → "Almost ready..."
        Optional: show last log line in small monospace text
      'running' + emailVerified = false:
        Green checkmark animation
        "Your workspace is running!"
        "Check your inbox — we sent your access link to {user email}"
        "Resend email" button → POST /auth/resend-verification
        Auto-advance to PHASE B after 3 seconds
      'running' + emailVerified = true:
        Green checkmark
        "Your AI workspace is ready."
        Large button "Open workspace" → workspace_url (new tab)
        Auto-advance to PHASE B after 2 seconds
      'failed':
        Red X
        "Setup failed. Our team has been notified."
        "Contact support" link
        No technical details shown to user
      'unhealthy':
        Amber pulse
        "Checking your workspace..."
        Continue polling

  PHASE B — Preferences wizard (shown after agent is running):
    Step progress indicator (Step X of 4)
    Step 1: Profile — full name (pre-filled), phone (optional), country (required select)
    Step 2: Account type — Personal / Business toggle; if Business: company name
    Step 3: Intended use — free text area (max 200 chars, optional)
    Step 4: Terms — "I accept the Terms of Service and Privacy Policy" checkbox (required)
    Each step: POST /onboarding/save-step on Next click
    Each step has "Skip" option except Step 4
    On Step 4 complete: POST /onboarding/complete → redirect to /dashboard

/dashboard — authenticated shell
  Sidebar: Workspaces, Overview, Referrals, Profile
  Topbar: user name, logout button
  All sidebar items link to sub-routes

/dashboard/workspaces
  Fetch GET /user/workspaces
  Render workspace cards (details in Prompt D3)

/dashboard/overview
  Stats: Running workspaces count, Paused count, Setting up count
  Next renewal date (from subscription)

/dashboard/referrals
  Fetch GET /user/referrals (or /upr/referrals)
  Referral link: copy button
  QR code: use qrcode.react package
  Stats: active referral count, total credit earned
  Ledger table

/dashboard/profile
  Edit form: full name, phone, country, company name
  Change password section
```

**ACCEPTANCE CHECK:**
- /checkout?product_id=X shows login form if not authenticated, then order summary
- /onboarding shows spinner, transitions through states based on polled API
- /dashboard shows authenticated content, redirects to /login if not authenticated

---

## PROMPT D3 — frontend-app: workspace dashboard card

```
TASK: Build the workspace card component for /dashboard/workspaces.
This is detailed enough to need its own prompt.

Create component: src/components/WorkspaceCard.tsx

Props: workspace object from GET /user/workspaces response

Status badge logic:
  pending → gray pill "Setting up..."
  deploying → amber pulsing pill "Starting up..."
  stopping → amber pill "Pausing..."
  stopped → gray pill "Paused"
  running → green pill "Running"
  unhealthy → amber pill "Checking health..."
  failed → red pill "Setup failed"
  deleted → gray pill "Decommissioned"

Card content always shows:
  Product name (large)
  Agent type badge: openclaw | hermes | nano | custom
  Size tier badge: nano | standard | pro
  Status badge
  Renewal date (from subscription.current_period_end)

Conditional content by status:

running + email NOT verified:
  Amber notice bar: "Verify your email to unlock your workspace URL"
  "Resend verification email" button → POST /auth/resend-verification
  No workspace URL shown

running + email verified:
  "Open workspace" button (primary, large) → workspace_url in new tab
  Workspace URL as copyable text (click to copy, shows "Copied!")
  Running since: {started_at formatted as date}
  "Pause workspace" button (secondary) → confirm modal → POST /user/workspaces/:id/stop

stopped:
  "Resume workspace" button → POST /user/workspaces/:id/start
  Paused since: {stopped_at}

deploying or pending:
  Progress bar (animated, not percentage-based)
  Current step text (same mapping as onboarding wizard)
  Auto-poll every 5 seconds via GET /user/workspaces/:id/status
  When status changes to 'running': update card without page reload

failed:
  Error notice: "Workspace setup failed. Our team has been notified."
  "Contact support" link

Build the /dashboard/workspaces page:
  Fetch GET /user/workspaces
  Render WorkspaceCard for each
  Empty state: "You don't have any workspaces yet. Browse products to get started."
  Loading skeleton: show 1 placeholder card while loading
```

**ACCEPTANCE CHECK:**
- Running + verified workspace: shows "Open workspace" button with correct URL
- Running + unverified: shows verification prompt, no URL
- Paused workspace: shows Resume button
- Deploying: shows animated progress, polls automatically

---

## PROMPT D4 — frontend-cms: CMS admin

```
TASK: Build the CMS admin frontend in apps/frontend-cms.
This serves cms.[YOUR_DOMAIN] and is IP-restricted by Caddy.
API base: VITE_API_URL env var.

All pages require admin authentication (POST /admin/auth/login).
Store admin token in memory via React context.

/login — Admin login form

/cms (redirect to /cms/content)

/cms/content — Content fields editor
  Fetch GET /admin/cms
  Render exactly 6 fields:
    hero_headline: text input
    hero_subheadline: text input
    hero_cta_text: text input
    product_card_footer_note: text input
    footer_tagline: text input
    faq_entries: dynamic list of Q+A pair editors
      Each pair: question text input + answer textarea
      Add pair button, remove pair button, drag to reorder
  Per-field save button (PATCH /admin/cms/:key)
  Show "Last saved: {timestamp}" under each field after save
  Show save error if request fails

/cms/products — Product catalog management
  Table: product name, slug, price, billing cycle, active toggle
  "Edit" button per row → inline edit form
  "Create product" button → create form
  Note below table: "To configure the AI agent and Docker settings for a product,
    go to admin.[YOUR_DOMAIN]/admin/cai-definitions"

/cms/white-labels — White-label config management
  List all white_label_configs
  Create / edit form:
    Slug (auto-generated from name, editable, URL-safe)
    Name
    Logo URL
    Primary color (colour picker)
    Headline (text)
    Target products (multi-select from products list)
    Active toggle
  Preview link: opens /{slug} landing page in new tab

Sidebar navigation: Content, Products, White Labels
Topbar: "AliceClaw CMS", admin user name, logout
```

**ACCEPTANCE CHECK:**
- /cms/content loads 6 fields from API
- Saving hero_headline updates the value and shows timestamp
- FAQ pairs can be added, removed, and saved
- /cms/products shows product list with active toggles

---

## PROMPT D5 — frontend-admin: infrastructure admin

```
TASK: Build the infrastructure admin frontend in apps/frontend-admin.
This serves admin.[YOUR_DOMAIN] and is IP-restricted by Caddy.

All pages require admin authentication. Same pattern as frontend-cms.

/login

/admin (redirect to /admin/fleet)

/admin/cai-definitions — CAI Definition Management
  Table: product name, agent type, size tier, image:tag, CPU, RAM, disk,
         active instances count, active status
  Create button → right panel form:
    Product select (from GET /products — products without existing active definition)
    Agent type: select openclaw / hermes / nano / custom
    Size tier: select nano / standard / pro
    Docker image: text input (e.g. registry.yourdomain.com/cai-openclaw)
    Docker tag: text input (default: latest)
    CPU: slider 0.1 to 8.0 CPU (stored as millicores = value × 1000)
    Memory: select 512MB / 1GB / 2GB / 4GB / 8GB / 16GB (stored as MB)
    Disk GB: number input
    Container port: number 1000–9999
    Health check path: text (default /health)
    Startup timeout: number 30–600 seconds
    Env template: key-value table, add/delete rows
      Available variables listed as tooltip: {{user_id}} {{subscription_id}}
      {{container_name}} {{host_ip}} {{workspace_url}} {{subdomain_prefix}}
    Save / Cancel buttons
  Click row → same form pre-filled for edit (PATCH)
  Delete button (row): blocked with warning if active instances > 0

/admin/fleet — Server Fleet
  Grid of server cards, auto-refresh every 30s
  Each card shows:
    Host name + subdomain (e.g. h1.[YOUR_DOMAIN])
    Status badge: provisioning (blue pulse) / ready (green) / draining (amber) / decommissioned (gray)
    IP address
    Caddy status: configured (green) / pending (amber)
    CPU usage bar: used/available — green <60%, amber 60-80%, red >80%
    RAM usage bar: same colour logic
    Container count: "{n} running"
  Click card → detail drawer:
    Full host info
    Container table: user email, product name, size tier, workspace URL, status, running since
    "Drain server" button (super_admin): confirm dialog
  "Provision new server" button (top right, super_admin):
    Modal: shows active template spec (type, region, threshold), reason text field
    Confirm → POST /admin/servers/provision

/admin/fleet/templates — Server Templates
  List templates, active one highlighted
  Edit/create modal:
    Name, Hetzner type (select with RAM shown: cx11/2GB, cx21/4GB, cx31/8GB, cx41/16GB, cx51/32GB)
    Region (select: EU Frankfurt / US Ashburn / APAC Singapore)
    Subdomain prefix (text, default 'h')
    Capacity threshold % (slider 50–95)
    Management overhead % (slider 10–30)
    Live computed preview:
      "Usable CPU: {total × (1 - overhead)} CPU"
      "Usable RAM: {total × (1 - overhead)} GB"
  "Set as active" button on inactive templates

/admin/scale-events — Scale Event Timeline
  Table: trigger server, reason, triggered at, new server, status, duration
  Status pipeline per row (triggered → provisioning → ready or failed)

/admin/provisioning — Provisioning Queue
  Table: user email, product name, status, current step, retry count, error, created, finished
  Status filter tabs: All / Queued / Running / Failed / Completed
  Failed row: "Retry" button → POST /admin/provisioning/:jobId/retry
  Click row → expand: full log_lines, error message

/admin/alerts — Admin Alerts
  Unresolved alerts badge in top navigation (red number)
  Table: type, message, entity ID, created at, resolve button
  Auto-refresh every 60 seconds
  Resolve button → PATCH /admin/alerts/:id/resolve

/admin/audit-log — Audit Log
  Read-only table: admin email, action, target type, target ID, timestamp, IP
  Filters: admin, action, date range
  Paginated

Sidebar: CAI Definitions, Fleet, Scale Events, Provisioning, Alerts, Audit Log
```

**ACCEPTANCE CHECK:**
- /admin/fleet shows host cards with CPU/RAM bars
- CAI definition create form validates port range and duplicate product
- Failed provisioning job shows Retry button, clicking it re-enqueues the job
- Alerts badge shows unresolved count

---

## PROMPT D6 — frontend-uprm: user/payment/referral admin

```
TASK: Build the UPRM admin frontend in apps/frontend-uprm.
This serves uprm.[YOUR_DOMAIN] and is IP-restricted by Caddy.
This frontend is designed to be separable later.

All pages require admin auth. Same pattern as other admin frontends.

/login

/uprm (redirect to /uprm/users)

/uprm/users — User Management
  Searchable paginated table: email, full name, status badge, subscription status, join date
  Filters: status (active/suspended), subscription status, date range
  Click row → user detail drawer:
    Profile section: email, name, phone, country, company, account type
    Status section: email verified, account status, join date
    Subscription section: current subscription status, product name, renewal date, billing ID
    Workspaces section: list of container_instances with workspace URL and status
    Referral section: how many referred, credited amount
    Actions:
      Suspend account (super_admin, billing_admin)
      Reactivate account (super_admin, billing_admin)
      Add credit: modal with amount (€) and reason → POST /admin/upr/credit
  Role: [super_admin, support_admin], actions require [super_admin, billing_admin]

/uprm/subscriptions — Subscription Management
  Table: user email, product name, status, billing ID, period end, created
  Filters: status, product, date range
  Per row: "View in Stripe" link (opens Stripe dashboard)
  Per row: "Cancel" button (super_admin, billing_admin)
  Per row: "Apply credit" button

/uprm/referrals — Referral Management
  Settings card at top:
    Global reward rate % (editable inline, save button)
    Cooling period days (editable inline)
    PATCH /admin/referrals/settings
  Table: referrer email, referred email, status, reward amount, order date
  Per row: "Flag as fraud" button
  Per row: "Set custom rate" button → modal with rate % and reason
  Role: [super_admin, referral_admin]

/uprm/api-tokens — UPR API Tokens
  Purpose notice: "These tokens allow external services to authenticate as this platform.
    Generate them now — they will be used when UPR is extracted to its own service."
  Table: name, scopes, created, last used, expires, revoke button
  "Generate new token" button → modal:
    Token name
    Scopes multi-select: users:read, users:write, subscriptions:read, subscriptions:write,
                         payments:read, referrals:read, referrals:write
    Generate → show plaintext token ONCE in modal with copy button
    Warning: "Save this token now. It will not be shown again."
  Revoke button → DELETE /admin/upr/tokens/:id with confirm dialog
  Role: [super_admin]

Sidebar: Users, Subscriptions, Referrals, API Tokens
```

**ACCEPTANCE CHECK:**
- /uprm/users shows user list, drawer opens on click with workspaces listed
- API token generation shows plaintext token once
- Referral settings saves global rate
- Subscription table shows correct statuses

---

# SPRINT E — CADDY HOST CONFIGURATION

---

## PROMPT E1 — SSH Docker adapter (real implementation)

```
TASK: Implement the real SshDockerAdapter that was stubbed in Prompt B1.
This runs commands on remote host servers via SSH.

Dependencies needed (add to apps/worker/package.json):
  node-ssh: for SSH connection management

Update file: apps/worker/src/providers/ssh-docker-adapter.ts

Read the DockerAdapter interface from apps/worker/src/providers/docker-adapter.ts

Implement SshDockerAdapter:

Private helper: getConnection(hostIp: string): Promise<NodeSSH>
  Connect using:
    host: hostIp
    username: 'root'
    privateKey: process.env.PROVISIONING_SSH_PRIVATE_KEY
  Return connected NodeSSH instance
  Disconnect in finally block after command execution

deployContainer(params):
  connection = await getConnection(hostIp)
  Build docker run command string:
    docker run -d \
      --name {containerName} \
      --restart unless-stopped \
      --cpus={cpuMillicores / 1000} \
      --memory={memoryMb}m \
      -p {hostPort}:{containerPort} \
      {for each envVar: -e KEY="VALUE" — shell-escape values} \
      --health-cmd="curl -sf http://localhost:{containerPort}{healthCheckPath} || exit 1" \
      --health-interval=10s \
      --health-retries=3 \
      --health-timeout=5s \
      {dockerImage}:{dockerTag}
  result = await connection.execCommand(dockerRunCmd)
  If result.stderr contains 'already in use': run docker start {containerName} instead
  If result.code !== 0: throw Error('docker run failed: ' + result.stderr)
  containerId = result.stdout.trim()

  Poll getContainerStatus every 5 seconds up to startupTimeoutSeconds:
    status = await getContainerStatus(hostIp, containerName)
    If 'running': return { containerId }
    If 'unhealthy': throw Error('Container started but is unhealthy')
    If 'stopped': throw Error('Container stopped immediately after start')
  Throw Error('Container did not become healthy within ' + startupTimeoutSeconds + 's')

getContainerStatus(hostIp, containerName):
  Connect and run:
    docker inspect --format="{{.State.Status}} {{.State.Health.Status}}" {containerName}
  Parse stdout:
    If contains 'running healthy': return 'running'
    If contains 'running starting': return 'starting'
    If contains 'running unhealthy': return 'unhealthy'
    If contains 'exited' or 'dead': return 'stopped'
    If command failed or empty: return 'not_found'

stopContainer(hostIp, containerName):
  Connect and run: docker stop {containerName}
  Ignore exit code (container may already be stopped)

removeContainer(hostIp, containerName):
  Connect and run: docker rm -f {containerName}
  Ignore exit code

updateCaddyRoute(hostIp, subdomainPrefix, port, hostSubdomain, platformDomain):
  routeContent = render infrastructure/caddy-host/route.caddy.template
    Replace {PREFIX} with subdomainPrefix
    Replace {HOST_SUBDOMAIN} with hostSubdomain
    Replace {PLATFORM_DOMAIN} with platformDomain
    Replace {PORT} with port.toString()
  Connect via SSH
  Write file: /etc/caddy/routes/{subdomainPrefix}.caddy with routeContent
  Run: caddy reload --config /etc/caddy/Caddyfile
  If caddy reload fails: log warning (non-fatal — route will be picked up on next reload)

removeCaddyRoute(hostIp, subdomainPrefix):
  Connect via SSH
  Run: rm -f /etc/caddy/routes/{subdomainPrefix}.caddy
  Run: caddy reload --config /etc/caddy/Caddyfile

Update docker-adapter-factory.ts:
  Remove the "not yet implemented" throw from SshDockerAdapter
  Return SshDockerAdapter in production (NODE_ENV === 'production')
```

**ACCEPTANCE CHECK:**
- Build passes
- SshDockerAdapter instantiates without error
- Unit test (optional): mock node-ssh and verify docker run command is built correctly with proper --cpus flag

---

## PROMPT E2 — Host Caddy configurator in orchestrator

```
TASK: Implement Caddy deployment in the host provision orchestrator (Step 4).
The stub in Prompt A4 deferred this step — now implement it fully.

Create file: apps/worker/src/provisioning/caddy/host-caddy-configurator.ts

Read the Caddyfile.template from infrastructure/caddy-host/Caddyfile.template

class HostCaddyConfigurator {
  async deployToHost(params: {
    hostIp: string
    hostSubdomain: string
    platformDomain: string
  }): Promise<void>

    Connect via SSH (PROVISIONING_SSH_PRIVATE_KEY, host: hostIp, user: root)

    Step 1 — Ensure Caddy is installed:
      Run: which caddy || apt-get install -y caddy 2>&1
      Log output

    Step 2 — Create routes directory:
      Run: mkdir -p /etc/caddy/routes

    Step 3 — Write Caddyfile:
      Read infrastructure/caddy-host/Caddyfile.template
      Replace: {HOST_SUBDOMAIN} → hostSubdomain
      Replace: {PLATFORM_DOMAIN} → platformDomain
      Write to /etc/caddy/Caddyfile via SSH file upload (or echo + redirect)

    Step 4 — Enable and start Caddy:
      Run: systemctl enable caddy && systemctl restart caddy
      Wait 3 seconds
      Run: systemctl is-active caddy
      If not 'active': throw Error('Caddy failed to start on host ' + hostSubdomain)

    Step 5 — Verify routing works:
      Run: curl -sf -o /dev/null -w "%{http_code}" http://localhost/health
      If response is not '200': throw Error('Caddy health check failed')
      Log: "Caddy configured on ${hostSubdomain}.${platformDomain}"
}

Update host-provision-orchestrator.ts Step 4:
  Replace the stub/TODO with:
    const caddyConfigurator = new HostCaddyConfigurator()
    await caddyConfigurator.deployToHost({
      hostIp: hostServer.ip_address,
      hostSubdomain: subdomain,
      platformDomain: process.env.PLATFORM_DOMAIN ?? 'localhost'
    })
    UPDATE host_servers.caddy_configured = true
```

**ACCEPTANCE CHECK:**
- Build passes
- MockHostServerProvider path: Caddy configurator is called (will fail SSH connection in mock — wrap in try/catch for mock mode so test still passes)
- In real Hetzner smoke test: host is provisioned, Caddy is installed, /health returns 200 on the host subdomain

---

# SPRINT F — TESTING AND GO-LIVE

---

## PROMPT F1 — End-to-end test suite

```
TASK: Write the Playwright E2E test suite in tests/e2e/.

Install Playwright if not present: pnpm add -D @playwright/test

Create playwright.config.ts at repo root:
  baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000'
  workers: 1 (sequential — tests share DB state)
  testDir: './tests/e2e'
  Use: storageState for reusing auth sessions across tests

Create tests/e2e/01-full-purchase-flow.spec.ts

TEST: complete purchase creates a running workspace
  Setup: ensure mock provider mode (NODE_ENV=test or env override)
  1. Navigate to http://localhost:3000 (frontend-landing)
  2. Click "Get started" on first product
  3. On register form: fill unique email (generate with timestamp), password, name
  4. Register → auth redirect → checkout page
  5. Click "Pay now" → (in test: mock Stripe success by calling POST /billing/webhook directly
     with a test checkout.session.completed event using test Stripe signature)
  6. Navigate to http://localhost:3001/onboarding?subscriptionId={subId}
  7. Wait for deploy status to show 'running' (poll with timeout 30s)
  8. Verify: container_instances status = 'running' in DB (via API GET /user/workspaces)
  9. Verify: workspace_url is not null in response

TEST: email verification unlocks workspace URL
  Continue from above (email still unverified)
  1. Query DB or API: get email_verifications token for this subscription
     (add a test-only route: GET /internal/test/verification-token?subscriptionId=X — guarded by TEST_MODE=true)
  2. Navigate to /auth/verify-email?token={token}
  3. Verify redirect to onboarding page
  4. Call GET /user/workspaces — verify email_verified_at is not null
  5. On workspace card: "Open workspace" button should now be present

---

Create tests/e2e/02-scale-out.spec.ts

TEST: scale-out triggers when largest CAI cannot fit
  Setup:
    Seed a host_server with limited capacity (enough for 1 nano CAI only)
    Ensure only nano CAI definition is active
  1. Deploy one CAI: simulate subscription.activated webhook
  2. Wait for deploy to complete: container status = 'running'
  3. Simulate a second subscription.activated webhook
  4. Deploy-cai job: should not find eligible host (host is full)
  5. Verify: server_scale_events record created with status 'triggered'
  6. Verify: provision-host-server job in BullMQ queue
  7. Verify: second deploy-cai job is delayed for retry
  8. Run mock provision: server_scale_events status → 'ready', new host status → 'ready'
  9. Verify: second deploy-cai eventually runs on new host

---

Create tests/e2e/03-lifecycle.spec.ts

TEST: stop and resume workspace
  1. Setup: running workspace
  2. POST /user/workspaces/:id/stop → { success: true }
  3. Wait: container status = 'stopped'
  4. Verify: MockDockerAdapter.stopContainer was called
  5. POST /user/workspaces/:id/start → { success: true }
  6. Wait: container status = 'running'
  7. Verify: workspace_url same as before (same host and port reused)

TEST: subscription cancellation deletes workspace
  1. Setup: running workspace
  2. Simulate subscription.cancelled billing event
  3. Wait: container status = 'deleted'

TEST: admin retry on failed deploy
  1. Override MockDockerAdapter to fail deployContainer on first call
  2. Simulate subscription.activated → deploy-cai runs → fails
  3. Verify: container status = 'failed', admin_alerts record created
  4. Login as admin: POST /admin/provisioning/:jobId/retry
  5. Reset MockDockerAdapter to succeed
  6. Wait: container status = 'running'

---

Create tests/e2e/04-production-smoke.spec.ts
(Run against production — reads-only, never writes data)

TEST: homepage loads
  GET {PROD_URL} → 200, contains product cards

TEST: API health
  GET {PROD_URL}/api/health → 200, { status: "ok" }

TEST: admin blocked from public
  GET {ADMIN_URL} from non-admin IP → non-200 (Caddy blocks)

TEST: webhook rejects bad signature
  POST {API_URL}/billing/webhook with invalid body → 400
```

**ACCEPTANCE CHECK:**
- All tests in 01, 02, 03 pass with mock provider
- No test writes to or reads from a shared production database
- Production smoke tests (04) pass against staging URL

---

## PROMPT F2 — Staging docker-compose and deploy script

```
TASK: Create staging environment configuration.

Create docker-compose.staging.yml:
  Same services as docker-compose.yml but:
  - All 7 apps (backend-api, worker, 5 frontends) + postgres + redis + caddy
  - NODE_ENV: staging for all services
  - All secrets via ${VAR_NAME} substitution (no hardcoded values)
  - No src volume mounts (uses built images)
  - restart: unless-stopped on all services
  - Add resource limits per service:
    backend-api: memory 512m
    worker: memory 512m
    each frontend: memory 256m
    postgres: memory 1g
    redis: memory 256m
  - Caddy service: mounts infrastructure/caddy/Caddyfile.platform as /etc/caddy/Caddyfile
    Also mounts a TLS volume for Let's Encrypt certs

Create .env.staging.example (never .env.staging with real values):
  NODE_ENV=staging
  DATABASE_URL=postgres://openclaw:CHANGE_ME@postgres:5432/openclaw
  REDIS_URL=redis://redis:6379
  JWT_SECRET=CHANGE_ME_64_CHARS
  INTERNAL_SECRET=CHANGE_ME_32_CHARS
  STRIPE_SECRET_KEY=sk_test_CHANGE_ME
  STRIPE_WEBHOOK_SECRET=whsec_CHANGE_ME
  POSTMARK_API_TOKEN=CHANGE_ME
  POSTMARK_FROM_EMAIL=noreply@yourdomain.com
  HETZNER_API_TOKEN=CHANGE_ME
  PROVISIONING_SSH_PRIVATE_KEY=CHANGE_ME (PEM format, no line breaks — use base64 or file mount)
  PROVISIONING_SSH_PUBLIC_KEY=CHANGE_ME
  PLATFORM_DOMAIN=staging.yourdomain.com
  AGENT_IMAGES=ubuntu:22.04
  UPR_MODE=local
  VITE_API_URL=https://api.staging.yourdomain.com
  HOST_SERVER_PROVIDER=mock  # change to 'hetzner' when smoke test ready
  HOST_PROVIDER_STATUS_POLL_INTERVAL_MS=5000
  HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS=24
  HOST_PROVIDER_READY_STABILIZATION_DELAY_MS=45000

Create infrastructure/scripts/deploy-staging.sh:
  #!/bin/bash
  set -e
  echo "Deploying to staging..."
  ssh staging-vps "
    cd /opt/aliceclaw
    git pull origin main
    docker compose -f docker-compose.staging.yml pull
    docker compose -f docker-compose.staging.yml up -d
    docker compose -f docker-compose.staging.yml exec -T backend-api pnpm --filter @psi/db migrate
  "
  echo "Checking health..."
  sleep 5
  curl -sf https://api.staging.yourdomain.com/health && echo "Health check passed" || echo "HEALTH CHECK FAILED"

Create infrastructure/scripts/STAGING-CHECKLIST.md:
  Manual verification checklist:
  [ ] All 5 frontends load on correct subdomains
  [ ] cms/admin/uprm blocked from public IP
  [ ] backend-api health endpoint returns ok
  [ ] Stripe test purchase: 4242 4242 4242 4242 completes
  [ ] subscription.activated webhook received and processed
  [ ] deploy-cai job runs (mock), container_instances status = running
  [ ] Verification email sent (check Postmark logs)
  [ ] /auth/verify-email link works, redirects to onboarding
  [ ] Onboarding deploy-status screen polls and updates
  [ ] Admin fleet shows host (dev seed host)
  [ ] Admin provisioning queue shows jobs
  [ ] Admin alerts section loads
  [ ] Health monitor job running (check worker logs: "Health check started" every 2 min)
```

**ACCEPTANCE CHECK:**
- docker-compose.staging.yml is valid YAML (docker compose -f docker-compose.staging.yml config → no errors)
- deploy-staging.sh exits cleanly if SSH fails (set -e)
- .env.staging is in .gitignore

---

## PROMPT F3 — Production pre-launch configuration

```
TASK: Create production deployment configuration and pre-launch checklist.

Create docker-compose.production.yml:
  Same as staging but:
  - Add healthcheck to each service
  - Postgres with named volume for persistence: postgres-data:/var/lib/postgresql/data
  - Worker has additional env: HOST_SERVER_PROVIDER=${HOST_SERVER_PROVIDER:-hetzner}
  - Caddy mounts Let's Encrypt data volume
  - All restart: unless-stopped

Create infrastructure/scripts/deploy-production.sh:
  #!/bin/bash
  set -e
  read -p "Deploy to PRODUCTION. Type YES to confirm: " confirm
  if [ "$confirm" != "YES" ]; then echo "Aborted."; exit 1; fi
  echo "Checking current branch is main..."
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$BRANCH" != "main" ]; then echo "Must deploy from main branch. Current: $BRANCH"; exit 1; fi
  echo "Deploying..."
  ssh production-vps "
    cd /opt/aliceclaw
    git pull origin main
    docker compose -f docker-compose.production.yml pull
    docker compose -f docker-compose.production.yml up -d --no-deps backend-api worker
    docker compose -f docker-compose.production.yml exec -T backend-api pnpm --filter @psi/db migrate
  "
  sleep 10
  curl -sf https://api.yourdomain.com/health && echo "Production deploy OK" || echo "PRODUCTION HEALTH CHECK FAILED — INVESTIGATE IMMEDIATELY"

Create infrastructure/scripts/PRODUCTION-LAUNCH-CHECKLIST.md:

  === DNS ===
  [ ] project-domain.com → PLATFORM_IP
  [ ] app.project-domain.com → PLATFORM_IP
  [ ] cms.project-domain.com → PLATFORM_IP
  [ ] admin.project-domain.com → PLATFORM_IP
  [ ] uprm.project-domain.com → PLATFORM_IP
  [ ] api.project-domain.com → PLATFORM_IP
  [ ] At least one host server provisioned and DNS set:
      h1.project-domain.com → HOST_IP
      *.h1.project-domain.com → HOST_IP

  === Stripe live mode ===
  [ ] STRIPE_SECRET_KEY is sk_live_ prefix
  [ ] Webhook endpoint registered: https://api.project-domain.com/billing/webhook
  [ ] Webhook events: checkout.session.completed, invoice.paid,
      invoice.payment_failed, customer.subscription.deleted
  [ ] Test €1 transaction processed and refunded

  === Email ===
  [ ] Postmark production sending domain verified (not sandbox)
  [ ] SPF record: v=spf1 include:spf.mtasv.net ~all
  [ ] DKIM record added in DNS
  [ ] DMARC record: v=DMARC1; p=quarantine
  [ ] Test email received in inbox (not spam)

  === Security ===
  [ ] cms.project-domain.com unreachable from public IP
  [ ] admin.project-domain.com unreachable from public IP
  [ ] uprm.project-domain.com unreachable from public IP
  [ ] JWT_SECRET is 64 random characters (not a word)
  [ ] INTERNAL_SECRET is 32+ random characters
  [ ] No secrets in committed files (grep -r "sk_live" . should return nothing)

  === Data ===
  [ ] pnpm db:migrate run against production DB
  [ ] pnpm db:seed run (creates admin user, products, CMS defaults)
  [ ] Admin password changed from seed default
  [ ] At least 1 active server_template configured
  [ ] At least 1 ready host_server in DB (provisioned manually before launch)
  [ ] That host has caddy_configured = true
  [ ] At least 1 active cai_definition per product

  === Legal ===
  [ ] /terms page content published (via CMS or static)
  [ ] /privacy page content published
  [ ] Cookie notice if applicable

  === Monitoring ===
  [ ] Cron job: */5 * * * * curl -sf https://api.project-domain.com/health || mail -s "AliceClaw DOWN" you@email.com
  [ ] DB backup cron: 0 2 * * * bash /opt/aliceclaw/infrastructure/scripts/backup-db.sh
  [ ] Docker log rotation configured in /etc/docker/daemon.json:
      { "log-driver": "json-file", "log-opts": { "max-size": "100m", "max-file": "3" } }
```

**ACCEPTANCE CHECK:**
- deploy-production.sh aborts if not on main branch
- deploy-production.sh aborts if confirmation is not "YES"
- PRODUCTION-LAUNCH-CHECKLIST.md is complete — go through it item by item before first real user

---

## PROMPT F4 — Operations runbook

```
TASK: Create the operations runbook for day-to-day management.

Create docs/RUNBOOK.md

Content structure:

SECTION 1: DAILY CHECKS (5 minutes)
  1. Open uprm.[domain]/uprm/users — any new user issues?
  2. Open admin.[domain]/admin/alerts — resolve any unresolved alerts
  3. Open admin.[domain]/admin/fleet — all hosts green? Caddy configured?
  4. Open admin.[domain]/admin/provisioning — any stuck or failed jobs?
  5. Check Postmark dashboard — delivery rate above 95%?

SECTION 2: INCIDENT RESPONSE

Scenario: CAI deploy failed
  1. admin/provisioning → find failed job → read error message
  2. Common errors:
     "no_cai_definition_found" → go to admin/cai-definitions, add definition for this product
     "no_capacity_no_scale_in_progress" → fleet has no ready hosts, manually provision one
     "DeployTimeoutError" → SSH to host, run: docker logs {container_name}
     "No ports available" → host is over-assigned, drain it and let scale-out run
  3. Click Retry after fixing the root cause

Scenario: Host server unreachable (caddy_configured = false or status stuck)
  1. admin/fleet → find the host → check IP
  2. SSH attempt: ssh root@{host_ip}
  3. If unreachable: check Hetzner console (may have crashed)
  4. If server exists: check cloud-init log: cat /var/log/cloud-init-output.log
  5. If irrecoverable: drain the host in admin panel, manually provision a replacement
  6. For affected users: find their container_instances records, enqueue retry via admin provisioning

Scenario: Scale-out not triggering
  1. admin/fleet → check utilisation bars — is any host above 80%?
  2. admin/scale-events → any recent events?
  3. Check worker logs: docker logs aliceclaw_worker_1 | grep scale
  4. If stuck: manually provision via admin/fleet "Provision new server" button
  5. Check: is there an active server_template? (admin/fleet/templates)

Scenario: Stripe webhook not received
  1. Stripe dashboard → Webhooks → check failed deliveries
  2. Redeliver from Stripe dashboard (deploy-cai idempotency ensures no double-deploy)
  3. If endpoint unreachable: check Caddy logs, check backend-api container

SECTION 3: MAINTENANCE

Deploy an update:
  1. Test on staging first
  2. bash infrastructure/scripts/deploy-production.sh
  3. Monitor admin/alerts for 10 minutes

Add a new CAI product:
  1. CMS admin → Products → Create product (name, price)
  2. Infrastructure admin → CAI Definitions → Configure definition (Docker image, resources)
  3. Test purchase on staging before activating on production

Update a CAI Docker image:
  1. Push new image:tag to registry
  2. Infrastructure admin → CAI Definitions → Edit → update dockerTag
  3. New deployments use the new tag; existing running containers unchanged
  4. To update running containers: user must stop and resume workspace

SECTION 4: USEFUL COMMANDS

Check running containers on a host:
  ssh root@{host_ip} "docker ps --format 'table {{.Names}}\t{{.Status}}'"

View container logs:
  ssh root@{host_ip} "docker logs --tail 100 {container_name}"

Check container resource usage:
  ssh root@{host_ip} "docker stats --no-stream"

Force remove stuck container:
  ssh root@{host_ip} "docker rm -f {container_name}"

Check Caddy routes:
  ssh root@{host_ip} "ls /etc/caddy/routes/"

Reload Caddy manually:
  ssh root@{host_ip} "caddy reload --config /etc/caddy/Caddyfile"

Check BullMQ queue depths (via Redis):
  docker exec aliceclaw_redis_1 redis-cli LLEN bull:deploy-cai:waiting
  docker exec aliceclaw_redis_1 redis-cli LLEN bull:provision-host-server:waiting

Backup DB now:
  bash infrastructure/scripts/backup-db.sh

Check pending referral rewards:
  docker exec aliceclaw_postgres_1 psql $DATABASE_URL -c \
    "SELECT COUNT(*) FROM referral_rewards_ledger WHERE status='pending';"

Trigger health check now:
  docker exec aliceclaw_worker_1 \
    npx ts-node -e "require('./src/jobs/health-check-cais').runOnce()"
```

**ACCEPTANCE CHECK:**
- RUNBOOK.md exists and is readable
- All docker exec commands reference the correct container names from docker-compose.yml
- deploy-production.sh is referenced correctly

---

# END OF WORKING PAPER

---

## QUICK REFERENCE: Prompt sequence

```
SPRINT A — Infrastructure
  A1  Add 5 new frontend apps to monorepo
  A2  Schema migration (cai_definitions, subdomain, white_labels, upr_tokens)
  A3  Infrastructure directory, Caddy templates, DNS docs
  A4  Host provision orchestrator
  A5  Env var setup for Hetzner smoke test
      → RUN LIVE HETZNER SMOKE TEST BEFORE CONTINUING ←

SPRINT B — Container deployment
  B1  DockerAdapter interface + MockDockerAdapter
  B2  SlotAllocator (host selection + scale trigger)
  B3  deploy-cai BullMQ job
  B4  stop/delete/restart lifecycle jobs + user API routes
  B5  health-check-cais repeating job

SPRINT C — Backend API
  C1  UPR service interface + local implementation
  C2  CAI definitions admin routes
  C3  Billing event handlers updated for CAI flow
  C4  Email verification routes + onboarding API + workspace routes
  C5  Internal alert + notification endpoints
  C6  Admin fleet updates + provisioning retry route

SPRINT D — Frontends (one per session)
  D1  frontend-landing: homepage, pricing, product detail, white-label
  D2  frontend-app: checkout, onboarding, dashboard shell + pages
  D3  frontend-app: workspace card component (deploy-aware)
  D4  frontend-cms: content, products, white-label management
  D5  frontend-admin: CAI definitions, fleet, provisioning, alerts
  D6  frontend-uprm: users, subscriptions, referrals, API tokens

SPRINT E — Caddy host config
  E1  SshDockerAdapter real implementation
  E2  Host Caddy configurator wired into orchestrator

SPRINT F — Testing and go-live
  F1  Playwright E2E test suite (7 tests)
  F2  Staging docker-compose + deploy script + checklist
  F3  Production docker-compose + deploy script + launch checklist
  F4  Operations runbook
```
