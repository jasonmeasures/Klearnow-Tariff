/**
 * Entry-level fee estimate (formal entry).
 * Rates approximate CBP schedules — used for landed-cost parity with Cervó-style UI.
 * Not a substitute for ACE fee calculation on the live entry.
 */

export type EntryFee = {
  code: string;
  label: string;
  amount: number;
  rate_note: string;
  floored?: boolean;
  capped?: boolean;
};

function money2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** FY-style MPF ad valorem 0.3464%, floor $33.58, ceiling $651.50 (formal entry). */
const MPF_RATE = 0.003464;
const MPF_MIN = 33.58;
const MPF_MAX = 651.5;

/** Harbor Maintenance Fee — 0.125% of entered value, ocean / vessel only. */
export const HMF_RATE = 0.00125;

const OCEAN_NAMES = new Set([
  "OCEAN",
  "VESSEL",
  "SEA",
  "WATER",
  "MARITIME",
  "BARGE",
  "SHIP",
]);

/** ACE conveyance: 10 vessel non-container, 11 vessel container, 12 barge. */
const OCEAN_ACE = new Set(["10", "11", "12"]);

/** Normalize MOT for API / UI (OCEAN | AIR | TRUCK | RAIL | raw). */
export function normalizeMot(raw: string | null | undefined): string | null {
  const m = String(raw || "").trim().toUpperCase();
  if (!m) return null;
  if (OCEAN_NAMES.has(m) || OCEAN_ACE.has(m)) return "OCEAN";
  if (m === "AIR" || m === "40" || m === "41") return "AIR";
  if (m === "TRUCK" || m === "ROAD" || m === "30" || m === "31" || m === "32") return "TRUCK";
  if (m === "RAIL" || m === "TRAIN" || m === "20" || m === "21") return "RAIL";
  return m;
}

export function isOceanMot(raw: string | null | undefined): boolean {
  return normalizeMot(raw) === "OCEAN";
}

export function computeEntryFees(opts: {
  entered_value_total: number;
  formal_entry?: boolean;
  mode_of_transport?: string | null;
  /** Entered value of USMCA / CAFTA-DR (etc.) SPI Free goods — excluded from MPF basis. */
  mpf_exempt_value?: number;
}): { fees: EntryFee[]; total: number; mode_of_transport: string | null; hmf_applies: boolean } {
  const entered = Math.max(0, Number(opts.entered_value_total) || 0);
  const exempt = Math.max(0, Math.min(entered, Number(opts.mpf_exempt_value) || 0));
  const mpfBasis = money2(entered - exempt);
  const fees: EntryFee[] = [];
  const mode = normalizeMot(opts.mode_of_transport);
  const ocean = mode === "OCEAN";
  const formal = opts.formal_entry !== false; // default formal when unspecified for UI parity

  if (formal && mpfBasis > 0) {
    let mpf = money2(mpfBasis * MPF_RATE);
    let floored = false;
    let capped = false;
    if (mpf < MPF_MIN) {
      mpf = MPF_MIN;
      floored = true;
    }
    if (mpf > MPF_MAX) {
      mpf = MPF_MAX;
      capped = true;
    }
    fees.push({
      code: "MPF",
      label: "Merchandise Processing Fee (MPF)",
      amount: Math.round(mpf),
      rate_note: `${(MPF_RATE * 100).toFixed(4)}% formal (min $${MPF_MIN} / max $${MPF_MAX})${
        exempt > 0 ? `; basis $${mpfBasis.toFixed(2)} after $${exempt.toFixed(2)} SPI/FTA exemption` : ""
      }`,
      floored,
      capped,
    });
  } else if (formal && entered > 0 && mpfBasis <= 0) {
    fees.push({
      code: "MPF",
      label: "Merchandise Processing Fee (MPF)",
      amount: 0,
      rate_note: `Exempt — entire entered value ($${entered.toFixed(2)}) covered by USMCA / CAFTA-DR SPI preference`,
    });
  }

  if (ocean && entered > 0) {
    const hmf = money2(entered * HMF_RATE);
    if (hmf > 0) {
      fees.push({
        code: "HMF",
        label: "Harbor Maintenance Fee (HMF)",
        amount: Math.round(hmf),
        rate_note: `${(HMF_RATE * 100).toFixed(3)}% of entered value (ocean / vessel)`,
      });
    }
  } else if (mode && entered > 0) {
    fees.push({
      code: "HMF",
      label: "Harbor Maintenance Fee (HMF)",
      amount: 0,
      rate_note: `Not due — ${mode.toLowerCase()} (HMF is ${(HMF_RATE * 100).toFixed(3)}% on ocean / vessel only)`,
    });
  }

  return {
    fees,
    total: money2(fees.reduce((a, f) => a + f.amount, 0)),
    mode_of_transport: mode,
    hmf_applies: ocean && entered > 0,
  };
}
