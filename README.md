# KlearNow Tariff

US Chapter 99 duty allocation against the file-authored `tariff-rules` pack.
**Quick check first** (single HTS → stack), then multi-line / engines / scenarios.
Local build first. Rollout: **playground → WordPress (external) → engine framework**.
See [`DEPLOYMENT.md`](DEPLOYMENT.md) and [`wordpress/klearnow-duty-stack/`](wordpress/klearnow-duty-stack/).

**Share for review**

| Audience | Document |
|----------|----------|
| Developers + compliance (rules sign-off) | [`tariff-rules/docs/RULES.md`](tariff-rules/docs/RULES.md) · **[HTML](tariff-rules/docs/RULES.html)** |
| Operators (how to use the app) | [`docs/USER_MANUAL.md`](docs/USER_MANUAL.md) · **[HTML](docs/USER_MANUAL.html)** |
| Other apps / API contract | [`tariff-rules/docs/FRAMEWORK.md`](tariff-rules/docs/FRAMEWORK.md) |

```bash
# Backend (port 8080)
cd backend && npm install && npm run dev

# Frontend PWA (port 3000 — proxies /v1 → 8080)
cd frontend && npm install && npm run dev
```

Open http://localhost:3000. Default API key: `dev-internal` (admin). Guest/external: `?embed=1&surface=external` or key `dev-external`.

## Access model

| Who | Sign-on | What they get |
|-----|---------|---------------|
| External (WordPress) | Auth0 optional · guest allowed | Duty stack / HTS list / Audit only · **5 stacks + 2 extracts / day** (50+10 when signed in) · **no admin** |
| Playground internal | Auth0 | Full product for authors; Manage / Rule chat / **Users** when DB role is `admin` |
| Engine framework | Auth0 | Same roles as playground (later) |

Admin is never shown to guests or WordPress embeds.

### Users & roles (optional PostgreSQL)

When `DATABASE_URL` (or `PGHOST`) is set, Auth0 only proves identity. **Roles live in the app `users` table** — not the Auth0 dashboard. Unprovisioned or disabled accounts get **403**.

- Bootstrap first admin(s): `ADMIN_BOOTSTRAP_EMAILS=you@klearnow.com`
- Auto-provision: signed-in Auth0 users get an **active** `user` row when `USER_AUTO_PROVISION=true` (default on for `SURFACE=playground`). Admins promote via Manage → Users. Set `USER_AUTO_PROVISION=false` for invite-only.
- Without a database, the app keeps the previous claims-based Auth0 roles (`https://klearnow.com/roles`)
- API keys (`dev-internal`, etc.) never hit the DB

Manage UI: **Manage → Users** (admin only). See [`DEPLOYMENT.md`](DEPLOYMENT.md) and [`docs/DB_USER_MANAGEMENT_PROMPT.md`](docs/DB_USER_MANAGEMENT_PROMPT.md).

## Product surface

| Audience | Path |
|---|---|
| Most users | **Check duty** — HTS / origin / value / date → allocation. Walkthrough: [`docs/USER_MANUAL.md`](docs/USER_MANUAL.md) |
| Catalog / ops | **HTS list** — Excel / CSV / JSON / paste → which rules apply, including 232 vehicles / MHDV / wood / semiconductors (no value) |
| Authors | **Rule chat** — Claude drafts CSMS / tariff pack updates; Apply hot-reloads (no rebuild) |
| Power users | Advanced panel — multi-line, Auto vs Ch99 engines, scenario A/B |
| Authors / AI | **MCP** (`mcp/`) + `PUT /v1/admin/s301fl/...` — hot-update rules, no rebuild |
| Other systems | **HTTP API** — `GET /v1/openapi.json`, `GET /v1/hts/{code}`, `POST /v1/entries:assess` |

## Layout

| Path | Purpose |
|---|---|
| `backend/` | Express/TS API on `:8080` — assess, audit, rules, admin hot-reload, OpenAPI |
| `frontend/` | Vite PWA — Quick Check lead; no rule logic in the browser |
| `tariff-rules/` | Source of truth — codes, 301-FL pack, Ch99 reciprocal, HTS column-1; **share [`docs/FRAMEWORK.md`](tariff-rules/docs/FRAMEWORK.md) + [`data/framework_contract.json`](tariff-rules/data/framework_contract.json)** with other apps until the shared Rules API lands |
| `mcp/` | MCP stdio server for Claude Desktop / Cursor |

