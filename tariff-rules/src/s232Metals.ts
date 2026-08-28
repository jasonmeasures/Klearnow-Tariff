/**
 * Section 232 metals / copper triage (HTS chapter → content type + duty heading).
 *
 * Source framing: U.S. note 16 / CSMS #68253075 (Apr 2026) as amended by
 * CSMS #68855869 (Jun 2026 Metals HTS List) —
 *   - 9903.82.02 — +50% on metal-content value for primary steel/alu/copper articles
 *   - 9903.82.09 — +25% on entered value for copper articles and derivative alu/steel
 *     (note 16(c)(vi)–(viii)/(xi)), including annex derivatives outside Ch.72–76
 *   - 9903.82.03 — 0% when aggregate metal weight is under 15% (not Ch.72–74/76)
 *
 * Chapters 72–74 and 76 are in-scope article triage. Derivative annex lines outside
 * those chapters apply only when the HTS is on the metals matrix (CSMS list), via
 * filed 9903.82.09 / 9903.03.06, or an explicit s232_metals claim — **not** from
 * metal-content entry alone on an off-list HTS (e.g. solar 8541.43).
 */

import { lookupMetalsMatrix, selectMetalsExtendedHeading } from "./s232MetalsMatrix.ts";

export type MetalKind = "steel" | "aluminum" | "copper";

