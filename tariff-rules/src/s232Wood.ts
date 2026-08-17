/**
 * Section 232 timber / lumber / wood derivatives — Proclamation 10976.
 * CSMS #66492057. Autos 232 wins if both apply.
 */
import pack from "../data/s232_wood.json" with { type: "json" };
import { EU_MEMBERS } from "./s301fl.ts";
import { compileStems, matchStem, onOrAfter } from "./s232Stems.ts";

export const S232_WOOD_START = String(pack.program.effective);

type Bucket = {
  id: string;
  label: string;
  heading: string;
  rate_pct: number;
  origin_split: boolean;
  not_completed_heading?: string;
  hts: string[];
};

const BUCKETS = (pack.buckets as Bucket[]).map((b) => ({
  ...b,
  stems: compileStems(b.hts),
}));

export type WoodHit = {
  hts: string;
  matched_stem: string;
  bucket: string;
  label: string;
  heading: string;
  rate_pct: number;
  source: string;
};

function originHeading(coo: string): string | null {
  const iso = String(coo || "").trim().toUpperCase();
  if (!iso) return null;
  const pref = pack.preferential_origins as Record<string, string>;
  if (iso === "GB") return pref.GB;
  if (iso === "JP") return pref.JP;
  if (EU_MEMBERS.has(iso)) return pref.EU;
  return null;
}

function rateFor(heading: string, fallback: number): number {
  if (heading === "9903.76.01") return 10;
  if (heading === "9903.76.02" || heading === "9903.76.03") return 25;
  if (heading === "9903.76.04") return 0;
  const pref = pack.preferential_rates as Record<string, { rate_pct: number }>;
  return pref[heading]?.rate_pct ?? fallback;
}

export function match232Wood(hts: string, coo: string, flags?: Record<string, boolean> | null): WoodHit | null {
  for (const b of BUCKETS) {
    const hit = matchStem(hts, b.stems);
    if (!hit) continue;
    if (b.not_completed_heading && flags?.s232_wood_not_cabinet) {
      return {
        ...hit,
        bucket: b.id,
        label: `${b.label} — not completed cabinet/vanity`,
        heading: b.not_completed_heading,
        rate_pct: 0,
        source: pack.source as string,
      };
    }
    let heading = b.heading;
    if (b.origin_split) {
      heading = originHeading(coo) || b.heading;
    }
    return {
      ...hit,
      bucket: b.id,
      label: b.label,
      heading,
      rate_pct: rateFor(heading, b.rate_pct),
      source: pack.source as string,
    };
  }
  return null;
}

export function isOn232WoodList(hts: string): boolean {
  return BUCKETS.some((b) => matchStem(hts, b.stems));
}

export function s232WoodMeta() {
  return {
    id: pack.program.id,
    effective: pack.program.effective,
    source_csms: pack.program.source_csms,
    buckets: BUCKETS.map((b) => ({ id: b.id, stem_count: b.stems.length, heading: b.heading })),
  };
}

export function s232WoodAppliesOn(d: string | null | undefined): boolean {
  return onOrAfter(d, S232_WOOD_START);
}
