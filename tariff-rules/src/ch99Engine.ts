/**
 * US Chapter 99 stack engine — extracted from
 * the shared US Chapter 99 rule pack for reuse across tools.
 *
 * Pure functions only: no DOM, no XLSX, no audit-run state.
 * Rule rows load from data/ch99_rules.json (country reciprocal / IEEPA / §301 / EU cap seed pack).
 * On/after 2026-07-24, Section 301-FL (CSMS #69326983) layers via s301fl.ts.
 *
 * Primary entry points:
 *   expectedChapter99(coo, hts, mfnPct, rules, opts)
 *   rulesInEffectOn(rules, isoDate)
 *   resolveRateDeterminationDate(fields)
 *   evaluateCh99Check(row) — mutates row.CH99_CHECK
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessS301fl } from "./s301fl.ts";

export type Ch99Category =
  | "Reciprocal"
  | "Reciprocal-EU"
  | "IEEPA-Universal"
  | "IEEPA-China"
  | "IEEPA-India"
  | "Section-301"
  | "Section-122"
  | "Section-232"
  | "232-Exclusion"
  | string;

export interface Ch99Rule {
  coo: string;
  ch99: string;
  rate: number;
  category: Ch99Category;
  basis?: string;
  notes?: string;
  authority?: string;
  effective?: string;
  effective_from?: string | null;
  effective_to?: string | null;
  eu_cap_when?: "mfn_gte_15" | "mfn_lt_15" | string;
}

export interface Ch99Layer {
  ch99: string;
  rate_pct: number | null;
  category: Ch99Category;
  basis?: string;
  notes?: string;
  authority?: string;
  effective?: string;
  section301_fuzzy?: boolean;
  review_code?: string;
  eu_cap_branch?: "mfn_gte_15" | "mfn_lt_15";
  mfn_used?: number | null;
}

export interface RateDateFields {
  itDate?: unknown;
  warehouseWithdrawalDate?: unknown;
  overcarriedOriginalEntryDate?: unknown;
  latestReleaseDate?: unknown;
  entryDate?: unknown;
  importDate?: unknown;
  exportDate?: unknown;
  entryType?: unknown;
}

export interface ExpectedOpts {
  rateDate?: string | null;
  inTransitGrandfathered?: boolean;
}

export interface Ch99CheckRow {
  CH99_FILED: string[];
  CH99_EXPECTED: Ch99Layer[];
  CH99_CHECK?: string;
  CH99_REVIEW_CODE?: string;
  SECTION_232_STACK?: boolean;
  CH99_232_FILED?: string[];
  CH99_232_EXCLUSION?: string[];
}

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../data");

function loadPack(): {
  version: string;
  as_of: string;
  constants: Record<string, unknown>;
  rules: Ch99Rule[];
} {
  return JSON.parse(
    readFileSync(join(DATA, "ch99_rules.json"), "utf8"),
  );
}

const PACK = loadPack();

export const ENGINE_VERSION = PACK.version;
export const ENGINE_AS_OF = PACK.as_of;

export const ANNEX_I_EFFECTIVE_FROM = String(
  PACK.constants.ANNEX_I_EFFECTIVE_FROM,
);
export const ANNEX_I_EFFECTIVE_TO = String(PACK.constants.ANNEX_I_EFFECTIVE_TO);
export const EU_RECIPROCAL_START = String(PACK.constants.EU_RECIPROCAL_START);
export const EU_RECIPROCAL_IN_TRANSIT_ENTER_BY = String(
  PACK.constants.EU_RECIPROCAL_IN_TRANSIT_ENTER_BY,
);
export const EU_RECIPROCAL_PRIOR_CODE = String(
  PACK.constants.EU_RECIPROCAL_PRIOR_CODE,
);
export const EO14389_REVIEW_FROM = String(PACK.constants.EO14389_REVIEW_FROM);
export const EU_COUNTRIES = new Set(
  (PACK.constants.EU_COUNTRIES as string[]) || ["BG", "ES", "PT"],
);
export const EU_CAP_THRESHOLD_PCT = Number(
  PACK.constants.EU_CAP_THRESHOLD_PCT ?? 15,
);
export const EU_CAP_CODE_HIGH_MFN = String(
  PACK.constants.EU_CAP_CODE_HIGH_MFN ?? "9903.02.19",
);
export const EU_CAP_CODE_LOW_MFN = String(
  PACK.constants.EU_CAP_CODE_LOW_MFN ?? "9903.02.20",
);

/** Section 301 Forced Labor (CSMS #69326983) — replaces §122 prospectively. */
export const S301FL_EFFECTIVE_FROM = "2026-07-24";

