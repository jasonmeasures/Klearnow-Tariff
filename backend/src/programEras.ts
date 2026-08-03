/**
 * US additional-duty program eras for Entry Date / rate-date routing.
 * Source: tariff-rules/data/program_status.json + ch99_rules.json windows.
 */

/** IEEPA CAPE / refund window (inclusive). Struck down prospectively after end. */
export const IEEPA_START = "2025-02-04";
export const IEEPA_END = "2026-02-23";

/** Section 122 10% surcharge — inclusive calendar days while in force. */
export const SEC_122_START = "2026-02-24";
export const SEC_122_END = "2026-07-23"; // sunset 12:01 a.m. 2026-07-24

/** 301-FL effective (replaces Sec 122 at the same instant). */
export const S301FL_START = "2026-07-24";

export const SEC_122_CH99 = "9903.03.01";

export type FilingEra = "pre_ieepa" | "ieepa" | "sec_122" | "s301fl";

export function day(iso: string | null | undefined): string {
  return String(iso || "").slice(0, 10);
}

export function inIeepaWindow(d: string | null | undefined): boolean {
  const x = day(d);
  return Boolean(x && x >= IEEPA_START && x <= IEEPA_END);
}

export function sec122AppliesOn(d: string | null | undefined): boolean {
  const x = day(d);
  return Boolean(x && x >= SEC_122_START && x <= SEC_122_END);
}

export function s301flAppliesOn(d: string | null | undefined): boolean {
  const x = day(d);
  return Boolean(x && x >= S301FL_START);
}

export function filingEra(d: string | null | undefined): FilingEra {
  const x = day(d);
  if (!x) return "s301fl"; // assume current pack if undated
  if (x < IEEPA_START) return "pre_ieepa";
  if (x <= IEEPA_END) return "ieepa";
  if (x <= SEC_122_END) return "sec_122";
  return "s301fl";
}

export function filingEraLabel(era: FilingEra): string {
  switch (era) {
    case "pre_ieepa":
      return "Pre-IEEPA";
    case "ieepa":
      return "IEEPA era";
    case "sec_122":
      return "Section 122 era";
    case "s301fl":
      return "301-FL era";
  }
}

/** Codes that belong to a dead / wrong era when filed on this rate date. */
export function wrongEraFiledCode(
  code: string,
  rateDay: string,
): { category: string; severity: "ERROR" | "WARNING"; message: string; remediation: string } | null {
  const c = code.trim();
  if (c.startsWith("9903.01.") || c.startsWith("9903.02.")) {
    if (inIeepaWindow(rateDay)) return null; // handled as CAPE candidate elsewhere
    if (rateDay >= "2026-02-24") {
      return {
        category: "WRONG_ERA",
        severity: "ERROR",
        message: `Filed ${c} (IEEPA) on ${rateDay} — IEEPA ended ${IEEPA_END}; era is ${filingEraLabel(filingEra(rateDay))}.`,
        remediation: "Remove IEEPA. Use Sec 122 (through 2026-07-23) or 301-FL (from 2026-07-24), plus 232 / China 301 as applicable.",
      };
    }
    return {
      category: "WRONG_ERA",
      severity: "WARNING",
      message: `Filed ${c} (IEEPA) on ${rateDay} before IEEPA start (${IEEPA_START}).`,
      remediation: "Confirm with the broker whether this heading belongs on the entry.",
    };
  }
  if (c === SEC_122_CH99 || (c.startsWith("9903.03.") && c === "9903.03.01")) {
    if (sec122AppliesOn(rateDay)) return null;
    if (s301flAppliesOn(rateDay)) {
      return {
        category: "WRONG_ERA",
        severity: "ERROR",
        message: `Filed ${c} (Section 122) on ${rateDay} after sunset — Sec 122 ended ${SEC_122_END}; 301-FL applies from ${S301FL_START}.`,
        remediation: "Remove Sec 122 surcharge; assess under 301-FL / live stack.",
      };
    }
    if (rateDay && rateDay < SEC_122_START) {
      return {
        category: "WRONG_ERA",
        severity: "WARNING",
        message: `Filed ${c} (Section 122) on ${rateDay} before Sec 122 start (${SEC_122_START}).`,
        remediation: "Confirm whether Annex/IEEPA or another layer should apply instead.",
      };
    }
  }
  // 301-FL headings before effective
  if (c.startsWith("9903.05.") && rateDay && rateDay < S301FL_START) {
    // 9903.05.90 also used as 232 vs FL suppression after FL exists; before FL era it's odd
    return {
      category: "WRONG_ERA",
      severity: "WARNING",
      message: `Filed ${c} (301-FL family) on ${rateDay} before 301-FL effective ${S301FL_START}.`,
      remediation:
        rateDay <= SEC_122_END
          ? "In Sec 122 era, expect 9903.03.01 (and China 301 / 232 as applicable), not 301-FL."
          : "Confirm the rate date and live pack.",
    };
  }
  return null;
}
