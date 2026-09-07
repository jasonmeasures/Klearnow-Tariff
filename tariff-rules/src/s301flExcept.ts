/**
 * Section 301-FL HTS exception lists (Note 52(b)–(j)).
 * Source: tariff-rules/data/s301fl_except_hts.json (imported from Trump Tariffs workbook).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EU_MEMBERS, listFlClaimExemptions } from "./s301fl.ts";

export const FL_EXCEPT_AUTO = new Set(["9903.05.86", "9903.05.87"]);
export const FL_EXCEPT_AIRCRAFT = "9903.05.88";
export const FL_EXCEPT_PHARMA = "9903.05.89";

type HeadingBlock = {
  heading: string;
  hts_count: number;
  stems: string[];
  hts10?: string[];
};

type Pack = {
  version: string;
  as_of: string;
  source: string;
  by_heading: Record<string, HeadingBlock>;
};

const DATA = join(
  dirname(fileURLToPath(import.meta.url)),
  "../data/s301fl_except_hts.json",
);

let pack: Pack | null = null;
/** heading → sorted stems (longest first) */
let stemsByHeading: Map<string, string[]> | null = null;
/** stem prefix → headings that contain it (for reverse lookup) */
let headingByStem: Map<string, string[]> | null = null;
/** heading → allowed ISO2 origins (economy-specific Note 52(j)) */
let originsByHeading: Map<string, Set<string>> | null = null;

function digits(hts: string): string {
  return String(hts || "").replace(/\D/g, "");
}

function load(): Pack {
  if (pack) return pack;
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  stemsByHeading = new Map();
  headingByStem = new Map();
  for (const [heading, block] of Object.entries(pack.by_heading)) {
    const stems = [...(block.stems || [])].sort((a, b) => b.length - a.length);
    stemsByHeading.set(heading, stems);
    for (const s of stems) {
      const list = headingByStem.get(s) || [];
      if (!list.includes(heading)) list.push(heading);
      headingByStem.set(s, list);
    }
    for (const h of block.hts10 || []) {
      const s = digits(h);
      if (!s) continue;
      const list = headingByStem.get(s) || [];
      if (!list.includes(heading)) list.push(heading);
      headingByStem.set(s, list);
    }
  }
  originsByHeading = new Map();
  for (const ex of listFlClaimExemptions()) {
    originsByHeading.set(
      ex.heading,
      new Set(ex.origins.map((o) => o.toUpperCase())),
    );
  }
  return pack;
}

export function reloadS301flExcept(): Pack {
  pack = null;
  stemsByHeading = null;
  headingByStem = null;
  originsByHeading = null;
  return load();
}

export function s301flExceptMeta() {
  const p = load();
  return {
    version: p.version,
    as_of: p.as_of,
    source: p.source,
    headings: Object.fromEntries(
      Object.entries(p.by_heading).map(([h, b]) => [h, b.hts_count]),
    ),
  };
}

function matchStem(hts: string, stems: string[]): string | null {
  const d = digits(hts);
  if (!d) return null;
  for (const s of stems) {
    if (d.startsWith(s) || s.startsWith(d)) return s;
  }
  if (d.length >= 8) {
    const d8 = d.slice(0, 8);
    for (const s of stems) {
      if (s.slice(0, 8) === d8) return s.slice(0, 8);
    }
  }
  return null;
}

/** All exception headings whose list matches this HTS. */
export function headingsForFlExceptHts(hts: string): string[] {
  load();
  const d = digits(hts);
  if (!d || !headingByStem) return [];
  const hits = new Set<string>();
  for (const [stem, headings] of headingByStem.entries()) {
    if (d.startsWith(stem) || stem.startsWith(d)) {
      for (const h of headings) hits.add(h);
    }
  }
  return [...hits];
}

function cooInHeadingOrigins(coo: string, heading: string): boolean {
  load();
  const iso = String(coo || "").trim().toUpperCase();
  if (!iso || !originsByHeading) return false;
  const allowed = originsByHeading.get(heading);
  if (!allowed) return false;
  if (allowed.has(iso)) return true;
  if (EU_MEMBERS.has(iso) && allowed.has("EU")) return true;
  return false;
}

export type FlExceptHit = {
  heading: string;
  matched_stem: string;
  basis: string;
  auto: boolean;
};

/**
 * Resolve the best 301-FL HTS exception for this line.
 * Returns null when no imported list matches or COO blocks a bilateral heading.
 */
export function matchFlExcept(opts: {
  hts: string;
  coo?: string;
  flags?: Record<string, boolean>;
}): FlExceptHit | null {
  load();
  const hts = opts.hts || "";
  const coo = String(opts.coo || "").trim().toUpperCase();
  const flags = opts.flags || {};
  const candidates = headingsForFlExceptHts(hts);
  if (!candidates.length) return null;

  const rank = (h: string): number => {
    if (FL_EXCEPT_AUTO.has(h)) return 0;
    if (h === FL_EXCEPT_AIRCRAFT) return 1;
    if (h.startsWith("9903.06.")) return 2;
    if (h.startsWith("9903.05.9") && h !== FL_EXCEPT_PHARMA) return 3;
    return 4;
  };
  candidates.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  for (const heading of candidates) {
    const stems = stemsByHeading?.get(heading) || [];
    const stem = matchStem(hts, stems);
    if (!stem) continue;

    if (heading === FL_EXCEPT_PHARMA) continue;

    if (FL_EXCEPT_AUTO.has(heading)) {
      return {
        heading,
        matched_stem: stem,
        basis: heading === "9903.05.86" ? "US Note 52(b)" : "US Note 52(c)",
        auto: true,
      };
    }

    if (heading === FL_EXCEPT_AIRCRAFT) {
      if (flags.civil_aircraft_gn6 || flags.civil_aircraft) {
        return {
          heading,
          matched_stem: stem,
          basis: "civil aircraft — US Note 52(d)",
          auto: true,
        };
      }
      continue;
    }

    if (heading.startsWith("9903.06.") || /^9903\.05\.9[6-9]$/.test(heading)) {
      if (!coo || !cooInHeadingOrigins(coo, heading)) continue;
      const ex = listFlClaimExemptions().find((e) => e.heading === heading);
      return {
        heading,
        matched_stem: stem,
        basis: ex?.basis || "US Note 52(j)",
        auto: true,
      };
    }
  }
  return null;
}
