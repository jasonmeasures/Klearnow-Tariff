/**
 * Section 301 Forced Labor pack (CSMS #69326983) — 60 economies.
 * Source: tariff-rules/data/s301fl_pack.json
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type FlFlat = {
  iso2: string;
  name: string;
  mechanic: "flat";
  rate_pct: number;
  heading: string;
};

export type FlThreshold = {
  iso2: string;
  name: string;
  mechanic: "threshold";
  cap_pct: number;
  no_additional_duty_heading: string;
  combined_to_cap_heading: string;
};

export type FlCountry = FlFlat | FlThreshold;

type Pack = {
  program: Record<string, unknown>;
  countries: FlCountry[];
  general_exemptions: Array<Record<string, unknown>>;
  economy_specific_exemptions: Array<{ heading: string; origins: string[]; basis: string }>;
  evaluation_order: string[];
  in_transit_grace: Record<string, unknown>;
  sources: string[];
};

/** ISO2 members that resolve to the pack's EU row. */
export const EU_MEMBERS = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../data/s301fl_pack.json");

let pack: Pack | null = null;
let byIso: Map<string, FlCountry> | null = null;

function load(): Pack {
  if (pack) return pack;
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  byIso = new Map(pack.countries.map((c) => [c.iso2.toUpperCase(), c]));
  return pack;
}

/** Drop in-memory cache so the next read picks up file edits (admin / MCP). */
export function reloadS301fl(): Pack {
  pack = null;
  byIso = null;
  pharmaPack = null;
  pharmaStems = null;
  return load();
}

export function s301flDataPath(): string {
  return DATA;
}

export function s301flMeta() {
  const p = load();
  return {
    id: p.program.id,
    economies: p.countries.length,
    source_csms: p.program.source_csms,
    effective: p.program.effective,
    sources: p.sources,
  };
}

export function listS301flCountries(): FlCountry[] {
  return [...load().countries];
}

export function listS301flExemptions() {
  const p = load();
  return {
    general: p.general_exemptions,
    economy_specific: p.economy_specific_exemptions,
  };
}

/** Note 52(e) pharmaceutical-use exemption (9903.05.89) — claim-gated + HTS list. */
const PHARMA_DATA = join(
  dirname(fileURLToPath(import.meta.url)),
  "../data/s301fl_pharma_hts.json",
);

type PharmaPack = {
  heading: string;
  basis: string;
  claim_flag: string;
  notes?: string;
  stems: string[];
};

let pharmaPack: PharmaPack | null = null;
let pharmaStems: string[] | null = null;

function loadPharma(): PharmaPack {
  if (pharmaPack) return pharmaPack;
  pharmaPack = JSON.parse(readFileSync(PHARMA_DATA, "utf8")) as PharmaPack;
  pharmaStems = (pharmaPack.stems || [])
    .map((s) => String(s).replace(/\D/g, ""))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return pharmaPack;
}

export function reloadS301flPharma(): PharmaPack {
  pharmaPack = null;
  pharmaStems = null;
  return loadPharma();
}

export const FL_PHARMA_HEADING = "9903.05.89";

export function flPharmaMeta() {
  const p = loadPharma();
  return {
    heading: p.heading || FL_PHARMA_HEADING,
    basis: p.basis,
    claim_flag: p.claim_flag || "s301fl_pharma",
    stem_count: (p.stems || []).length,
    notes: p.notes || "",
  };
}

/** Match HTS against the seeded Note 52(e) pharmaceutical-use list (digit prefix). */
export function matchFlPharmaHts(hts: string): {
  matched_stem: string;
  heading: string;
  basis: string;
} | null {
  const digits = String(hts || "").replace(/\D/g, "");
  if (digits.length < 6) return null;
  const p = loadPharma();
  const stems = pharmaStems || [];
  for (const stem of stems) {
    if (digits.startsWith(stem)) {
      return {
        matched_stem: stem,
        heading: p.heading || FL_PHARMA_HEADING,
        basis: p.basis,
      };
    }
  }
  // 8-digit statistical family: listed 39076900 covers 3907690050 etc.
  if (digits.length >= 8) {
    const d8 = digits.slice(0, 8);
    for (const stem of stems) {
      const s8 = stem.slice(0, 8);
      if (s8.length >= 8 && d8 === s8) {
        return {
          matched_stem: s8,
          heading: p.heading || FL_PHARMA_HEADING,
          basis: p.basis,
        };
      }
    }
  }
  return null;
}

/** True when importer asserts pharmaceutical-use claim via flags. */
export function flPharmaClaimed(flags?: Record<string, boolean> | null): boolean {
  const f = flags || {};
  return Boolean(
    f.s301fl_pharma ||
      f.pharma_use ||
      f.pharma ||
      f.fl_pharma ||
      f.note_52e,
  );
}

export type FlEconomyExemption = {
  heading: string;
  origins: string[];
  basis: string;
  /** Short claim id for UI / flags: USMCA | CAFTA_DR | NOTE_52 */
  claim_id: string;
  label: string;
};

function claimMeta(basis: string): { claim_id: string; label: string } {
  const b = String(basis || "");
  if (/USMCA/i.test(b)) return { claim_id: "USMCA", label: "USMCA" };
  if (/CAFTA/i.test(b)) return { claim_id: "CAFTA_DR", label: "CAFTA-DR" };
  return { claim_id: "NOTE_52", label: "Note 52 preference" };
}

