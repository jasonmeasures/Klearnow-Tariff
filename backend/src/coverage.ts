/**
 * HTS list coverage — which baseline rates + Chapter 99 rules apply.
 * No entered value required (duty dollars are not the goal).
 */
import * as XLSX from "xlsx";
import { assessS301fl, lookupS301fl } from "../../tariff-rules/src/s301fl.ts";
import { assessLine, type LineIn } from "./assess.ts";
import { normalizeHtsDigits, resolveCol1 } from "./htsLookup.ts";
import { rulepackPublic } from "./state.ts";

export type CoverageRowIn = {
  hts?: string;
  coo?: string;
  origin?: string;
  country?: string;
  as_of?: string;
  entry_date?: string;
  flags?: Record<string, boolean>;
  s301_list_3?: boolean | string;
  s232_auto_part?: boolean | string;
};

export type AppliedRule = {
  program: string;
  ch99: string | null;
  label: string;
  rate: string;
  rate_pct: number | null;
  reason: string;
  source_ref: string;
  status: "applies" | "reporting" | "needs_claim" | "info";
};

function truthy(v: unknown): boolean {
  if (v === true || v === 1) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

function pctPoints(col1: number): number {
  // table stores percent points (2.5) or occasionally decimal
  if (col1 > 0 && col1 < 1) return col1 * 100;
  return col1;
}

function rateLabel(pctPointsVal: number): string {
  const s = String(Number(pctPointsVal.toFixed(4))).replace(/0+$/, "").replace(/\.$/, "");
  return `${s}% ad valorem`;
}

function pickCoo(row: CoverageRowIn, defaultCoo: string | null): string {
  return String(row.coo || row.origin || row.country || defaultCoo || "")
    .trim()
    .toUpperCase();
}

function rowFlags(row: CoverageRowIn): Record<string, boolean> {
  const flags = { ...(row.flags || {}) };
  if (truthy(row.s301_list_3) || truthy((row as { s301_list3?: unknown }).s301_list3)) {
    flags.s301_list_3 = true;
  }
  if (truthy(row.s232_auto_part) || truthy((row as { s232?: unknown }).s232)) {
    flags.s232_auto_part = true;
  }
  return flags;
}

export function coverOne(
  row: CoverageRowIn,
  opts: { as_of: string; default_coo: string | null; assume_cn_list3?: boolean },
): Record<string, unknown> {
  const htsRaw = String(row.hts || "").trim();
  const htsKey = normalizeHtsDigits(htsRaw);
  const asOf = String(row.as_of || row.entry_date || opts.as_of).slice(0, 10);
  const coo = pickCoo(row, opts.default_coo);
  const notes: string[] = [];
  const rules: AppliedRule[] = [];

  if (!htsRaw) {
    return {
      hts: "",
      coo: coo || null,
      as_of: asOf,
      in_table: false,
      error: "Missing HTS",
      rules: [],
      ch99_sequence: [],
      notes: ["Each row needs an HTS code."],
    };
  }

  const hit = resolveCol1(htsRaw, asOf);
  const col1Pts = hit ? pctPoints(hit.col1_pct) : null;
  const col1Dec = col1Pts == null ? 0 : col1Pts / 100;

  if (!hit) {
    notes.push("HTS not found in the baseline Column-1 table — Col-1 unknown until imported.");
  }

  // Column 1 always listed when known
  if (hit) {
    rules.push({
      program: "base",
      ch99: null,
      label: "Column 1 general",
      rate: rateLabel(col1Pts!),
      rate_pct: col1Dec,
      reason: hit.desc || "HTS Column 1 rate window",
      source_ref: `HTS table ${hit.start} → ${hit.end}`,
      status: "applies",
    });
  }

  if (!coo) {
    notes.push("No origin — 301-FL and country stacks need a COO (set a default origin or a coo column).");
  } else {
    const flRow = lookupS301fl(coo);
    const fl = assessS301fl(coo, col1Dec);
    if (fl.kind === "out_of_scope") {
      notes.push(fl.reason);
    } else if (fl.kind === "flat") {
      rules.push({
        program: "s301fl",
        ch99: fl.heading,
        label: fl.label,
        rate: rateLabel(fl.rate_pct_decimal * 100),
        rate_pct: fl.rate_pct_decimal,
        reason: fl.reason,
        source_ref: "CSMS #69326983 — Section 301 Forced Labor",
        status: "applies",
      });
    } else if (fl.kind === "threshold_topup") {
      rules.push({
        program: "s301fl",
        ch99: fl.heading,
        label: fl.label,
        rate: rateLabel(fl.rate_pct_decimal * 100),
        rate_pct: fl.rate_pct_decimal,
        reason: fl.reason,
        source_ref: "CSMS #69326983 — Section 301 Forced Labor",
        status: "applies",
      });
    } else if (fl.kind === "threshold_no_add") {
      rules.push({
        program: "s301fl",
        ch99: fl.heading,
        label: fl.label,
        rate: "0% (report heading)",
        rate_pct: 0,
        reason: fl.reason,
        source_ref: "CSMS #69326983 — Section 301 Forced Labor",
        status: "reporting",
      });
    }
    if (flRow) {
      notes.push(`301-FL economy: ${flRow.name} (${flRow.mechanic}).`);
    }
  }

  const flags = rowFlags(row);
  if (coo === "CN" && !flags.s301_list_3 && !flags.s301_list_4a && opts.assume_cn_list3) {
    flags.s301_list_3 = true;
    notes.push("Assumed China 301 List 3 for coverage (toggle off if wrong list).");
  } else if (coo === "CN" && !flags.s301_list_3 && !flags.s301_list_4a) {
    notes.push("China origin: set List 3 / 4A claim to resolve legacy 301 heading.");
    rules.push({
      program: "s301",
      ch99: null,
      label: "Section 301 (China) — claim needed",
      rate: "—",
      rate_pct: null,
      reason: "Legacy China 301 is list-gated. Mark s301_list_3 or s301_list_4a on the row.",
      source_ref: "Trade Act / USTR lists",
      status: "needs_claim",
    });
  }

  // Full stack preview when we have COO (notional $10k — rates/sequence only)
  let ch99_sequence: string[] = [];
  let stack_preview: Array<Record<string, unknown>> = [];
  let diagnostics: unknown[] = [];
  if (coo) {
    const line: LineIn = {
      hts: htsRaw,
      coo,
      entered_value: 10000,
      col1_rate_pct: col1Pts ?? undefined,
      entry_date: asOf,
      release_date: asOf,
      flags,
    };
    try {
      const L = assessLine(line, 0);
      ch99_sequence = L.ch99_sequence || [];
      diagnostics = L.diagnostics || [];
      stack_preview = (L.layers || [])
        .filter((x) => x.program !== "base")
        .map((x) => ({
          program: x.program,
          ch99: x.ch99,
          label: x.label,
          rate: x.rate,
          reason: x.reason,
          source_ref: x.source_ref,
        }));
      for (const s of L.suppressed || []) {
        stack_preview.push({
          program: s.program,
          ch99: s.ch99,
          label: s.label,
          rate: s.rate,
          reason: `Suppressed: ${s.reason}`,
          source_ref: s.source_ref,
          suppressed: true,
        });
      }
      // Merge assess layers into rules if not already present
      for (const x of L.layers || []) {
        if (x.program === "base") continue;
        if (rules.some((r) => r.ch99 && r.ch99 === x.ch99)) continue;
        rules.push({
          program: x.program,
          ch99: x.ch99,
          label: x.label || x.program,
          rate: x.rate,
          rate_pct: x.rate_pct,
          reason: x.reason || "",
          source_ref: x.source_ref || "",
          status: Number(x.duty_amount) === 0 && x.ch99 ? "reporting" : "applies",
        });
      }
    } catch (e) {
      notes.push(e instanceof Error ? e.message : String(e));
    }
  }

  return {
    hts: htsRaw,
    hts_key: htsKey,
    coo: coo || null,
    as_of: asOf,
    in_table: Boolean(hit),
    col1_pct: col1Pts,
    desc: hit?.desc || null,
    rules,
    ch99_sequence,
    stack_preview,
    diagnostics,
    notes,
  };
}

export function coverRows(body: {
  as_of?: string;
  default_coo?: string;
  assume_cn_list3?: boolean;
  rows?: CoverageRowIn[];
}) {
  const as_of = String(body.as_of || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const default_coo = body.default_coo
    ? String(body.default_coo).trim().toUpperCase()
    : null;
  const rowsIn = Array.isArray(body.rows) ? body.rows : [];
  const rows = rowsIn.map((r) =>
    coverOne(r, {
      as_of,
      default_coo,
      assume_cn_list3: Boolean(body.assume_cn_list3),
    }),
  );

  return {
    ok: true,
    as_of,
    default_coo,
    rulepack: rulepackPublic(),
    summary: {
      rows: rows.length,
      in_table: rows.filter((r) => r.in_table).length,
      missing_hts: rows.filter((r) => !r.hts).length,
      missing_coo: rows.filter((r) => !r.coo).length,
      with_ch99: rows.filter((r) => (r.ch99_sequence as string[])?.length > 0).length,
    },
    rows,
  };
}

const HTS_HEADER_RE =
  /^(primary[_\s-]?hts|hts([_\s-]?(code|formatted|number|us))?|tariff([_\s-]?code)?|htsus)$/i;
const COO_HEADER_RE =
  /^(coo|origin|country([_\s-]?(of[_\s-]?origin|code|bloc))?|iso2)$/i;

function normHeaderCell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .replace(/\n/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isHtsHeader(h: string): boolean {
  return HTS_HEADER_RE.test(h) || h.includes("primary_hts") || h === "hts_formatted";
}

function isCooHeader(h: string): boolean {
  return COO_HEADER_RE.test(h);
}

function rowLooksLikeHeader(cells: unknown[]): boolean {
  const headers = cells.map(normHeaderCell).filter(Boolean);
  return headers.some(isHtsHeader);
}

function sheetToCoverageRows(sheet: XLSX.WorkSheet): CoverageRowIn[] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  if (!matrix.length) return [];

  let headerIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 25); i++) {
    if (rowLooksLikeHeader(matrix[i] || [])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    // Fall back: treat first non-empty row as data with col0=hts
    return matrix
      .map((row) => {
        const cells = row || [];
        const hts = String(cells[0] ?? "").trim();
        if (!hts || !/\d{4}/.test(hts.replace(/\D/g, ""))) return null;
        return normalizeParsedRow({ hts, coo: String(cells[1] ?? "").trim() });
      })
      .filter(Boolean) as CoverageRowIn[];
  }

  const headers = (matrix[headerIdx] || []).map(normHeaderCell);
  const out: CoverageRowIn[] = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const cells = matrix[r] || [];
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (!h) return;
      obj[h] = cells[i];
    });
    // Map Subaru / ops sheet aliases onto canonical keys before normalize
    const htsKey = headers.find(isHtsHeader);
    const cooKey = headers.find(isCooHeader);
    // Prefer Primary HTS (digits) over formatted when both exist
    const primaryKey = headers.find((h) => h.includes("primary_hts"));
    const formattedKey = headers.find((h) => h.includes("hts_formatted") || h === "hts_formatted");
    if (primaryKey && obj[primaryKey]) obj.hts = obj[primaryKey];
    else if (htsKey && obj[htsKey]) obj.hts = obj[htsKey];
    else if (formattedKey && obj[formattedKey]) obj.hts = obj[formattedKey];
    if (cooKey && obj[cooKey]) obj.coo = obj[cooKey];

    const s232Key = headers.find((h) => h.includes("232") && h.includes("auto"));
    if (s232Key) {
      const v = String(obj[s232Key] ?? "").trim().toUpperCase();
      if (v === "Y" || v === "YES" || v === "TRUE" || v === "1") obj.s232_auto_part = true;
    }
    const listKey = headers.find((h) => h.includes("301") && h.includes("list"));
    if (listKey) {
      const v = String(obj[listKey] ?? "").trim().toUpperCase();
      if (v.includes("3") || v === "Y" || v === "LIST 3") obj.s301_list_3 = true;
      if (v.includes("4")) (obj as { s301_list_4a?: boolean }).s301_list_4a = true;
    }
    const dateKey = headers.find((h) => h.includes("entry_date") || h === "date" || h.includes("rate_date"));
    if (dateKey && obj[dateKey]) obj.as_of = obj[dateKey];

    const row = normalizeParsedRow(obj);
    if (!row.hts) continue;
    // skip note / blank lines mistaken for data
    if (!/\d{6,}/.test(row.hts.replace(/\D/g, ""))) continue;
    out.push(row);
  }
  return out;
}

