# KlearNow Tariff — User Manual

**Version 1.6.0 · as of 2026-08-24 · United States entries only**

This is the operator guide for the Duty stack app. For *why* a heading applies, share [`tariff-rules/docs/RULES.md`](../tariff-rules/docs/RULES.md) with compliance — that pack is written for review.

Shareable HTML (same content): [`USER_MANUAL.html`](./USER_MANUAL.html) — open in a browser or Print → PDF.

---

## 1. What this tool is

KlearNow Tariff builds the **US duty stack** for a classification: Column 1 (the ordinary HTS rate) plus every **Chapter 99** layer that should report — China 301, 301-FL, Section 232 (autos, vehicles, MHDV, wood, semiconductors, metals, patented pharma), Brazil 301, **Section 338 Canada** — in the order CBP expects.

It does **not** classify the product. You still need a correct 10-digit HTS. It will not invent a Column 1 rate for an unknown code, and it will not tick a claim (MHDV part, semiconductor Note 39 parameters, patented pharma) unless you do.

Typical uses:

| You have… | Use |
|-----------|-----|
| One HTS, origin, value, date | **Duty stack** |
| A spreadsheet of parts / SKUs | **HTS list** (which rules apply — no value needed) |
| An ACE ES-003 export | **Audit** (filed Ch.99 vs expected) |

---

## 2. Who sees what

| Who | Sign-on | What they get |
|-----|---------|---------------|
| Guest / WordPress embed | Optional Auth0 | Duty stack only. **5 stacks / 2 extracts per day.** Sign in for unlimited. No admin. |
| Signed-in user | Auth0 | Unlimited stacks. Full calculator; Chat / CSMS on the direct app (not the WordPress embed). |
| Admin | Auth0 + app role `admin` | Rules, Upload, Snapshots, Users. |

Local demo: open http://localhost:3000 with API key `dev-internal`. Use **View as** to preview user / guest. Playground / WordPress replace that switch with Auth0.

---

## 3. Duty stack (single HTS)

Open **Duty stack**. Fill in:

1. **HTS** — 10-digit statistical reporting number, with or without dots (`8708.10.3050` or `8708103050`).
2. **Origin** — type a name or ISO-2 (`Germany` or `DE`) and Tab.
3. **Entered value** — customs value in USD.
4. **Rate date** — Entry Date (or the date you want the stack as of). This picks the era (IEEPA / Section 122 / 301-FL) and whether a 232 program has started.

Then click **Run the stack**.

Under the fields, a preview line appears as you type the HTS:

- Column 1 rate and description
- China 301 list membership (from the 8-digit HTS)
- **232 list pills** — passenger vehicle, MHDV, bus, wood, auto-parts annex, metals
- USITC link

If Column 1 is a specific rate (¢/kg, etc.), a **quantity** field appears. If the HTS is in Chapters 72–74 / 76, a **metals** panel appears (content in USD or % of entered, plus melt/pour country).

### Claims (checkboxes that appear only when relevant)

| Checkbox | When you see it | When to tick it |
|----------|-----------------|-----------------|
| **232 auto part** | Off-list 8483 / 8708 / 8544 HTS (not on the Proclamation 10908 annex) | Tick to self-cert `9903.94.07`. On-annex HTS auto-applies — no checkbox. |
| **232 MHDV part** | HTS is on the MHDV **parts** list | Tick if the article is actually a part of a medium- or heavy-duty vehicle |
| **232 semiconductor (Note 39 params)** | HTS is `8471.50` / `8471.80` / `8473.30` | Tick only if TPP / DRAM bandwidth bands in U.S. note 39(b) are met |
| **25-year vehicle** | HTS is on the passenger or MHDV **vehicle/bus** list | Tick if manufactured ≥25 years before entry (0% additional 232) |
| **232 patented pharma** | Chapters 29 / 30 | Tick for patented articles under Proclamation 11020 |
| **Pharma use (9903.05.89)** | 301-FL pharma-use list | Tick for Note 52(e) pharmaceutical **use** — not the same as 232 pharma |
| **Claim FTA / USMCA** | Origin CA / MX / CAFTA | SPI S/S+ zeros Column 1 and MPF only — it does not automatically clear 232, 301-FL, or Section 338 |
| **Civil aircraft (General Note 6)** | HTS is on the Section 338 aircraft list | Reports `9903.03.16` @ 0% instead of the 50% 338 duty heading |
| **201 QSP over-quota** | Covered quartz surface product | Tick when the quarterly TRQ is exhausted (`9903.45.31`) |
| **232 UAS thermal** | Small-UAS annex II HTS | Tick if the aircraft integrates a thermal imager (`9903.08.21`) |

