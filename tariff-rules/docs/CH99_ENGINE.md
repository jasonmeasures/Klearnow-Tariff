# US Chapter 99 stack engine

Pure evaluator for US Chapter 99 expectations — rate-determination date,
country reciprocal / IEEPA / China §301 / EU cap, and (on/after 2026-07-24)
Section 301 Forced Labor. No DOM, no XLSX, no product-brand assumptions.

## Files

| Path | Purpose |
|---|---|
| `data/ch99_rules.json` | Annex I / EU / China / India / §122 seed rows |
| `data/s301fl_pack.json` | Section 301 Forced Labor (CSMS #69326983) — 60 economies |
| `src/s301fl.ts` | Flat / combined-to-cap 301-FL assessor |
| `src/ch99Engine.ts` | Stack engine |

On/after **2026-07-24**, `expectedChapter99` layers **301-FL** via `assessS301fl`
(§122 replacement).

## Import

```ts
import {
  defaultCh99Rules,
  rulesInEffectOn,
  expectedChapter99,
  assessLineCh99,
  evaluateCh99Check,
  resolveRateDeterminationDate,
} from "../../tariff-rules/src/ch99Engine.ts";

const { expected, opts } = assessLineCh99({
  coo: "ES",
  hts: "6203.42.4010",
  mfnPct: 16.6,          // true HTSUS Col-1 — drives .19 vs .20
  rateDate: "2025-09-15",
});
// expected[0].ch99 === "9903.02.19"
```

## Surface

| Function | Role |
|---|---|
| `expectedChapter99(coo, hts, mfnPct, rules, opts)` | Expected Ch99 layers |
| `rulesInEffectOn(rules, isoDate)` | Effective-window filter |
| `resolveRateDeterminationDate(fields)` | 19 CFR 141.68/141.69 date |
| `resolveEuReciprocalLayer(mfn, rules, coo)` | `.19` / `.20` branch |
| `section301FlLayer(coo, mfnPct, rateDate)` | 301-FL after 2026-07-24 |
| `evaluateCh99Check(row)` | MATCH / MISMATCH / PARTIAL / REVIEW |
| `assessLineCh99({...})` | Convenience wrapper |
| `defaultCh99Rules()` | Cloned seed pack |

## Notes

- Pass the **true HTSUS Column 1** rate for EU `.19`/`.20` branching — not a
  replacement-duty figure from a 7501 column 33.
- China §301 list membership is HTS-specific; the engine emits a fuzzy
  `9903.88.*` marker and accepts any List 1/2/3/4A code as coverage.
- Bump `version` / `as_of` in `ch99_rules.json` when the seed changes.
