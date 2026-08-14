/**
 * Section 232 patented pharmaceuticals & ingredients (Proclamation 11020).
 * Headings 9903.04.60–.69 — CSMS #69395344; UK rate cut CSMS #69415934.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EU_MEMBERS } from "./s301fl.ts";

export const S232_PHARMA_START = "2026-07-31";
export const S232_PHARMA_OTHER_DUTY_START = "2026-09-29";

type Heading = {
  code: string;
  rate_pct: number;
  prior_rate_pct?: number;
  rate_kind: "additional" | "combined_col1_and_232";
  label: string;
  basis: string;
  origins?: string[];
  rate_effective?: string;
  valid_through?: string;
  expires?: string;
  source_csms?: string;
};

type Pack = {
  program: Record<string, unknown>;
  chapters: number[];
  claim_flag_patented: string;
  claim_flag_generic: string;
  headings: Heading[];
  sources: string[];
};

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../data/s232_pharma.json");

let pack: Pack | null = null;

function load(): Pack {
  if (pack) return pack;
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  return pack;
}

export function reloadS232Pharma(): Pack {
  pack = null;
  return load();
}

export function s232PharmaMeta() {
  const p = load();
  return {
    id: p.program.id,
    proclamation: p.program.proclamation,
    effective: p.program.effective,
    source_csms: p.program.source_csms,
    chapters: p.chapters,
    sources: p.sources,
  };
}

export function s232PharmaAppliesOn(d: string | null | undefined): boolean {
  const x = String(d || "").slice(0, 10);
  return Boolean(x && x >= S232_PHARMA_START);
}

/** HTS in Chapter 29 or 30 (subject universe for reporting; exact Note 40(c) list TBD). */
export function htsIn232PharmaChapters(hts: string): boolean {
  const digits = String(hts || "").replace(/\D/g, "");
  if (digits.length < 2) return false;
  const ch = Number(digits.slice(0, 2));
  return ch === 29 || ch === 30;
}

export function s232PharmaClaimed(flags?: Record<string, boolean> | null): {
  patented: boolean;
  generic: boolean;
} {
  const f = flags || {};
  return {
    patented: Boolean(
      f.s232_pharma_patented || f.s232_pharma || f.pharma_patented || f.patented_pharma,
    ),
    generic: Boolean(f.s232_pharma_generic || f.pharma_generic || f.generic_pharma),
  };
}

function headingByCode(code: string): Heading | undefined {
  return load().headings.find((h) => h.code === code);
}

function resolveOriginBucket(coo: string): string {
  const iso = String(coo || "").trim().toUpperCase();
  if (!iso) return "";
  if (EU_MEMBERS.has(iso)) return "EU";
  return iso;
}

export type S232PharmaAssessment = {
  applies: boolean;
  heading: string;
  rate_pct_decimal: number;
  rate_kind: Heading["rate_kind"];
  label: string;
  reason: string;
  suppresses_301fl: boolean;
  /** True when MFN/Col-1 interaction needs review (combined rates). */
  combined_rate_tbc: boolean;
};

/**
 * Resolve Proclamation 11020 Chapter 99 for a line.
 * Requires an explicit patented / generic claim and Ch.29/30 HTS (list membership is claim-gated until the full Note 40(c) file is seeded).
 */
export function assessS232Pharma(opts: {
  hts: string;
  coo: string;
  rateDay: string;
  flags?: Record<string, boolean> | null;
}): S232PharmaAssessment | null {
  if (!s232PharmaAppliesOn(opts.rateDay)) return null;
  const claim = s232PharmaClaimed(opts.flags);
  if (!claim.patented && !claim.generic) return null;

  const inCh = htsIn232PharmaChapters(opts.hts);
  if (!inCh) {
    return {
      applies: false,
      heading: "",
      rate_pct_decimal: 0,
      rate_kind: "additional",
      label: "232 pharma — HTS not Ch.29/30",
      reason: `Section 232 pharma claim asserted, but HTS ${opts.hts || "(blank)"} is outside Chapters 29–30 (Proclamation 11020 / U.S. note 40(c)). No 9903.04.xx layer.`,
      suppresses_301fl: false,
      combined_rate_tbc: false,
    };
  }

  if (claim.generic) {
    const h = headingByCode("9903.04.67")!;
    return {
      applies: true,
      heading: h.code,
      rate_pct_decimal: h.rate_pct / 100,
      rate_kind: h.rate_kind,
      label: h.label,
      reason: `Generic pharmaceutical articles — report ${h.code} @ 0% additional (CSMS #69395344). Confirm goods are generic under U.S. note 40.`,
      suppresses_301fl: false,
      combined_rate_tbc: false,
    };
  }

  // Patented path — country / special headings
  const bucket = resolveOriginBucket(opts.coo);
  if (bucket === "GB") {
    const h = headingByCode("9903.04.63")!;
    return {
      applies: true,
      heading: h.code,
      rate_pct_decimal: h.rate_pct / 100,
      rate_kind: h.rate_kind,
      label: h.label,
      reason: `United Kingdom patented pharmaceuticals / ingredients — ${h.code} @ 0% additional ad valorem from ${h.rate_effective || S232_PHARMA_START} (CSMS #69415934; was ${h.prior_rate_pct ?? 10}% additional). Column-1 still stacks. 301-FL suppressed via 9903.05.90 (Note 52(f) 232 universe).`,
      suppresses_301fl: true,
      combined_rate_tbc: false,
    };
  }

  if (["JP", "EU", "KR", "CH", "LI"].includes(bucket)) {
    const h = headingByCode("9903.04.62")!;
    return {
      applies: true,
      heading: h.code,
      rate_pct_decimal: h.rate_pct / 100,
      rate_kind: h.rate_kind,
      label: h.label,
      reason: `${bucket} patented pharma — ${h.code} @ ${h.rate_pct}% (combined Column-1 + 232 per CSMS #69395344). MFN interaction treated as TBC in this tool; 301-FL suppressed via 9903.05.90.`,
      suppresses_301fl: true,
      combined_rate_tbc: true,
    };
  }

  // Default Annex III / other — use .60; note interim .61 window for non-Annex III
  const day = String(opts.rateDay || "").slice(0, 10);
  if (day && day < S232_PHARMA_OTHER_DUTY_START) {
    const h = headingByCode("9903.04.61")!;
    return {
      applies: true,
      heading: h.code,
      rate_pct_decimal: 0,
      rate_kind: h.rate_kind,
      label: h.label,
      reason: `Patented pharma (non-UK preferential origin) entered before ${S232_PHARMA_OTHER_DUTY_START} — interim ${h.code} @ 0% if not Annex III (CSMS #69395344). Confirm Annex III company status. 301-FL suppressed via 9903.05.90 when treated as patented 232 universe.`,
      suppresses_301fl: true,
      combined_rate_tbc: false,
    };
  }

  const h = headingByCode("9903.04.60")!;
  return {
    applies: true,
    heading: h.code,
    rate_pct_decimal: h.rate_pct / 100,
    rate_kind: h.rate_kind,
    label: h.label,
    reason: `Patented pharma default ${h.code} @ ${h.rate_pct}% combined (Annex III path). Confirm company annex and any lower preferential heading. 301-FL suppressed via 9903.05.90.`,
    suppresses_301fl: true,
    combined_rate_tbc: true,
  };
}
