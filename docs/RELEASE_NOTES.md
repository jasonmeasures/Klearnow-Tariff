# KlearNow Tariff — Release notes

Operator-facing ship notes. Rules/compliance review pack: [`../tariff-rules/docs/RULES.md`](../tariff-rules/docs/RULES.md) · **[HTML](../tariff-rules/docs/RULES.html)**. How to use the app: [`USER_MANUAL.md`](./USER_MANUAL.md) · **[HTML](./USER_MANUAL.html)**.

In the live app: left nav **Release notes**, or top bar **What’s new**.

---

## 1.9.0 — 2026-08-31

**PGA Watch for · Coverage · collapsible Chapter 99 stack**

Playground: [kn-playground#93](https://github.com/klearnow/kn-playground/pull/93) · Local branch `feature/s232-packs-qa-csms` · Jira [CORE-84927](https://klearnow.atlassian.net/browse/CORE-84927)

### What’s new

- **About this HTS** on Duty stack Results — before or after you run:
  - **Watch for** — Partner Government Agency and trade-remedy signals from the classification table (FDA, USDA AMS, AD, CVD, additional HTS). Expand a row for filing notes and ACE codes; agency names are shown by default.
  - **Description** — readable path; **Show hierarchy** opens Heading → Subheading → Line.
- **Collapsible Chapter 99 / provision layers** — each layer starts collapsed; open one row or use **Expand all** for reason, source (CSMS / proclamation), and duty basis. The commodity row shows the real 10-digit HTS.
- **Coverage** (renamed from **HTS list**) — same bulk which-rules-apply flow, plus a **Watch for** column, expandable row detail, and CSV export of PGA / AD / CVD / additional-HTS flags.
- **Instructions & tooltips** — Quick directions, empty states, Coverage tips, and the user manual match the new UI.

### Data / API

- Classification flags and USITC description paths: `hts_rates.json` flags + `hts_desc_path.json`
- `GET /v1/hts/:hts` and `POST /v1/hts:coverage` return `flags` / Watch for fields
- Pack notes: [`../tariff-rules/docs/HTS_FLAGS_AND_DESC.md`](../tariff-rules/docs/HTS_FLAGS_AND_DESC.md)

### Not in this release

- Duty math for AD/CVD case rates (Watch for is a notice only)
- Auth / invite / RDS SSL changes on playground (preserved on sync)

### Try it

1. Duty stack — enter an HTS with PGA flags (e.g. food / FDA lines) → expand **Watch for** → **Run the stack** → **Expand all** on Chapter 99.
2. Coverage — paste a short HTS list → confirm **Watch for** column → open a row → export CSV.

---

## Earlier highlights

| Version | Date | Summary |
|---------|------|---------|
| **1.8.x** | 2026-08 | Section-stable Ch.99 order (CSMS #69668138); MHDV dual-list `9903.74.11`; Chapter 98 dutiable basis; UAS / QSP / 338 docs |
| **1.7.x** | 2026-08 | Duty stack UI restore + context-gated claims; Section 338 Canada |
| **1.5–1.6** | 2026-08 | 232 vehicle / MHDV / wood / semiconductor packs; operator manual |
