# HTS flags + description paths (Quick Check)

Versioned under `tariff-rules/data/`. Surfaces on `GET /v1/hts/:hts`; UI lives in **Stack result → About this HTS** (not under the form).

## Flags from classification workbook

Source columns already on `HTS_Classification_Table` xlsx:

| Workbook | Pack field | User-facing notice |
|----------|------------|--------------------|
| `PGACD` | `pga_codes[]` | Agency name from ACE prefix (e.g. `FD*` → **FDA**, `AM*` → **USDA AMS**) — raw codes only in tooltip |
| `ADD` | `add` (Y only) | **Antidumping** — may apply; case rates not computed |
| `CVD` | `cvd` (Y only) | **Countervailing** — may apply; case rates not computed |
| `Add. HTS` | `add_hts` (Y only) | **Additional HTS** reporting may be required |
| `SPI` | *(not imported for QC)* | Preferential SPI stays in assess claims |

```bash
cd backend && npx tsx src/import_hts.ts "../HTS_Classification_Table (5).xlsx"
```

## Hierarchical description path (USITC)

Indent walk of USITC schedule JSON (`htsno` + `indent` + `description`), including superior-only rows with empty `htsno`.

```bash
cd backend && npx tsx src/import_hts_desc.ts /path/to/hts_YYYY_revision_N_json.json
# or
cd backend && npx tsx src/import_hts_desc.ts --url
```

Writes [`hts_desc_path.json`](../data/hts_desc_path.json). API returns `flags`, `desc_path`, `desc_full`.

**UI:** Rate / program pills stay under the Quick Check form. Description shows the full Cervo-style path by default; **Show hierarchy** opens the indent tree. Chapter titles (e.g. “Furniture; bedding…”) are often absent from the USITC JSON export — path usually starts at the heading.
