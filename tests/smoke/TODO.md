# Smoke test harness TODO

To make `shared-host-runtime.spec.ts` runnable, add:

1. `@playwright/test` as a dev dependency
2. a root `playwright.config.ts`
3. test bootstrap for:
   - backend-api
   - worker
   - Redis
   - Postgres test DB
4. mock/runtime fixture controls for:
   - HostServerProvider
   - DockerAdapter
5. deterministic billing + verification helpers
6. queue inspection helpers for BullMQ

## Why scaffold-first?

The current repository had no Playwright or integration test harness. This scaffold locks the intended assertions now without pretending a fully runnable e2e stack already exists.
