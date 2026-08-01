/**
 * Import HTS_Classification_Table xlsx → tariff-rules/data/hts_rates.json
 *
 * Usage:
 *   npx tsx src/import_hts.ts [path-to-xlsx]
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OUT = join(ROOT, "tariff-rules/data/hts_rates.json");

const DEFAULT_XLSX = join(ROOT, "HTS_Classification_Table (5).xlsx");

type RateRow = {
  hts: string;
  start: string;
  end: string;
  col1_pct: number;
  desc?: string;
};

function excelSerialToIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const n = Number(s);
    if (Number.isFinite(n) && n > 20000) v = n;
    else return null;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel serial (UTC)
    const ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

function normalizeHts(v: unknown): string | null {
  const digits = String(v ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 10) return null;
  return digits.padEnd(10, "0").slice(0, 10);
}

function col1Pct(adValorem: unknown, formula: unknown): number | null {
  if (formula != null && formula !== "" && Number.isFinite(Number(formula))) {
    const f = Number(formula);
    // formula is typically decimal (0.068); if > 1 treat as already percent
    return f > 1 ? f : f * 100;
  }
  if (adValorem != null && adValorem !== "") {
    const n = Number(String(adValorem).replace(/%/g, "").trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function main() {
  const src = resolve(process.argv[2] || DEFAULT_XLSX);
  if (!existsSync(src)) {
    console.error(`HTS file not found: ${src}`);
    process.exit(1);
  }

  console.log(`Reading ${src}…`);
  const wb = XLSX.read(readFileSync(src), { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    range: 5, // skip extract metadata; row 5 is header in 0-index sheet_to_json with range
  });

  // range:5 means start at row index 5 as header — verify keys
  const sampleKeys = raw[0] ? Object.keys(raw[0]) : [];
  console.log(`Parsed ${raw.length} rows. Keys: ${sampleKeys.join(", ")}`);

  const rates: RateRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const r of raw) {
    const hts = normalizeHts(r["HTS No."] ?? r["HTS No"] ?? r["hts"]);
    const start = excelSerialToIso(r["Start Date"]);
    const end = excelSerialToIso(r["End Date"]) || "9999-12-31";
    const pct = col1Pct(r["C1 Ad Valorem"], r["C1 Ad Valorem formula"]);
    if (!hts || !start || pct == null) {
      skipped++;
      continue;
    }
    const key = `${hts}|${start}|${end}|${pct}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const desc = String(r["Description"] ?? "").trim();
    rates.push({
      hts,
      start,
      end,
      col1_pct: Math.round(pct * 10000) / 10000,
      ...(desc ? { desc: desc.slice(0, 80) } : {}),
    });
  }

  rates.sort((a, b) => a.hts.localeCompare(b.hts) || a.start.localeCompare(b.start));

  const payload = {
    version: "1.0.0",
    as_of: "2026-07-30",
    source: "HTS_Classification_Table (5).xlsx",
    row_count: rates.length,
    rates,
  };
  const json = JSON.stringify(payload);
  writeFileSync(OUT, json);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 16);
  console.log(
    `Wrote ${rates.length} unique rate windows → ${OUT} (${(json.length / 1e6).toFixed(1)} MB, skipped ${skipped}, hash ${hash})`,
  );
}

main();
