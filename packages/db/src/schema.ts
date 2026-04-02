import {
  boolean,
  char,
  decimal,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const userStatusEnum = pgEnum('user_status', ['active', 'suspended']);
export const accountTypeEnum = pgEnum('account_type', ['private', 'business']);
export const onboardingStateEnum = pgEnum('onboarding_state', [
  'pending',
  'in_progress',
  'completed',
]);
export const adminRoleEnum = pgEnum('admin_role', [
  'super_admin',
  'support_admin',
  'billing_admin',
  'content_admin',
  'provisioning_admin',
  'referral_admin',
]);
export const adminStatusEnum = pgEnum('admin_status', ['active', 'suspended']);
export const billingCycleEnum = pgEnum('billing_cycle', ['monthly', 'annual']);
export const orderStatusEnum = pgEnum('order_status', ['pending', 'paid', 'failed', 'refunded']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'suspended',
  'cancelled',
  'expired',
  'provisioning_failed',
]);
export const vpsInstanceStatusEnum = pgEnum('vps_instance_status', [
  'queued',
  'creating_server',
  'server_ready',
  'provisioning',
  'completed',
  'failed',
  'suspended',
  'deleted',
]);
export const hostServerStatusEnum = pgEnum('host_server_status', [
  'provisioning',
  'ready',
  'draining',
  'unreachable',
  'failed',
  'decommissioned',
]);
export const containerInstanceStatusEnum = pgEnum('container_instance_status', [
  'pending_verification',
  'queued',
  'allocating',
  'deploying',
  'starting',
  'running',
  'unhealthy',
  'stopping',
  'stopped',
  'deleting',
  'deleted',
  'failed',
]);
export const serverScaleEventStatusEnum = pgEnum('server_scale_event_status', [
  'triggered',
  'provisioning',
  'ready',
  'failed',
]);
export const provisioningJobStatusEnum = pgEnum('provisioning_job_status', [
  'queued',
  'running',
  'completed',
  'failed',
]);
export const referralStatusEnum = pgEnum('referral_status', [
  'pending',
  'converted',
  'rewarded',
  'voided',
  'fraud_flagged',
]);
export const referralRewardTypeEnum = pgEnum('referral_reward_type', ['subscription_credit']);
export const referralRewardStatusEnum = pgEnum('referral_reward_status', [
  'pending',
  'applied',
  'voided',
]);
export const cmsContentKeyEnum = pgEnum('cms_content_key', [
  'hero_headline',
  'hero_subheadline',
  'hero_cta_text',
  'product_card_footer_note',
  'faq_entries',
  'footer_tagline',
]);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email').notNull().unique(),
  passwordHash: varchar('password_hash').notNull(),
  fullName: varchar('full_name').notNull(),
  referralCode: varchar('referral_code', { length: 8 }).notNull().unique(),
  referredByUserId: uuid('referred_by_user_id').references(() => users.id),
  emailVerified: boolean('email_verified').notNull().default(false),
  status: userStatusEnum('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const profiles = pgTable('profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  accountType: accountTypeEnum('account_type').notNull(),
  companyName: varchar('company_name'),
  taxId: varchar('tax_id'),
  phone: varchar('phone'),
  country: char('country', { length: 2 }).notNull(),
  onboardingState: onboardingStateEnum('onboarding_state').notNull(),
});

export const adminUsers = pgTable('admin_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email').notNull().unique(),
  passwordHash: varchar('password_hash').notNull(),
  fullName: varchar('full_name').notNull(),
  role: adminRoleEnum('role').notNull(),
  status: adminStatusEnum('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name').notNull(),
  slug: varchar('slug').notNull().unique(),
  description: text('description').notNull(),
  priceCents: integer('price_cents').notNull(),
  billingCycle: billingCycleEnum('billing_cycle').notNull(),
  vpsSpec: jsonb('vps_spec').notNull(),
  provisioningTemplateId: varchar('provisioning_template_id').notNull(),
  active: boolean('active').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  status: orderStatusEnum('status').notNull(),
  referralCodeUsed: varchar('referral_code_used'),
  stripeSessionId: varchar('stripe_session_id'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
  billingProvider: varchar('billing_provider').notNull().default('stripe'),
  billingProviderSubscriptionId: varchar('billing_provider_subscription_id'),
  status: subscriptionStatusEnum('status').notNull(),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: false }).notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: false }).notNull(),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const billingEventsLog = pgTable('billing_events_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .references(() => subscriptions.id),
  eventType: varchar('event_type').notNull(),
  provider: varchar('provider').notNull(),
  providerEventId: varchar('provider_event_id').notNull(),
  payload: jsonb('payload').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: false }).notNull(),
});

