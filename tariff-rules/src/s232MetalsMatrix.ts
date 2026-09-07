/**
 * Section 232 metals extended heading matrix (partner / UK / US / RU paths).
 * Source: tariff-rules/data/s232_metals_matrix.json
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EU_MEMBERS } from "./s301fl.ts";
import { METALS_DE_MINIMIS_PCT } from "./s232Metals.ts";

export const METALS_PARTNER_ISO2 = new Set([
  "AR",
  "CH",
  "EC",
  "EU",
  "GT",
  "JP",
  "KR",
  "LI",
  "SV",
  "TW",
  "GB",
  ...EU_MEMBERS,
]);

export const METALS_RU_FAMILY = new Set(["RU", "BY", "CU", "KP"]);

/** Known rates for extended headings (CSMS #68253075 / #68855869 workbook matrix). */
export const METALS_EXTENDED_RATES: Record<string, number> = {
  "9903.82.01": 0,
  "9903.82.02": 50,
  "9903.82.03": 0,
  "9903.82.04": 25,
  "9903.82.05": 15,
  "9903.82.06": 10,
  "9903.82.07": 10,
  "9903.82.09": 25,
  "9903.82.10": 15,
  "9903.82.11": 0,
  "9903.82.12": 25,
  "9903.82.13": 0,
  "9903.82.14": 50,
  "9903.82.15": 10,
  "9903.82.16": 25,
  "9903.82.17": 25,
  "9903.82.21": 0,
  "9903.82.22": 15,
  "9903.82.23": 10,
  "9903.82.24": 0,
  "9903.82.25": 15,
  "9903.82.26": 0,
  "9903.85.67": 200,
  "9903.85.68": 200,
};

type MatrixEntry = {
  hts: string;
  provision: string;
  metal: string;
  headings: string[];
};

type Pack = {
  entries: MatrixEntry[];
};

const DATA = join(
  dirname(fileURLToPath(import.meta.url)),
  "../data/s232_metals_matrix.json",
);

let pack: Pack | null = null;
let byStem: Map<string, MatrixEntry> | null = null;

function digits(raw: string): string {
  return String(raw || "").replace(/\D/g, "");
}

function load(): Pack {
  if (pack) return pack;
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  byStem = new Map();
  for (const e of pack.entries) {
    const d = digits(e.hts);
    if (d) byStem.set(d, e);
    if (d.length <= 4) {
      byStem.set(d.padEnd(4, "0"), e);
    }
  }
  return pack;
}

export function reloadS232MetalsMatrix(): Pack {
  pack = null;
  byStem = null;
  return load();
}

export function lookupMetalsMatrix(hts: string): MatrixEntry | null {
  load();
  const d = digits(hts);
  if (!d || !byStem) return null;
  if (byStem.has(d)) return byStem.get(d)!;
  for (let len = Math.min(d.length, 10); len >= 4; len--) {
    const stem = d.slice(0, len);
    if (byStem.has(stem)) return byStem.get(stem)!;
  }
  return null;
}

export type MetalsExtendedPick = {
  heading: string;
  rate_pct: number;
  reason: string;
};

/**
 * Pick the best extended metals heading when the workbook matrix lists multiple options.
 */
export function selectMetalsExtendedHeading(opts: {
  hts: string;
  coo?: string;
  col1_pct?: number;
  aggregate_metal_pct?: number | null;
  us_content_pct?: number | null;
  filed_ch99?: string[];
  flags?: Record<string, boolean>;
}): MetalsExtendedPick | null {
  const entry = lookupMetalsMatrix(opts.hts);
  if (!entry?.headings?.length) return null;

  const available = new Set(entry.headings);
  const filed = new Set((opts.filed_ch99 || []).map((c) => c.trim()));
  for (const c of filed) {
    if (available.has(c) && METALS_EXTENDED_RATES[c] != null) {
      return {
        heading: c,
        rate_pct: METALS_EXTENDED_RATES[c],
        reason: `Workbook metals matrix — filed ${c} for HTS ${entry.hts} (${entry.metal}).`,
      };
    }
  }

  const coo = String(opts.coo || "").trim().toUpperCase();
  const col1 = opts.col1_pct ?? 0;
  const metalPct = opts.aggregate_metal_pct;
  const usPct = opts.us_content_pct ?? (opts.flags?.us_content ? 40 : null);

  const pick = (h: string, reason: string): MetalsExtendedPick | null => {
    if (!available.has(h)) return null;
    return {
      heading: h,
      rate_pct: METALS_EXTENDED_RATES[h] ?? 0,
      reason,
    };
  };

  if (METALS_RU_FAMILY.has(coo)) {
    for (const h of ["9903.85.67", "9903.85.68", "9903.82.14", "9903.82.16", "9903.82.17", "9903.82.12"]) {
      const p = pick(h, `Matrix RU-family path for COO ${coo}.`);
      if (p) return p;
    }
  }

  if (coo === "GB") {
    const p = pick("9903.82.05", "Matrix UK partner path (9903.82.05 @ 15%).")
      ?? pick("9903.82.04", "Matrix UK path (9903.82.04 @ 25%).");
    if (p) return p;
  }

  if (coo && (METALS_PARTNER_ISO2.has(coo) || EU_MEMBERS.has(coo))) {
    const p = pick("9903.82.22", `Matrix partner cap path for COO ${coo} (9903.82.22 @ 15%).`);
    if (p) return p;
  }

  if (usPct != null && usPct >= 85) {
    const p = pick("9903.82.06", "Matrix US metal content ≥85% (9903.82.06 @ 10%).")
      ?? pick("9903.82.07", "Matrix US metal content path (9903.82.07).")
      ?? pick("9903.82.21", "Matrix US content value path (9903.82.21 @ 0%).");
    if (p) return p;
  }

  if (metalPct != null && metalPct < METALS_DE_MINIMIS_PCT) {
    const p = pick("9903.82.03", "Matrix aggregate metal <15% (9903.82.03 @ 0%).");
    if (p) return p;
  }

  if (col1 < 10) {
    const p = pick("9903.82.23", "Matrix MFN <10% path (9903.82.23 @ 10%).");
    if (p) return p;
  }
  if (col1 >= 15) {
    const p = pick("9903.82.11", "Matrix MFN ≥15% path (9903.82.11 @ 0%).")
      ?? pick("9903.82.24", "Matrix MFN >10% path (9903.82.24 @ 0%).");
    if (p) return p;
  }
  if (col1 < 15) {
    const p = pick("9903.82.10", "Matrix MFN <15% path (9903.82.10 @ 15%).")
      ?? pick("9903.82.25", "Matrix MFN <15% path (9903.82.25 @ 15%).");
    if (p) return p;
  }

  if (available.has("9903.82.02")) {
    return {
      heading: "9903.82.02",
      rate_pct: 50,
      reason: `Matrix default article path for ${entry.hts} (${entry.metal}).`,
    };
  }
  if (available.has("9903.82.09")) {
    return {
      heading: "9903.82.09",
      rate_pct: 25,
      reason: `Matrix derivative path for ${entry.hts}.`,
    };
  }

  const first = [...available].sort()[0];
  return {
    heading: first,
    rate_pct: METALS_EXTENDED_RATES[first] ?? 0,
    reason: `Matrix first available heading for ${entry.hts}.`,
  };
}
