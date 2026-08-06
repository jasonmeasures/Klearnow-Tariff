# KlearNow Tariff Stacking Rules — Narrative Reference

Version 1.0.0 · as of 2026-07-31 · machine tables live in `../data/`

> **Inditex / integration hand-off:** see [`RULES_ENGINE.md`](./RULES_ENGINE.md) (eras, stacking contract, inventory, API map, open items).

## 1. Legal landscape (what's alive, what's dead)

| Program | Ch.99 family | Status |
|---|---|---|
| IEEPA | 9903.01.xx | **Struck down** — SCOTUS 2026-02-20 held IEEPA does not authorize tariffs. Whole layer gone prospectively, incl. 9903.01.33 auto-parts carve-out. Ruling did not touch 232 or 301. |
| Section 122 | 9903.03.01 (as surcharge) | **Sunset** 12:01 a.m. 2026-07-24 (150-day statutory limit, no extension). |
| 301-FL | 9903.05.xx | **Live** 2026-07-24 (CSMS #69326983). Functional replacement for 122 — no sunset. |
| 232 autos/parts | Procl. 10908 | **Live.** Master switch for the whole stack. |
| 232 metals | 9903.03.xx / .85.xx | **Live.** Separate entry line, metal-content value. |
| Legacy China 301 | 9903.88.xx | **Live.** Not suppressed by 232. |
| Brazil 301 | 9903.05.01 | **Live** from 2026-07-22 @ 25% (CSMS #69302472). Exemptions `.02`–`.09`. Stacks with 301-FL `.27`. |

## 2. Core interactions

**R1 — 232 vs 301-FL: mutually exclusive, 232 wins.** When a line is a valid
232 auto part, report 9903.05.90 to suppress 301-FL. The 232 determination is
10-digit specific against the Proclamation 10908 annex — chapter membership is
triage, not a determination. General-purpose parts not specifically intended
for automotive use fall outside scope.

**R2 — Legacy China 301 is not suppressed.** Both report, 301 first.
Worked: CN 8708 List 3 @ 2.5% col-1 → 25% + 25% + 2.5% = **52.5%**.

**R3 — Japan 232 top-up.** Col-1 < 15% is brought up to 15% via 9903.94.43,
15% on the Ch.99 line, **zero** on the Ch.1–97 line.
Worked: JP part @ 2.5% col-1 → 232 of 12.5% → **15.0%** total.
Same part *not* a 232 auto part → 9903.05.49 (+10%) → **12.5%** total.
The 232 determination is worth 2.5 pts either way on Japan — far more elsewhere
(15% JP cap vs 25% default 232 vs 12.5% flat 301-FL).

**R4 — Metals on a separate line.** 232 steel/aluminum reports against
metal-content value; excluded from parts TOTAL.

**R8 — HTS authority.** Parts: Item Master only (BL10 HTS is inaccurate).
Vehicles: HA30 `primary_tariff_num`, Item Master fallback.

## 3. Ch.99 code registry (summary — authoritative copy in data/ch99_codes.json)

| Code | Program | Rate | MFN | Status |
|---|---|---|---|---|
| 9903.03.06 | 232 metals exclusion | 0% | normal | ✅ |
| 9903.03.03 | 232 metals exclusion | 0% | normal | ✅ |
| 9903.03.01 | Steel duty | 10% | normal | ✅ |
| 9903.74.11 | Med/heavy parts exclusion | 0% | normal | ✅ |
| 9903.82.02 | Sec. 301 | 50% | normal | ✅ |
| 9903.88.01 | China 301 List 4A | 25% | normal | ✅ |
| 9903.88.03 | China 301 List 3 | 25% | normal | ✅ |
| 9903.94.05 | ⚠ label TBC | 25% | stacks | rate ✅ / program ⚠ |
| 9903.94.07 | ⚠ label TBC | 25% | capped | rate ✅ / mechanic ⚠ |
| 9903.94.43 | JP trade deal | 15% | capped | rate ✅ / mechanic ⚠ |
| 9903.94.45 | EU trade deal | 15% | capped | rate ✅ / mechanic ⚠ |
| 9903.94.55 | JP trade deal | 15% | capped | rate ✅ / mechanic ⚠ |
| 9903.94.63 | KR trade deal | 15% | capped | rate ✅ / mechanic ⚠ |
| 9903.05.27 | 301-FL flat | 12.5% | normal | ✅ |
| 9903.05.49 | 301-FL threshold | +10% | normal | ✅ |
| 9903.05.90 | 301-FL suppression | 0% | normal | ✅ |

## 4. Review tiers (from the 2026-07-27 full-stack analysis, 251 lines)

- **Tier 1** (15 lines, Ch. 39/49/82/91): 232 auto-part claim fails on chapter scope — reject.
- **Tier 1b** (1 line, 7419 copper).
- **Tier 2** (211 lines): in annex chapters but unconfirmed at 10 digits;
  104 general-purpose-heading lines need part-number-level evidence from Subaru.
- **Tier 3** (22 lines, Ch. 73 steel derivatives): autos-vs-metals precedence — Marek.
- **Tier 4** (2 US-origin lines).
- **AD/CVD:** 45 lines flagged in ACE — producer/exporter case coverage verification.

Key finding: Subaru's blanket "everything is a 232 auto part" claim **raises** duty
on every line (15% JP 232 cap vs 12.5% 301-FL; 25% default 232 vs 12.5% flat),
costs ~15.36 aggregate pts across 246 priced lines (~6.2 pts/line avg),
forfeits drawback on the 232 portion, and is a misdeclaration risk.

## Changelog

- **1.0.0 (2026-07-31)** — initial repo cut from the 2026-07-27 full-stack build
  and 2026-07-30 code corrections. Open items carried into OPEN_ITEMS.md.
