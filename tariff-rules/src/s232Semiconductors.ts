/**
 * Section 232 semiconductors — January 14, 2026 proclamation / U.S. note 39.
 * CSMS #67400472. 25% only when TPP/DRAM params are claimed — HTS alone is not enough.
 */
import pack from "../data/s232_semiconductors.json" with { type: "json" };
import { compileStems, matchStem, onOrAfter } from "./s232Stems.ts";

export const S232_SEMI_START = String(pack.program.effective);

const STEMS = compileStems(pack.hts as string[]);

type Heading = {
  code: string;
  rate_pct: number;
  rate_kind: string;
  label: string;
  claim_flag: string;
};

const HEADINGS = pack.headings as Heading[];

export function match232SemiconductorHts(hts: string) {
  const hit = matchStem(hts, STEMS);
  if (!hit) return null;
  return { ...hit, source: pack.source as string };
}

export function isOn232SemiconductorList(hts: string): boolean {
  return Boolean(match232SemiconductorHts(hts));
}

function claimedHeading(flags?: Record<string, boolean> | null): Heading | null {
  const f = flags || {};
  // Duty claim first, then first matching 0% exclusion.
  const duty = HEADINGS.find((h) => h.code === "9903.79.01");
  if (duty && (f[duty.claim_flag] || f.s232_semi)) return duty;
  for (const h of HEADINGS) {
    if (h.code === "9903.79.01") continue;
    if (f[h.claim_flag]) return h;
  }
  return null;
}

export function assessS232Semiconductors(opts: {
  hts: string;
  rateDay: string;
  flags?: Record<string, boolean> | null;
}): {
  on_list: boolean;
  applies: boolean;
  heading: string;
  rate_pct: number;
  label: string;
  reason: string;
} | null {
  if (!onOrAfter(opts.rateDay, S232_SEMI_START)) return null;
  const list = match232SemiconductorHts(opts.hts);
  if (!list) return null;
  const h = claimedHeading(opts.flags);
  if (!h) {
    return {
      on_list: true,
      applies: false,
      heading: "",
      rate_pct: 0,
      label: "232 semiconductors — params not claimed",
      reason: `HTS matches semiconductor 232 list stem ${list.matched_stem} (8471.50 / 8471.80 / 8473.30). 9903.79.01 @ 25% applies only if the article meets U.S. note 39(b) TPP/DRAM bands — claim s232_semiconductor. Use 9903.79.02–.09 for the listed 0% exclusions.`,
    };
  }
  return {
    on_list: true,
    applies: true,
    heading: h.code,
    rate_pct: h.rate_pct,
    label: h.label,
    reason: `${h.label} — ${h.code} @ ${h.rate_pct}% additional (CSMS #67400472). 301-FL suppressed via 9903.05.90.`,
  };
}

export function s232SemiMeta() {
  return {
    id: pack.program.id,
    effective: pack.program.effective,
    source_csms: pack.program.source_csms,
    stem_count: STEMS.length,
    headings: HEADINGS.map((h) => h.code),
  };
}
