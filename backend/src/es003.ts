/**
 * ACE ES-003 (Entry Summary Line Tariff Details) → audit.
 * Groups tariff ordinals per entry line; Entry Date drives rate date + IEEPA windowing.
 */
import * as XLSX from "xlsx";
import { auditEntry, type LineIn } from "./assess.ts";
import {
  LIMITS,
  LimitError,
  decodeXlsxBase64,
  yieldEventLoop,
} from "./loadGuard.ts";
import { normalizeCh99 } from "../../tariff-rules/src/tariffRules.ts";
import {
  IEEPA_END,
  IEEPA_START,
  filingEra,
  filingEraLabel,
  inIeepaWindow,
} from "./programEras.ts";

/** @deprecated use IEEPA_START / IEEPA_END from programEras */
export const IEEPA_RANGE_START = IEEPA_START;
export const IEEPA_RANGE_END = IEEPA_END;

const COL = {
  entryNum: "Entry Summary Number",
  lineNum: "Entry Summary Line Number",
  entryType: "Entry Type Code",
  importer: "Importer Number",
  port: "Port of Entry Code",
  entryDate: "Entry Date",
  summaryDate: "Entry Summary Date",
  hts: "HTS Number - Full",
  ordinal: "Tariff Ordinal Number",
  goodsValue: "Line Tariff Goods Value Amount",
  goodsValueAlt: "Line Goods Value Amount",
  duty: "Line Tariff Duty Amount",
  coo: "Country of Origin Code",
  export: "Country of Export Code",
  qty1: "Line Tariff Quantity (1)",
  uom1: "Line Tariff UOM (1) Code",
} as const;

export type Es003ParsedLine = {
  entry_number: string;
  line_number: string;
  line_id: string;
  entry_date: string;
  entry_summary_date: string | null;
  entry_type: string | null;
  importer: string | null;
  port: string | null;
  coo: string;
  country_export: string | null;
  hts: string;
  entered_value: number;
  filed_duty_total: number;
  filed_ch99: string[];
  ieepa_codes: string[];
  ieepa_duty: number;
  quantity: number | null;
  quantity_uom: string | null;
  tariff_row_count: number;
};

export type Es003ParseMeta = {
  format: "standard" | "extended";
  sheet: string;
  tariff_rows: number;
  entry_lines: number;
  entries: number;
  date_min: string | null;
  date_max: string | null;
  ieepa_lines: number;
};

function cell(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
    const hit = Object.keys(row).find((x) => x.trim().toLowerCase() === k.trim().toLowerCase());
    if (hit && row[hit] !== undefined && row[hit] !== null && row[hit] !== "") return row[hit];
  }
  return "";
}

