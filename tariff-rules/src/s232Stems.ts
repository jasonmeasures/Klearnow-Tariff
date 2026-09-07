/**
 * Prefix membership against a published HTS stem list.
 * Longest stem wins; chapter triage alone is never a hit.
 */
export type StemHit = {
  hts: string;
  matched_stem: string;
};

export function digitsHts(hts: string): string {
  return String(hts || "").replace(/\D/g, "");
}

export function compileStems(raw: string[]): string[] {
  return [...new Set(raw.map((h) => String(h).replace(/\D/g, "")).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
}

export function matchStem(hts: string, stems: string[]): StemHit | null {
  const d = digitsHts(hts);
  if (d.length < 4) return null;
  for (const stem of stems) {
    if (d.startsWith(stem)) return { hts: d, matched_stem: stem };
    if (stem.startsWith(d) && d.length >= 6) return { hts: d, matched_stem: stem };
  }
  return null;
}

export function onOrAfter(day: string | null | undefined, start: string): boolean {
  const x = String(day || "").slice(0, 10);
  return Boolean(x && x >= start);
}
