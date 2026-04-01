# DEPLOYMENT-NOTES.md

## API origin decision

Decision: use a single canonical public API origin in production.

Recommended production setting for all three frontends:
- `VITE_API_URL=https://aquiero.com/api`

Rationale:
- one API ingress point
- simpler nginx/TLS/rate-limit reasoning
- less config drift than duplicating `/api` proxies on multiple frontend subdomains
- cleaner security posture for admin/app/web separation

## Frontend code status

Normalized already:
- `apps/frontend-web/src/lib/api.ts`
- `apps/frontend-app/src/lib/api.ts`
- `apps/frontend-admin/src/lib/api.ts`
- `apps/frontend-admin/src/state/admin-auth-context.tsx`

Current fallback:
- `import.meta.env.VITE_API_URL ?? '/api'`

## Remaining config assumptions to update

Still assuming the old API host model:
- `docker-compose.yml`
  - still injects `VITE_API_URL: https://api.canariaslibre.com` for frontends
- `Caddyfile`
  - still defines `api.canariaslibre.com`

## Recommended next deployment updates

1. Update frontend env injection in `docker-compose.yml`:
- replace old API host with canonical production API path/origin
- preferred production value:
  - `VITE_API_URL=https://aquiero.com/api`

2. Review `Caddyfile`:
- if nginx becomes the production ingress, Caddy may be dev/legacy only
- if still used, align it with the same canonical API decision

3. Keep nginx production routing as the source of truth:
- web on `aquiero.com`
- app on `app.aquiero.com`
- admin on `admin.aquiero.com`
- API on `https://aquiero.com/api`

## CMS Phase 12 checkpoint

- `GET /cms/public` now uses Redis-backed caching (`cms:public`, 5 minutes)
- admin CMS patch invalidates the public CMS cache
- behavior verified live