## Rule chat (CSMS / tariff changes)

1. Put your Anthropic key in `backend/.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

2. Restart `cd backend && npm run dev`
3. Open **Rule chat** (or the floating Chat button)
4. Describe the notice → review the pending upsert → **Apply** (writes `s301fl_pack.json` and reloads)

MCP (`mcp/`) still works for Claude Desktop / Cursor in parallel.

Rules updates without rebuild:

```bash
cd mcp && npm install
TARIFF_API_URL=http://localhost:8080 TARIFF_API_KEY=dev-internal npm start
```

Wire the stdio server in Claude Desktop or Cursor MCP settings — full steps in [`mcp/README.md`](mcp/README.md).

Useful chat intents:

- Assess a single HTS for 301-FL
- Upsert a 301-FL economy (`upsert_s301fl_country`)
- Look up baseline Column-1 (`lookup_hts`)

## HTTP API (for other tools)

| Endpoint | Use |
|---|---|
| `GET /v1/hts/{code}?as_of=YYYY-MM-DD` | Baseline Column-1 rate |
| `POST /v1/entries:assess` | Duty stack (`engine`: `auto` \| `ch99`) |
| `POST /v1/entries:audit` | Filed vs required |
| `GET /v1/rules` | Browse materialized rules |
| `PUT /v1/admin/s301fl/countries/{iso2}` | Hot-update 301-FL (author key) |
| `POST /v1/admin/reload` | Reload caches after file edits |
| `GET /v1/openapi.json` | OpenAPI 3 contract |

Auth: header `X-API-Key: dev-internal`.

Baseline HTS table: **Manage → Upload** (admin) — drop the classification workbook (.xlsx) to replace Column-1 rates live, or paste CSV to merge rows. CLI still works: place the workbook at repo root, then `cd backend && npm run import:hts`.

## Packs in `tariff-rules/`

| Pack | Browse | Assess |
|---|---|---|
| Auto-parts stacking | Rules | `POST /v1/entries:assess` (default) |
| 301-FL by country | `?program=s301fl` | included in default assess; hot-editable via admin/MCP |
| Ch99 reciprocal / IEEPA | `?program=ch99` | `"engine":"ch99"` (process restart after editing `ch99_rules.json`) |

## Safety contract

1. **Never hardcode a rate** — import from `tariff-rules`.
2. **Non-`CONFIRMED` codes** do not compute silently.
3. **Trade-deal totals blocked** until R6 is resolved.
4. **IEEPA / Section 122** rejected prospectively.
5. **232 metals** use metal-content value.

## Tests

```bash
cd backend && npm test
```

## Later: kn-playground → WordPress → engine

1. Copy `backend/`, `frontend/`, `tariff-rules/`, `mcp/` → `kn-playground/applications/KlearNow-Tariff/`.
2. Set `APP_SURFACE=playground`, Auth0 env, Terraform SSO (repo owner).
3. WordPress: install `wordpress/klearnow-duty-stack` and point at Amplify URL with `?embed=1&surface=external`.
4. Engine framework reuses the same Auth0 apps / admin claim.

Also see [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Regression QA

Duty math, copy, and Quick Check chips are locked in `tariff-rules/data/qa_goldens.json`. CI runs this on every push/PR (`.github/workflows/qa.yml`).

```bash
cd backend && npm test          # all unit + golden + UI contract tests
cd backend && npm run qa:dump -- qc-de-pharma   # print current numbers after a stack change
```

When you change a stack, a claim, or the wording on a result:

1. Re-run the scenario in Quick Check and confirm it looks right.
2. If numbers or copy changed on purpose, update the matching `expect` in `qa_goldens.json` (or dump it).
3. If you add a Try-an-example chip, add it to `examples` **and** `frontend/index.html` — the UI contract test requires both.
4. `npm test` must pass before merge.

