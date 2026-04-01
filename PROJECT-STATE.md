# PROJECT-STATE.md

Use this as the first project handoff file for active work.

## Purpose

Keep only the minimum needed to reconnect to the current project in a new session.
Do not paste raw logs here. Do not duplicate full schema/reference material here.

## Current active project

- Project: PSI platform
- Current focus: stabilization/manual sweep after closing referral verification.
- Current status: referral flow was verified from live local data. Admin referral routes respond correctly. A real referral moved pending -> converted -> rewarded, and ledger credit was written/applied in mock mode. While reconnecting, a separate backend startup issue was found and fixed by reinstalling workspace deps in-container so `postmark` resolved again.
- Referral hardening completed: deferred live-Stripe credit no longer auto-pretends success in code. Mock mode still marks applied; live undeployed Stripe path now keeps ledger pending and referral converted until a real credit implementation exists. Historical rows are unchanged.
- Stabilization fixes completed this round:
  - fixed dev user-login drift by reseeding `user@openclaw.local` with the documented `user_dev_password`
  - fixed `/user/subscriptions` 500, then restored live `container_instances` joins after migration `0003` landed
  - hardened backend and worker notification paths so missing Postmark config skips email cleanly in local/dev instead of 500/failing finished jobs
  - hardened worker provisioning preflight so missing env is detected early and logged as configuration blockage instead of failing deep in the flow
  - fixed the actual schema drift by applying DB migration `0003_shared-host-runtime-foundations`
  - bootstrapped active `product_definitions` for `starter` and `pro`
  - bootstrapped one active `server_template` and one ready dev `host_server`
  - marked stale queued VPS-era provisioning jobs as obsolete failures so DB state no longer implies they are still actionable
  - fixed deploy-worker bugs uncovered during the first real post-migration run (`productDefinitions` import, delayed requeue path, fresh provisioning-job rows for reruns)
  - added the missing user delete route
  - cleaned stopped/deleted payload semantics so stale runtime fields are nulled in user/onboarding responses
  - verified one fresh post-migration host-backed mock deploy completed end-to-end, then verified lifecycle coverage: deploy -> visibility -> stop -> start -> health-check -> delete
  - verified frontend-web source starts cleanly in an isolated Vite launch; the scary duplicate-component error appears to be stale from the long-running dev container rather than current source
- Remaining referral caveat: existing historical data may still show already-applied rows from before the hardening patch; future runs should behave more truthfully.

## Next exact step

- Pause here as a clean checkpoint.
- Next session should start with a short broader polish/integration sweep: admin UX consistency, scale-event/server-template lifecycle, and any remaining real-email/live-Stripe follow-ups once those integrations are intentionally resumed.
- Keep referral verification summarized; do not reopen it unless the billing-credit implementation changes.

## Rules for this file

- Keep under ~40 lines when possible.
- Update at end of each major phase/sub-phase.
- Include only:
  - current focus
  - current status
  - next exact step
  - one or two critical cautions

## Critical cautions

- Do not mix unrelated product/UI work into this worker debugging phase.
- Keep logs summarized, not pasted.
- If dependency/runtime weirdness appears, distinguish container/runtime issues from code issues before patching app logic.
