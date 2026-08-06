# KlearNow Rules Engine — Inditex Hand-off Pack

**Audience:** Inditex Audit / playground integration  
**Source of truth:** `tariff-rules/` (this repo) + assess API in `backend/`  
**Pack version:** rulepack ~1.1.x · stacking contract **1.3.0** · as of **2026-08-05**  
**Shareable framework (other apps):** [`FRAMEWORK.md`](./FRAMEWORK.md) + [`../data/framework_contract.json`](../data/framework_contract.json)  
**Companion narrative:** [`RULES.md`](./RULES.md) · [`CH99_ENGINE.md`](./CH99_ENGINE.md) · [`OPEN_ITEMS.md`](./OPEN_ITEMS.md)

Use this document to wire Inditex entry / ES-003 review against the same stacking logic as KlearNow Tariff (Duty stack). Prefer calling the API rather than re-implementing rates in the Inditex Python app.

---

## 1. What the engine is

A **US Chapter 99 duty-stack evaluator**: given HTS, origin (COO), entered value, metal content (when needed), and **rate-determination date** (Entry Date proxy under 19 CFR 141.68/141.69), it returns:

1. Expected Ch.99 layers (codes + rates + basis)
2. Stacking notes (suppressions, wrong-era filings)
3. Filed-vs-required audit (ES-003 / multi-line entries)

**Nothing in the browser invents rates.** Rates and interactions live in JSON packs under `tariff-rules/data/`; TypeScript materializes them.

