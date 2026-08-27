/**
 * Import HTS_Classification_Table xlsx → tariff-rules/data/hts_rates.json
 *
 * Captures Column-1 ad valorem % AND specific rates (¢/unit → USD/unit) + UOM.
 *
 * CLI:
 *   npx tsx src/import_hts.ts [path-to-xlsx]
 *
 * Library: importHtsFromBuffer / mergeHtsRateRows for admin Upload UI.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
/** Default live pack path — prefer resolvedHtsRatesPath() for reads/writes. */
export const HTS_RATES_PATH = join(ROOT, "tariff-rules/data/hts_rates.json");
export const HTS_REPLACEMENTS_PATH = join(ROOT, "tariff-rules/data/hts_replacements.json");
const DEFAULT_XLSX = join(ROOT, "HTS_Classification_Table (5).xlsx");

/** Allow tests to redirect writes via TARIFF_HTS_RATES_PATH (never clobber the live pack). */
export function resolvedHtsRatesPath(): string {
  return process.env.TARIFF_HTS_RATES_PATH || HTS_RATES_PATH;
}

export function resolvedHtsReplacementsPath(): string {
  return process.env.TARIFF_HTS_REPLACEMENTS_PATH || HTS_REPLACEMENTS_PATH;
}

function assertTestSafeWrite(path: string, livePath: string, label: string) {
  if (process.env.NODE_TEST_CONTEXT && path === livePath) {
    throw new Error(
      `Refusing to write live ${label} during tests. Set ${
        label.includes("replacement") ? "TARIFF_HTS_REPLACEMENTS_PATH" : "TARIFF_HTS_RATES_PATH"
      } to a temp file before merge/import.`,
    );
  }
}

export type ReplacementRow = {
  from: string;
  to: string;
  effective?: string;
  note?: string;
};

export type ReplacementPack = {
  version: string;
  as_of: string;
  source: string;
  row_count: number;
  replacements: ReplacementRow[];
};

const REPLACEMENT_KEYS = [
  "Replacement HTS",
  "Replacement HTS No.",
  "Replacement",
  "Successor HTS",
  "Successor",
  "Replaced By",
  "New HTS",
  "New HTS No.",
  "replacement_hts",
  "successor_hts",
  "successor",
  "replaced_by",
];

function pickReplacementHts(row: Record<string, unknown>): string | null {
  for (const k of REPLACEMENT_KEYS) {
    if (row[k] != null && String(row[k]).trim()) {
      return normalizeHts(row[k]);
    }
  }
  // Case-insensitive header match (CSV / alternate workbooks)
  for (const [k, v] of Object.entries(row)) {
    const nk = k.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (
      [
        "replacement_hts",
        "replacement_hts_no",
        "replacement",
        "successor_hts",
        "successor",
        "replaced_by",
        "new_hts",
        "new_hts_no",
      ].includes(nk)
    ) {
      const n = normalizeHts(v);
      if (n) return n;
    }
  }
  return null;
}

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

export type HtsPack = {
  version: string;
  as_of: string;
  source: string;
  row_count: number;
  with_specific?: number;
  rates: RateRow[];
};

export type ImportResult = {
  path: string;
  row_count: number;
  with_specific: number;
  skipped: number;
  source: string;
  as_of: string;
  hash: string;
  bytes: number;
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
      usd = c / 100;
    }
  }
  if (usd == null && formula != null && formula !== "" && Number.isFinite(Number(formula))) {
    const f = Number(formula);
    usd = f > 20 ? f / 100 : f;
  }
  if (usd != null) usd = Math.round(usd * 1e6) / 1e6;
  return { usd, cents: centsOut };
}

function rateKey(r: RateRow): string {
  return `${r.hts}|${r.start}|${r.end}|${r.col1_pct}|${r.col1_specific_usd ?? ""}|${r.uom1 ?? ""}`;
}

