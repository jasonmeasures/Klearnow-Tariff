/**
 * Brazil Section 301 HTS annex / product exception lists.
 * Source: tariff-rules/data/s301_brazil_hts.json
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const BRAZIL_ANNEX_HEADING = "9903.05.03";

type HeadingBlock = {
  heading: string;
  hts_count: number;
  stems: string[];
};

type Pack = {
  by_heading: Record<string, HeadingBlock>;
  annex_9903_05_03: HeadingBlock;
};

const DATA = join(
  dirname(fileURLToPath(import.meta.url)),
  "../data/s301_brazil_hts.json",
);

let pack: Pack | null = null;
let annexStems: string[] | null = null;

function load(): Pack {
  if (pack) return pack;
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  annexStems = [...(pack.annex_9903_05_03?.stems || [])].sort(
    (a, b) => b.length - a.length,
  );
  return pack;
}

export function reloadS301BrazilHts(): Pack {
  pack = null;
  annexStems = null;
  return load();
}

function digits(hts: string): string {
  return String(hts || "").replace(/\D/g, "");
}

export function matchBrazil301Annex(hts: string): {
  heading: string;
  matched_stem: string;
} | null {
  load();
  const d = digits(hts);
  if (!d || !annexStems) return null;
  for (const s of annexStems) {
    if (d.startsWith(s) || s.startsWith(d)) {
      return { heading: BRAZIL_ANNEX_HEADING, matched_stem: s };
    }
  }
  if (d.length >= 8) {
    const d8 = d.slice(0, 8);
    for (const s of annexStems) {
      if (s.slice(0, 8) === d8) {
        return { heading: BRAZIL_ANNEX_HEADING, matched_stem: d8 };
      }
    }
  }
  return null;
}

export function matchBrazil301ExceptHeading(
  hts: string,
  heading: string,
): { matched_stem: string } | null {
  load();
  const block = pack!.by_heading[heading];
  if (!block) return null;
  const d = digits(hts);
  const stems = [...block.stems].sort((a, b) => b.length - a.length);
  for (const s of stems) {
    if (d.startsWith(s) || s.startsWith(d)) return { matched_stem: s };
  }
  return null;
}
