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
