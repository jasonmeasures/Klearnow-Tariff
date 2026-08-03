/**
 * Section 232 metals / copper triage (HTS chapter → content type + duty heading).
 *
 * Source framing: CSMS #68253075 / U.S. note 16 — heading 9903.82.02 applies
 * +50% on articles of aluminum, steel, or copper and listed derivatives.
 * Chapters 72–74 and 76 are in-scope articles (Cervó parity for pipe fittings).
 *
 * Derivative annex lines outside these chapters remain claim-gated until an
 * annex membership pack is authored.
 */

export type MetalKind = "steel" | "aluminum" | "copper";

export type MetalsHit = {
  metal: MetalKind;
  chapter: string;
  hts10: string;
  /** Primary duty heading (articles / listed derivatives). */
  duty_ch99: string;
  rate_pct: number;
  /** Common exclusion / relief headings to surface in UI (not auto-applied). */
  potential_exclusions: Array<{
    ch99: string;
    label: string;
  }>;
  /** Why content is required before duty math. */
  content_prompt: string;
  melt_pour_label: string;
};

const EXCLUSIONS: MetalsHit["potential_exclusions"] = [
  {
    ch99: "9903.82.01",
    label: "Section 232 0% content / carve-out exclusion",
  },
  {
    ch99: "9903.82.06",
    label: "Section 232 US-content metal reduction (10%)",
  },
  {
    ch99: "9903.82.03",
    label: "Aggregate metal weight < 15% (0% additional) — not for Ch.72–74/76 articles",
  },
];

function digits10(hts: string): string {
  const d = String(hts || "").replace(/\D/g, "");
  if (!d) return "";
  return d.padEnd(10, "0").slice(0, 10);
}

/**
 * Classify an HTS for Section 232 metals article treatment.
 * Returns null when the HTS is outside the chapter triage set.
 */
export function classify232Metals(hts: string): MetalsHit | null {
  const hts10 = digits10(hts);
  if (!hts10 || hts10.length < 4) return null;
  const chapter = hts10.slice(0, 2);
  let metal: MetalKind | null = null;
  if (chapter === "72" || chapter === "73") metal = "steel";
  else if (chapter === "76") metal = "aluminum";
  else if (chapter === "74") metal = "copper";
  if (!metal) return null;

  const melt =
    metal === "aluminum"
      ? "Country of smelt / most recent cast"
      : metal === "copper"
        ? "Country of smelt / refined production"
        : "Steel country of melt & pour";

  return {
    metal,
    chapter,
    hts10,
    duty_ch99: "9903.82.02",
    rate_pct: 50,
    potential_exclusions: EXCLUSIONS,
    content_prompt: `${metal.charAt(0).toUpperCase() + metal.slice(1)} content — enter as USD value or as % of entered value (Section 232 basis)`,
    melt_pour_label: melt,
  };
}

export function is232MetalsHts(hts: string): boolean {
  return classify232Metals(hts) != null;
}