export const SECTION_232_STEEL_PREFIX = "990381";
export const SECTION_232_ALUM_PREFIX = "990385";
export const SECTION_232_EXCLUSION_CODES = new Set(["99030133", "99030134"]);

/** Deep-cloned default rule pack (safe to mutate per tool). */
export function defaultCh99Rules(): Ch99Rule[] {
  return JSON.parse(JSON.stringify(PACK.rules)) as Ch99Rule[];
}

export function htsNormalize(s: unknown): string {
  return String(s ?? "").replace(/[.\s]/g, "");
}

export function htsFormat(s: unknown): string {
  const n = htsNormalize(s);
  if (n.length === 10)
    return `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6, 10)}`;
  if (n.length === 8)
    return `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6, 8)}`;
  return String(s ?? "");
}

export function parseRatePct(s: unknown): number | null {
  if (s == null) return null;
  const str = String(s).trim();
  if (str.toLowerCase() === "free") return 0.0;
  const m = str.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

export function parseIsoDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && isFinite(v) && v > 1 && v < 1e6) {
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(+d) ? null : d.toISOString().slice(0, 10);
  }
  if (v instanceof Date) {
    if (isNaN(+v)) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 1 && n < 1e6) {
      const ms = (n - 25569) * 86400 * 1000;
      const d = new Date(ms);
      return isNaN(+d) ? null : d.toISOString().slice(0, 10);
    }
  }
  const d = new Date(s);
  return isNaN(+d) ? null : d.toISOString().slice(0, 10);
}

export function isWarehouseWithdrawalEntry(entryType: unknown): boolean {
  const s = String(entryType || "").toLowerCase();
  return /\b31\b/.test(s) || s.includes("warehouse withdrawal");
}

/**
 * 19 CFR 141.68 / 141.69 rate-determination date.
 * Priority: IT → warehouse withdrawal → overcarried → release → entry → import → today.
 */
export function resolveRateDeterminationDate(fields: RateDateFields): {
  date: string;
  source: string;
  missing: string[];
} {
  const f = fields || {};
  const missing: string[] = [];

  const it = parseIsoDate(f.itDate);
  if (it) return { date: it, source: "it", missing };

  if (isWarehouseWithdrawalEntry(f.entryType)) {
    const wd =
      parseIsoDate(f.warehouseWithdrawalDate) || parseIsoDate(f.entryDate);
    if (wd) return { date: wd, source: "warehouse_withdrawal", missing };
    missing.push("warehouse_withdrawal_date");
  }

  const overcarried = parseIsoDate(f.overcarriedOriginalEntryDate);
  if (overcarried)
    return { date: overcarried, source: "overcarried_original", missing };

  const release = parseIsoDate(f.latestReleaseDate);
  if (release) return { date: release, source: "release", missing };

  const entry = parseIsoDate(f.entryDate);
  if (entry) {
    missing.push("latest_release_date");
    return { date: entry, source: "entry_fallback", missing };
  }
  const imp = parseIsoDate(f.importDate);
  if (imp) return { date: imp, source: "import_fallback", missing };
  return {
    date: new Date().toISOString().slice(0, 10),
    source: "today",
    missing,
  };
}

/** @deprecated prefer resolveRateDeterminationDate */
export function resolveApplicableDate(
  entryDate: unknown,
  importDate: unknown,
): { date: string; source: string; missing: string[] } {
  return resolveRateDeterminationDate({
    entryDate,
    importDate,
    latestReleaseDate: entryDate,
  });
}

export function isEuReciprocalInTransitGrandfathered(
  fields: RateDateFields,
  rateDateIso: string | null,
): boolean {
  const exportDate = parseIsoDate(fields?.exportDate);
  if (!exportDate || !rateDateIso) return false;
  return (
    exportDate < EU_RECIPROCAL_START &&
    rateDateIso < EU_RECIPROCAL_IN_TRANSIT_ENTER_BY
  );
}

export function buildCh99Opts(ctx: {
  rateDeterminationDate?: string | null;
  applicableDate?: string | null;
  euReciprocalInTransit?: boolean;
}): ExpectedOpts {
  const rateDate = ctx?.rateDeterminationDate || ctx?.applicableDate || null;
  return {
    rateDate,
    inTransitGrandfathered: !!ctx?.euReciprocalInTransit,
  };
}

