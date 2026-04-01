# PSI smoke test plan

This folder contains the first smoke/integration test scaffolds for the shared-host runtime model.

## Current status

The repository did not contain an existing Playwright or integration test harness at the time these tests were added. So this phase establishes:

- a canonical smoke test plan
- executable test scaffolds to be wired into a real test environment next

## Intended coverage

1. Email verification gate
2. Bin-packing and scale-out
3. Container stop and resume
4. Subscription teardown after grace period
5. No-capacity queued deploy recovery

## Next wiring step

To make these fully executable, PSI still needs:

- Playwright as a dev dependency
- a test environment bootstrap (API + worker + Redis + DB)
- test fixtures for mock host provider / mock docker adapter
- seeded test data helpers
