# KlearNow Tariff

US Chapter 99 duty allocation against the file-authored `tariff-rules` pack.
**Quick check first** (single HTS → stack), then multi-line / engines / scenarios.
Local build first. Rollout: **playground → WordPress (external) → engine framework**.
See [`DEPLOYMENT.md`](DEPLOYMENT.md) and [`wordpress/klearnow-duty-stack/`](wordpress/klearnow-duty-stack/).

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
| Playground internal | Auth0 | Full product for authors; Manage / Rule chat only if `admin` claim |
| Engine framework | Auth0 | Same roles as playground (later) |

Admin is never shown to guests or WordPress embeds. Admin claim: Auth0 `https://klearnow.com/roles` includes `admin`.

## Product surface

| Audience | Path |
|---|---|
| Most users | **Check duty** — HTS / origin / value / date → allocation |
| Catalog / ops | **HTS list** — Excel / CSV / JSON / paste → which rules apply (no value) |
| Authors | **Rule chat** — Claude drafts CSMS / tariff pack updates; Apply hot-reloads (no rebuild) |
| Power users | Advanced panel — multi-line, Auto vs Ch99 engines, scenario A/B |
| Authors / AI | **MCP** (`mcp/`) + `PUT /v1/admin/s301fl/...` — hot-update rules, no rebuild |
| Other systems | **HTTP API** — `GET /v1/openapi.json`, `GET /v1/hts/{code}`, `POST /v1/entries:assess` |

## Layout

| Path | Purpose |
|---|---|
| `backend/` | Express/TS API on `:8080` — assess, audit, rules, admin hot-reload, OpenAPI |
| `frontend/` | Vite PWA — Quick Check lead; no rule logic in the browser |
| `tariff-rules/` | Source of truth — codes, 301-FL pack, Ch99 reciprocal, HTS column-1 |
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

Baseline HTS table: place the classification workbook at repo root, then `cd backend && npm run import:hts`.

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