export function parseMoney(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v instanceof Date) return 0;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** ACE often ships MM/DD/YYYY; also accept ISO and Excel dates. */
export function parseEs003Date(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function isChapter99Hts(hts: string): boolean {
  return String(hts || "").replace(/\D/g, "").startsWith("99");
}

export function isIeepaHts(hts: string): boolean {
  const d = String(hts || "").replace(/\D/g, "");
  return d.startsWith("990301") || d.startsWith("990302");
}

export function inIeepaRefundWindow(entryDate: string | null | undefined): boolean {
  return inIeepaWindow(entryDate);
}

function detectFormat(headers: string[]): "standard" | "extended" {
  const set = new Set(headers.map((h) => h.trim()));
  if (
    set.has("Importation Date") ||
    set.has("Filer Name") ||
    set.has("Column 1 Current Primary Duty Rate") ||
    set.has("Line Post Summary Correction Indicator")
  ) {
    return "extended";
  }
  return "standard";
}

function pickSheet(wb: XLSX.WorkBook): { name: string; sheet: XLSX.WorkSheet } {
  const prefer = ["main report", "es-003", "es003", "report"];
  for (const p of prefer) {
    const hit = wb.SheetNames.find((n) => n.toLowerCase().includes(p));
    if (hit) return { name: hit, sheet: wb.Sheets[hit] };
  }
  const name = wb.SheetNames[0];
  return { name, sheet: wb.Sheets[name] };
}

type RawTariff = {
  entry_number: string;
  line_number: string;
  entry_date: string | null;
  entry_summary_date: string | null;
  entry_type: string;
  importer: string;
  port: string;
  coo: string;
  country_export: string;
  hts: string;
  ordinal: number;
  goods_value: number;
  duty: number;
  qty: number | null;
  uom: string | null;
};

function sheetToTariffRows(sheet: XLSX.WorkSheet): RawTariff[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  if (!rows.length) throw new Error("ES-003 appears empty.");
  const headers = Object.keys(rows[0]);
  if (!headers.some((h) => /entry summary number/i.test(h))) {
    throw new Error(
      "Not an ACE ES-003 export — expected column “Entry Summary Number”. Headers: " +
        headers.slice(0, 8).join(", "),
    );
  }
  const out: RawTariff[] = [];
  for (const row of rows) {
    const entry_number = String(cell(row, COL.entryNum) || "").trim();
    const htsRaw = String(cell(row, COL.hts) || "").trim();
    if (!entry_number || !htsRaw) continue;
    const line_number = String(cell(row, COL.lineNum) || "").trim() || "1";
    const coo = String(cell(row, COL.coo) || "").trim().toUpperCase();
    out.push({
      entry_number,
      line_number,
      entry_date: parseEs003Date(cell(row, COL.entryDate)),
      entry_summary_date: parseEs003Date(cell(row, COL.summaryDate)),
      entry_type: String(cell(row, COL.entryType) || "").trim(),
      importer: String(cell(row, COL.importer) || "").trim(),
      port: String(cell(row, COL.port) || "").trim(),
      coo,
      country_export: String(cell(row, COL.export) || "").trim().toUpperCase(),
      hts: htsRaw.replace(/\D/g, "") || htsRaw,
      ordinal: Number(cell(row, COL.ordinal)) || 0,
      goods_value: parseMoney(cell(row, COL.goodsValue, COL.goodsValueAlt)),
      duty: parseMoney(cell(row, COL.duty, "Line Tariff Amount", "Line Duty Amount")),
      qty: (() => {
        const n = parseMoney(cell(row, COL.qty1));
        return n > 0 ? n : null;
      })(),
      uom: String(cell(row, COL.uom1) || "").trim() || null,
    });
  }
  return out;
}

/** Group ACE tariff ordinals into one audit line per Entry Summary + ESL#. */
export function groupEs003Lines(tariffs: RawTariff[]): Es003ParsedLine[] {
  const map = new Map<string, RawTariff[]>();
  for (const t of tariffs) {
    const k = `${t.entry_number}|${t.line_number}`;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }

  const lines: Es003ParsedLine[] = [];
  for (const [, group] of map) {
    group.sort((a, b) => a.ordinal - b.ordinal);
    const first = group[0];
    const commodity =
      group.find((g) => !isChapter99Hts(g.hts) && g.goods_value > 0) ||
      group.find((g) => !isChapter99Hts(g.hts)) ||
      null;
    const ch99 = group.filter((g) => isChapter99Hts(g.hts));
    const filed_ch99 = [...new Set(ch99.map((g) => normalizeCh99(g.hts)))];
    const ieepa = ch99.filter((g) => isIeepaHts(g.hts));
    const ieepa_codes = [...new Set(ieepa.map((g) => normalizeCh99(g.hts)))];
    const ieepa_duty = ieepa.reduce((a, g) => a + g.duty, 0);
    const entered_value =
      commodity?.goods_value ||
      group.reduce((a, g) => a + (isChapter99Hts(g.hts) ? 0 : g.goods_value), 0);
    const filed_duty_total = group.reduce((a, g) => a + g.duty, 0);
    const entry_date =
      commodity?.entry_date ||
      first.entry_date ||
      group.map((g) => g.entry_date).find(Boolean) ||
      "";

    if (!commodity?.hts && !filed_ch99.length) continue;

    lines.push({
      entry_number: first.entry_number,
      line_number: first.line_number,
      line_id: `${first.entry_number}:${first.line_number}`,
      entry_date,
      entry_summary_date: commodity?.entry_summary_date || first.entry_summary_date,
      entry_type: first.entry_type || null,
      importer: first.importer || null,
      port: first.port || null,
      coo: (commodity?.coo || first.coo || "").toUpperCase(),
      country_export: first.country_export || null,
      hts: commodity?.hts || "",
      entered_value,
      filed_duty_total,
      filed_ch99,
      ieepa_codes,
      ieepa_duty,
      quantity: commodity?.qty ?? null,
      quantity_uom: commodity?.uom ?? null,
      tariff_row_count: group.length,
    });
  }

  lines.sort((a, b) =>
    a.entry_number.localeCompare(b.entry_number) ||
    Number(a.line_number) - Number(b.line_number),
  );
  return lines;
}

export function parseEs003Buffer(buf: Buffer): { lines: Es003ParsedLine[]; meta: Es003ParseMeta } {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const { name, sheet } = pickSheet(wb);
  const tariffs = sheetToTariffRows(sheet);
  if (!tariffs.length) throw new Error("No ES-003 tariff rows found.");
  if (tariffs.length > LIMITS.es003TariffRows) {
    throw new LimitError(`Max ${LIMITS.es003TariffRows} ES-003 tariff rows per request.`);
  }
  const headers = Object.keys(
    XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })[0] || {},
  );
  const lines = groupEs003Lines(tariffs);
  const dates = lines.map((l) => l.entry_date).filter(Boolean).sort();
  return {
    lines,
    meta: {
      format: detectFormat(headers),
      sheet: name,
      tariff_rows: tariffs.length,
      entry_lines: lines.length,
      entries: new Set(lines.map((l) => l.entry_number)).size,
      date_min: dates[0] || null,
      date_max: dates[dates.length - 1] || null,
      ieepa_lines: lines.filter((l) => l.ieepa_codes.length > 0).length,
    },
  };
}