/** Parse classification workbook buffer into RateRow[] (+ optional replacements). */
export function parseHtsClassificationWorkbook(buf: Buffer): {
  rates: RateRow[];
  replacements: ReplacementRow[];
  skipped: number;
  with_specific: number;
  keys: string[];
} {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    range: 5,
  });

  const rates: RateRow[] = [];
  const replacementByFrom = new Map<string, ReplacementRow>();
  const seen = new Set<string>();
  let skipped = 0;
  let withSpecific = 0;
  const keys = Object.keys(raw[0] || {});

  for (const r of raw) {
    const hts = normalizeHts(r["HTS No."] ?? r["HTS No"] ?? r["hts"] ?? r["HTS"]);
    const start = excelSerialToIso(r["Start Date"] ?? r["effective_start"] ?? r["start"]);
    const end =
      excelSerialToIso(r["End Date"] ?? r["effective_end"] ?? r["end"]) || "9999-12-31";
    if (!hts || !start) {
      skipped++;
      continue;
    }
    const pct = col1Pct(
      r["C1 Ad Valorem"] ?? r["col1_rate_pct"] ?? r["Col1"],
      r["C1 Ad Valorem formula"],
    );
    const spec = specificUsd(
      r["C1 Rate Specific"] ?? r["col1_specific_amount"],
      r["C1 Rate Specific formula"],
    );
    const uom1 =
      String(r["UOM1"] ?? r["col1_specific_uom"] ?? r["unit_of_quantity"] ?? "").trim() ||
      undefined;
    const uom2 = String(r["UOM2"] ?? "").trim() || undefined;
    const duty_code = r["Duty Code"] != null ? String(r["Duty Code"]) : undefined;
    const desc = String(r["Description"] ?? r["description"] ?? "").trim();

    if (spec.usd && spec.usd > 0) withSpecific++;

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

    const key = rateKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rates.push(row);

    const to = pickReplacementHts(r);
    if (to && to !== hts) {
      const prev = replacementByFrom.get(hts);
      const effective = end !== "9999-12-31" ? end : start;
      // Prefer the mapping attached to the latest-ending window.
      if (!prev || (effective && (!prev.effective || effective >= prev.effective))) {
        replacementByFrom.set(hts, {
          from: hts,
          to,
          effective,
          note: desc ? `From workbook · ${desc.slice(0, 60)}` : "From classification workbook",
        });
      }
    }
  }

  rates.sort((a, b) => a.hts.localeCompare(b.hts) || a.start.localeCompare(b.start));
  return {
    rates,
    replacements: [...replacementByFrom.values()],
    skipped,
    with_specific: withSpecific,
    keys,
  };
}

