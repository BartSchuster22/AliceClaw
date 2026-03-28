# DECISIONS.md

## PRODUCT MATRIX

Product 1 name:
Product 1 price (monthly):
Product 1 VPS spec (RAM / CPU / disk):
Product 1 region options:

## ONBOARDING WIZARD QUESTIONS

Step 1: welcome (no input)
Step 2: full name, phone, country (required)
Step 3: account type (private / business), company name if business
Step 4: intended use-case (free text, max 200 chars)
Step 5: preferred region (EU / US / APAC)
Step 6: SSH public key (optional)
Step 7: accept terms + privacy (required checkbox)

## REFERRAL RULES

Reward rate: __% subscription credit
Cooling period before reward vests: __ days
Fraud flag trigger: __

## PROVISIONING STATES

queued → creating_server → server_ready → provisioning → completed
Any step can → failed. Retry is admin-initiated only.

## COMPLETE DATA SCHEMA REFERENCE

Use this when writing the schema prompt.

users
id uuid PK, email varchar unique, password_hash varchar, full_name varchar, referral_code varchar(8) unique, referred_by_user_id uuid FK nullable, email_verified boolean default false, status enum(active, suspended), created_at timestamp
profiles
id uuid PK, user_id uuid FK unique, account_type enum(private, business), company_name varchar nullable, tax_id varchar nullable, phone varchar nullable, country char(2), onboarding_state enum(pending, in_progress, completed)
admin_users
id uuid PK, email varchar unique, password_hash varchar, full_name varchar, role enum(super_admin, support_admin, billing_admin, content_admin, provisioning_admin, referral_admin), status enum(active, suspended), created_at timestamp
products
id uuid PK, name varchar, slug varchar unique, description text, price_cents integer, billing_cycle enum(monthly, annual), vps_spec jsonb, provisioning_template_id varchar, active boolean, created_at timestamp
orders
id uuid PK, user_id uuid FK, product_id uuid FK, status enum(pending, paid, failed, refunded), referral_code_used varchar nullable, stripe_session_id varchar nullable, created_at timestamp
subscriptions
id uuid PK, user_id uuid FK, product_id uuid FK, order_id uuid FK, billing_provider varchar default 'stripe', billing_provider_subscription_id varchar nullable, status enum(active, suspended, cancelled, expired, provisioning_failed), current_period_start timestamp, current_period_end timestamp, cancel_at_period_end boolean default false, created_at timestamp
billing_events_log
id uuid PK, subscription_id uuid FK, event_type varchar, provider varchar, provider_event_id varchar, payload jsonb, processed_at timestamp
onboarding_sessions
id uuid PK, user_id uuid FK, order_id uuid FK unique, current_step integer default 1, answers jsonb default '{}', ssh_public_key text nullable, completed_at timestamp nullable, created_at timestamp
vps_instances
id uuid PK, subscription_id uuid FK unique, user_id uuid FK, provider varchar default 'hetzner', provider_instance_id varchar nullable, region varchar, ip_address inet nullable, status enum(queued, creating_server, server_ready, provisioning, completed, failed, suspended, deleted), created_at timestamp
provisioning_jobs
id uuid PK, vps_instance_id uuid FK, subscription_id uuid FK, status enum(queued, running, completed, failed), current_step varchar nullable, log_lines text[] default '{}', retry_count integer default 0, error_message text nullable, started_at timestamp nullable, finished_at timestamp nullable, created_at timestamp
referrals
id uuid PK, referrer_user_id uuid FK, referred_user_id uuid FK unique, referral_code varchar, order_id uuid FK nullable, status enum(pending, converted, rewarded, fraud_flagged), created_at timestamp
referral_rewards_ledger
id uuid PK, referral_id uuid FK, user_id uuid FK, reward_type enum(subscription_credit), amount_cents integer, status enum(pending, applied, voided), applied_to_subscription_id uuid FK nullable, reason varchar, created_at timestamp
referral_settings
id integer PK default 1, global_reward_rate_percent decimal(5,2) default 10.00, cooling_period_days integer default 14, updated_at timestamp, updated_by_admin_id uuid FK
referral_user_overrides
id uuid PK, user_id uuid FK unique, custom_reward_rate_percent decimal(5,2), reason text, set_by_admin_id uuid FK, created_at timestamp
cms_content
key enum(hero_headline, hero_subheadline, hero_cta_text, product_card_footer_note, faq_entries, footer_tagline) PK, value text, updated_at timestamp, updated_by_admin_id uuid FK
admin_audit_log
id uuid PK, admin_user_id uuid FK, action varchar, target_type varchar, target_id uuid nullable, payload_summary jsonb, ip_address inet, created_at timestamp
