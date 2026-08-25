# Deployment surfaces

| Surface | Audience | Host | Auth | Admin UI | Quotas |
|---------|----------|------|------|----------|--------|
| **external** | Public / WordPress | Amplify + iframe shortcode | Auth0 (optional guest) | Hidden | **5/2 guest** · **unlimited when signed in** |
| **playground** | Internal KN | kn-playground Amplify/EB | Auth0 | Authors / `admin` role | Unlimited |
| **engine** | Engine framework | Future | Auth0 | Authors / `admin` | Unlimited |
| **local** | Dev | localhost | API key `dev-internal` | Visible | Unlimited |

## Order of delivery

1. **Local** (this repo) — full Duty stack + rules.
2. **Playground** — copy into `kn-playground/applications/KlearNow-Tariff/` with Auth0.
3. **WordPress** — embed SPA with `?embed=1&surface=external` via `wordpress/klearnow-duty-stack`.
4. **Engine framework** — same Auth0 tenants / roles as playground.

## Companion tools

Top-bar **RPS** links to Restricted Party Screening (`kn-playground/applications/RPS`).

| Env | Value |
|-----|--------|
| `VITE_RPS_URL` | RPS Amplify URL in playground / production. Local default: `http://localhost:3002`. Set empty / `false` to hide the link. |

## Auth0 + users database

**Without PostgreSQL** (local / interim): roles still come from Auth0 claim `https://klearnow.com/roles` (override with `AUTH0_ADMIN_CLAIM`):

- includes `admin` → full Manage / Rule chat / hot-reload
- otherwise → signed-in user (calculate + **unlimited**)
- no token + `ALLOW_GUEST` → guest quotas (5 stacks / 2 extracts per day)

**With PostgreSQL** (`DATABASE_URL` or `PGHOST`):

1. Auth0 remains the **authenticator** only (JWT verification).
2. Role and access come from the `users` table. Auth0 dashboard is **not** where roles are assigned.
3. Require an `email` claim on the access token (Auth0 Action) so new logins can match/provision rows.
4. Env:
   - `ADMIN_BOOTSTRAP_EMAILS` — comma-separated emails upserted as active admins on boot
   - `USER_AUTO_PROVISION=true` — unknown Auth0 emails get an **active** `user` row (promote in Manage → Users). Default on when `SURFACE=playground`. Set `false` for invite-only.
5. Admin UI: Manage → **Users** (`GET/POST/PATCH/DELETE /v1/admin/users`).
6. Terraform: wire RDS/Postgres + credentials separately (do not edit `terraform/` in-app for this feature).

Infrastructure handoff: managed Postgres instance reachable from EB, Secrets/env for `DATABASE_URL`, security group allowing EB → 5432.