/** Normalize CSV-style upload rows (Manage → Upload) into RateRow[] (+ replacements). */
export function normalizeCsvHtsRows(
  rows: Array<Record<string, unknown>>,
): { rates: RateRow[]; replacements: ReplacementRow[]; problems: string[] } {
  const rates: RateRow[] = [];
  const replacements: ReplacementRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const seenRepl = new Set<string>();

  rows.forEach((o, i) => {
    const hts = normalizeHts(o.hts ?? o.from);
    const start =
      excelSerialToIso(o.effective_start ?? o.start ?? o.as_of) ||
      String(o.effective_start || o.start || "").slice(0, 10) ||
      null;

    const to = pickReplacementHts(o) || normalizeHts(o.to);
    if (hts && to && to !== hts && !seenRepl.has(hts)) {
      seenRepl.add(hts);
      const effective =
        excelSerialToIso(o.effective ?? o.replacement_effective) ||
        (start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : undefined);
      replacements.push({
        from: hts,
        to,
        effective: effective || undefined,
        note: String(o.note ?? o.replacement_note ?? "").trim() || "From CSV upload",
      });
    }

    // Pure replacement rows (from/to only) are fine without a rate window.
    const hasRate =
      o.col1_rate_pct != null ||
      o.col1_pct != null ||
      o.effective_start != null ||
      o.start != null;
    if (!hasRate && to) return;

    if (!hts) {
      problems.push(`row ${i + 1}: invalid hts`);
      return;
    }
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      problems.push(`row ${i + 1}: effective_start required (YYYY-MM-DD)`);
      return;
    }
    const end =
      excelSerialToIso(o.effective_end ?? o.end) ||
      String(o.effective_end || o.end || "9999-12-31").slice(0, 10) ||
      "9999-12-31";
    const pctRaw = o.col1_rate_pct ?? o.col1_pct ?? 0;
    const pct = Number(String(pctRaw).replace(/%/g, "").trim());
    if (!Number.isFinite(pct)) {
      problems.push(`row ${i + 1}: col1_rate_pct is not a number`);
      return;
    }
    const row: RateRow = {
      hts,
      start,
      end,
      col1_pct: Math.round(pct * 10000) / 10000,
    };
    const specAmt = o.col1_specific_amount ?? o.col1_specific_usd;
    if (specAmt != null && specAmt !== "") {
      const n = Number(specAmt);
      if (Number.isFinite(n) && n > 0) {
        // CSV often uses dollars; if > 20 treat as cents
        row.col1_specific_usd = n > 20 ? Math.round((n / 100) * 1e6) / 1e6 : Math.round(n * 1e6) / 1e6;
        if (n > 20) row.col1_specific_cents = n;
      }
    }
    const uom = String(o.col1_specific_uom ?? o.unit_of_quantity ?? o.uom1 ?? "").trim();
    if (uom) row.uom1 = uom;
    const desc = String(o.description ?? o.desc ?? "").trim();
    if (desc) row.desc = desc.slice(0, 80);

    const key = rateKey(row);
    if (seen.has(key)) return;
    seen.add(key);
    rates.push(row);
  });

  return { rates, replacements, problems };
}

