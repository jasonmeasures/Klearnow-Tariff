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

/** Harbor Maintenance Fee — 0.125% of entered value, ocean only. */
const HMF_RATE = 0.00125;

export function computeEntryFees(opts: {
  entered_value_total: number;
  formal_entry?: boolean;
  mode_of_transport?: string | null;
}): { fees: EntryFee[]; total: number } {
  const entered = Math.max(0, Number(opts.entered_value_total) || 0);
  const fees: EntryFee[] = [];
  const mode = String(opts.mode_of_transport || "").toUpperCase();
  const formal = opts.formal_entry !== false; // default formal when unspecified for UI parity

  if (formal && entered > 0) {
    let mpf = money2(entered * MPF_RATE);
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
      rate_note: `${(MPF_RATE * 100).toFixed(4)}% formal (min $${MPF_MIN} / max $${MPF_MAX})`,
      floored,
      capped,
    });
  }

  if (mode === "OCEAN" || mode === "VESSEL" || mode === "SEA") {
    const hmf = money2(entered * HMF_RATE);
    if (hmf > 0) {
      fees.push({
        code: "HMF",
        label: "Harbor Maintenance Fee (HMF)",
        amount: Math.round(hmf),
        rate_note: `${(HMF_RATE * 100).toFixed(3)}% ocean / vessel`,
      });
    }
  }

  return { fees, total: money2(fees.reduce((a, f) => a + f.amount, 0)) };
}
