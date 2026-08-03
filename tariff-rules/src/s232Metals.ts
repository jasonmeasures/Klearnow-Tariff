/**
 * Section 232 metals / copper triage (HTS chapter → content type + duty heading).
 *
 * Source framing: CSMS #68253075 / U.S. note 16 —
 *   - 9903.82.02 — +50% on metal-content value for primary steel/alu/copper articles
 *   - 9903.82.09 — +25% on entered value for copper articles and derivative alu/steel
 *     (note 16(c)(vi)–(viii)/(xi)), including annex derivatives outside Ch.72–76
 *
 * Chapters 72–74 and 76 are in-scope article triage. Derivative annex lines outside
 * those chapters are claim-gated via filed 9903.82.09 / 9903.03.06 until a full
 * annex membership pack is authored.
 */

export type MetalKind = "steel" | "aluminum" | "copper";

export type MetalsHit = {
  metal: MetalKind;
  chapter: string;
  hts10: string;
  /** Primary duty heading. */
  duty_ch99: string;
  rate_pct: number;
  /** Entered-value derivative (82.09) vs metal-content article (82.02). */
  basis: "ENTERED_VALUE" | "METAL_CONTENT_VALUE";
  /** Common exclusion / relief headings to surface in UI (not auto-applied). */
  potential_exclusions: Array<{
    ch99: string;
    label: string;
  }>;
  /** Why content is required before duty math (article path only). */
  content_prompt: string;
  melt_pour_label: string;
  /** True when scope came from filed Ch.99 / claim flag, not chapter triage. */
  claim_gated?: boolean;
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

/** Duty headings that put the line in the 232 metals universe (suppress Sec 122). */
export const METALS_DUTY_CODES = new Set([
  "9903.82.02",
  "9903.82.09",
  "9903.82.06",
]);

export const METALS_EXCLUSION_CODES = new Set(["9903.03.06", "9903.03.03"]);

function digits10(hts: string): string {
  const d = String(hts || "").replace(/\D/g, "");
  if (!d) return "";
  return d.padEnd(10, "0").slice(0, 10);
}

function normalizeCh99Local(c: string): string {
  const d = String(c || "").replace(/\D/g, "");
  if (d.length < 8) return String(c || "").trim();
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
}

/** Prefer explicit filed metals duty heading. */
export function filedMetalsDutyCode(filed: string[]): string | null {
  const set = new Set(filed.map(normalizeCh99Local));
  if (set.has("9903.82.09")) return "9903.82.09";
  if (set.has("9903.82.02")) return "9903.82.02";
  if (set.has("9903.82.06")) return "9903.82.06";
  return null;
}

function hitFor(
  metal: MetalKind,
  chapter: string,
  hts10: string,
  duty_ch99: string,
  opts?: { claim_gated?: boolean },
): MetalsHit {
  const derivative = duty_ch99 === "9903.82.09";
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
    duty_ch99,
    rate_pct: derivative ? 25 : duty_ch99 === "9903.82.06" ? 10 : 50,
    basis: derivative ? "ENTERED_VALUE" : "METAL_CONTENT_VALUE",
    potential_exclusions: EXCLUSIONS,
    content_prompt: derivative
      ? "Derivative path 9903.82.09 assesses on entered value (no metal-content split required)."
      : `${metal.charAt(0).toUpperCase() + metal.slice(1)} content — enter as USD value or as % of entered value (Section 232 basis)`,
    melt_pour_label: melt,
    claim_gated: opts?.claim_gated,
  };
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
  return hitFor(metal, chapter, hts10, "9903.82.02");
}

/**
 * Resolve metals scope from chapter triage and/or filed Ch.99 / claim flags.
 * Filed 9903.82.09 wins over the default Ch.72–76 article heading 9903.82.02.
 */
export function resolve232Metals(opts: {
  hts: string;
  filed_ch99?: string[];
  flags?: Record<string, boolean>;
}): MetalsHit | null {
  const filed = opts.filed_ch99 || [];
  const flags = opts.flags || {};
  const chapterHit = classify232Metals(opts.hts);
  const dutyFiled = filedMetalsDutyCode(filed);
  const filedExclusion = filed.some((c) =>
    METALS_EXCLUSION_CODES.has(normalizeCh99Local(c)),
  );
  const claimFlag = Boolean(
    flags.s232_metals || flags.s232_metal || flags.s232_derivative,
  );

  if (chapterHit) {
    if (dutyFiled && dutyFiled !== chapterHit.duty_ch99) {
      return hitFor(chapterHit.metal, chapterHit.chapter, chapterHit.hts10, dutyFiled);
    }
    return chapterHit;
  }

  // Derivative annex outside Ch.72–76 — claim / filing gated (e.g. 9406 prefab).
  if (dutyFiled || filedExclusion || claimFlag) {
    const hts10 = digits10(opts.hts);
    const chapter = hts10.slice(0, 2) || "??";
    return hitFor(
      "steel",
      chapter,
      hts10 || "0000000000",
      dutyFiled || "9903.82.09",
      { claim_gated: true },
    );
  }
  return null;
}

export function is232MetalsHts(hts: string): boolean {
  return classify232Metals(hts) != null;
}
