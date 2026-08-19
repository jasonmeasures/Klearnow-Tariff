/**
 * KlearNow tariff rules — typed access layer over the JSON registries.
 *
 * SOURCE OF TRUTH: /data/*.json in this folder. Do not hardcode rates in
 * application code — import from here so a registry bump propagates.
 *
 * SAFETY CONTRACT:
 *  - Any code whose status is not "CONFIRMED" must NOT be used for silent
 *    duty computation. `assertComputable()` enforces this — call it before
 *    using a rate in math, and surface TBC lines to a review queue instead.
 *  - Rate-known but program-TBC codes may use `assertRateKnown()` with an
 *    explicit WARNING diagnostic (never silent).
 *  - The MFN cap mechanic (rule R6_MFN_CAP_RULE) is TBC_BLOCKING. Until it
 *    is resolved, `computeTradeDealTotal()` throws by design.
 *
 * Version 1.0.0 — as of 2026-07-31.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type MfnInteraction = "NORMAL" | "STACKS" | "CAPPED";
export type CodeKind = "DUTY" | "EXCLUSION" | "SUPPRESSION";
export type CodeStatus =
  | "CONFIRMED"
  | "CONFIRMED_RATE_TBC_PROGRAM"
  | "CONFIRMED_RATE_TBC_MECHANIC";

export interface Ch99Code {
  code: string;
  program: string;
  kind: CodeKind;
  rate: number;
  mfn_interaction: MfnInteraction;
  status: CodeStatus;
  notes: string;
}

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../data");

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA, name), "utf8")) as T;
}

const ch99 = loadJson<{ version: string; as_of: string; codes: Ch99Code[] }>(
  "ch99_codes.json",
);
const programs = loadJson<{ version: string; programs: unknown[] }>(
  "program_status.json",
);
const interactions = loadJson<{ version: string; rules: unknown[] }>(
  "interaction_rules.json",
);

const CODES: Ch99Code[] = ch99.codes;

/** Normalize "99039443" or "9903.94.43" to dotted form. */
export function normalizeCh99(code: string): string {
  const digits = code.replace(/\D/g, "");
  if (digits.length !== 8) return code.trim();
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6, 8)}`;
}

export function getCh99(code: string): Ch99Code | undefined {
  const c = normalizeCh99(code);
  return CODES.find((x) => x.code === c);
}

export function listCh99(): Ch99Code[] {
  return [...CODES];
}

/** Throws unless the code is fully CONFIRMED for silent computation. */
export function assertComputable(code: string): Ch99Code {
  const c = getCh99(code);
  if (!c) {
    throw new Error(
      `Unknown Ch.99 code: ${code} — add to ch99_codes.json, do not guess.`,
    );
  }
  if (c.status !== "CONFIRMED") {
    throw new Error(
      `Ch.99 ${c.code} is ${c.status} — not cleared for duty math. Route to review queue. Notes: ${c.notes}`,
    );
  }
  return c;
}

/**
 * Allows CONFIRMED and CONFIRMED_RATE_TBC_PROGRAM (rate may be used with a
 * WARNING). Blocks CONFIRMED_RATE_TBC_MECHANIC and unknown codes.
 */
export function assertRateKnown(code: string): Ch99Code {
  const c = getCh99(code);
  if (!c) {
    throw new Error(
      `Unknown Ch.99 code: ${code} — add to ch99_codes.json, do not guess.`,
    );
  }
  if (c.status === "CONFIRMED_RATE_TBC_MECHANIC") {
    throw new Error(
      `Ch.99 ${c.code} is ${c.status} — MFN/total mechanic unresolved. Route to review. Notes: ${c.notes}`,
    );
  }
  return c;
}

/**
 * Combined Column-1 + 232 cap (CSMS default for JP/EU/KR autos and UK parts):
 * col-1 under the cap → report the cap on Ch.99 and zero Ch.1–97.
 * col-1 already ≥ cap → 0 additional; col-1 stays on Ch.1–97.
 * Drawback exception: keep col-1 on Ch.1–97 and report (cap − col-1) on Ch.99.
 */
export function combinedCapTopUp(
  col1Rate: number,
  cap: number,
  drawback = false,
): {
  ch99Line: number;
  ch1to97Line: number;
} {
  if (col1Rate >= cap) return { ch99Line: 0, ch1to97Line: col1Rate };
  if (drawback) return { ch99Line: cap - col1Rate, ch1to97Line: col1Rate };
  return { ch99Line: cap, ch1to97Line: 0 };
}

/**
 * Japan 232 auto-part top-up (rule R3, CONFIRMED).
 */
export function jp232TopUp(col1Rate: number): {
  ch99Line: number;
  ch1to97Line: number;
} {
  return combinedCapTopUp(col1Rate, 0.15);
}

/**
 * 301-FL fallback where the part is NOT a 232 auto part (rule R3, CONFIRMED):
 * 9903.05.49 adds 10% on top of col-1.
 */
export function fl301NonAuto(col1Rate: number): number {
  return col1Rate + 0.1;
}

/**
 * Legacy China 301 stack (rule R2, CONFIRMED): 301 + 232 + col-1, 301 first.
 */
export function chinaStack(
  col1Rate: number,
  legacy301Rate: number,
  s232Rate: number,
): number {
  return legacy301Rate + s232Rate + col1Rate;
}

/**
 * BLOCKED BY DESIGN — rule R6_MFN_CAP_RULE is TBC.
 */
export function computeTradeDealTotal(_code: string, _col1Rate: number): never {
  throw new Error(
    "MFN cap mechanic for leftover trade-deal flags (9903.94.45/.55) is unresolved (R6_MFN_CAP_RULE). " +
      "Resolve in data/interaction_rules.json before computing.",
  );
}

export const PROGRAMS = programs.programs;
export const INTERACTION_RULES = interactions.rules;
export const PACK_META = {
  version: ch99.version,
  as_of: ch99.as_of,
  ch99_version: ch99.version,
  programs_version: programs.version,
  interactions_version: interactions.version,
};

/** Programs eliminated — must never appear in a computed stack. */
export const DEAD_PROGRAMS = ["IEEPA", "SEC_122"] as const;