| Path | Role |
|------|------|
| `tariff-rules/data/program_status.json` | Live / sunset / struck programs |
| `tariff-rules/data/interaction_rules.json` | R1–R9 stacking contract |
| `tariff-rules/data/ch99_codes.json` | ~120 Ch.99 code registry |
| `tariff-rules/data/s301fl_pack.json` | 301-FL · 60 economies (CSMS #69326983) |
| `tariff-rules/data/ch99_rules.json` | Ch99 reciprocal / IEEPA-era seed (~83 rules) |
| `tariff-rules/data/s301_china_lists.json` | Legacy China 301 list membership |
| `tariff-rules/data/hts_rates.json` | Column-1 baseline (import workbook) |
| `backend/src/assess.ts` | Auto-parts stacking engine |
| `backend/src/programEras.ts` / `rulesContract.ts` | Era windows + machine contract |
| `tariff-rules/src/ch99Engine.ts` | Alternate Ch99 reciprocal engine |

### Engines (request `engine`)

| Id | Use |
|----|-----|
| `auto` (default) | Auto-parts stacking + 301-FL by COO + 232 / China 301 / Sec 122 eras |
| `ch99` | Pure Ch99 reciprocal / IEEPA pack evaluator |

---

## 2. Filing eras (Entry / rate date)

Calendar days are **inclusive**. Rate date selects the window.

| Era | Dates | Primary layer | Ch.99 |
|-----|-------|---------------|-------|
| Pre-IEEPA | before 2025-02-04 | Baseline / other | — |
| **IEEPA** | 2025-02-04 → **2026-02-23** | CAPE / refund only — **not** live forward | `9903.01.xx` / `9903.02.xx` |
| **Section 122** | **2026-02-24** → **2026-07-23** | 10% surcharge | `9903.03.01` |
| **301-FL** | from **2026-07-24** | Forced Labor 301 (replaces 122) | `9903.05.xx` |

**Boundary days (do not drift):**

- Last IEEPA day: `2026-02-23`
- First Sec 122 day: `2026-02-24`
- Last Sec 122 day: `2026-07-23`
- First 301-FL day: `2026-07-24`

Filing IEEPA after 2026-02-23, or Sec 122 on/after 2026-07-24, is a **WRONG_ERA** error in audit.

---

## 3. Program status (legal landscape)

| Program | Family | Status | Compute? |
|---------|--------|--------|----------|
| IEEPA | `9903.01.xx` | **STRUCK_DOWN** (SCOTUS 2026-02-20) | No (prospective) |
| Section 122 | `9903.03.01` | **SUNSET** 12:01 a.m. 2026-07-24 | Historical only |
| **301-FL** | `9903.05.xx` | **ACTIVE** (CSMS #69326983) | Yes |
| **232 autos/parts** | Procl. 10908 / `9903.94` / exclusions | **ACTIVE** | Yes |
| **232 metals** | `9903.82.xx`, `9903.03.06` | **ACTIVE** | Yes (own line) |
| **China 301 legacy** | `9903.88.xx` | **ACTIVE** | Yes |
| Brazil 301 | `9903.05.01` | **ACTIVE** | Yes |
| Trade deals JP/EU/KR | `9903.94.43/.45/.55/.63` | Rate known · MFN mechanic TBC | **No totals** until R6 |

---

## 4. Stacking contract (must match Inditex)

Authoritative IDs: `interaction_rules.json` + `STACKING_CONTRACT` in `backend/src/rulesContract.ts`.

### R1 — 232 vs 301-FL
Mutually exclusive. **232 wins.** Report `9903.05.90` to suppress 301-FL.  
232 determination is **10-digit annex** (Proclamation 10908 / U.S. note 33) — chapter match is triage only. Machine list: `tariff-rules/data/s232_auto_parts_annex.json`. **In-annex HTS auto-applies 232** (suppresses 301-FL via `9903.05.90`). Off-list needs `flags.s232_auto_part` with evidence. Note: `8544.30.00` is in-annex; **`8544.42.xx` is not**.

### R2 — China 301 not suppressed
Legacy China 301 (`9903.88.xx`) is **not** suppressed by 232 or Sec 122. Both report; **301 first**.  
Example: CN 8708 List 3 @ 2.5% col-1 → 25% + 25% + 2.5% = **52.5%**.  
Also stacks with Sec 122 when the line is outside the 232 universe.

### R2b — Sec 122 vs 232
Sec 122 does **not** stack with 232 autos/parts or 232 metals. Report `9903.03.06`; suppress `9903.03.01`. China 301 still reports (R2).

### R3 — Japan 232 top-up
If col-1 &lt; 15%, 232 tops up to 15% via `9903.94.43` (15% on Ch.99; **zero** on Ch.1–97).  
Non-232 JP part → 301-FL family (e.g. threshold / flat) instead.

### R4 — Metals separate line
232 metals on a **separate ESL** vs metal-content (or entered value for derivatives). Excluded from parts TOTAL.

- **R4a** `9903.82.02` — primary metal articles: **+50% on metal-content** (needs content + melt/pour).
- **R4b** `9903.82.09` — copper / derivative alu+steel (U.S. note 16): **+25% on entered value**. Claim-gated outside Ch.72–76 when filed.
- **R4c** Sec 122 is **entry-level**: `9903.03.01` on **any ESL** of an Entry Summary Number satisfies the entry (not per-line).

### R5 — Metals vs autos on Ch.73/74
**TBC** — conflicting published guidance.

### R6 — Trade-deal MFN cap
**BLOCKING** for trade-deal totals. Unresolved: (A) MFN zeroed vs (B) conditional cap. Engine throws / refuses total until resolved.

### R7 — `9903.94.xx` program label
232 autos vs IEEPA/trade-deal framing — labeling TBC (rates may still be confirmed).

### R8 — HTS authority (Subaru / Inditex data)
Parts: **Item Master only** (BL10 HTS inaccurate). Vehicles: HA30 `primary_tariff_num`, Item Master fallback.

### R9 — AD/CVD
Outside Ch.99 stack computation; flag for producer/exporter case coverage.

### Reporting order
CBP: Ch.99 lines before Ch.1–97. Where China 301 and 232 both apply, **301 reports first**.

---

## 5. Rule inventory (machine tables)

Counts from pack on disk (refresh after hot-reload):

| Dataset | Approx. size |
|---------|----------------|
| Ch.99 codes (`ch99_codes.json`) | **120** codes (114 CONFIRMED; 6 rate-confirmed / mechanic or program TBC) |
| 301-FL economies | **60** |
| Ch99 reciprocal seed rules | **~83** |
| Interaction rules | **R1–R9** |
| Materialized assess rules (API `/v1/rules`) | **~270+** |

### Registry by program (summary)

#### SEC_122
| Code | Rate | Status |
|------|------|--------|
| `9903.03.01` | 10% | CONFIRMED |

#### SEC_232_METALS
| Code | Rate | Kind |
|------|------|------|
| `9903.03.03` / `9903.03.06` | 0% | EXCLUSION (122 vs 232) |
| `9903.82.01` / `.03` | 0% | EXCLUSION |
| `9903.82.02` | 50% | DUTY (metal content) |
| `9903.82.06` | 10% | DUTY |
| `9903.82.09` | 25% | DUTY (entered value) |

#### SEC_232_AUTOS
| Code | Rate | Kind |
|------|------|------|
| `9903.74.11` | 0% | EXCLUSION (med/heavy parts) |

#### SEC_301_CHINA_LEGACY
| Code | Rate | Notes |
|------|------|--------|
| `9903.88.01` | 25% | List 4A-style family (see lists JSON) |
| `9903.88.02` | 25% | |
| `9903.88.03` | 25% | List 3 |
| `9903.88.15` | 7.5% | List 4A |

Full list membership: `s301_china_lists.json` (HTS → list).

#### SEC_301_FL
`9903.05.20`–`.xx` — **101** codes (flats, thresholds, zeros, suppression `9903.05.90`). Economy → code mapping in `s301fl_pack.json`.

#### Trade deals / TBC labeling
| Code | Rate | Status |
|------|------|--------|
| `9903.94.43` / `.55` | 15% | JP · CONFIRMED_RATE_TBC_MECHANIC |
| `9903.94.45` | 15% | EU · same |
| `9903.94.63` | 15% | KR · same |
| `9903.94.05` / `.07` | 25% | CONFIRMED_RATE_TBC_PROGRAM |

Authoritative rows: always read `ch99_codes.json` rather than copying this table into Inditex forever.

---

## 6. How Inditex should call it

### Prefer HTTP (local / playground)

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness (EB) |
| `GET /v1/config` | Surface, Auth0, quotas |
| `GET /v1/hts/{code}?as_of=YYYY-MM-DD` | Column-1 baseline |
| `POST /v1/entries:assess` | **Duty stack** (lines[]) |
| `POST /v1/entries:audit` | Filed vs required |
| `POST /v1/entries:es003` / audit ingest | ACE ES-003 multi-entry review |
| `POST /v1/coverage` | HTS list extract (quotas on external) |
| `GET /v1/rules` | Browse materialized rules |
| `GET /v1/openapi.json` | Contract |

**Minimal assess body:**

```json
{
  "engine": "auto",
  "as_of": "2026-08-01",
  "lines": [
    {
      "hts": "8708998180",
      "coo": "JP",
      "value": 1000,
      "claims": { "is_232_auto_part": true }
    }
  ]
}
```

Auth (playground): Auth0 Bearer. Local: `X-API-Key: dev-internal` (admin).

### Optional: embed packs

If Inditex must stay offline, treat `tariff-rules/data/*.json` as read-only inputs and do **not** fork rate math without tracking `interaction_rules.json` version. Prefer MCP / hot-reload against the Tariff API for authors.

### Field mapping tips (Inditex → engine)

| Inditex / ACE | Engine |
|---------------|--------|
| Entry date / rate date | `as_of` / line `rate_date` |
| HTS (10-digit) | `hts` (Item Master for parts — R8) |
| Country of origin | `coo` (ISO-2) |
| Entered value | `value` |
| Metal content $ / % | metal-content fields for `9903.82.02` |
| Filed Ch.99 on ESL | audit / ES-003 `filed` codes |
| Entry Summary Number | groups ESLs for entry-level Sec 122 (R4c) |

---

## 7. Safety contract (do not violate in Inditex)

1. **Never hardcode a rate** — import from `tariff-rules` or call the API.
2. **Non-`CONFIRMED` codes** do not compute silently.
3. **Trade-deal totals blocked** until R6 (MFN cap) is resolved.
4. **IEEPA / Section 122** rejected prospectively outside their eras.
5. **232 metals** use metal-content value where required (`9903.82.02`); `9903.82.09` uses entered value.

---

## 8. Open items (blocking / owners)

Copied from [`OPEN_ITEMS.md`](./OPEN_ITEMS.md) — resolve before claiming Inditex “full stack” parity on affected lines.

| # | Item | Blocking? | Owner |
|---|------|-----------|-------|
| 1 | **MFN cap mechanic** on trade-deal codes (`9903.94.43/.45/.55/.63`) | **YES** (totals) | Jason |
| 2 | `9903.94.xx` program labeling (232 vs IEEPA/trade-deal) | Labeling | Jason / Marek |
| 3 | 232 auto-part **10-digit** determinations (Tier 2 / general-purpose) | 232 vs 301-FL routing | Subaru / Marek |
| 4 | 232 metals vs autos on Ch.73/74 | Metal lines | Marek / Vantage Point |
| 5 | Korea / Taiwan bilateral 232 heading assignment | KR/TW lines | Jason |
| 6 | ~~Brazil 301 heading confirmation~~ → `9903.05.01` | — | — |
| 7 | Japan column-1 PENDING rows in workbook | Workbook totals | Jason |
| 8 | China legacy 301 / IEEPA-era heading on outlier CN lines | CN lines | Jason |
| 9 | AD/CVD case coverage | Separate | Marek |

---

## 9. Suggested Inditex file placement

Copy this pack into Inditex Audit as e.g.:

```
inditex-audit-main/docs/KLEARNOW_RULES_ENGINE.md
```

Or keep a short pointer in `USER_MANUAL.md` / `SETUP.md`:

> Duty stack / Ch.99 expectations are owned by **KlearNow Tariff**  
> (`kn-playground/applications/KlearNow-Tariff` or this `tariff-rules` pack).  
> See `RULES_ENGINE.md`. Do not duplicate rates in `inditex_audit_server.py`.

---

## 10. Changelog (engine pack for Inditex)

- **2026-08-04** — Inditex hand-off pack: eras, R1–R9, inventory, API map, open items.
- **2026-08-03** — Stacking contract 1.2.0: Sec 122 entry-level; China 301 + Sec 122; `9903.82.09`; ES-003 era bugs fixed.
- **2026-07-31** — Initial `RULES.md` / `OPEN_ITEMS.md` / program_status cut.

---

*Machine truth: `tariff-rules/data/*` + `backend/src/rulesContract.ts`. If prose and JSON disagree, JSON wins.*
