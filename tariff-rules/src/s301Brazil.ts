/**
 * Section 301 Brazil country action (CSMS #69302472 / 91 FR 45516).
 * Distinct from 301-FL Brazil flat heading 9903.05.27 — both can stack.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAZIL_ANNEX_HEADING,
  matchBrazil301Annex,
  matchBrazil301ExceptHeading,
} from "./s301BrazilHts.ts";

export const BRAZIL_301_START = "2026-07-22";
export const BRAZIL_301_DUTY = "9903.05.01";
export const BRAZIL_301_232_EXEMPT = "9903.05.07";

type Exemption = {
  heading: string;
  kind: string;
  rate_pct: number;
  claim_flag?: string;
  auto_when?: string;
  notes: string;
};

type Pack = {
  program: {
    id: string;
    effective: string;
    rate_pct: number;
    duty_heading: string;
    source_csms: string;
    detail: string;
  };
  exemptions: Exemption[];
  sources: string[];
};

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../data/s301_brazil.json");

let pack: Pack | null = null;

function load(): Pack {
  if (pack) return pack;
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  return pack;
}

export function reloadS301Brazil(): Pack {
  pack = null;
  return load();
}

export function s301BrazilMeta() {
  const p = load();
  return {
    id: p.program.id,
    effective: p.program.effective,
    rate_pct: p.program.rate_pct,
    duty_heading: p.program.duty_heading,
    source_csms: p.program.source_csms,
    sources: p.sources,
  };
}

export function brazil301AppliesOn(d: string | null | undefined): boolean {
  const x = String(d || "").slice(0, 10);
  return Boolean(x && x >= BRAZIL_301_START);
}

/** True for Brazil country-301 headings 9903.05.01–.09 (not 301-FL .20+). */
export function isBrazil301Heading(code: string): boolean {
  return /^9903\.05\.0[1-9]$/.test(String(code || "").trim());
}

export type Brazil301Assessment = {
  heading: string;
  rate_pct_decimal: number;
  label: string;
  reason: string;
  exempt: boolean;
};

/**
 * Assess Brazil Section 301 for COO=BR.
 * 232 universe → 9903.05.07 @ 0%. Claim flags → matching exemption. Else 9903.05.01 @ 25%.
 */
export function assessBrazil301(opts: {
  coo: string;
  hts?: string;
  in232Universe?: boolean;
  flags?: Record<string, boolean>;
}): Brazil301Assessment | null {
  const coo = String(opts.coo || "")
    .trim()
    .toUpperCase();
  if (coo !== "BR") return null;

  const p = load();
  const flags = opts.flags || {};
  const hts = opts.hts || "";

  const annexHit = matchBrazil301Annex(hts);
  if (annexHit) {
    const ex = p.exemptions.find((e) => e.heading === BRAZIL_ANNEX_HEADING)!;
    return {
      heading: ex.heading,
      rate_pct_decimal: 0,
      label: "Brazil Section 301 — exempt (annex HTS)",
      reason: `${ex.heading}: HTS on U.S. note 50(a)(ii) annex list (stem ${annexHit.matched_stem}). ${ex.notes}`,
      exempt: true,
    };
  }

  for (const ex of p.exemptions) {
    if (ex.heading === BRAZIL_ANNEX_HEADING) continue;
    const hit = matchBrazil301ExceptHeading(hts, ex.heading);
    if (!hit) continue;
    if (ex.claim_flag && !flags[ex.claim_flag]) continue;
    return {
      heading: ex.heading,
      rate_pct_decimal: 0,
      label: `Brazil Section 301 — exempt (${ex.kind})`,
      reason: ex.claim_flag
        ? `${ex.heading}: ${ex.notes}`
        : `${ex.heading}: HTS on imported exception list (stem ${hit.matched_stem}). ${ex.notes}`,
      exempt: true,
    };
  }

  if (opts.in232Universe) {
    const ex = p.exemptions.find((e) => e.heading === BRAZIL_301_232_EXEMPT)!;
    return {
      heading: ex.heading,
      rate_pct_decimal: 0,
      label: "Brazil Section 301 — exempt (232 universe)",
      reason: `${ex.heading}: ${ex.notes} (CSMS #69302472).`,
      exempt: true,
    };
  }

  for (const ex of p.exemptions) {
    if (ex.claim_flag && flags[ex.claim_flag]) {
      return {
        heading: ex.heading,
        rate_pct_decimal: 0,
        label: `Brazil Section 301 — exempt (${ex.kind})`,
        reason: `${ex.heading}: ${ex.notes}`,
        exempt: true,
      };
    }
  }

  const rate = p.program.rate_pct / 100;
  return {
    heading: p.program.duty_heading,
    rate_pct_decimal: rate,
    label: "Brazil Section 301 — 25% country action",
    reason: `${p.program.duty_heading}: Country of origin BR — additional 25% on entered value (CSMS #69302472 / 91 FR 45516). Stacks with 301-FL when applicable.`,
    exempt: false,
  };
}
