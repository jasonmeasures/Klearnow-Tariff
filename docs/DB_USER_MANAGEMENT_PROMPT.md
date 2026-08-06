# Task: replace Auth0 user management with database-backed users & roles

## Repo context

App: `applications/Klearnow-Tariff-main/` in the `kn-playground` monorepo.

| Part | Detail |
|---|---|
| Backend | Node 20 + Express 4 + TypeScript, run directly by `tsx` (no build step). Source in `backend/src/`, ESM with explicit `.ts` import extensions. |
| Frontend | Vanilla-JS PWA (no framework) built by Vite. Source in `frontend/` — `app.js`, `auth.js`, `index.html`, `styles.css`. |
| Rules data | JSON files in `tariff-rules/data/` — unrelated to this task, do not touch. |
| Deploy | One multi-stage `Dockerfile` at the app root: stage 1 builds the PWA, stage 2 runs Express and serves the build from the same origin. Elastic Beanstalk, single instance. |
| Run locally | `cd backend && npm install && npm run dev` (:8080); `cd frontend && npm install && npm run dev` (:3000, proxies `/v1` → :8080). |

## Current auth model (read these before changing anything)

- `backend/src/auth.ts` — the whole authorization model.
  - `authMiddleware` resolves a `Principal` per request, in priority order: Auth0 `Bearer` JWT → `X-API-Key` → guest (only if `ALLOW_GUEST=true`).
  - `principalFromBearer` verifies the JWT with `jose` against the Auth0 JWKS.
  - `roleFromClaims` derives the role **from token claims**: `admin` if the `https://klearnow.com/roles` claim or the `permissions` array contains `admin`/`tariff:admin`, otherwise `user`.
  - `scopesForRole` maps role → `{ calculate, read_rules, write_rules, admin }`.
  - Three API keys from env (`API_KEY_INTERNAL` = admin, `API_KEY_CALCULATE` = user, `API_KEY_EXTERNAL` = guest).
- `backend/src/index.ts` — `app.use("/v1", authMiddleware)`; routes guard with `requireScope(...)`.
- `backend/src/quota.ts` — daily quota counters in an in-memory `Map`.
- `frontend/app.js` — `/v1/me` drives `applyScopes()`, which shows/hides `[data-admin-only]` elements; `passSignInGate()` blocks the app until authenticated.

**The app currently has no database at all.** There is no user record anywhere: authorization is derived from JWT claims on every request, and user/role administration happens in the Auth0 dashboard.

## Goal

Move **user management and authorization** into a PostgreSQL database owned by the app. Auth0 stays as the **authenticator only** (it proves who you are); the database becomes the sole authority for *whether that person may use the app and with what role*.

Explicitly:

- Stop reading roles from Auth0 token claims.
- Add a `users` table and an in-app admin UI to manage users and roles.
- Anyone whose verified Auth0 identity has no active user row is denied — this replaces today's behavior where any valid token gets the `user` role.

## Hard constraints

1. **No Terraform / infrastructure changes.** Do not edit anything under `terraform/`. Infra will be wired separately after review. Read DB config from env vars only.
2. **The app must still boot and work with no database configured.** When `DATABASE_URL` (or `PGHOST`) is unset, log a clear warning and fall back to exactly today's behavior (roles from Auth0 claims). This is required for local dev and for the currently-deployed environment. Every DB code path must be behind this check.
3. **Do not break the API-key principals.** Service keys must keep working without any DB lookup — they are used by the MCP server and for smoke tests.
4. Keep the existing three roles (`guest` / `user` / `admin`) and the `scopesForRole` mapping. Do not touch individual route guards.
5. `GET /health` must stay unauthenticated and must not depend on the DB.
6. Do not modify anything in `tariff-rules/`, the duty-stack calculation, or the assessment engines.
7. Keep dependencies minimal: use `pg` only. No ORM, no migration framework, no auth library.
8. Assume a **single application instance** (the deployment is pinned to one).

## What to build

### 1. Database layer — `backend/src/db.ts`

- A `pg` Pool built from `DATABASE_URL`, or `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`.
- `isDbEnabled()` helper used everywhere to branch.
- Create the schema on startup if absent (plain `CREATE TABLE IF NOT EXISTS` in code — the sibling app `applications/inditex-audit-main/inditex_audit_server.py` does this and is a fine reference for the pattern).
- Fail loudly at boot if the DB is configured but unreachable; do not silently fall back in that case.

