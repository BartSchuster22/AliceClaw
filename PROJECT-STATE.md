# PROJECT-STATE.md

Use this as the first project handoff file for active work.

## Purpose

Keep only the minimum needed to reconnect to the current project in a new session.
Do not paste raw logs here. Do not duplicate full schema/reference material here.

## Current active project

- Project: PSI platform
- Current focus: real provider integration prep after stabilizing the shared-host runtime and fleet operations.
- Current status: internal shared-host runtime stabilization and admin operational polish are in strong shape. Referral flow remains verified; deferred live Stripe credit is still intentionally not implemented. Worker/runtime/admin lifecycle now supports provision, retry, archive, retire, and much better recovery semantics.
- Shared-host stabilization and reliability work completed before this pass:
  - fixed `/user/subscriptions` runtime path, restored live `container_instances` joins after migration `0003`, and verified lifecycle coverage (deploy -> visibility -> stop -> start -> health-check -> delete)
  - hardened backend/worker notification fallbacks for missing Postmark config
  - implemented `host_provision_attempts` with heartbeat, cleanup status, worker-run ownership, and startup reconciliation (`0004`, `0005` migrations)
  - upgraded mock host provider for scenario-driven provisioning robustness testing
  - added admin retry, archive, and queued retire flows plus broader fleet UX polish (summary cards, filters, archived toggles, attempt badges, counters, empty states)
- Real provider boundary hardening completed in this pass:
  - replaced the old minimal host-provider contract with richer `HostServerDetails`, explicit lifecycle/existence semantics, provider-owned SSH key resolution/import, and async delete semantics
  - adapted PSI provisioning and retire flows to the stronger provider contract
  - upgraded mock provider to the stronger contract
  - added first real Hetzner adapter scaffold (`apps/worker/src/providers/hetzner-host-server-provider.ts`) with create/details/delete methods, SSH-key import/reuse logic, conservative status mapping, and richer provider metadata
  - provider selection now supports `HOST_SERVER_PROVIDER=mock|hetzner`
  - implemented provider-action tracking end-to-end: contract supports action metadata, `host_provision_attempts` and `host_servers` persist provider action id/command/status/timestamps (migration `0007_provider-action-tracking`), and admin fleet UI now surfaces provider action context on hosts/attempts/scale events
- Remaining caveat: Hetzner adapter is still scaffolded and doc-aligned, not yet live-tested against real Hetzner credentials/resources. Exact status-enum coverage and any future action-reconciliation loop are still possible next hardening items.

## Next exact step

- Provider-contract/action-tracking pass is checkpointed here.
- Next likely move: decide whether to continue real-provider hardening (for example action reconciliation loops / live Hetzner smoke-test preparation) or pause and resume later from this stronger provider boundary.
- If staying conservative, prepare the first intentional live Hetzner smoke-test path before using real credentials.

## Rules for this file

- Keep under ~40 lines when possible.
- Update at end of each major phase/sub-phase.
- Include only:
  - current focus
  - current status
  - next exact step
  - one or two critical cautions

## Critical cautions

- Do not bypass the provider boundary by importing worker-only provider internals into backend routes.
- For real-provider work, prefer correctness and explicit semantics over minimal-effort shortcuts.
- Keep mock/testing assumptions clearly separated from real-provider assumptions.