If no extra claim applies, the form says **No extra claims for this line** instead of a row of empty boxes. The China 301 list override appears only for CN / HK origins.

If a 232 program **auto-applies** from the published HTS list (passenger vehicle, MHDV truck, bus, wood, in-annex auto part), you do **not** need a checkbox. The stack will already include that heading and `9903.05.90` (301-FL suppressed).

### Reading the result

Each row is a layer: program, Chapter 99 code (or “commodity” for Column 1), rate, duty dollars, and a short reason with the CSMS / proclamation source.

- **Suppressed** layers (typical: 301-FL killed by 232) stay visible so you can see *why* they did not assess.
- **Diagnostics** warn when a list hit needs a claim, when metal content is missing, or when a trade-deal total is blocked (R6).
- **Chapter 99 sequence** is the reporting order (99 before 1–97; China 301 before 232 when both apply).

Use **Try an example** chips for a known-good VN apparel, CN auto-parts, or DE pharma stack.

### Multi-line and A/B

Open **Multi-line & scenarios** when you need several lines on one entry, a paste from Excel, or to pin two runs (for example with vs without an MHDV-part claim).

---

## 4. HTS list (which rules apply)

Open **HTS list** when you have many codes and want coverage — **not** duty dollars.

1. Set **Rate date**.
2. Optionally set **Default origin** (used when the sheet has no COO column). Origin is required for 301-FL and for the filed Chapter 99 sequence; 232 **list membership** still shows without it.
3. Drop Excel / CSV / JSON, or paste `hts,coo` (one code per line is fine).
4. Click **Find applicable rules**.

Recognised columns include `hts` / `primary_hts`, `coo` / origin, `part`, `sku`, date, `s232_mhdv_part`, `s232_semiconductor`, and the older `s232_auto_part` / China 301 list flags.

### What you will see

| Chip | Meaning |
|------|---------|
| Green 232 heading | Auto-applies from a published list (vehicle, bus, wood, in-annex auto part) |
| Orange heading **· claim** | On a claim-gated list (MHDV parts, semiconductors) — duty only if you certify the fact |
| 301-FL heading | Origin is in the Forced Labor pack — **suppressed** if 232 already won |
| **on a 232 list** / **need a claim** | Summary pills at the top of the results |

Click a row for the rule trail, Section 232 list hits, mapped replacements, and **Run stack for this HTS** (sends the line to Duty stack). **Export CSV** includes `s232_lists`.

**Load sample list** includes apparel, auto parts, a Japan passenger vehicle, an MHDV dump truck, a bus, Canadian lumber, VN wood furniture, and a Taiwan semiconductor stem so you can see auto vs claim chips.

Unknown 10-digit codes stay **blocked** for duty math (no invented Free rate). If that stem is on a 232 CSMS list, list membership still appears so you can see the new rules — then fix the statistical suffix via USITC / the suggested related codes.

---

## 5. Audit (ACE ES-003)

Open **Audit**, drop an ACE **Entry Summary Line Tariff Details** Excel, and run.

The tool groups lines by Entry Summary Number, uses each line’s **Entry Date** for the era, and compares filed Chapter 99 to the live stack.

| Check | What it means |
|-------|----------------|
| IEEPA / CAPE | `9903.01` / `.02` in the IEEPA window → refund candidates. After 2026-02-23 → dead program. |
| Missing Ch.99 | Expected heading (301-FL, 232, China 301, …) not filed. |
| Extra Ch.99 | Filed heading the current pack does not produce for that date. |
| Duty math | Computed stack vs filing (entered value from the commodity ordinal). |
| Needs inputs | Metals content is not on ES-003 — those lines cannot finish 232 metals math. |