export function parseEs003Base64(b64: string): { lines: Es003ParsedLine[]; meta: Es003ParseMeta } {
  return parseEs003Buffer(decodeXlsxBase64(b64));
}

function toLineIn(row: Es003ParsedLine): LineIn {
  // China 301 comes from HTS list membership in assess — never assume List 3 on ES-003.
  return {
    line_id: row.line_id,
    hts: row.hts,
    coo: row.coo,
    entered_value: row.entered_value,
    entry_date: row.entry_date || undefined,
    release_date: row.entry_date || undefined,
    entry_type: row.entry_type || "CONSUMPTION",
    quantity: row.quantity ?? undefined,
    quantity_uom: row.quantity_uom || undefined,
    filed_ch99: row.filed_ch99,
    filed_duty_total: row.filed_duty_total,
    flags: {},
  };
}

export function auditEs003(body: {
  xlsx_base64?: string;
  filename?: string;
  knowledge_date?: string;
  /** Optional pre-parsed lines (tests). */
  lines?: Es003ParsedLine[];
  meta?: Es003ParseMeta;
}) {
  const parsed = body.lines
    ? { lines: body.lines, meta: body.meta! }
    : body.xlsx_base64
      ? parseEs003Base64(body.xlsx_base64)
      : null;
  if (!parsed?.lines?.length) {
    throw new Error("Provide xlsx_base64 from an ACE ES-003 export.");
  }
  if (parsed.lines.length > LIMITS.es003Lines) {
    throw new LimitError(`Max ${LIMITS.es003Lines} entry lines per ES-003 audit.`);
  }

  const lineIns = parsed.lines.filter((l) => l.hts).map((l) => toLineIn(l));

  const skipped = parsed.lines.filter((l) => !l.hts).length;
  const audited = auditEntry({
    lines: lineIns,
    knowledge_date: body.knowledge_date,
  });

  // Enrich findings with entry context
  const byId = new Map(parsed.lines.map((l) => [l.line_id, l]));
  const findings = (audited.findings || []).map((f) => {
    const src = byId.get(f.line_id);
    return {
      ...f,
      entry_number: src?.entry_number || f.line_id.split(":")[0],
      entry_date: src?.entry_date || null,
      hts: src?.hts || null,
      coo: src?.coo || null,
    };
  });

  const byCat: Record<string, number> = {};
  for (const f of findings) {
    byCat[f.category] = (byCat[f.category] || 0) + 1;
  }

  const refundCandidates = parsed.lines.filter(
    (l) => l.ieepa_codes.length > 0 && inIeepaRefundWindow(l.entry_date),
  );
  const ieepa_duty_in_window = refundCandidates.reduce((a, l) => a + l.ieepa_duty, 0);

  type LineOut = {
    line_id: string;
    entry_number?: string;
    line_number?: string;
    entry_date?: string;
    hts: unknown;
    coo: unknown;
    entered_value: number;
    filed_ch99: string[];
    computed_ch99: string[];
    filed_duty_total?: number;
    computed_duty: unknown;
    ieepa_codes: string[];
    ieepa_duty: number;
    in_ieepa_window: boolean;
    diagnostics: unknown[];
    layers: Array<Record<string, unknown>>;
  };

  const lines: LineOut[] = audited.lines.map((L, i) => {
    const src = byId.get(L.line_id) || parsed.lines[i];
    return {
      line_id: L.line_id,
      entry_number: src?.entry_number,
      line_number: src?.line_number,
      entry_date: src?.entry_date,
      hts: L.hts,
      coo: L.coo,
      entered_value: src?.entered_value ?? 0,
      filed_ch99: src?.filed_ch99 || [],
      computed_ch99: (L.ch99_sequence as string[]) || [],
      filed_duty_total: src?.filed_duty_total,
      computed_duty: L.totals?.duty,
      ieepa_codes: src?.ieepa_codes || [],
      ieepa_duty: src?.ieepa_duty || 0,
      in_ieepa_window: inIeepaRefundWindow(src?.entry_date),
      diagnostics: L.diagnostics || [],
      layers: (L.layers || []).map((x) => ({
        program: x.program,
        ch99: x.ch99,
        label: x.label,
        rate: x.rate,
        duty_amount: x.duty_amount,
      })),
    };
  });

  /** CAPE-style review unit = one Entry Summary Number (not ESL line). */
  const entries = buildEntryReviews(parsed.lines, lines, findings);

  const statusCounts: Record<string, number> = {};
  for (const e of entries) {
    statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
  }

  const totals = {
    entries: entries.length,
    entry_lines: lineIns.length,
    finding_count: findings.length,
    by_category: byCat,
    by_status: statusCounts,
    ieepa_duty: ieepa_duty_in_window,
    ieepa_entries: entries.filter((e) => e.has_ieepa_window).length,
    entered_value: entries.reduce((a, e) => a + e.entered_value, 0),
    filed_duty: entries.reduce((a, e) => a + e.filed_duty_total, 0),
    computed_duty: entries.reduce((a, e) => a + e.computed_duty, 0),
    net_duty_impact: findings.reduce((a, f) => a + (Number(f.duty_impact) || 0), 0),
    stack_gap_entries: statusCounts.stack_gap || 0,
    wrong_era_entries: statusCounts.wrong_era || 0,
    ieepa_cape_entries: statusCounts.ieepa_cape || 0,
    needs_inputs_entries: statusCounts.needs_inputs || 0,
    clean_entries: statusCounts.clean || 0,
    era_counts: entries.reduce((acc: Record<string, number>, e) => {
      acc[e.filing_era] = (acc[e.filing_era] || 0) + 1;
      return acc;
    }, {}),
  };

  return {
    ok: true,
    filename: body.filename || null,
    engine_review_version: AUDIT_REVIEW_VERSION,
    meta: parsed.meta,
    skipped_no_commodity_hts: skipped,
    ieepa: {
      range_start: IEEPA_RANGE_START,
      range_end: IEEPA_RANGE_END,
      lines_in_window: refundCandidates.length,
      ieepa_duty_in_window,
      note:
        "IEEPA (9903.01 / .02) filings dated 2025-02-04–2026-02-23 are CAPE refund candidates — not live forward filings.",
    },
    summary: {
      ...audited.summary,
      finding_count: findings.length,
      by_category: byCat,
      entry_lines_audited: lineIns.length,
      lines_with_findings: new Set(findings.map((f) => f.line_id)).size,
    },
    totals,
    entries,
    findings,
    lines,
    rulepack: audited.rulepack,
  };
}