export const onboardingSessions = pgTable('onboarding_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  orderId: uuid('order_id').references(() => orders.id),
  subscriptionId: uuid('subscription_id')
    .unique()
    .references(() => subscriptions.id),
  currentStep: integer('current_step').notNull().default(1),
  answers: jsonb('answers').notNull().default({}),
  sshPublicKey: text('ssh_public_key'),
  completedAt: timestamp('completed_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const vpsInstances = pgTable('vps_instances', {
  id: uuid('id').defaultRandom().primaryKey(),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .unique()
    .references(() => subscriptions.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  provider: varchar('provider').notNull().default('hetzner'),
  providerInstanceId: varchar('provider_instance_id'),
  region: varchar('region').notNull(),
  ipAddress: inet('ip_address'),
  status: vpsInstanceStatusEnum('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const productDefinitions = pgTable('product_definitions', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  version: integer('version').notNull().default(1),
  dockerImage: varchar('docker_image').notNull(),
  dockerTag: varchar('docker_tag').notNull().default('latest'),
  cpuMillicores: integer('cpu_millicores').notNull(),
  memoryMb: integer('memory_mb').notNull(),
  diskGb: integer('disk_gb').notNull(),
  envTemplate: jsonb('env_template').notNull().default({}),
  port: integer('port').notNull(),
  healthCheckPath: varchar('health_check_path').notNull().default('/health'),
  startupTimeoutSeconds: integer('startup_timeout_seconds').notNull().default(120),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const hostServers = pgTable('host_servers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name').notNull(),
  provider: varchar('provider').notNull().default('hetzner'),
  providerInstanceId: varchar('provider_instance_id'),
  providerActionId: varchar('provider_action_id'),
  providerActionCommand: varchar('provider_action_command'),
  providerActionStatus: varchar('provider_action_status'),
  providerActionStartedAt: timestamp('provider_action_started_at', { withTimezone: false }),
  providerActionFinishedAt: timestamp('provider_action_finished_at', { withTimezone: false }),
  region: varchar('region').notNull(),
  ipAddress: inet('ip_address'),
  instanceType: varchar('instance_type').notNull(),
  totalCpuMillicores: integer('total_cpu_millicores').notNull(),
  totalMemoryMb: integer('total_memory_mb').notNull(),
  totalDiskGb: integer('total_disk_gb').notNull(),
  reservedCpuMillicores: integer('reserved_cpu_millicores').notNull().default(0),
  reservedMemoryMb: integer('reserved_memory_mb').notNull().default(0),
  reservedDiskGb: integer('reserved_disk_gb').notNull().default(0),
  status: hostServerStatusEnum('status').notNull(),
  capacityThresholdPercent: integer('capacity_threshold_percent').notNull().default(80),
  readyAt: timestamp('ready_at', { withTimezone: false }),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: false }),
  archivedAt: timestamp('archived_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const containerInstances = pgTable('container_instances', {
  id: uuid('id').defaultRandom().primaryKey(),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .references(() => subscriptions.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  productDefinitionId: uuid('product_definition_id')
    .notNull()
    .references(() => productDefinitions.id),
  hostServerId: uuid('host_server_id').references(() => hostServers.id),
  containerId: varchar('container_id'),
  containerName: varchar('container_name'),
  assignedPort: integer('assigned_port'),
  assignedCpuMillicores: integer('assigned_cpu_millicores'),
  assignedMemoryMb: integer('assigned_memory_mb'),
  assignedDiskGb: integer('assigned_disk_gb'),
  status: containerInstanceStatusEnum('status').notNull(),
  agentUrl: varchar('agent_url'),
  failureReason: text('failure_reason'),
  deploymentRequestedAt: timestamp('deployment_requested_at', { withTimezone: false }),
  startedAt: timestamp('started_at', { withTimezone: false }),
  healthyAt: timestamp('healthy_at', { withTimezone: false }),
  stoppedAt: timestamp('stopped_at', { withTimezone: false }),
  deletedAt: timestamp('deleted_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const serverTemplates = pgTable('server_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name').notNull(),
  provider: varchar('provider').notNull().default('hetzner'),
  instanceType: varchar('instance_type').notNull(),
  region: varchar('region').notNull(),
  capacityThresholdPercent: integer('capacity_threshold_percent').notNull().default(80),
  managementOverheadPercent: integer('management_overhead_percent').notNull().default(15),
  expectedCpuMillicores: integer('expected_cpu_millicores').notNull(),
  expectedMemoryMb: integer('expected_memory_mb').notNull(),
  expectedDiskGb: integer('expected_disk_gb').notNull(),
  isActive: boolean('is_active').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const serverScaleEvents = pgTable('server_scale_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  triggerHostServerId: uuid('trigger_host_server_id').references(() => hostServers.id),
  triggerReason: varchar('trigger_reason').notNull(),
  newHostServerId: uuid('new_host_server_id').references(() => hostServers.id),
  status: serverScaleEventStatusEnum('status').notNull(),
  failedReason: text('failed_reason'),
  completedAt: timestamp('completed_at', { withTimezone: false }),
  archivedAt: timestamp('archived_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const hostProvisionAttempts = pgTable('host_provision_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  scaleEventId: uuid('scale_event_id')
    .notNull()
    .references(() => serverScaleEvents.id),
  hostServerId: uuid('host_server_id').references(() => hostServers.id),
  providerInstanceId: varchar('provider_instance_id'),
  providerActionId: varchar('provider_action_id'),
  providerActionCommand: varchar('provider_action_command'),
  providerActionStatus: varchar('provider_action_status'),
  providerActionStartedAt: timestamp('provider_action_started_at', { withTimezone: false }),
  providerActionFinishedAt: timestamp('provider_action_finished_at', { withTimezone: false }),
  workerRunId: varchar('worker_run_id'),
  status: varchar('status').notNull(),
  failureReason: text('failure_reason'),
  cleanupStatus: varchar('cleanup_status').notNull().default('not_started'),
  startedAt: timestamp('started_at', { withTimezone: false }).notNull().defaultNow(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: false }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const emailVerifications = pgTable('email_verifications', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .references(() => subscriptions.id),
  tokenHash: varchar('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: false }),
  invalidatedAt: timestamp('invalidated_at', { withTimezone: false }),
  resendCount: integer('resend_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const adminAlerts = pgTable('admin_alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: varchar('type').notNull(),
  severity: varchar('severity').notNull().default('warning'),
  entityType: varchar('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  message: text('message').notNull(),
  dedupeKey: varchar('dedupe_key'),
  resolvedAt: timestamp('resolved_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const provisioningJobs = pgTable('provisioning_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  vpsInstanceId: uuid('vps_instance_id').references(() => vpsInstances.id),
  containerInstanceId: uuid('container_instance_id').references(() => containerInstances.id),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .references(() => subscriptions.id),
  status: provisioningJobStatusEnum('status').notNull(),
  currentStep: varchar('current_step'),
  logLines: text('log_lines').array().notNull().default([]),
  retryCount: integer('retry_count').notNull().default(0),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: false }),
  finishedAt: timestamp('finished_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const referrals = pgTable('referrals', {
  id: uuid('id').defaultRandom().primaryKey(),
  referrerUserId: uuid('referrer_user_id')
    .notNull()
    .references(() => users.id),
  referredUserId: uuid('referred_user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  referralCode: varchar('referral_code').notNull(),
  orderId: uuid('order_id').references(() => orders.id),
  status: referralStatusEnum('status').notNull(),
  fraudReason: text('fraud_reason'),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const referralRewardsLedger = pgTable('referral_rewards_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  referralId: uuid('referral_id').references(() => referrals.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  rewardType: referralRewardTypeEnum('reward_type').notNull(),
  amountCents: integer('amount_cents').notNull(),
  status: referralRewardStatusEnum('status').notNull(),
  appliedToSubscriptionId: uuid('applied_to_subscription_id').references(() => subscriptions.id),
  reason: varchar('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const referralSettings = pgTable('referral_settings', {
  id: integer('id').primaryKey().default(1),
  globalRewardRatePercent: decimal('global_reward_rate_percent', {
    precision: 5,
    scale: 2,
  })
    .notNull()
    .default('10.00'),
  coolingPeriodDays: integer('cooling_period_days').notNull().default(14),
  updatedAt: timestamp('updated_at', { withTimezone: false }).notNull(),
  updatedByAdminId: uuid('updated_by_admin_id')
    .notNull()
    .references(() => adminUsers.id),
});

export const referralUserOverrides = pgTable('referral_user_overrides', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),
  customRewardRatePercent: decimal('custom_reward_rate_percent', {
    precision: 5,
    scale: 2,
  }).notNull(),
  reason: text('reason').notNull(),
  setByAdminId: uuid('set_by_admin_id')
    .notNull()
    .references(() => adminUsers.id),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const cmsContent = pgTable('cms_content', {
  key: cmsContentKeyEnum('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).notNull(),
  updatedByAdminId: uuid('updated_by_admin_id')
    .notNull()
    .references(() => adminUsers.id),
});

export const adminAuditLog = pgTable('admin_audit_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  adminUserId: uuid('admin_user_id')
    .notNull()
    .references(() => adminUsers.id),
  action: varchar('action').notNull(),
  targetType: varchar('target_type').notNull(),
  targetId: uuid('target_id'),
  payloadSummary: jsonb('payload_summary').notNull(),
  ipAddress: inet('ip_address').notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).notNull().defaultNow(),
});

export const schema = {
  users,
  profiles,
  adminUsers,
  products,
  orders,
  subscriptions,
  billingEventsLog,
  onboardingSessions,
  vpsInstances,
  productDefinitions,
  hostServers,
  containerInstances,
  serverTemplates,
  serverScaleEvents,
  emailVerifications,
  adminAlerts,
  provisioningJobs,
  referrals,
  referralRewardsLedger,
  referralSettings,
  referralUserOverrides,
  cmsContent,
  adminAuditLog,
};
