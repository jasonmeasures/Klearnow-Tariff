/**
 * Chapter 98 duty basis — shared valuation for trade-remedy and Column-1 layers.
 *
 * Carve-outs (duty still applies, special basis):
 *   9802.00.40 / .50 / .60 — value of repairs, alterations, or processing
 *   9802.00.80 — assembled-abroad value less US-content cost/value
 *
 * Exception (CSMS #68253075): under 9802.00.60, Section 232 duties are assessed
 * on the full value of the imported article (not the processing value).
 *
 * General Chapter 98 (other 98xx, not Subchapter XXIII): suppresses classic
 * Section 301 (Note 20(f)), 301-FL (pack chapter_98), Brazil 301, and
 * Section 338 (CSMS #69606660). Does not suppress Section 232.
 */

export const CH98_REPAIR_PROVISIONS = ["9802.00.40", "9802.00.50", "9802.00.60"] as const;
export const CH98_ASSEMBLY_PROVISION = "9802.00.80";
/** 232 full-value exception under CSMS #68253075. */
export const CH98_232_FULL_VALUE_PROVISION = "9802.00.60";

export type Ch98Program =
  | "col1"
  | "s301"
  | "s301fl"
  | "s301_brazil"
  | "s338"
  | "s232"
  | "s232_metals"
  | "s201"
  | "s122";

export type Ch98Classification =
  | { kind: "none" }
  | { kind: "suppress"; provision: string }
  | { kind: "repair"; provision: string }
  | { kind: "assembly"; provision: string }
  | { kind: "subchapter_xxiii"; provision: string };

export type Ch98BasisName = "ENTERED_VALUE" | "REPAIR_VALUE" | "ASSEMBLY_LESS_US_CONTENT";

export type Ch98BasisResult = {
  kind: Ch98Classification["kind"];
  provision: string | null;
  /** Skip this trade-remedy layer entirely (no Ch.99 heading). */
  suppress: boolean;
  basis: Ch98BasisName;
  basis_amount: number;
  reason?: string;
  /** True when repair/US-content was required but missing — fell back to entered. */
  missing_value?: "repair" | "us_content";
};

const SUPPRESS_PROGRAMS: ReadonlySet<Ch98Program> = new Set([
  "s301",
  "s301fl",
  "s301_brazil",
  "s338",
]);

export function normalizeCh98(code: string): string {
  const d = String(code || "").replace(/\D/g, "");
  if (d.length < 8) return String(code || "").trim();
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
}

export function classifyChapter98(provision: string | null | undefined): Ch98Classification {
  const code = normalizeCh98(provision || "");
  if (!code || !code.startsWith("98")) return { kind: "none" };
  if (code.startsWith("9823")) return { kind: "subchapter_xxiii", provision: code };
  if ((CH98_REPAIR_PROVISIONS as readonly string[]).includes(code)) {
    return { kind: "repair", provision: code };
  }
  if (code === CH98_ASSEMBLY_PROVISION) {
    return { kind: "assembly", provision: code };
  }
  return { kind: "suppress", provision: code };
}

function money2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(v: unknown): number {
  if (v == null || v === "") return NaN;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Resolve dutiable basis (and optional suppression) for a Chapter 98 claim
 * against a specific duty program.
 */
export function resolveCh98DutyBasis(opts: {
  provision?: string | null;
  entered: number;
  repair_value?: number | string | null;
  us_content_value?: number | string | null;
  program: Ch98Program;
}): Ch98BasisResult {
  const entered = money2(Math.max(0, Number(opts.entered) || 0));
  const cls = classifyChapter98(opts.provision);
  const program = opts.program;

  if (cls.kind === "none") {
    return {
      kind: "none",
      provision: null,
      suppress: false,
      basis: "ENTERED_VALUE",
      basis_amount: entered,
    };
  }

  if (cls.kind === "subchapter_xxiii") {
    return {
      kind: "subchapter_xxiii",
      provision: cls.provision,
      suppress: false,
      basis: "ENTERED_VALUE",
      basis_amount: entered,
      reason: `Chapter 98 ${cls.provision} (Subchapter XXIII) — duties on full entered value.`,
    };
  }

  if (cls.kind === "suppress") {
    const suppress = SUPPRESS_PROGRAMS.has(program);
    return {
      kind: "suppress",
      provision: cls.provision,
      suppress,
      basis: "ENTERED_VALUE",
      basis_amount: entered,
      reason: suppress
        ? `Chapter 98 ${cls.provision}: properly claimed provision suppresses this trade remedy (no Ch.99 heading).`
        : `Chapter 98 ${cls.provision}: claimed; this program is not auto-suppressed by general Chapter 98.`,
    };
  }

  if (cls.kind === "repair") {
    const is232Full =
      cls.provision === CH98_232_FULL_VALUE_PROVISION &&
      (program === "s232" || program === "s232_metals");
    if (is232Full) {
      return {
        kind: "repair",
        provision: cls.provision,
        suppress: false,
        basis: "ENTERED_VALUE",
        basis_amount: entered,
        reason: `Chapter 98 ${cls.provision}: Section 232 assessed on full value of the imported article (CSMS #68253075); other programs use processing value.`,
      };
    }
    const repair = num(opts.repair_value);
    if (Number.isFinite(repair) && repair >= 0) {
      return {
        kind: "repair",
        provision: cls.provision,
        suppress: false,
        basis: "REPAIR_VALUE",
        basis_amount: money2(repair),
        reason: `Chapter 98 ${cls.provision}: duty on value of repairs, alterations, or processing only.`,
      };
    }
    return {
      kind: "repair",
      provision: cls.provision,
      suppress: false,
      basis: "REPAIR_VALUE",
      basis_amount: entered,
      missing_value: "repair",
      reason: `Chapter 98 ${cls.provision}: repair/processing value not supplied — using entered value until provided.`,
    };
  }

  // assembly 9802.00.80
  const us = num(opts.us_content_value);
  if (Number.isFinite(us) && us >= 0) {
    return {
      kind: "assembly",
      provision: cls.provision,
      suppress: false,
      basis: "ASSEMBLY_LESS_US_CONTENT",
      basis_amount: money2(Math.max(0, entered - us)),
      reason: `Chapter 98 ${cls.provision}: duty on assembled-abroad value less US-content cost/value.`,
    };
  }
  return {
    kind: "assembly",
    provision: cls.provision,
    suppress: false,
    basis: "ASSEMBLY_LESS_US_CONTENT",
    basis_amount: entered,
    missing_value: "us_content",
    reason: `Chapter 98 ${cls.provision}: US-content value not supplied — using full entered value until provided.`,
  };
}

/** Programs for which general Chapter 98 suppresses the remedy heading. */
export function ch98SuppressesProgram(program: Ch98Program): boolean {
  return SUPPRESS_PROGRAMS.has(program);
}