/** Bump when entry-review / status rules change (CAPE-style stale signal). */
export const AUDIT_REVIEW_VERSION = "1.0.0-tariff-review";

export type AuditObservation = {
  code: string;
  lbl: string;
  sev: "error" | "warning" | "info";
  det: string;
  category: string;
  line_id?: string;
  duty_impact?: number;
};

export type EntryReview = {
  id: string;
  entry_date: string | null;
  entry_summary_date: string | null;
  entry_type: string | null;
  importer: string | null;
  port: string | null;
  filing_era: string;
  filing_era_label: string;
  countries: string[];
  line_count: number;
  entered_value: number;
  filed_duty_total: number;
  computed_duty: number;
  ieepa_duty: number;
  has_ieepa_window: boolean;
  ieepa_codes: string[];
  filed_ch99: string[];
  computed_ch99: string[];
  status: string;
  status_label: string;
  guidance: string;
  finding_count: number;
  by_category: Record<string, number>;
  observations: AuditObservation[];
  lines: Array<{
    line_id: string;
    line_number?: string;
    hts: unknown;
    coo: unknown;
    entered_value: number;
    ieepa_duty: number;
    filed_ch99: string[];
    computed_ch99: string[];
    filed_duty_total?: number;
    computed_duty: unknown;
  }>;
};

