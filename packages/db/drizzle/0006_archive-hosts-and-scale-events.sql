ALTER TABLE "host_servers"
ADD COLUMN IF NOT EXISTS "archived_at" timestamp;

ALTER TABLE "server_scale_events"
ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
