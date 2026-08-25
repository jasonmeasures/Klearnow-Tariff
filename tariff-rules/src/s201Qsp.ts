/**
 * Section 201 quartz surface products TRQ (U.S. note 41).
 * Live 2026-08-15 through 2030-08-14. Stacks with 301-FL — does not suppress it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileStems, matchStem } from "./s232Stems.ts";

export const S201_QSP_IN_QUOTA = "9903.45.30";
export const S201_QSP_OVER_QUOTA = "9903.45.31";
export const S201_QSP_PROGRAM = "SEC_201_QSP";

type RateRow = { from: string; to: string; in_quota_pct: number; over_quota_pct: number };

type Pack = {
  program: {
    id: string;
    name: string;
    authority: string;
    source_fr: string;
    source_url: string;
    annex_url: string;
    effective: string;
    expires: string;
    in_quota_heading: string;
    over_quota_heading: string;
    detail: string;
  };
  hts_covered: string[];
  rate_schedule: RateRow[];
  exempt_iso2: Record<string, string[]>;
  sources: string[];
  scope_note: string;
};

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../data/s201_qsp.json");

let pack: Pack | null = null;
let stems: string[] = [];
let exempt = new Set<string>();

function load(): Pack {
  if (pack) return pack;
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  stems = compileStems(pack.hts_covered);
  exempt = new Set(
    Object.values(pack.exempt_iso2)
      .flat()
      .map((c) => String(c).toUpperCase()),
  );
  return pack;
}

export function reloadS201Qsp(): Pack {
  pack = null;
  return load();
}

export function s201QspMeta() {
  const p = load();
  return {
    id: p.program.id,
    name: p.program.name,
    effective: p.program.effective,
    expires: p.program.expires,
    in_quota_heading: p.program.in_quota_heading,
    over_quota_heading: p.program.over_quota_heading,
    hts_covered: [...p.hts_covered],
    source_url: p.program.source_url,
    sources: p.sources,
  };
}

export function isS201QspHeading(code: string): boolean {
  const c = String(code || "").trim();
  return c === S201_QSP_IN_QUOTA || c === S201_QSP_OVER_QUOTA;
}

export function s201QspAppliesOn(rateDay: string | null | undefined): boolean {
  load();
  const day = String(rateDay || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day >= pack!.program.effective && day <= pack!.program.expires;
}

export function matchS201QspHts(hts: string): { matched_stem: string } | null {
  load();
  const hit = matchStem(hts, stems);
  return hit ? { matched_stem: hit.matched_stem } : null;
}

export function isS201QspExemptOrigin(coo: string): boolean {
  load();
  return exempt.has(String(coo || "").trim().toUpperCase());
}

export function ratesForS201Qsp(rateDay: string | null | undefined): RateRow | null {
  const p = load();
  const day = String(rateDay || "").slice(0, 10);
  if (!s201QspAppliesOn(day)) return null;
  return p.rate_schedule.find((r) => day >= r.from && day <= r.to) || null;
}

export function previewS201Qsp(hts: string): {
  covered: boolean;
  matched_stem: string | null;
  in_quota: string;
  over_quota: string;
} {
  const hit = matchS201QspHts(hts);
  const p = load();
  return {
    covered: Boolean(hit),
    matched_stem: hit?.matched_stem || null,
    in_quota: p.program.in_quota_heading,
    over_quota: p.program.over_quota_heading,
  };
}

function flag(flags: Record<string, boolean> | null | undefined, ...keys: string[]): boolean {
  const f = flags || {};
  return keys.some((k) => Boolean(f[k]));
}

export type S201QspAssessment = {
  heading: string;
  rate_pct_decimal: number;
  rate_pct: number;
  label: string;
  reason: string;
  over_quota: boolean;
  matched_stem: string;
  exempt: boolean;
};

export function assessS201Qsp(opts: {
  hts: string;
  coo: string;
  rateDay?: string | null;
  flags?: Record<string, boolean> | null;
  filed_ch99?: string[];
}): S201QspAssessment | null {
  const p = load();
  const htsHit = matchS201QspHts(opts.hts);
  if (!htsHit) return null;

  const flags = opts.flags || {};
  if (flag(flags, "s201_not_qsp", "not_qsp", "s201_qsp_out_of_scope")) {
    return {
      heading: S201_QSP_IN_QUOTA,
      rate_pct_decimal: 0,
      rate_pct: 0,
      label: "Section 201 QSP — out of scope (claimed)",
      reason: `HTS stem ${htsHit.matched_stem} is on the QSP statistical list, but flags.s201_not_qsp is set (note 41(a) quarried stone / non-QSP). ${p.scope_note}`,
      over_quota: false,
      matched_stem: htsHit.matched_stem,
      exempt: true,
    };
  }

  const coo = String(opts.coo || "").trim().toUpperCase();
  if (coo && isS201QspExemptOrigin(coo)) {
    return {
      heading: S201_QSP_IN_QUOTA,
      rate_pct_decimal: 0,
      rate_pct: 0,
      label: "Section 201 QSP — origin exempt (note 41(c))",
      reason: `Product of ${coo} is exempt from the QSP TRQ under U.S. note 41(c). Imports from this origin do not count against the quota.`,
      over_quota: false,
      matched_stem: htsHit.matched_stem,
      exempt: true,
    };
  }

  if (!s201QspAppliesOn(opts.rateDay)) {
    return null;
  }

  const row = ratesForS201Qsp(opts.rateDay);
  if (!row) return null;

  const filed = (opts.filed_ch99 || []).map((c) => String(c || "").trim());
  const over =
    flag(flags, "s201_qsp_over_quota", "s201_over_quota") ||
    filed.includes(S201_QSP_OVER_QUOTA);
  const pct = over ? row.over_quota_pct : row.in_quota_pct;
  const heading = over ? S201_QSP_OVER_QUOTA : S201_QSP_IN_QUOTA;
  return {
    heading,
    rate_pct_decimal: pct / 100,
    rate_pct: pct,
    label: over
      ? `Section 201 Quartz Surface Products — over quota (${pct}%)`
      : `Section 201 Quartz Surface Products — within quota (${pct}%)`,
    reason: `U.S. note 41 QSP stem ${htsHit.matched_stem} → ${heading} @ ${pct}% additional (${row.from}–${row.to}). Stacks with 301-FL / Column 1 / AD/CVD. Default is in-quota; tick over-quota or file ${S201_QSP_OVER_QUOTA} when the quarterly TRQ is exhausted.`,
    over_quota: over,
    matched_stem: htsHit.matched_stem,
    exempt: false,
  };
}