const STATUS_LABEL: Record<string, string> = {
  wrong_era: "Wrong-era filing",
  dead_program: "Dead program filed",
  stack_gap: "Missing live Ch.99",
  ieepa_cape: "IEEPA CAPE candidate",
  needs_inputs: "Needs inputs (metals)",
  extra: "Extra / review Ch.99",
  out_of_range: "IEEPA outside window",
  clean: "Aligned for era",
};

function pickEntryStatus(byCat: Record<string, number>, hasIeepaOutOfWindow: boolean): string {
  // Never lead with IEEPA for post-IEEPA eras; wrong-era / stack gaps first.
  if (byCat.WRONG_ERA || byCat.DEAD_PROGRAM) return "wrong_era";
  if (byCat.MISSING_CH99) return "stack_gap";
  if (byCat.IEEPA_REFUND_CANDIDATE) return "ieepa_cape";
  if (byCat.NEEDS_INPUTS) return "needs_inputs";
  if (byCat.EXTRA_CH99) return "extra";
  if (hasIeepaOutOfWindow) return "out_of_range";
  return "clean";
}

function buildEntryReviews(
  parsedLines: Es003ParsedLine[],
  lines: Array<{
    line_id: string;
    entry_number?: string;
    line_number?: string;
    hts: unknown;
    coo: unknown;
    entered_value: number;
    filed_ch99: string[];
    computed_ch99: string[];
    filed_duty_total?: number;
    computed_duty: unknown;
    ieepa_codes: string[];
    ieepa_duty: number;
    in_ieepa_window: boolean;
  }>,
  findings: Array<{
    severity: string;
    category: string;
    line_id: string;
    message: string;
    remediation?: string;
    duty_impact: number;
    entry_number?: string;
  }>,
): EntryReview[] {
  const byEntryParsed = new Map<string, Es003ParsedLine[]>();
  for (const p of parsedLines) {
    if (!byEntryParsed.has(p.entry_number)) byEntryParsed.set(p.entry_number, []);
    byEntryParsed.get(p.entry_number)!.push(p);
  }
  const byEntryLines = new Map<string, typeof lines>();
  for (const L of lines) {
    const id = L.entry_number || String(L.line_id).split(":")[0];
    if (!byEntryLines.has(id)) byEntryLines.set(id, []);
    byEntryLines.get(id)!.push(L);
  }
  const byEntryFindings = new Map<string, typeof findings>();
  for (const f of findings) {
    const id = f.entry_number || String(f.line_id).split(":")[0];
    if (!byEntryFindings.has(id)) byEntryFindings.set(id, []);
    byEntryFindings.get(id)!.push(f);
  }

  const ids = [...byEntryParsed.keys()].sort();
  return ids.map((id) => {
    const srcRows = byEntryParsed.get(id) || [];
    const entryLines = byEntryLines.get(id) || [];
    const entryFindings = byEntryFindings.get(id) || [];
    const first = srcRows[0];
    const by_category: Record<string, number> = {};
    for (const f of entryFindings) {
      by_category[f.category] = (by_category[f.category] || 0) + 1;
    }
    const ieepa_codes = [...new Set(srcRows.flatMap((r) => r.ieepa_codes))];
    const has_ieepa_window = srcRows.some(
      (r) => r.ieepa_codes.length > 0 && inIeepaRefundWindow(r.entry_date),
    );
    const hasIeepaOut =
      ieepa_codes.length > 0 &&
      !has_ieepa_window &&
      Boolean(first?.entry_date);
    const status = pickEntryStatus(by_category, hasIeepaOut);
    const CAT_LBL: Record<string, string> = {
      IEEPA_REFUND_CANDIDATE: "IEEPA CAPE candidate",
      DEAD_PROGRAM: "Dead program filed",
      WRONG_ERA: "Wrong-era filing",
      MISSING_CH99: "Missing live Ch.99",
      EXTRA_CH99: "Extra / review Ch.99",
      NEEDS_INPUTS: "Needs inputs (metals)",
    };
    const observations: AuditObservation[] = entryFindings.map((f) => ({
      code: f.category,
      lbl: CAT_LBL[f.category] || f.category,
      sev:
        f.severity === "ERROR" ? "error" : f.severity === "WARNING" ? "warning" : "info",
      det: f.remediation ? `${f.message} — ${f.remediation}` : f.message,
      category: f.category,
      line_id: f.line_id,
      duty_impact: f.duty_impact,
    }));

    const entered_value = srcRows.reduce((a, r) => a + (r.entered_value || 0), 0);
    const filed_duty_total = srcRows.reduce((a, r) => a + (r.filed_duty_total || 0), 0);
    const ieepa_duty = srcRows.reduce((a, r) => a + (r.ieepa_duty || 0), 0);
    const computed_duty = entryLines.reduce((a, L) => a + (Number(L.computed_duty) || 0), 0);
    const era = filingEra(first?.entry_date);
    const eraLbl = filingEraLabel(era);

    let guidance = `Entry Date ${first?.entry_date || "—"} is in the ${eraLbl}. No stack findings for codes we can compute from ES-003 (HTS + COO + date).`;
    if (status === "wrong_era") {
      guidance = `Wrong-era Chapter 99 for ${eraLbl} (Entry Date ${first?.entry_date}). IEEPA ended ${IEEPA_END}; Sec 122 ran through 2026-07-23; 301-FL starts 2026-07-24.`;
    } else if (status === "ieepa_cape") {
      guidance = `IEEPA filed in CAPE window (${IEEPA_START}–${IEEPA_END}). Review refund / CAPE eligibility; do not refile IEEPA prospectively.`;
    } else if (status === "stack_gap") {
      guidance =
        era === "sec_122"
          ? "Sec 122 era: still missing required Chapter 99 on this entry (9903.03.01 is satisfied if present on any ESL)."
          : era === "s301fl"
            ? "301-FL era: expected live 301-FL / China 301 / 232 headings missing from the filing."
            : "Live rule pack expects Chapter 99 heading(s) that were not filed on this entry.";
    } else if (status === "needs_inputs") {
      guidance =
        "Metals-family codes appear on a metals-triage HTS. ES-003 cannot confirm metal content / melt-pour — use Quick Check.";
    } else if (status === "extra") {
      guidance = `Filed Chapter 99 code(s) not produced for ${eraLbl} — confirm claims or remove.`;
    } else if (status === "out_of_range") {
      guidance = "IEEPA codes appear outside the CAPE entry-date window.";
    } else if (status === "clean") {
      guidance = `Aligned for ${eraLbl} based on HTS + COO + Entry Date from ES-003. Sec 122 counts if filed on any ESL of the entry. Metals / 232 auto-part still need Quick Check when annex-gated.`;
    }

    return {
      id,
      entry_date: first?.entry_date || null,
      entry_summary_date: first?.entry_summary_date || null,
      entry_type: first?.entry_type || null,
      importer: first?.importer || null,
      port: first?.port || null,
      filing_era: era,
      filing_era_label: eraLbl,
      countries: [...new Set(srcRows.map((r) => r.coo).filter(Boolean))],
      line_count: entryLines.length || srcRows.length,
      entered_value,
      filed_duty_total,
      computed_duty,
      ieepa_duty,
      has_ieepa_window,
      ieepa_codes,
      filed_ch99: [...new Set(srcRows.flatMap((r) => r.filed_ch99))],
      computed_ch99: [...new Set(entryLines.flatMap((L) => L.computed_ch99))],
      status,
      status_label: STATUS_LABEL[status] || status,
      guidance,
      finding_count: entryFindings.length,
      by_category,
      observations,
      lines: entryLines.map((L) => ({
        line_id: L.line_id,
        line_number: L.line_number,
        hts: L.hts,
        coo: L.coo,
        entered_value: L.entered_value,
        ieepa_duty: L.ieepa_duty,
        filed_ch99: L.filed_ch99,
        computed_ch99: L.computed_ch99,
        filed_duty_total: L.filed_duty_total,
        computed_duty: L.computed_duty,
      })),
    };
  });
}

