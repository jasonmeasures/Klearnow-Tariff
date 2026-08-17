# US Tariff Rules — v1.1.0 (as of 2026-07-31)

Shared **United States** Chapter 99 / HTSUS rule pack for KlearNow tools.
Jurisdiction is US only (HTSUS Column 1, CBP Chapter 99, 19 CFR 141.68/141.69).
These are not customer- or brand-specific rules — any US entry tool can consume them.

| Module | What it covers | Entry |
|---|---|---|
| **Code registry** | Confirmed Ch.99 headings, rates, MFN interaction | `src/tariffRules.ts` + `data/ch99_codes.json` |
| **301-FL** | CSMS #69326983 — 60 origins, flat / combined-to-cap | `src/s301fl.ts` + `data/s301fl_pack.json` |
| **232 autos/parts** | Procl. 10908 annex — `9903.94.05` | `src/s232Autos.ts` + `data/s232_auto_parts_annex.json` |
| **232 vehicles** | CSMS #64624801 — passenger vehicles `9903.94.01` | `src/s232Vehicles.ts` + `data/s232_autos_vehicles.json` |
| **232 MHDV** | CSMS #66665333 — `9903.74.01/.02/.08` | `src/s232Mhdv.ts` + `data/s232_mhdv.json` |
| **232 wood** | CSMS #66492057 — `9903.76.xx` | `src/s232Wood.ts` + `data/s232_wood.json` |
| **232 semiconductors** | CSMS #67400472 — `9903.79.01` claim-gated | `src/s232Semiconductors.ts` + `data/s232_semiconductors.json` |
| **Ch99 stack engine** | Annex I reciprocal, EU `.19`/`.20` cap, China §301 fuzzy, IEEPA windows, §122 → 301-FL | `src/ch99Engine.ts` + `data/ch99_rules.json` |

## Layout

```
tariff-rules/
├── README.md
├── docs/
│   ├── RULES.md                 ← full stacking review pack (developers + compliance)
│   ├── RULES.html               ← shareable HTML (regenerate: node scripts/render-docs.mjs)
│   ├── FRAMEWORK.md             ← shareable contract for other apps
│   ├── RULES_ENGINE.md          ← Inditex / API hand-off
│   ├── CH99_ENGINE.md           ← how to call the Ch99 stack engine
│   └── OPEN_ITEMS.md
├── data/
│   ├── ch99_codes.json          ← Ch.99 code registry (incl. all 301-FL headings)
│   ├── program_status.json
│   ├── interaction_rules.json   ← stacking / precedence R1–R9
│   ├── s301fl_pack.json         ← CSMS #69326983 — 60 economies + exemptions
│   ├── ch99_rules.json          ← reciprocal / IEEPA / §301 / EU / §122 seed
│   └── hts_rates.json           ← HTSUS Column 1 rates (optional, large)
└── src/
    ├── tariffRules.ts           ← registry accessors + confirmed calc helpers
    ├── s301fl.ts                ← 301-FL flat / threshold assessor
    └── ch99Engine.ts            ← expectedChapter99 + rate-date + EU cap + 301-FL
```

## Quick start

```ts
import { assessLineCh99 } from "./src/ch99Engine.ts";
import { assessS301fl } from "./src/s301fl.ts";

const { expected } = assessLineCh99({
  coo: "ES",
  mfnPct: 16.6,
  rateDate: "2025-09-15",
});
// → 9903.02.19

const fl = assessS301fl("JP", 0.025); // col-1 as decimal
// → 9903.05.49 @ +10% (combined to 12.5%)
```

See [docs/CH99_ENGINE.md](docs/CH99_ENGINE.md).

## Hard constraints

1. **Never hardcode a rate.** Import from `data/` via the typed accessors.
2. **`status !== "CONFIRMED"` → no silent math** in the registry path. Use
   `assertComputable()`; route TBC codes to review.
3. **Trade-deal totals are blocked** until the MFN cap mechanic (R6) is resolved.
4. **IEEPA and §122 are dead prospectively** for live stacking after their end
   dates — the Ch99 engine still evaluates historical windows when you pass an
   earlier rate-determination date.
5. **232 metals** compute on a separate line (metal-content value).

## Provenance

- CSMS #69326983 (301-FL, effective 2026-07-24).
- SCOTUS IEEPA ruling 2026-02-20; §122 sunset 2026-07-24.
- Reciprocal / EU cap / China §301 seed aligned to EO 14326 / CBP CSMS guidance.
- 2026-07-31: pack published as shared US rules (not customer-branded).

Bump `version` in each JSON on any rule change and log it in the docs changelog.
