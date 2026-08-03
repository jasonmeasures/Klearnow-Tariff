/**
 * Import HTS_Classification_Table xlsx → tariff-rules/data/hts_rates.json
 *
 * Captures Column-1 ad valorem % AND specific rates (¢/unit → USD/unit) + UOM.
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

export type RateRow = {
  hts: string;
  start: string;
  end: string;
  /** Column-1 ad valorem in percent points (2.5 = 2.5%). */
  col1_pct: number;
  /** Specific rate in USD per UOM1 unit (from formula; e.g. 0.84 = $0.84/bbl). */
  col1_specific_usd?: number;
  /** Specific rate as published cents (display). */
  col1_specific_cents?: number;
  uom1?: string;
  uom2?: string;
  duty_code?: string;
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

function col1Pct(adValorem: unknown, formula: unknown): number {
  if (formula != null && formula !== "" && Number.isFinite(Number(formula))) {
    const f = Number(formula);
    return f > 1 ? f : f * 100;
  }
  if (adValorem != null && adValorem !== "") {
    const n = Number(String(adValorem).replace(/%/g, "").trim());
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function specificUsd(cents: unknown, formula: unknown): {
  usd?: number;
  cents?: number;
} {
  let usd: number | undefined;
  let centsOut: number | undefined;
  if (cents != null && cents !== "") {
    const c = Number(String(cents).replace(/[^\d.]/g, ""));
    if (Number.isFinite(c)) {
      centsOut = c;
      // Prefer published cents (84 → $0.84/bbl) over float formula noise
      usd = c / 100;
    }
  }
  if (usd == null && formula != null && formula !== "" && Number.isFinite(Number(formula))) {
    const f = Number(formula);
    // formula is USD per unit (0.84); if > 20 treat as cents by mistake
    usd = f > 20 ? f / 100 : f;
  }
  if (usd != null) usd = Math.round(usd * 1e6) / 1e6;
  return { usd, cents: centsOut };
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
    range: 5,
  });

  console.log(`Parsed ${raw.length} rows. Keys: ${Object.keys(raw[0] || {}).join(", ")}`);

  const rates: RateRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let withSpecific = 0;

  for (const r of raw) {
    const hts = normalizeHts(r["HTS No."] ?? r["HTS No"] ?? r["hts"]);
    const start = excelSerialToIso(r["Start Date"]);
    const end = excelSerialToIso(r["End Date"]) || "9999-12-31";
    if (!hts || !start) {
      skipped++;
      continue;
    }
    const pct = col1Pct(r["C1 Ad Valorem"], r["C1 Ad Valorem formula"]);
    const spec = specificUsd(r["C1 Rate Specific"], r["C1 Rate Specific formula"]);
    const uom1 = String(r["UOM1"] ?? "").trim() || undefined;
    const uom2 = String(r["UOM2"] ?? "").trim() || undefined;
    const duty_code = r["Duty Code"] != null ? String(r["Duty Code"]) : undefined;
    const desc = String(r["Description"] ?? "").trim();

    if (pct === 0 && !(spec.usd && spec.usd > 0)) {
      // keep free goods so lookup still finds the row
    }
    if (spec.usd && spec.usd > 0) withSpecific++;

    const key = `${hts}|${start}|${end}|${pct}|${spec.usd ?? ""}|${uom1 ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const row: RateRow = {
      hts,
      start,
      end,
      col1_pct: Math.round(pct * 10000) / 10000,
    };
    if (spec.usd && spec.usd > 0) row.col1_specific_usd = spec.usd;
    if (spec.cents != null && spec.cents > 0) row.col1_specific_cents = spec.cents;
    if (uom1) row.uom1 = uom1;
    if (uom2) row.uom2 = uom2;
    if (duty_code) row.duty_code = duty_code;
    if (desc) row.desc = desc.slice(0, 80);
    rates.push(row);
  }

  rates.sort((a, b) => a.hts.localeCompare(b.hts) || a.start.localeCompare(b.start));

  const payload = {
    version: "1.1.0",
    as_of: "2026-08-03",
    source: "HTS_Classification_Table (5).xlsx",
    row_count: rates.length,
    with_specific: withSpecific,
    rates,
  };
  const json = JSON.stringify(payload);
  writeFileSync(OUT, json);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 16);
  console.log(
    `Wrote ${rates.length} windows (${withSpecific} with specific) → ${OUT} (${(json.length / 1e6).toFixed(1)} MB, skipped ${skipped}, hash ${hash})`,
  );
}

main();