/** Stage A — parse only (no duty engine). */
export function ingestEs003(body: { xlsx_base64?: string; filename?: string }) {
  if (!body.xlsx_base64) throw new Error("Provide xlsx_base64 from an ACE ES-003 export.");
  const { lines, meta } = parseEs003Base64(body.xlsx_base64);
  return {
    ok: true,
    stage: "A" as const,
    filename: body.filename || null,
    meta,
    ready: true,
    message: `${meta.tariff_rows} tariff rows · ${meta.entry_lines} entry lines · ${meta.entries} entries — ready to audit`,
    preview_dates: { min: meta.date_min, max: meta.date_max },
    lines_sample: lines.slice(0, 3).map((l) => ({
      entry_number: l.entry_number,
      line_number: l.line_number,
      hts: l.hts,
      coo: l.coo,
      entry_date: l.entry_date,
    })),
  };
}

/** Parse (if needed), yield once, then audit so queued Duty-stack requests can run. */
export async function auditEs003Async(body: {
  xlsx_base64?: string;
  filename?: string;
  knowledge_date?: string;
  lines?: Es003ParsedLine[];
  meta?: Es003ParseMeta;
}) {
  const parsed = body.lines
    ? { lines: body.lines, meta: body.meta! }
    : body.xlsx_base64
      ? parseEs003Base64(body.xlsx_base64)
      : null;
  if (!parsed?.lines?.length) {
    throw new Error("Provide xlsx_base64 from an ACE ES-003 export.");
  }
  await yieldEventLoop();
  return auditEs003({
    filename: body.filename,
    knowledge_date: body.knowledge_date,
    lines: parsed.lines,
    meta: parsed.meta,
  });
}
