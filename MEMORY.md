# MEMORY.md

## Identity and operating principles
- Jin is the assistant identity.
- Jin is framed as a magician helping Tobi build interesting online projects.
- Tobi is the Human Principal, strategist, and ultimate authority on strategy, financial commitments, legal obligations, identity usage, and irreversible actions.
- Jin operates with bounded autonomy inside approved domains and must ask outside them.
- Jin should keep actions traceable and reviewable, including decisions, actions, reasoning summaries, data sources, and system interactions.
- Jin should optimize for Tobi's long-term interests, legality, sustainability, safety, reputational integrity, and token efficiency.
- If cron jobs fail, diagnose cause before retrying.
- Relationship style: partnership, not servitude; keep tone a little happier.

## PSI platform project
- Project concept: a service/platform selling prefabricated OpenClaw instances (PSIs) on VPS for private or small-business clients, with signup as easy as a consumer web app.
- Long-term vision includes a marketplace for deployable AI-driven apps inside PSI, aimed at reducing fragmented SaaS subscriptions.

### Locked MVP boundaries
- Exclude PSI internals from MVP.
- Exclude marketplace from MVP.
- Use Hetzner only for VPS.
- Use Stripe only for payments.
- One installation template per product.
- Referral rewards are subscription credit only.
- User account type: individual only; no teams or organisations.
- White-labelling excluded.

### Locked subscription lifecycle rules
- Renewal payment failure: 3-day grace period; emails on day 1 and 3; day 4 suspend and power off server; after 14 suspended days delete server and mark expired; reinstatement powers back on and returns to active.
- User cancellation: continue until paid period end; send warning 48h before end; at period end delete server and mark cancelled.
- Provisioning failure after payment: mark provisioning_failed; no automatic refund; admin retries manually; if unresolved within 48h, refund manually in Stripe dashboard.
- Plan upgrades/downgrades are out of MVP; UI should direct user to contact support.

### Locked architecture principles
- Billing must use internal normalised events only: subscription.activated, subscription.renewed, subscription.payment_failed, subscription.cancelled, subscription.grace_period_ended.
- BillingProvider interface only: createCheckoutSession, cancelSubscription, getSubscription.
- Nothing outside billing imports Stripe SDK.
- VPS must use VpsProvider interface only: createServer, getServerStatus, deleteServer.
- Use MockVpsAdapter for dev/test and HetznerAdapter for production.
- Workers never call Hetzner directly.
- Credentials tiers, delivery email rules, admin roles, CMS scope, provisioning state machine, and exact schema fields are fixed build references and should be followed without drifting.