export function rulesInEffectOn(
  rules: Ch99Rule[],
  isoDate: string | null | undefined,
): Ch99Rule[] {
  if (!isoDate) return rules;
  return rules.filter((r) => {
    const from = r.effective_from;
    const to = r.effective_to;
    if (from && isoDate < from) return false;
    if (to && isoDate > to) return false;
    return true;
  });
}

export function normalizeEuCapRules(rules: Ch99Rule[]): Ch99Rule[] {
  if (!Array.isArray(rules)) return rules;
  for (const r of rules) {
    if (r.category !== "Reciprocal-EU" || !EU_COUNTRIES.has(r.coo)) continue;
    const ch = htsNormalize(r.ch99);
    if (!r.eu_cap_when) {
      if (ch === htsNormalize(EU_CAP_CODE_HIGH_MFN)) r.eu_cap_when = "mfn_gte_15";
      if (ch === htsNormalize(EU_CAP_CODE_LOW_MFN)) r.eu_cap_when = "mfn_lt_15";
    }
    if (r.eu_cap_when === "mfn_gte_15") {
      r.ch99 = EU_CAP_CODE_HIGH_MFN;
      r.rate = 0;
    } else if (r.eu_cap_when === "mfn_lt_15") {
      r.ch99 = EU_CAP_CODE_LOW_MFN;
      r.rate = 15;
    }
  }
  return rules;
}

/**
 * EU cap MFN: prefer HTS-table Col-1. When broker filed .20 and col 33 is exactly
 * 15%, treat that 15% as replacement duty — not statutory MFN.
 */
export function getMfnRateForEuCap(
  hts: string,
  brokerRate: number | null | undefined,
  filedEuCapCode: string | null | undefined,
  htsLookup?: Map<string, { rate_pct: number }> | null,
): number | null {
  if (htsLookup) {
    const entry = htsLookup.get(htsNormalize(hts));
    if (entry != null) return entry.rate_pct;
  }
  const br =
    brokerRate != null && !isNaN(Number(brokerRate))
      ? Number(brokerRate)
      : null;
  if (br != null && br >= EU_CAP_THRESHOLD_PCT) {
    if (
      filedEuCapCode &&
      htsNormalize(filedEuCapCode) === htsNormalize(EU_CAP_CODE_LOW_MFN)
    ) {
      return null;
    }
  }
  return br;
}

export function filedEuCapCodeFromCh99(ch99Hts: string | null | undefined): string | null {
  const codes = String(ch99Hts || "")
    .split(",")
    .map((s) => htsNormalize(s.trim()))
    .filter(Boolean);
  if (codes.includes(htsNormalize(EU_CAP_CODE_HIGH_MFN)))
    return EU_CAP_CODE_HIGH_MFN;
  if (codes.includes(htsNormalize(EU_CAP_CODE_LOW_MFN)))
    return EU_CAP_CODE_LOW_MFN;
  return null;
}

export function isEuCapCh99Code(code: unknown): boolean {
  if (code == null || code === "") return false;
  const n = htsNormalize(String(code));
  return (
    n === htsNormalize(EU_CAP_CODE_HIGH_MFN) ||
    n === htsNormalize(EU_CAP_CODE_LOW_MFN)
  );
}

export function isEuCapCodeSwapMismatch(
  coo: string,
  expectedCodes: string[],
  filedCodes: string[],
): boolean {
  if (!EU_COUNTRIES.has((coo || "").trim().toUpperCase())) return false;
  const exp = new Set((expectedCodes || []).map((c) => htsNormalize(c)));
  const fil = new Set((filedCodes || []).map((c) => htsNormalize(c)));
  const expHigh = exp.has(htsNormalize(EU_CAP_CODE_HIGH_MFN));
  const expLow = exp.has(htsNormalize(EU_CAP_CODE_LOW_MFN));
  const filHigh = fil.has(htsNormalize(EU_CAP_CODE_HIGH_MFN));
  const filLow = fil.has(htsNormalize(EU_CAP_CODE_LOW_MFN));
  return (expHigh && filLow && !filHigh) || (expLow && filHigh && !filLow);
}