export function writeReplacementsPack(opts: {
  replacements: ReplacementRow[];
  source: string;
  as_of?: string;
  version?: string;
}): { path: string; row_count: number; as_of: string; source: string } {
  const path = resolvedHtsReplacementsPath();
  assertTestSafeWrite(path, HTS_REPLACEMENTS_PATH, "hts_replacements.json");
  const as_of = (opts.as_of || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const payload: ReplacementPack = {
    version: opts.version || "1.0.0",
    as_of,
    source: opts.source,
    row_count: opts.replacements.length,
    replacements: opts.replacements
      .slice()
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
  };
  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n");
  return {
    path,
    row_count: payload.row_count,
    as_of,
    source: opts.source,
  };
}

/**
 * Upsert successor mappings by `from` HTS. Pass replace=true to wipe prior map first.
 */
export function mergeHtsReplacements(
  incoming: ReplacementRow[],
  opts: { source: string; as_of?: string; replace?: boolean },
): { upserted: number; row_count: number; as_of: string; source: string } {
  const path = resolvedHtsReplacementsPath();
  let base: ReplacementRow[] = [];
  if (!opts.replace && existsSync(path)) {
    try {
      const prev = JSON.parse(readFileSync(path, "utf8")) as ReplacementPack;
      base = Array.isArray(prev.replacements) ? [...prev.replacements] : [];
    } catch {
      base = [];
    }
  }
  const byFrom = new Map<string, ReplacementRow>();
  for (const r of base) {
    if (r.from && r.to) byFrom.set(r.from, r);
  }
  let upserted = 0;
  for (const r of incoming) {
    if (!r.from || !r.to || r.from === r.to) continue;
    byFrom.set(r.from, r);
    upserted++;
  }
  const written = writeReplacementsPack({
    replacements: [...byFrom.values()],
    source: opts.source,
    as_of: opts.as_of,
  });
  return { upserted, row_count: written.row_count, as_of: written.as_of, source: written.source };
}

export function writeHtsPack(opts: {
  rates: RateRow[];
  source: string;
  as_of?: string;
  version?: string;
}): ImportResult {
  const path = resolvedHtsRatesPath();
  assertTestSafeWrite(path, HTS_RATES_PATH, "hts_rates.json");
  const with_specific = opts.rates.filter((r) => (r.col1_specific_usd || 0) > 0).length;
  const as_of = (opts.as_of || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const payload: HtsPack = {
    version: opts.version || "1.2.0",
    as_of,
    source: opts.source,
    row_count: opts.rates.length,
    with_specific,
    rates: opts.rates,
  };
  const json = JSON.stringify(payload);
  writeFileSync(path, json);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 16);
  return {
    path,
    row_count: opts.rates.length,
    with_specific,
    skipped: 0,
    source: opts.source,
    as_of,
    hash,
    bytes: json.length,
  };
}

/** Full replace from classification workbook bytes (rates + any Replacement HTS columns). */
export function importHtsFromBuffer(
  buf: Buffer,
  sourceName: string,
  asOf?: string,
): ImportResult & { keys: string[]; replacements_upserted: number; replacements_total: number } {
  const parsed = parseHtsClassificationWorkbook(buf);
  if (!parsed.rates.length) {
    throw new Error(
      "No HTS rate rows parsed. Expected a classification workbook with headers like “HTS No.” / “Start Date” (or CSV columns hts, effective_start).",
    );
  }
  const result = writeHtsPack({
    rates: parsed.rates,
    source: sourceName,
    as_of: asOf,
  });
  let replacements_upserted = 0;
  let replacements_total = 0;
  if (parsed.replacements.length) {
    const merged = mergeHtsReplacements(parsed.replacements, {
      source: sourceName,
      as_of: asOf,
      replace: false,
    });
    replacements_upserted = merged.upserted;
    replacements_total = merged.row_count;
  } else if (existsSync(resolvedHtsReplacementsPath())) {
    try {
      const prev = JSON.parse(
        readFileSync(resolvedHtsReplacementsPath(), "utf8"),
      ) as ReplacementPack;
      replacements_total = Array.isArray(prev.replacements) ? prev.replacements.length : 0;
    } catch {
      replacements_total = 0;
    }
  }
  return {
    ...result,
    skipped: parsed.skipped,
    keys: parsed.keys,
    replacements_upserted,
    replacements_total,
  };
}

/**
 * Merge CSV upload rows into the existing table (upsert by hts|start|end).
 * Pass replace=true to wipe prior rates first.
 */
export function mergeHtsRateRows(
  incoming: RateRow[],
  opts: { source: string; as_of?: string; replace?: boolean },
): ImportResult & { upserted: number } {
  const path = resolvedHtsRatesPath();
  let base: RateRow[] = [];
  if (!opts.replace && existsSync(path)) {
    try {
      const prev = JSON.parse(readFileSync(path, "utf8")) as HtsPack;
      base = Array.isArray(prev.rates) ? [...prev.rates] : [];
    } catch {
      base = [];
    }
  }
  const byWindow = new Map<string, RateRow>();
  for (const r of base) {
    byWindow.set(`${r.hts}|${r.start}|${r.end}`, r);
  }
  let upserted = 0;
  for (const r of incoming) {
    const k = `${r.hts}|${r.start}|${r.end}`;
    byWindow.set(k, r);
    upserted++;
  }
  const rates = [...byWindow.values()].sort(
    (a, b) => a.hts.localeCompare(b.hts) || a.start.localeCompare(b.start),
  );
  const result = writeHtsPack({
    rates,
    source: opts.source,
    as_of: opts.as_of,
  });
  return { ...result, upserted };
}

function main() {
  const src = resolve(process.argv[2] || DEFAULT_XLSX);
  if (!existsSync(src)) {
    console.error(`HTS file not found: ${src}`);
    process.exit(1);
  }

  console.log(`Reading ${src}…`);
  const buf = readFileSync(src);
  const result = importHtsFromBuffer(buf, src.split(/[/\\]/).pop() || src);
  console.log(
    `Wrote ${result.row_count} windows (${result.with_specific} with specific) → ${result.path} (${(result.bytes / 1e6).toFixed(1)} MB, skipped ${result.skipped}, hash ${result.hash})`,
  );
}

const isCli =
  process.argv[1] &&
  (process.argv[1].endsWith("import_hts.ts") || process.argv[1].endsWith("import_hts.js"));
if (isCli) main();
