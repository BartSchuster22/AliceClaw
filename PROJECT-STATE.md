# PROJECT-STATE.md

Use this as the first project handoff file for active work.

## Purpose

Keep only the minimum needed to reconnect to the current project in a new session.
Do not paste raw logs here. Do not duplicate full schema/reference material here.

## Current active project

- Project: PSI platform
- Current focus: shared-host runtime stabilization, provisioning reliability, and admin operational polish.
- Current status: referral flow was verified from live local data. Admin referral routes respond correctly. Deferred live Stripe credit remains intentionally unimplemented, but referral state no longer falsely auto-applies in live-Stripe-deferred mode.
- Shared-host stabilization already completed before the latest pass:
  - fixed dev user-login drift by reseeding `user@openclaw.local`
  - fixed `/user/subscriptions` runtime path and restored live `container_instances` joins after migration `0003`
  - hardened backend and worker notification paths so missing Postmark config skips email cleanly in local/dev
  - applied DB migration `0003_shared-host-runtime-foundations`
  - bootstrapped active product definitions, server template, and ready dev host data
  - cleaned stale queued VPS-era provisioning jobs
  - fixed deploy worker bugs, added user delete route, cleaned stopped/deleted payload semantics, and verified lifecycle coverage (deploy -> visibility -> stop -> start -> health-check -> delete)
- Provisioning reliability/admin work now completed and checkpointed:
  - upgraded mock host provider with scenario-driven testing via `.openclaw/mock-host-provider.json` (`success`, `fail_provision`, `error_on_status`, `stuck_starting`, `fail_delete`) plus delay/readiness knobs
  - fixed same-run mid-provision failure cleanup so created host rows become `failed` and provider cleanup is attempted best-effort
  - implemented `host_provision_attempts` with heartbeat, cleanup status, worker-run ownership, and startup reconciliation (migrations `0004_host-provision-attempts` and `0005_host-provision-attempt-worker-run-id`)
  - verified fresh fail/success behavior under the attempt model and verified interrupted attempts from older worker runs are reconciled to failed on startup
  - cleaned legacy orphaned pre-attempt provisioning rows once and fenced them off from future recovery logic
  - fixed worker dev flow so the worker container no longer reruns install-on-start after a proper `docker compose up -d --force-recreate worker`
  - improved admin server-fleet observability: `/admin/servers`, `/admin/servers/:id`, and `/admin/scale-events` now expose provisioning-attempt context; frontend admin Server Fleet page now shows latest attempt status, cleanup result, failure reason, and worker run detail
  - added admin retry for failed provisioning: `POST /admin/scale-events/:id/retry` creates a fresh retry scale-event, preserves old failed history, and was verified to produce a new ready host from a previously failed event
  - added operational cleanup/archive support: `host_servers.archived_at` and `server_scale_events.archived_at` (migration `0006_archive-hosts-and-scale-events`), archive host action, bulk archive of stale failed noise, and default admin views now hide archived records while preserving history
  - added true queued host retirement/decommission flow: `POST /admin/servers/:id/retire` now validates host state/no active containers, enqueues worker-side provider cleanup, and archives the retired host out of active fleet views; verified against failed host `89c15cc8-4b0f-4ac2-8f5b-7b1f03722a39`
- Remaining caveat: legacy pre-attempt historical rows remain old test artifacts; going forward `host_provision_attempts` is the authoritative recovery model.

## Next exact step

- Reliability/admin lifecycle pass is checkpointed here.
- Next likely operational improvement: broader fleet UX polish (clearer separation of active vs archived history, richer attempt/scale-event filtering) or intentionally resume real provider / real email / real Stripe follow-ups.
- If staying in fleet operations, prioritize operator clarity over new background complexity.

## Rules for this file

- Keep under ~40 lines when possible.
- Update at end of each major phase/sub-phase.
- Include only:
  - current focus
  - current status
  - next exact step
  - one or two critical cautions

## Critical cautions

- Do not mix unrelated product/UI work into provisioning-reliability changes.
- Keep logs summarized, not pasted.
- For provisioning recovery bugs, distinguish legacy pre-attempt artifacts from new attempt-model behavior before patching further.
