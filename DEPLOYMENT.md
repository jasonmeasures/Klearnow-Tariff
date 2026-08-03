# Deployment surfaces

| Surface | Audience | Host | Auth | Admin UI | Quotas |
|---------|----------|------|------|----------|--------|
| **external** | Public / WordPress | Amplify + iframe shortcode | Auth0 (optional guest) | Hidden | 5/2 anon · 50/10 signed-in |
| **playground** | Internal KN | kn-playground Amplify/EB | Auth0 | Authors / `admin` role | Unlimited for admins |
| **engine** | Engine framework | Future | Auth0 | Authors / `admin` | Unlimited for admins |
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

## Auth0 roles

Custom claim `https://klearnow.com/roles` (override with `AUTH0_ADMIN_CLAIM`):

- includes `admin` → full Manage / Rule chat / hot-reload
- otherwise → signed-in user (calculate + higher quotas)
- no token + `ALLOW_GUEST` → guest quotas
