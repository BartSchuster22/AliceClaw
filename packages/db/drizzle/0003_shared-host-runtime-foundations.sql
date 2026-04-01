CREATE TYPE host_server_status AS ENUM ('provisioning', 'ready', 'draining', 'unreachable', 'failed', 'decommissioned');
CREATE TYPE container_instance_status AS ENUM ('pending_verification', 'queued', 'allocating', 'deploying', 'starting', 'running', 'unhealthy', 'stopping', 'stopped', 'deleting', 'deleted', 'failed');
CREATE TYPE server_scale_event_status AS ENUM ('triggered', 'provisioning', 'ready', 'failed');

ALTER TABLE onboarding_sessions ADD COLUMN IF NOT EXISTS subscription_id uuid UNIQUE REFERENCES subscriptions(id);
ALTER TABLE onboarding_sessions ALTER COLUMN order_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS product_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  version integer NOT NULL DEFAULT 1,
  docker_image varchar NOT NULL,
  docker_tag varchar NOT NULL DEFAULT 'latest',
  cpu_millicores integer NOT NULL,
  memory_mb integer NOT NULL,
  disk_gb integer NOT NULL,
  env_template jsonb NOT NULL DEFAULT '{}'::jsonb,
  port integer NOT NULL,
  health_check_path varchar NOT NULL DEFAULT '/health',
  startup_timeout_seconds integer NOT NULL DEFAULT 120,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS host_servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar NOT NULL,
  provider varchar NOT NULL DEFAULT 'hetzner',
  provider_instance_id varchar,
  region varchar NOT NULL,
  ip_address inet,
  instance_type varchar NOT NULL,
  total_cpu_millicores integer NOT NULL,
  total_memory_mb integer NOT NULL,
  total_disk_gb integer NOT NULL,
  reserved_cpu_millicores integer NOT NULL DEFAULT 0,
  reserved_memory_mb integer NOT NULL DEFAULT 0,
  reserved_disk_gb integer NOT NULL DEFAULT 0,
  status host_server_status NOT NULL,
  capacity_threshold_percent integer NOT NULL DEFAULT 80,
  ready_at timestamp,
  last_heartbeat_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS container_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  user_id uuid NOT NULL REFERENCES users(id),
  product_definition_id uuid NOT NULL REFERENCES product_definitions(id),
  host_server_id uuid REFERENCES host_servers(id),
  container_id varchar,
  container_name varchar,
  assigned_port integer,
  assigned_cpu_millicores integer,
  assigned_memory_mb integer,
  assigned_disk_gb integer,
  status container_instance_status NOT NULL,
  agent_url varchar,
  failure_reason text,
  deployment_requested_at timestamp,
  started_at timestamp,
  healthy_at timestamp,
  stopped_at timestamp,
  deleted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS server_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar NOT NULL,
  provider varchar NOT NULL DEFAULT 'hetzner',
  instance_type varchar NOT NULL,
  region varchar NOT NULL,
  capacity_threshold_percent integer NOT NULL DEFAULT 80,
  management_overhead_percent integer NOT NULL DEFAULT 15,
  expected_cpu_millicores integer NOT NULL,
  expected_memory_mb integer NOT NULL,
  expected_disk_gb integer NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS server_scale_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_host_server_id uuid REFERENCES host_servers(id),
  trigger_reason varchar NOT NULL,
  new_host_server_id uuid REFERENCES host_servers(id),
  status server_scale_event_status NOT NULL,
  failed_reason text,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  token_hash varchar NOT NULL UNIQUE,
  expires_at timestamp NOT NULL,
  verified_at timestamp,
  invalidated_at timestamp,
  resend_count integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type varchar NOT NULL,
  severity varchar NOT NULL DEFAULT 'warning',
  entity_type varchar NOT NULL,
  entity_id uuid NOT NULL,
  message text NOT NULL,
  dedupe_key varchar,
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE provisioning_jobs ADD COLUMN IF NOT EXISTS container_instance_id uuid REFERENCES container_instances(id);
ALTER TABLE provisioning_jobs ALTER COLUMN vps_instance_id DROP NOT NULL;