China 301 uses HTS list membership, not a column on the report.

---

## 6. Other screens (authors / admins)

| Screen | Who | What |
|--------|-----|------|
| **Chat** | Users | Ask about an HTS / origin / pack rule. Stacks run from live tables. |
| **CSMS** | Users | Jump to CBP Cargo Systems Messaging Service. |
| **Rules** | Admin | Browse materialized rules; publish snapshots. A draft does not affect assessments until published. |
| **Upload** | Admin | Replace or merge the Column 1 HTS table (Excel / CSV) without a rebuild. |
| **Snapshots** | Admin | History of published packs. |
| **Users** | Admin | App roles (when PostgreSQL is configured). Auth0 only proves identity. |
| **Insights / API & ref** | Browse | Pack stats and claim-flag / OpenAPI reference. |

---

## 7. Eras at a glance (why the date field matters)

| Rate date | What dominates |
|-----------|----------------|
| 2025-02-04 → 2026-02-23 | IEEPA (historical / CAPE only — not live forward) |
| 2026-02-24 → 2026-07-23 | Section 122 10% surcharge (`9903.03.01`), entry-level |
| **From 2026-07-24** | **301-FL** (`9903.05.xx`) unless Section 232 already won |

Section 232 programs can apply in those windows too, on their own effective dates (vehicles from 2025-04-03, wood 2025-10-14, MHDV 2025-11-01, semiconductors 2026-01-15, patented pharma 2026-07-31).

---

## 8. Common questions

**Why did 301-FL disappear?**  
Section 232 and 301-FL are mutually exclusive. If the HTS is a valid 232 auto part, vehicle, MHDV, wood article, claimed semiconductor, metal, or patented pharma, the stack reports `9903.05.90` and does not assess 301-FL. China 301 (`9903.88`) still stacks.

**Section 338 Canada** (from 22 Aug 2026): listed products of Canada take an extra 50% (`9903.03.12` / `.13` / `.14`). USMCA does **not** turn that off. If a 232 heading already applies, the engine reports `9903.03.15` @ 0% instead. Civil aircraft needs the General Note 6 claim (`9903.03.16`). The 338 additional duty is drawback-eligible.

**Why is a Japan car 15% combined, not 25% additional?**  
Country of origin drives the 232 vehicle heading. Japan passenger vehicles from 16 Sep 2025 use `9903.94.41` (combined Column 1 + 232 = 15%) when Column 1 is under 15%. The parts heading `9903.94.43` is not used on a car. Other origins (Thailand, China, Vietnam, …) still use `9903.94.01` @ 25% additional. UK in-quota vehicles need the TRQ claim `s232_uk_auto_trq` for `9903.94.31`.

**Why didn’t MHDV parts add 25%?**  
The parts list is necessary but not sufficient — CBP also has a 0% heading for listed articles that are *not* MHDV parts. Tick **232 MHDV part** (or a `s232_mhdv_part` column on the spreadsheet) when the article really is an MHDV part.

**Why didn’t semiconductors add 25%?**  
HTS `8471.50` / `8471.80` / `8473.30` only puts you on the list. 25% requires a Note 39(b) TPP/DRAM claim. `8471.50` without that claim often follows the **auto-parts annex** instead.

**USMCA is claimed — why is there still 232 / 301-FL?**  
SPI S/S+ zeros Column 1 and MPF only. Other programs need their own Chapter 99 exception.

**The HTS is “not in the baseline table.”**  
The Column 1 workbook does not have that 10-digit statistical line (padded zeros are a common cause). Use the suggested related codes, the mapped replacement, or USITC — then re-run. 232 list hits may still show.

**Totals say blocked.**  
Trade-deal MFN cap (R6) is unresolved for some JP/EU/KR headings. Rates can still display; a single total duty figure is withheld until compliance signs that mechanic off.

---

## 9. Local run (developers)

```bash
cd backend && npm install && npm run dev    # :8080
cd frontend && npm install && npm run dev   # :3000, proxies /v1
```

Open http://localhost:3000. Tests: `cd backend && npm test`.

More: root [`README.md`](../README.md), [`DEPLOYMENT.md`](../DEPLOYMENT.md).