### 2. Schema

```sql
users (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,          -- store lowercased
  auth0_sub    text unique,                   -- filled on first successful login
  name         text,
  role         text not null default 'user',  -- 'user' | 'admin'
  status       text not null default 'active',-- 'active' | 'disabled'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_login_at timestamptz
)
user_audit (   -- who changed whom, append-only
  id bigserial primary key,
  actor_email text, target_email text, action text, detail jsonb,
  created_at timestamptz not null default now()
)
```

### 3. Auth flow change — `backend/src/auth.ts`

In `principalFromBearer`, after JWT verification succeeds:

- Look the user up by `auth0_sub`, falling back to lowercased `email` from the token; on an email match, backfill `auth0_sub`.
- Not found or `status = 'disabled'` → **reject with 403** and a clear message (`"Your account is not provisioned for this application. Contact an administrator."`). Do not fall back to the claims-based role.
- Found and active → role comes from the DB row. Update `last_login_at` (best-effort, must not block or fail the request).
- Optional env `USER_AUTO_PROVISION=true` — auto-create a new row as `role='user'`, `status='disabled'` so an admin can approve it. Default **false**.

The access token may not carry `email` by default; read it from the standard `email` claim and document that an Auth0 Action must add it. If no email and no matching `auth0_sub`, deny.

Bootstrap: env `ADMIN_BOOTSTRAP_EMAILS` (comma-separated). On startup, upsert those as `role='admin'`, `status='active'` — otherwise the first deployment has no admin and nobody can grant themselves access.

### 4. Admin API — new `backend/src/users.ts`, mounted under `/v1`

All routes `requireScope("admin")` (see how `backend/src/admin.ts` does it):

- `GET /v1/admin/users` — list with optional `?q=` search and status filter
- `POST /v1/admin/users` — create `{ email, name?, role? }`, defaults `role='user'`, `status='active'`
- `PATCH /v1/admin/users/:id` — change `role` and/or `status`
- `DELETE /v1/admin/users/:id` — hard delete

Rules:

- Validate role/status against allowed values; normalize emails to lowercase.
- Write a `user_audit` row for every mutation.
- **An admin must not be able to disable, demote, or delete their own account**, and the system must never end up with zero active admins — reject with 409 and a clear message.
- Return 503 with a clear message on every route when the DB is not configured.

### 5. Frontend — users admin page

Follow existing patterns exactly; do not introduce a framework or a build-step change.

- Add a `Users` nav button under the existing **Manage** group in `frontend/index.html`, marked `data-admin-only` like its siblings.
- Add a `view-users` section: table (email, name, role, status, last login) plus add-user form and per-row role/status controls.
- Use the existing `api()` helper in `frontend/app.js` for calls, the existing `banner()` for errors, and existing CSS classes — no new design language.
- Hide the whole section when `/v1/me` reports `can.admin === false`.

### 6. Config & docs

- Add every new env var to `backend/.env.example` with comments: `DATABASE_URL`, `ADMIN_BOOTSTRAP_EMAILS`, `USER_AUTO_PROVISION`.
- Update `applications/Klearnow-Tariff-main/README.md` and `DEPLOYMENT.md`: how users are managed now, how to bootstrap the first admin, and that the app degrades to claims-based roles with no DB.
- Note in the docs that the Auth0 dashboard is no longer where roles are assigned.

## Acceptance criteria

- With no `DATABASE_URL`: app boots, logs the fallback warning, behaves exactly as before.
- With a local Postgres: schema auto-creates, bootstrap admin appears, admin UI lists/creates/updates/disables users, a disabled user is locked out on their next request.
- A token whose claims say `admin` but whose DB row says `user` resolves as **`user`** — the database wins.
- The existing `cd backend && npm test` suite still passes.
- `docker build -t kn-tariff .` from the app root succeeds and the container serves the SPA and API on :8080.
- No files under `terraform/` are modified.

## Deliverables

A summary of: files added/changed, the exact SQL schema created, every new env var, and what infrastructure will be needed (DB instance, credentials, network) so it can be wired up in Terraform afterwards.
