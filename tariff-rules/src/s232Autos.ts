/**
 * Section 232 autos/parts — Proclamation 10908 annex (U.S. note 33).
 * 10-digit (or shorter published stem) membership; chapter triage alone is not enough.
 */
import annexPack from "../data/s232_auto_parts_annex.json" with { type: "json" };

export type S232AnnexHit = {
  hts: string;
  matched_stem: string;
  ch99_duty: string;
  source: string;
  as_of: string;
};

const STEMS: string[] = (annexPack.hts as string[])
  .map((h) => String(h).replace(/\D/g, ""))
  .filter(Boolean)
  .sort((a, b) => b.length - a.length); // longest prefix first

export function digitsHts(hts: string): string {
  return String(hts || "").replace(/\D/g, "");
}

/** True when the line HTS is covered by a published annex stem. */
export function isOn232AutoPartsAnnex(hts: string): boolean {
  return Boolean(match232AutoPartsAnnex(hts));
}

export function match232AutoPartsAnnex(hts: string): S232AnnexHit | null {
  const d = digitsHts(hts);
  if (d.length < 4) return null;
  for (const stem of STEMS) {
    // published stem covers this 10-digit (or longer) code
    if (d.startsWith(stem)) {
      return {
        hts: d,
        matched_stem: stem,
        ch99_duty: String(annexPack.ch99_duty || "9903.94.05"),
        source: String(annexPack.source || "Proclamation 10908 annex"),
        as_of: String(annexPack.as_of || ""),
      };
    }
    // rare: filer passed a shorter code that equals a stem
    if (stem.startsWith(d) && d.length >= 6) {
      return {
        hts: d,
        matched_stem: stem,
        ch99_duty: String(annexPack.ch99_duty || "9903.94.05"),
        source: String(annexPack.source || "Proclamation 10908 annex"),
        as_of: String(annexPack.as_of || ""),
      };
    }
  }
  return null;
}

export function annexMeta() {
  return {
    version: annexPack.version,
    as_of: annexPack.as_of,
    source: annexPack.source,
    source_url: annexPack.source_url,
    stem_count: STEMS.length,
    ch99_duty: annexPack.ch99_duty,
    notes: annexPack.notes,
  };
}