function pickCoverageSheet(wb: XLSX.WorkBook): XLSX.WorkSheet {
  const prefer = ["full stack", "lines", "hts", "catalog", "sheet1"];
  const names = wb.SheetNames;
  for (const p of prefer) {
    const hit = names.find((n) => n.toLowerCase().includes(p));
    if (hit) return wb.Sheets[hit];
  }
  // Prefer the sheet with the most rows that look like an HTS header
  let best = names[0];
  let bestScore = -1;
  for (const n of names) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], {
      header: 1,
      defval: "",
    });
    const idx = matrix.findIndex((row) => rowLooksLikeHeader(row || []));
    const score = idx >= 0 ? matrix.length - idx : 0;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return wb.Sheets[best];
}

/** Parse paste / CSV / JSON / Excel (base64) into coverage rows. */
export function parseCoverageInput(body: {
  text?: string;
  json?: unknown;
  filename?: string;
  xlsx_base64?: string;
}): CoverageRowIn[] {
  if (Array.isArray(body.json)) {
    return body.json.map(normalizeParsedRow);
  }
  if (body.xlsx_base64) {
    const buf = Buffer.from(String(body.xlsx_base64).replace(/^data:.*base64,/, ""), "base64");
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    return sheetToCoverageRows(pickCoverageSheet(wb));
  }
  const text = String(body.text || "").trim();
  if (!text) return [];

  // JSON array pasted
  if (text.startsWith("[") || text.startsWith("{")) {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map(normalizeParsedRow);
  }

  // CSV / TSV — skip title rows until we see an HTS header
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes("\t") || lines.some((l) => l.includes("\t")) ? "\t" : ",";
  const cells = (line: string) => splitDelimited(line, delim);

  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    if (rowLooksLikeHeader(cells(lines[i]))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    return lines
      .map((line) => {
        const cols = cells(line);
        if (cols.length === 1) return normalizeParsedRow({ hts: cols[0] });
        return normalizeParsedRow({ hts: cols[0], coo: cols[1] });
      })
      .filter((r) => r.hts && /\d{6,}/.test(r.hts.replace(/\D/g, "")));
  }

  const keys = cells(lines[headerIdx]).map(normHeaderCell);
  return lines.slice(headerIdx + 1).map((line) => {
    const cols = cells(line);
    const obj: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      if (k && cols[i] !== undefined) obj[k] = cols[i];
    });
    return normalizeParsedRow(obj);
  }).filter((r) => r.hts && /\d{6,}/.test(r.hts.replace(/\D/g, "")));
}

