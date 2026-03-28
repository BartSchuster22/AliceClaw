CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');
CREATE TYPE "public"."account_type" AS ENUM('private', 'business');
CREATE TYPE "public"."onboarding_state" AS ENUM('pending', 'in_progress', 'completed');
CREATE TYPE "public"."admin_role" AS ENUM('super_admin', 'support_admin', 'billing_admin', 'content_admin', 'provisioning_admin', 'referral_admin');
CREATE TYPE "public"."admin_status" AS ENUM('active', 'suspended');
CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'annual');
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'failed', 'refunded');
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'suspended', 'cancelled', 'expired', 'provisioning_failed');
CREATE TYPE "public"."vps_instance_status" AS ENUM('queued', 'creating_server', 'server_ready', 'provisioning', 'completed', 'failed', 'suspended', 'deleted');
CREATE TYPE "public"."provisioning_job_status" AS ENUM('queued', 'running', 'completed', 'failed');
CREATE TYPE "public"."referral_status" AS ENUM('pending', 'converted', 'rewarded', 'fraud_flagged');
CREATE TYPE "public"."referral_reward_type" AS ENUM('subscription_credit');
CREATE TYPE "public"."referral_reward_status" AS ENUM('pending', 'applied', 'voided');
CREATE TYPE "public"."cms_content_key" AS ENUM('hero_headline', 'hero_subheadline', 'hero_cta_text', 'product_card_footer_note', 'faq_entries', 'footer_tagline');

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar NOT NULL,
  "password_hash" varchar NOT NULL,
  "full_name" varchar NOT NULL,
  "referral_code" varchar(8) NOT NULL,
  "referred_by_user_id" uuid,
  "email_verified" boolean DEFAULT false NOT NULL,
  "status" "user_status" NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email"),
  CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code")
);

CREATE TABLE "profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_type" "account_type" NOT NULL,
  "company_name" varchar,
  "tax_id" varchar,
  "phone" varchar,
  "country" char(2) NOT NULL,
  "onboarding_state" "onboarding_state" NOT NULL,
  CONSTRAINT "profiles_user_id_unique" UNIQUE("user_id")
);

CREATE TABLE "admin_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar NOT NULL,
  "password_hash" varchar NOT NULL,
  "full_name" varchar NOT NULL,
  "role" "admin_role" NOT NULL,
  "status" "admin_status" NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);

CREATE TABLE "products" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar NOT NULL,
  "slug" varchar NOT NULL,
  "description" text NOT NULL,
  "price_cents" integer NOT NULL,
  "billing_cycle" "billing_cycle" NOT NULL,
  "vps_spec" jsonb NOT NULL,
  "provisioning_template_id" varchar NOT NULL,
  "active" boolean NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "products_slug_unique" UNIQUE("slug")
);

CREATE TABLE "orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "status" "order_status" NOT NULL,
  "referral_code_used" varchar,
  "stripe_session_id" varchar,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "billing_provider" varchar DEFAULT 'stripe' NOT NULL,
  "billing_provider_subscription_id" varchar,
  "status" "subscription_status" NOT NULL,
  "current_period_start" timestamp NOT NULL,
  "current_period_end" timestamp NOT NULL,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "billing_events_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subscription_id" uuid NOT NULL,
  "event_type" varchar NOT NULL,
  "provider" varchar NOT NULL,
  "provider_event_id" varchar NOT NULL,
  "payload" jsonb NOT NULL,
  "processed_at" timestamp NOT NULL
);

CREATE TABLE "onboarding_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "current_step" integer DEFAULT 1 NOT NULL,
  "answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ssh_public_key" text,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "onboarding_sessions_order_id_unique" UNIQUE("order_id")
);

CREATE TABLE "vps_instances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "subscription_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" varchar DEFAULT 'hetzner' NOT NULL,
  "provider_instance_id" varchar,
  "region" varchar NOT NULL,
  "ip_address" inet,
  "status" "vps_instance_status" NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "vps_instances_subscription_id_unique" UNIQUE("subscription_id")
);

CREATE TABLE "provisioning_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vps_instance_id" uuid NOT NULL,
  "subscription_id" uuid NOT NULL,
  "status" "provisioning_job_status" NOT NULL,
  "current_step" varchar,
  "log_lines" text[] DEFAULT '{}' NOT NULL,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "started_at" timestamp,
  "finished_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "referrer_user_id" uuid NOT NULL,
  "referred_user_id" uuid NOT NULL,
  "referral_code" varchar NOT NULL,
  "order_id" uuid,
  "status" "referral_status" NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referrals_referred_user_id_unique" UNIQUE("referred_user_id")
);

CREATE TABLE "referral_rewards_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "referral_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "reward_type" "referral_reward_type" NOT NULL,
  "amount_cents" integer NOT NULL,
  "status" "referral_reward_status" NOT NULL,
  "applied_to_subscription_id" uuid,
  "reason" varchar NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "referral_settings" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "global_reward_rate_percent" decimal(5,2) DEFAULT '10.00' NOT NULL,
  "cooling_period_days" integer DEFAULT 14 NOT NULL,
  "updated_at" timestamp NOT NULL,
  "updated_by_admin_id" uuid NOT NULL
);

CREATE TABLE "referral_user_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "custom_reward_rate_percent" decimal(5,2) NOT NULL,
  "reason" text NOT NULL,
  "set_by_admin_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "referral_user_overrides_user_id_unique" UNIQUE("user_id")
);

CREATE TABLE "cms_content" (
  "key" "cms_content_key" PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp NOT NULL,
  "updated_by_admin_id" uuid NOT NULL
);

CREATE TABLE "admin_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "admin_user_id" uuid NOT NULL,
  "action" varchar NOT NULL,
  "target_type" varchar NOT NULL,
  "target_id" uuid,
  "payload_summary" jsonb NOT NULL,
  "ip_address" inet NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_user_id_users_id_fk" FOREIGN KEY ("referred_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "billing_events_log" ADD CONSTRAINT "billing_events_log_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "onboarding_sessions" ADD CONSTRAINT "onboarding_sessions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "vps_instances" ADD CONSTRAINT "vps_instances_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "vps_instances" ADD CONSTRAINT "vps_instances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_vps_instance_id_vps_instances_id_fk" FOREIGN KEY ("vps_instance_id") REFERENCES "public"."vps_instances"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referral_rewards_ledger" ADD CONSTRAINT "referral_rewards_ledger_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referral_rewards_ledger" ADD CONSTRAINT "referral_rewards_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referral_rewards_ledger" ADD CONSTRAINT "referral_rewards_ledger_applied_to_subscription_id_subscriptions_id_fk" FOREIGN KEY ("applied_to_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referral_settings" ADD CONSTRAINT "referral_settings_updated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referral_user_overrides" ADD CONSTRAINT "referral_user_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "referral_user_overrides" ADD CONSTRAINT "referral_user_overrides_set_by_admin_id_admin_users_id_fk" FOREIGN KEY ("set_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "cms_content" ADD CONSTRAINT "cms_content_updated_by_admin_id_admin_users_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
