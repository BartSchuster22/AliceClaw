ALTER TABLE "host_provision_attempts"
ADD COLUMN IF NOT EXISTS "worker_run_id" varchar;

CREATE INDEX IF NOT EXISTS "host_provision_attempts_worker_run_idx"
ON "host_provision_attempts" ("worker_run_id");