/** Economy-specific 301-FL exemptions that fire only when the importer claims the related preference (USMCA / CAFTA-DR / Note 52). */
export function listFlClaimExemptions(): FlEconomyExemption[] {
  return load().economy_specific_exemptions.map((e) => {
    const meta = claimMeta(e.basis);
    return {
      heading: e.heading,
      origins: e.origins.map((o) => o.toUpperCase()),
      basis: e.basis,
      claim_id: meta.claim_id,
      label: meta.label,
    };
  });
}

/** Resolve the claimable exemption for a COO (maps EU members → EU row). Prefer USMCA / CAFTA headings when multiple exist. */
export function lookupFlClaimExemption(coo: string): FlEconomyExemption | null {
  const iso = String(coo || "").trim().toUpperCase();
  if (!iso) return null;
  const keys = [iso];
  if (EU_MEMBERS.has(iso)) keys.push("EU");
  const hits = listFlClaimExemptions().filter((e) =>
    e.origins.some((o) => keys.includes(o)),
  );
  if (!hits.length) return null;
  // Prefer USMCA, then CAFTA-DR, then first Note 52(j) heading for the origin.
  const rank = (id: string) => (id === "USMCA" ? 0 : id === "CAFTA_DR" ? 1 : 2);
  hits.sort(
    (a, b) => rank(a.claim_id) - rank(b.claim_id) || a.heading.localeCompare(b.heading),
  );
  return hits[0];
}

/** True when this claim id qualifies the COO for the Note 52 economy exemption. */
export function flClaimMatches(
  coo: string,
  claim: string | null | undefined,
): FlEconomyExemption | null {
  const ex = lookupFlClaimExemption(coo);
  if (!ex || !claim) return null;
  const c = String(claim).trim().toUpperCase();
  if (!c || c === "NONE" || c === "FALSE" || c === "0") return null;
  if (c === ex.claim_id || c === ex.heading.replace(/\./g, "").toUpperCase()) return ex;
  if (c === "USMCA" && ex.claim_id === "USMCA") return ex;
  if ((c === "CAFTA" || c === "CAFTA_DR" || c === "CAFTA-DR") && ex.claim_id === "CAFTA_DR") {
    return ex;
  }
  if (c === ex.heading.toUpperCase()) return ex;
  return null;
}

/** Resolve pack row for a COO (maps EU members → EU). */
export function lookupS301fl(coo: string): FlCountry | null {
  load();
  const iso = String(coo || "").trim().toUpperCase();
  if (!iso || !byIso) return null;
  if (byIso.has(iso)) return byIso.get(iso)!;
  if (EU_MEMBERS.has(iso)) return byIso.get("EU") || null;
  return null;
}

export type FlAssessment =
  | {
      kind: "flat";
      heading: string;
      rate_pct_decimal: number;
      label: string;
      reason: string;
    }
  | {
      kind: "threshold_topup";
      heading: string;
      rate_pct_decimal: number;
      cap_pct: number;
      label: string;
      reason: string;
    }
  | {
      kind: "threshold_no_add";
      heading: string;
      rate_pct_decimal: 0;
      cap_pct: number;
      label: string;
      reason: string;
    }
  | { kind: "out_of_scope"; reason: string };

/**
 * Compute 301-FL duty layer inputs for a COO + column-1 decimal rate.
 * Does not apply 232 suppression or claim-gated exemptions — caller handles order.
 */
export function assessS301fl(coo: string, col1Decimal: number): FlAssessment {
  const row = lookupS301fl(coo);
  if (!row) {
    return {
      kind: "out_of_scope",
      reason: `Origin ${coo || "(blank)"} is not one of the 60 301-FL economies (CSMS #69326983).`,
    };
  }

  if (row.mechanic === "flat") {
    return {
      kind: "flat",
      heading: row.heading,
      rate_pct_decimal: row.rate_pct / 100,
      label: `301-FL ${row.name} — flat ${row.rate_pct}%`,
      reason: `Country of origin ${row.iso2}: flat additional ${row.rate_pct}% on entered value (CSMS #69326983).`,
    };
  }

  const col1Pct = col1Decimal * 100;
  if (col1Pct >= row.cap_pct) {
    return {
      kind: "threshold_no_add",
      heading: row.no_additional_duty_heading,
      rate_pct_decimal: 0,
      cap_pct: row.cap_pct,
      label: `301-FL ${row.name} — at/above ${row.cap_pct}% cap`,
      reason: `Column-1 ${col1Pct}% ≥ ${row.cap_pct}% cap — no additional 301-FL duty; report ${row.no_additional_duty_heading}.`,
    };
  }

  const add = (row.cap_pct - col1Pct) / 100;
  return {
    kind: "threshold_topup",
    heading: row.combined_to_cap_heading,
    rate_pct_decimal: add,
    cap_pct: row.cap_pct,
    label: `301-FL ${row.name} — combined to ${row.cap_pct}%`,
    reason: `Column-1 ${col1Pct}% below ${row.cap_pct}% cap — additional ${(add * 100).toFixed(4)}% via ${row.combined_to_cap_heading} (total line = ${row.cap_pct}%).`,
  };
}