function guessKeys(n: number): string[] {
  if (n <= 1) return ["hts"];
  if (n === 2) return ["hts", "coo"];
  return ["hts", "coo", "as_of"];
}

function splitDelimited(line: string, delim: string): string[] {
  if (delim === "\t") return line.split("\t");
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === delim && !q) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function normalizeParsedRow(raw: Record<string, unknown> | CoverageRowIn): CoverageRowIn {
  const r = raw as Record<string, unknown>;
  const get = (...keys: string[]) => {
    for (const k of keys) {
      if (r[k] !== undefined && r[k] !== "") return r[k];
      const hit = Object.keys(r).find((x) => normHeaderCell(x) === normHeaderCell(k));
      if (hit && r[hit] !== undefined && r[hit] !== "") return r[hit];
    }
    // fuzzy: any key that looks like HTS / COO
    return undefined;
  };
  let hts = String(
    get(
      "hts",
      "primary_hts",
      "hts_formatted",
      "hts_code",
      "htscode",
      "tariff",
      "tariff_code",
      "htsus",
      "code",
    ) ?? "",
  ).trim();
  if (!hts) {
    const hk = Object.keys(r).find((k) => isHtsHeader(normHeaderCell(k)));
    if (hk) hts = String(r[hk] ?? "").trim();
  }
  let coo = String(
    get("coo", "origin", "country", "country_of_origin", "country_bloc", "iso2") ?? "",
  ).trim();
  if (!coo) {
    const ck = Object.keys(r).find((k) => isCooHeader(normHeaderCell(k)));
    if (ck) coo = String(r[ck] ?? "").trim();
  }
  // COO cells sometimes "Brazil" — keep 2-letter if present elsewhere; strip to ISO2 when length 2
  if (coo.length > 2 && /^[A-Z]{2}\b/i.test(coo)) coo = coo.slice(0, 2);

  const listRaw = get("s301_list_3", "list_3", "list3", "legacy_china_301_list_input");
  const s232Raw = get("s232_auto_part", "s232", "auto_part", "232_auto_part_input_y_n_review");

  return {
    hts,
    coo,
    as_of: String(get("as_of", "entry_date", "date", "rate_date", "entry_date_input") ?? "").trim() ||
      undefined,
    s301_list_3: truthy(listRaw) || undefined,
    s232_auto_part:
      truthy(s232Raw) ||
      String(s232Raw ?? "").trim().toUpperCase() === "Y" ||
      undefined,
  };
}
