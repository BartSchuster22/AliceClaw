ALTER TABLE "host_provision_attempts"
ADD COLUMN IF NOT EXISTS "provider_action_id" varchar,
ADD COLUMN IF NOT EXISTS "provider_action_command" varchar,
ADD COLUMN IF NOT EXISTS "provider_action_status" varchar,
ADD COLUMN IF NOT EXISTS "provider_action_started_at" timestamp,
ADD COLUMN IF NOT EXISTS "provider_action_finished_at" timestamp;

ALTER TABLE "host_servers"
ADD COLUMN IF NOT EXISTS "provider_action_id" varchar,
ADD COLUMN IF NOT EXISTS "provider_action_command" varchar,
ADD COLUMN IF NOT EXISTS "provider_action_status" varchar,
ADD COLUMN IF NOT EXISTS "provider_action_started_at" timestamp,
ADD COLUMN IF NOT EXISTS "provider_action_finished_at" timestamp;