function priorEuReciprocalLayer(): Ch99Layer {
  return {
    ch99: EU_RECIPROCAL_PRIOR_CODE,
    rate_pct: 10.0,
    category: "IEEPA-Universal",
    basis: "IEEPA Universal baseline (pre–Aug 7, 2025)",
    notes: `Before ${EU_RECIPROCAL_START}, or in-transit grandfathered through ${EU_RECIPROCAL_IN_TRANSIT_ENTER_BY}, EU reciprocal uses prior 10% regime (${EU_RECIPROCAL_PRIOR_CODE}).`,
    authority: "EO 14257 / in-transit carve-out per CSMS #65829726",
    effective: `before ${EU_RECIPROCAL_START}`,
  };
}

function euNeedsReviewEo14389Layer(rateDate: string): Ch99Layer {
  return {
    ch99: "—",
    rate_pct: null,
    category: "Reciprocal-EU",
    basis: "EO 14389 — tariff review required",
    review_code: "NEEDS_REVIEW_EO14389",
    notes: `Rate determination date ${rateDate} is on/after ${EO14389_REVIEW_FROM}. USITC has not modified HTS — human review required; do not auto-clear EU reciprocal expectations.`,
    authority: "EO 14389 (Ending Certain Tariff Actions, Feb 2026)",
    effective: `from ${EO14389_REVIEW_FROM}`,
  };
}

export function resolveEuReciprocalLayer(
  mfnPct: number | null | undefined,
  rules: Ch99Rule[],
  coo: string,
): Ch99Layer {
  const euRules = (rules || []).filter(
    (r) => r.coo === coo && r.category === "Reciprocal-EU",
  );
  const gteRule =
    euRules.find((r) => r.eu_cap_when === "mfn_gte_15") ||
    euRules.find(
      (r) => htsNormalize(r.ch99) === htsNormalize(EU_CAP_CODE_HIGH_MFN),
    );
  const ltRule =
    euRules.find((r) => r.eu_cap_when === "mfn_lt_15") ||
    euRules.find(
      (r) => htsNormalize(r.ch99) === htsNormalize(EU_CAP_CODE_LOW_MFN),
    );
  const useHigh = mfnPct != null && mfnPct >= EU_CAP_THRESHOLD_PCT;
  const rule = useHigh ? gteRule : ltRule;
  const ch99 =
    rule?.ch99 || (useHigh ? EU_CAP_CODE_HIGH_MFN : EU_CAP_CODE_LOW_MFN);
  const rate_pct = rule?.rate ?? (useHigh ? 0.0 : 15.0);
  return {
    ch99,
    rate_pct,
    category: "Reciprocal-EU",
    basis:
      rule?.basis ||
      (useHigh ? "Reciprocal EU (high-MFN cap)" : "Reciprocal EU (additive)"),
    notes:
      rule?.notes ||
      (useHigh
        ? `EU MFN ≥ ${EU_CAP_THRESHOLD_PCT}%`
        : `EU MFN < ${EU_CAP_THRESHOLD_PCT}% (additive to reach 15%)`),
    authority: rule?.authority || "EO 14326 (Aug 5, 2025)",
    effective: rule?.effective || "Aug 7, 2025 → Feb 24, 2026",
    eu_cap_branch: useHigh ? "mfn_gte_15" : "mfn_lt_15",
    mfn_used: mfnPct ?? null,
  };
}

function section122Layer(rules: Ch99Rule[]): Ch99Layer | null {
  const r = (rules || []).find(
    (x) => x.coo === "*" && x.category === "Section-122",
  );
  if (!r) return null;
  return {
    ch99: r.ch99,
    rate_pct: r.rate,
    category: "Section-122",
    basis: r.basis,
    notes: r.notes,
    authority: r.authority || "—",
    effective: r.effective || "—",
  };
}

/**
 * 301-FL layer when rate date is on/after 2026-07-24.
 * mfnPct is percent points (16.6 → 0.166 decimal for assessS301fl).
 */
export function section301FlLayer(
  coo: string,
  mfnPct: number | null | undefined,
  rateDate: string | null | undefined,
): Ch99Layer | null {
  if (!rateDate || rateDate < S301FL_EFFECTIVE_FROM) return null;
  const col1Decimal =
    mfnPct == null || Number.isNaN(Number(mfnPct)) ? 0 : Number(mfnPct) / 100;
  const a = assessS301fl(coo, col1Decimal);
  if (a.kind === "out_of_scope") return null;
  return {
    ch99: a.heading,
    rate_pct: a.rate_pct_decimal * 100,
    category: "Section-301-FL",
    basis: a.label,
    notes: a.reason,
    authority: "Section 301 Forced Labor — CSMS #69326983",
    effective: `from ${S301FL_EFFECTIVE_FROM}`,
  };
}

