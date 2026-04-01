# DECISIONS.md

Keep this file for live locked product/build decisions only.
Do not use it for templates, brainstorming, or duplicated reference dumps.

## PSI locked product boundaries
- MVP excludes PSI internals.
- MVP excludes marketplace.
- VPS provider: Hetzner only.
- Payment provider: Stripe only.
- One installation template per product.
- Referral rewards: subscription credit only.
- User accounts: individual only; no teams or organisations.
- White-labelling excluded.

## PSI locked subscription lifecycle
- Renewal payment failure: 3-day grace period; emails on day 1 and 3; day 4 suspend and power off server; after 14 suspended days delete server and mark expired; reinstatement powers back on and returns to active.
- User cancellation: continue until paid period end; send warning 48h before end; at period end delete server and mark cancelled.
- Provisioning failure after payment: mark provisioning_failed; no automatic refund; admin retries manually; if unresolved within 48h, manual Stripe dashboard refund.
- Plan upgrades/downgrades are out of MVP; UI should direct user to contact support.

## PSI locked architecture
- Billing must use internal normalized events only: subscription.activated, subscription.renewed, subscription.payment_failed, subscription.cancelled, subscription.grace_period_ended.
- BillingProvider interface only: createCheckoutSession, cancelSubscription, getSubscription.
- Nothing outside billing imports Stripe SDK.
- VPS must use VpsProvider interface only: createServer, getServerStatus, deleteServer.
- MockVpsAdapter for dev/test; HetznerAdapter for production.
- Workers never call Hetzner directly.

## Provisioning state machine
- queued -> creating_server -> server_ready -> provisioning -> completed
- failure from any step -> failed
- retry from failed -> queued, admin-initiated only

## Scope rule
- If a later task needs detailed schema, CMS keys, admin roles, or other implementation reference, store that in a separate targeted reference file rather than expanding this file again.