export type MetalsHit = {
  metal: MetalKind;
  chapter: string;
  hts10: string;
  /** Primary duty or exclusion heading. */
  duty_ch99: string;
  rate_pct: number;
  kind: "DUTY" | "EXCLUSION";
  /** When false, 301-FL still applies (de minimis 9903.82.03 / .01). */
  suppresses_301fl: boolean;
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
  /** True when scope came from filed Ch.99 / content % / claim flag, not chapter triage. */
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

/** Duty headings that put the line in the 232 metals universe (suppress Sec 122 / 301-FL). */
export const METALS_DUTY_CODES = new Set([
  "9903.82.02",
  "9903.82.09",
  "9903.82.06",
]);

export const METALS_EXCLUSION_CODES = new Set(["9903.03.06", "9903.03.03"]);

/** Note 16 de minimis / carve-out — 0% additional, 301-FL still applies. */
export const METALS_DE_MINIMIS_CODES = new Set(["9903.82.03", "9903.82.01"]);

/** Under 15% aggregate metal weight → 9903.82.03. At 15% the derivative duty path applies. */
export const METALS_DE_MINIMIS_PCT = 15;

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

export function filedMetalsDeMinimisCode(filed: string[]): string | null {
  const set = new Set(filed.map(normalizeCh99Local));
  if (set.has("9903.82.03")) return "9903.82.03";
  if (set.has("9903.82.01")) return "9903.82.01";
  return null;
}

export function isMetalsDutyHit(hit: MetalsHit | null | undefined): hit is MetalsHit {
  return Boolean(hit && hit.kind === "DUTY");
}

function hitFor(
  metal: MetalKind,
  chapter: string,
  hts10: string,
  duty_ch99: string,
  opts?: { claim_gated?: boolean },
): MetalsHit {
  const derivative = duty_ch99 === "9903.82.09";
  const exclusion = METALS_DE_MINIMIS_CODES.has(duty_ch99);
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
    rate_pct: exclusion ? 0 : derivative ? 25 : duty_ch99 === "9903.82.06" ? 10 : 50,
    kind: exclusion ? "EXCLUSION" : "DUTY",
    suppresses_301fl: !exclusion,
    basis: derivative || exclusion ? "ENTERED_VALUE" : "METAL_CONTENT_VALUE",
    potential_exclusions: EXCLUSIONS,
    content_prompt: derivative
      ? "Derivative path 9903.82.09 assesses on entered value (no metal-content split required)."
      : exclusion
        ? "Aggregate metal under 15% → 9903.82.03 at 0% additional. 301-FL still applies."
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

function metalKindFromLabel(label: string | undefined, fallback: MetalKind): MetalKind {
  const m = String(label || "").toLowerCase();
  if (m.includes("aluminum") || m.includes("aluminium")) return "aluminum";
  if (m.includes("copper")) return "copper";
  if (m.includes("steel")) return "steel";
  return fallback;
}

/**
 * Resolve metals scope from chapter triage, published metals HTS list, filed Ch.99,
 * metal content %, or claim flags.
 * Filed 9903.82.09 wins over the default Ch.72–76 article heading 9903.82.02.
 * Outside those chapters, content % selects .03 / .09 **only** when the HTS is on
 * the metals matrix (CSMS Metals HTS List). Off-list HTS (e.g. 8541.43) need an
 * explicit filed metals heading or s232_metals claim — content alone is ignored.
 */
export function resolve232Metals(opts: {
  hts: string;
  filed_ch99?: string[];
  flags?: Record<string, boolean>;
  /** Sum of steel + aluminum + copper as % of entered value. */
  aggregate_metal_pct?: number | null;
  primary_metal?: MetalKind;
  coo?: string;
  col1_pct?: number;
  us_content_pct?: number | null;
}): MetalsHit | null {
  const filed = opts.filed_ch99 || [];
  const flags = opts.flags || {};
  const chapterHit = classify232Metals(opts.hts);
  const dutyFiled = filedMetalsDutyCode(filed);
  const deMinimisFiled = filedMetalsDeMinimisCode(filed);
  const filedExclusion = filed.some((c) =>
    METALS_EXCLUSION_CODES.has(normalizeCh99Local(c)),
  );
  const claimFlag = Boolean(
    flags.s232_metals || flags.s232_metal || flags.s232_derivative,
  );
  const pct = opts.aggregate_metal_pct;
  const metal = opts.primary_metal || "steel";
  const matrix = lookupMetalsMatrix(opts.hts);

  const applyExtended = (
    base: MetalsHit,
    kind: MetalKind = base.metal,
  ): MetalsHit => {
    const ext = selectMetalsExtendedHeading({
      hts: opts.hts,
      coo: opts.coo,
      col1_pct: opts.col1_pct,
      aggregate_metal_pct: pct,
      us_content_pct: opts.us_content_pct,
      filed_ch99: filed,
      flags,
    });
    if (!ext || ext.heading === base.duty_ch99) return base;
    const exclusion = METALS_DE_MINIMIS_CODES.has(ext.heading);
    const derivative = ext.heading === "9903.82.09";
    return {
      ...base,
      metal: kind,
      duty_ch99: ext.heading,
      rate_pct: ext.rate_pct,
      kind: exclusion ? "EXCLUSION" : "DUTY",
      suppresses_301fl: !exclusion,
      basis:
        derivative || exclusion ? "ENTERED_VALUE" : base.basis,
      content_prompt: ext.reason,
    };
  };

  if (chapterHit) {
    if (dutyFiled && dutyFiled !== chapterHit.duty_ch99) {
      return hitFor(chapterHit.metal, chapterHit.chapter, chapterHit.hts10, dutyFiled);
    }
    return applyExtended(chapterHit);
  }

  const hts10 = digits10(opts.hts);
  const chapter = hts10.slice(0, 2) || "??";
  const matrixKind = metalKindFromLabel(matrix?.metal, metal);
  const gated = (code: string, kind: MetalKind = matrixKind) =>
    hitFor(kind, chapter, hts10 || "0000000000", code, { claim_gated: true });

  if (dutyFiled) return gated(dutyFiled);
  if (deMinimisFiled) return gated(deMinimisFiled, matrixKind === "steel" ? "copper" : matrixKind);

  // Annex / derivative HTS on the published Metals HTS List (outside Ch.72–74/76).
  if (matrix && pct != null && pct > 0) {
    return gated(pct < METALS_DE_MINIMIS_PCT ? "9903.82.03" : "9903.82.09", matrixKind);
  }

  // Explicit claim / 9903.03.06 filing (e.g. 9406 prefab) — still allowed off-list.
  if (filedExclusion || claimFlag) {
    return gated("9903.82.09", matrixKind);
  }

  // Off-list HTS: ignore stray metal-content fields (do not invent 9903.82.09).
  return null;
}

export function is232MetalsHts(hts: string): boolean {
  return classify232Metals(hts) != null || lookupMetalsMatrix(hts) != null;
}