export function collapseSection301Expected(out: Ch99Layer[]): Ch99Layer[] {
  const sec301Entries = out.filter((e) => e.category === "Section-301");
  if (sec301Entries.length === 0) return out;
  const nonSec301 = out.filter((e) => e.category !== "Section-301");
  nonSec301.push({
    ch99: "9903.88.15",
    rate_pct: 7.5,
    category: "Section-301",
    section301_fuzzy: true,
    basis: "Section 301 (List 1/2/3/4A — code varies by HTS)",
    notes:
      "Engine cannot determine HTS-level list membership. Any 9903.88.01/02/03/15 satisfies coverage; broker classification is authoritative.",
    authority: "USTR Section 301 (Trade Act of 1974)",
    effective: "2018–2019 → present",
  });
  return nonSec301;
}

/**
 * Expected Chapter 99 stack for a line.
 * @param mfnPct true HTSUS Column 1 (General) rate — required for EU .19/.20 branch
 */
export function expectedChapter99(
  country: string,
  _hts: string,
  mfnPct: number | null | undefined,
  rules: Ch99Rule[],
  opts?: ExpectedOpts,
): Ch99Layer[] {
  const c = (country || "").trim().toUpperCase();
  const rateDate = opts?.rateDate || null;
  const inTransit = !!opts?.inTransitGrandfathered;
  const out: Ch99Layer[] = [];
  const s122 = section122Layer(rules);
  const euReciprocalActive = (rules || []).some(
    (r) =>
      r.coo === c &&
      (r.category === "Reciprocal-EU" || r.category === "Reciprocal"),
  );

  if (EU_COUNTRIES.has(c)) {
    // On/after 301-FL effective date, EU uses threshold 301-FL (not EO 14389 review).
    const flEu = section301FlLayer(c, mfnPct, rateDate);
    if (flEu) {
      out.push(flEu);
      return collapseSection301Expected(out);
    }
    if (rateDate && rateDate >= EO14389_REVIEW_FROM) {
      out.push(euNeedsReviewEo14389Layer(rateDate));
      return collapseSection301Expected(out);
    }
    if (inTransit || (rateDate && rateDate < EU_RECIPROCAL_START)) {
      out.push(priorEuReciprocalLayer());
      return collapseSection301Expected(out);
    }
    if (euReciprocalActive) {
      out.push(resolveEuReciprocalLayer(mfnPct, rules, c));
      return collapseSection301Expected(out);
    }
    if (s122) out.push(s122);
    return collapseSection301Expected(out);
  }

  for (const r of rules) {
    if (r.coo === c && r.coo !== "*" && !EU_COUNTRIES.has(r.coo)) {
      out.push({
        ch99: r.ch99,
        rate_pct: r.rate,
        category: r.category || "Reciprocal",
        basis: r.basis,
        notes: r.notes,
        authority: r.authority || "—",
        effective: r.effective || "—",
      });
    }
  }
  if (s122) out.push(s122);
  const fl = section301FlLayer(c, mfnPct, rateDate);
  if (fl) out.push(fl);
  return collapseSection301Expected(out);
}

export function isSection301Code(code: string): boolean {
  return /^99038[78]/.test(htsNormalize(code));
}

export function isSection232Code(code: string): boolean {
  const n = htsNormalize(code);
  return (
    n.startsWith(SECTION_232_STEEL_PREFIX) ||
    n.startsWith(SECTION_232_ALUM_PREFIX)
  );
}

export function is232ReciprocalExclusion(code: string): boolean {
  return SECTION_232_EXCLUSION_CODES.has(htsNormalize(code));
}

