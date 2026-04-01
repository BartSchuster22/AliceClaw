CREATE TABLE IF NOT EXISTS "host_provision_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "scale_event_id" uuid NOT NULL REFERENCES "server_scale_events"("id"),
  "host_server_id" uuid REFERENCES "host_servers"("id"),
  "provider_instance_id" varchar,
  "status" varchar NOT NULL,
  "failure_reason" text,
  "cleanup_status" varchar NOT NULL DEFAULT 'not_started',
  "started_at" timestamp NOT NULL DEFAULT now(),
  "last_heartbeat_at" timestamp NOT NULL DEFAULT now(),
  "finished_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "host_provision_attempts_scale_event_idx" ON "host_provision_attempts" ("scale_event_id");
CREATE INDEX IF NOT EXISTS "host_provision_attempts_status_idx" ON "host_provision_attempts" ("status");
