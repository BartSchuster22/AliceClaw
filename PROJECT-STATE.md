# PROJECT-STATE.md

Use this as the first project handoff file for active work.

## Purpose

Keep only the minimum needed to reconnect to the current project in a new session.
Do not paste raw logs here. Do not duplicate full schema/reference material here.

## Current active project

- Project: PSI platform
- Current focus: conservative real-provider hardening before any intentional live Hetzner smoke test.
- Current status: shared-host runtime stabilization and admin fleet flows remain in strong shape. The provider boundary is stronger, provisioning now persists provider action/status metadata throughout create/poll/cleanup, and there is now a targeted admin-triggered refresh path to resync provider-backed host state after worker completion or restart.
- Recent real-provider hardening now includes:
  - richer `HostServerProvider` contract (`HostServerDetails`, provider-owned SSH key resolution/import, async delete semantics)
  - Hetzner adapter scaffold with create/details/delete, SSH-key import/reuse logic, conservative status mapping, and provider metadata
  - provider selection via `HOST_SERVER_PROVIDER=mock|hetzner`
  - provider-action tracking schema/UI support (`0007_provider-action-tracking`)
  - provisioning worker persistence tightened so `host_provision_attempts` and `host_servers` are updated with provider action/status/timestamps during initial create response, status polling, and cleanup delete response
  - new targeted refresh queue/worker + admin endpoint (`POST /admin/servers/:id/refresh-provider-state`) to resync non-archived host provider state on demand
- Remaining caveat: Hetzner adapter is still doc-aligned only, not live-tested against real Hetzner credentials/resources. Refresh is manual/on-demand for now; there is still no broad scheduled reconciliation loop.

## Next exact step

- Next code step: introduce `apps/worker/src/provisioning/execution/host-provision-orchestrator.ts` and route the job through it. Orchestrator iterates candidate list, stops on success, handles failure summary. This is the last seam before Hetzner-only fallback can be wired.
- Live smoke test ready: inject real `HETZNER_API_TOKEN` + `PROVISIONING_SSH_PUBLIC_KEY` locally, confirm one disposable active Hetzner template, follow `HETZNER-PREFLIGHT-CHECKLIST.md` → `HETZNER-LIVE-TEST-RUNBOOK.md`.

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