export function partitionCh99NormCodes(normCodes: string[]): {
  reciprocal: string[];
  section232: string[];
  exclusion232: string[];
  section301: string[];
  other: string[];
} {
  const reciprocal: string[] = [];
  const section232: string[] = [];
  const exclusion232: string[] = [];
  const section301: string[] = [];
  const other: string[] = [];
  for (const n of normCodes) {
    if (isSection301Code(n)) section301.push(n);
    else if (isSection232Code(n)) section232.push(n);
    else if (is232ReciprocalExclusion(n)) exclusion232.push(n);
    else if (/^9903/.test(n)) reciprocal.push(n);
    else other.push(n);
  }
  return { reciprocal, section232, exclusion232, section301, other };
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/** Mutates row with CH99_CHECK: MATCH | MISMATCH | MISSING | PARTIAL | REVIEW | — */
export function evaluateCh99Check(row: Ch99CheckRow): void {
  const filNorm = row.CH99_FILED.map((c) => htsNormalize(c));
  const expNorm = row.CH99_EXPECTED.map((e) => htsNormalize(e.ch99)).filter(
    (c) => c && c !== "—",
  );
  const filPart = partitionCh99NormCodes(filNorm);
  const expPart = partitionCh99NormCodes(expNorm);
  const has232Stack =
    filPart.section232.length > 0 || filPart.exclusion232.length > 0;

  if (row.CH99_EXPECTED.some((e) => e.review_code === "NEEDS_REVIEW_EO14389")) {
    row.CH99_CHECK = "REVIEW";
    row.CH99_REVIEW_CODE = "NEEDS_REVIEW_EO14389";
    return;
  }

  if (has232Stack) {
    row.SECTION_232_STACK = true;
    row.CH99_232_FILED = filPart.section232.map(htsFormat);
    row.CH99_232_EXCLUSION = filPart.exclusion232.map(htsFormat);
  }

  if (filNorm.length === 0 && expNorm.length === 0) {
    row.CH99_CHECK = "—";
    return;
  }

  const expHas301 = row.CH99_EXPECTED.some(
    (e) => e.section301_fuzzy || isSection301Code(e.ch99),
  );
  const filHas301 = filPart.section301.length > 0;

  const expRec = new Set(has232Stack ? [] : expPart.reciprocal);
  const filRec = new Set(filPart.reciprocal);
  const expNonRec = new Set([...expPart.section301, ...expPart.other]);
  const filNonRec = new Set([...filPart.section301, ...filPart.other]);

  let reciprocalOk = setsEqual(expRec, filRec);
  if (has232Stack && filRec.size === 0) reciprocalOk = true;

  let section301Ok = true;
  if (expHas301 && filHas301) section301Ok = true;
  else if (expHas301 && !filHas301) {
    row.CH99_CHECK = "PARTIAL";
    return;
  } else if (!expHas301 && filHas301) section301Ok = false;

  const section232Ok = !has232Stack || filPart.section232.length > 0;
  const otherOk = section301Ok
    ? setsEqual(expPart.other, filPart.other) ||
      (expPart.other.length === 0 && filPart.other.length === 0)
    : setsEqual(expNonRec, filNonRec) ||
      (expNonRec.size === 0 && filNonRec.size === 0);

  if (reciprocalOk && section301Ok && section232Ok && otherOk) {
    row.CH99_CHECK = "MATCH";
    return;
  }
  if (has232Stack && reciprocalOk && section301Ok && section232Ok) {
    row.CH99_CHECK = "MATCH";
    return;
  }
  if (filNorm.length === 0 && expNorm.length > 0) {
    row.CH99_CHECK = "MISSING";
    return;
  }
  row.CH99_CHECK = "MISMATCH";
}

/** Convenience: filter default pack + expected stack for one line. */
export function assessLineCh99(input: {
  coo: string;
  hts?: string;
  mfnPct?: number | null;
  rateDate?: string | null;
  exportDate?: string | null;
  rules?: Ch99Rule[];
}): { rulesUsed: Ch99Rule[]; expected: Ch99Layer[]; opts: ExpectedOpts } {
  const fields: RateDateFields = {
    exportDate: input.exportDate,
    entryDate: input.rateDate,
    latestReleaseDate: input.rateDate,
  };
  const rateDate =
    input.rateDate || resolveRateDeterminationDate(fields).date;
  const opts: ExpectedOpts = {
    rateDate,
    inTransitGrandfathered: isEuReciprocalInTransitGrandfathered(
      fields,
      rateDate,
    ),
  };
  const base = normalizeEuCapRules(input.rules || defaultCh99Rules());
  const rulesUsed = rulesInEffectOn(base, rateDate);
  const expected = expectedChapter99(
    input.coo,
    input.hts || "",
    input.mfnPct ?? null,
    rulesUsed,
    opts,
  );
  return { rulesUsed, expected, opts };
}
