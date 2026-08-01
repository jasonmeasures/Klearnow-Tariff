import {
  assertComputable,
  assertRateKnown,
  chinaStack,
  getCh99,
  jp232TopUp,
  normalizeCh99,
} from "../../tariff-rules/src/tariffRules.ts";
import { assessS301fl } from "../../tariff-rules/src/s301fl.ts";
import { resolveCol1 } from "./htsLookup.ts";
import { rulepackPublic } from "./state.ts";

export type Diagnostic = {
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  message: string;
  remediation?: string;
};

export type DutyLayer = {
  stack_slot: string;
  program: string;
  ch99: string | null;
  label: string;
  reason?: string;
  source_ref?: string;
  basis: string;
  basis_amount: number;
  rate: string;
  rate_pct: number;
  duty_amount: number;
};

export type SuppressedLayer = DutyLayer & { reason: string };

export type LineIn = {
  line_id?: string;
  hts: string;
  coo: string;
  entered_value: number | string;
  col1_rate_pct?: number | string;
  entry_date?: string;
  release_date?: string;
  it_date?: string;
  warehouse_withdrawal_date?: string;
  entry_type?: string;
  metal_content_value?: number | string;
  filed_ch99?: string[];
  filed_duty_total?: number | string;
  flags?: Record<string, boolean>;
};

function money2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pctLabel(decimalRate: number): string {
  const p = decimalRate * 100;
  const s = p.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `${s}% ad valorem`;
}

function rateDate(line: LineIn): { date: string; basis: string } {
  const et = (line.entry_type || "CONSUMPTION").toUpperCase();
  if (et === "IT" && line.it_date) {
    return { date: line.it_date, basis: "IT date (19 CFR 141.68)" };
  }
  if (et === "WAREHOUSE" && line.warehouse_withdrawal_date) {
    return {
      date: line.warehouse_withdrawal_date,
      basis: "warehouse withdrawal (19 CFR 141.69)",
    };
  }
  if (line.release_date) {
    return { date: line.release_date, basis: "latest_release (19 CFR 141.68)" };
  }
  if (line.entry_date) {
    return { date: line.entry_date, basis: "entry date (fallback)" };
  }
  return {
    date: new Date().toISOString().slice(0, 10),
    basis: "assessment date (no line date supplied)",
  };
}

function uiProgram(id: string): string {
  const map: Record<string, string> = {
    SEC_301_CHINA_LEGACY: "s301",
    SEC_301: "s301",
    SEC_301_FL: "s301fl",
    SEC_232_AUTOS: "s232",
    SEC_232_METALS: "s232",
    TRADE_DEAL_JP: "s232",
    TRADE_DEAL_EU: "s232",
    TRADE_DEAL_KR: "s232",
    TBC_LABELING: "s232",
    base: "base",
  };
  return map[id] || id.toLowerCase();
}

function layer(opts: {
  slot: string;
  program: string;
  ch99: string | null;
  label: string;
  reason?: string;
  source_ref?: string;
  basis?: string;
  basis_amount: number;
  rate_pct: number;
}): DutyLayer {
  const duty = money2(opts.basis_amount * opts.rate_pct);
  return {
    stack_slot: opts.slot,
    program: uiProgram(opts.program),
    ch99: opts.ch99,
    label: opts.label,
    reason: opts.reason,
    source_ref: opts.source_ref,
    basis: opts.basis || "ENTERED_VALUE",
    basis_amount: money2(opts.basis_amount),
    rate: pctLabel(opts.rate_pct),
    rate_pct: opts.rate_pct,
    duty_amount: duty,
  };
}

function chinaListCode(flags: Record<string, boolean>): string | null {
  if (flags.s301_list_3 || flags.s301_list3) return "9903.88.03";
  if (flags.s301_list_4a || flags.s301_list4a) return "9903.88.01";
  if (flags.s301_list_1 || flags.s301_list1) return "9903.88.03";
  if (flags.s301_list_2 || flags.s301_list2) return "9903.88.03";
  return null;
}

function rejectDeadFiled(filed: string[], diagnostics: Diagnostic[]) {
  for (const raw of filed) {
    const c = normalizeCh99(raw);
    if (c.startsWith("9903.01.")) {
      diagnostics.push({
        severity: "ERROR",
        code: "DEAD_PROGRAM_IEEPA",
        message: `Filed Chapter 99 ${c} is an IEEPA heading. IEEPA was struck down; do not include prospectively.`,
        remediation: "Remove 9903.01.xx from the filing and reassess under live programs (232 / 301 / 301-FL).",
      });
    }
  }
}

export function assessLine(line: LineIn, index: number) {
  const diagnostics: Diagnostic[] = [];
  const layers: DutyLayer[] = [];
  const suppressed: SuppressedLayer[] = [];
  const line_id = line.line_id || String(index + 1);
  const hts = String(line.hts || "").trim();
  const coo = String(line.coo || "").trim().toUpperCase();
  const entered = num(line.entered_value);
  const rd = rateDate(line);

  let col1Pct = num(line.col1_rate_pct, NaN);
  let col1Source = "supplied";
  if (!Number.isFinite(col1Pct)) {
    const resolved = resolveCol1(hts, rd.date);
    if (resolved) {
      col1Pct = resolved.col1_pct;
      col1Source = "hts_table";
      diagnostics.push({
        severity: "INFO",
        code: "COL1_RESOLVED",
        message: `Column-1 ${col1Pct}% resolved from HTS table for ${resolved.hts} (window ${resolved.start} → ${resolved.end}).`,
      });
    } else {
      col1Pct = 0;
      col1Source = "missing";
      diagnostics.push({
        severity: "WARNING",
        code: "MISSING_COL1",
        message: "No column-1 rate supplied and HTS was not found in the classification table.",
        remediation: "Enter col1_rate_pct on the line, or confirm the 10-digit HTS.",
      });
    }
  }
  const col1 = col1Pct / 100;
  const flags = line.flags || {};
  const filed = (line.filed_ch99 || []).map(normalizeCh99);

  if (!hts) {
    diagnostics.push({
      severity: "ERROR",
      code: "MISSING_HTS",
      message: "No HTS on the line.",
    });
  }
  if (!coo) {
    diagnostics.push({
      severity: "ERROR",
      code: "MISSING_COO",
      message: "No country of origin on the line.",
    });
  }
  if (!(entered > 0)) {
    diagnostics.push({
      severity: "ERROR",
      code: "MISSING_VALUE",
      message: "Entered value must be a positive number.",
    });
  }

  rejectDeadFiled(filed, diagnostics);

  const is232 = Boolean(flags.s232_auto_part || flags.s232_auto || flags.s232);
  if (is232) {
    diagnostics.push({
      severity: "WARNING",
      code: "S232_ANNEX_CLAIM_GATED",
      message:
        "Section 232 auto-part status is claim-gated. Chapter membership is triage only — confirm the 10-digit HTS against Proclamation 10908 annex before filing.",
      remediation: "Attach annex evidence or clear the 232 claim if the part is out of scope.",
    });
  }

  const chinaCode = coo === "CN" ? chinaListCode(flags) : null;
  let partsDuty = 0;
  let metalsDuty = 0;
  let blocked = false;

  // Trade-deal total path (non JP top-up) is blocked by R6
  const tradeDealAttempt =
    Boolean(flags.trade_deal_eu || flags.trade_deal_kr || flags.trade_deal_tw) ||
    filed.some((c) => ["9903.94.45", "9903.94.55", "9903.94.63"].includes(c));
  if (tradeDealAttempt && !(is232 && coo === "JP")) {
    try {
      computeTradeDealBlocked();
    } catch (e) {
      blocked = true;
      diagnostics.push({
        severity: "ERROR",
        code: "DATA_GAP_MFN_CAP_RULE",
        message: e instanceof Error ? e.message : String(e),
        remediation:
          "Resolve R6_MFN_CAP_RULE in tariff-rules/data/interaction_rules.json before computing trade-deal totals.",
      });
    }
  }

  if (!blocked && chinaCode) {
    try {
      const c301 = assertComputable(chinaCode);
      layers.push(
        layer({
          slot: "3.1",
          program: c301.program,
          ch99: c301.code,
          label: c301.notes.split(".")[0] || "Legacy China 301",
          reason: "Legacy China 301 is not suppressed by Section 232 (R2). Reports first.",
          source_ref: c301.notes,
          basis_amount: entered,
          rate_pct: c301.rate,
        }),
      );

      if (is232) {
        const meta = assertRateKnown("9903.94.05");
        if (meta.status !== "CONFIRMED") {
          diagnostics.push({
            severity: "WARNING",
            code: "TBC_PROGRAM_LABEL",
            message: `${meta.code} rate is confirmed but program labeling is unresolved. ${meta.notes}`,
            remediation:
              "Confirm 232 vs trade-deal/IEEPA labeling before relying on drawback/refund treatment.",
          });
        }
        layers.push(
          layer({
            slot: "3.3",
            program: "SEC_232_AUTOS",
            ch99: meta.code,
            label: "Section 232 — auto parts (rate known)",
            reason: `China stack (R2): effective ${(
              chinaStack(col1, c301.rate, meta.rate) * 100
            ).toFixed(1)}% when col-1 is ${col1Pct}%.`,
            source_ref: meta.notes,
            basis_amount: entered,
            rate_pct: meta.rate,
          }),
        );
        push301FlSuppression(coo, entered, col1, layers, suppressed);
      } else {
        add301Fl(coo, entered, col1, layers, suppressed, diagnostics);
      }

      layers.push(
        layer({
          slot: "6.0",
          program: "base",
          ch99: null,
          label: "Column-1 / Chapters 1–97",
          reason: "Commodity line rate.",
          basis_amount: entered,
          rate_pct: col1,
        }),
      );
    } catch (e) {
      diagnostics.push({
        severity: "ERROR",
        code: "REVIEW_REQUIRED",
        message: e instanceof Error ? e.message : String(e),
      });
      blocked = true;
    }
  } else if (!blocked && is232 && coo === "JP") {
    // Confirmed JP 232 top-up path (R3) — uses helper, not computeTradeDealTotal
    const top = jp232TopUp(col1);
    const heading = "9903.94.43";
    const meta = getCh99(heading);
    diagnostics.push({
      severity: "WARNING",
      code: "TBC_MFN_MECHANIC_LABEL",
      message:
        `${heading} is used for the confirmed Japan 232 top-up path (R3). Full trade-deal MFN-cap totals remain blocked under R6.`,
      remediation: meta?.notes,
    });
    const L232 = layer({
      slot: "3.3",
      program: "SEC_232_AUTOS",
      ch99: heading,
      label: "Japan 232 auto-part top-up to 15%",
      reason:
        col1 < 0.15
          ? `Column-1 ${col1Pct}% is below 15%; Ch.99 reports 15% and Ch.1–97 reports zero (R3).`
          : `Column-1 already ≥ 15%; no top-up.`,
      source_ref: "R3_JP_232_TOPUP",
      basis_amount: entered,
      rate_pct: top.ch99Line,
    });
    layers.push(L232);
    push301FlSuppression(coo, entered, col1, layers, suppressed);
    layers.push(
      layer({
        slot: "6.0",
        program: "base",
        ch99: null,
        label: "Column-1 / Chapters 1–97",
        reason:
          top.ch1to97Line === 0
            ? "Zeroed on commodity line when Japan 232 top-up applies (R3)."
            : "Column-1 applies on commodity line.",
        basis_amount: entered,
        rate_pct: top.ch1to97Line,
      }),
    );
  } else if (!blocked && is232) {
    // Non-JP 232 default 25% with TBC program label
    try {
      const meta = assertRateKnown("9903.94.05");
      if (meta.status !== "CONFIRMED") {
        diagnostics.push({
          severity: "WARNING",
          code: "TBC_PROGRAM_LABEL",
          message: `${meta.code} rate confirmed; program label unresolved. ${meta.notes}`,
        });
      }
      layers.push(
        layer({
          slot: "3.3",
          program: "SEC_232_AUTOS",
          ch99: meta.code,
          label: "Section 232 — auto parts",
          reason: "Default 232 auto-parts duty while annex claim is asserted.",
          source_ref: meta.notes,
          basis_amount: entered,
          rate_pct: meta.rate,
        }),
      );
      push301FlSuppression(coo, entered, col1, layers, suppressed);
      layers.push(
        layer({
          slot: "6.0",
          program: "base",
          ch99: null,
          label: "Column-1 / Chapters 1–97",
          reason: "Commodity line rate.",
          basis_amount: entered,
          rate_pct: col1,
        }),
      );
    } catch (e) {
      diagnostics.push({
        severity: "ERROR",
        code: "REVIEW_REQUIRED",
        message: e instanceof Error ? e.message : String(e),
      });
      blocked = true;
    }
  } else if (!blocked) {
    // Non-232 → country-specific 301-FL from s301fl pack
    add301Fl(coo, entered, col1, layers, suppressed, diagnostics);
    layers.push(
      layer({
        slot: "6.0",
        program: "base",
        ch99: null,
        label: "Column-1 / Chapters 1–97",
        reason: "Commodity line rate.",
        basis_amount: entered,
        rate_pct: col1,
      }),
    );
  }

  // Metals separate line (R4)
  const metalVal = num(line.metal_content_value);
  if (metalVal > 0) {
    try {
      const steel = assertComputable("9903.03.01");
      const Lm = layer({
        slot: "3.3",
        program: steel.program,
        ch99: steel.code,
        label: "Section 232 metals — steel",
        reason:
          "Metals duty on metal-content value; excluded from parts TOTAL (R4).",
        source_ref: steel.notes,
        basis: "METAL_CONTENT_VALUE",
        basis_amount: metalVal,
        rate_pct: steel.rate,
      });
      layers.push(Lm);
      metalsDuty += Lm.duty_amount;
      diagnostics.push({
        severity: "INFO",
        code: "METALS_SEPARATE_LINE",
        message: "232 metals reported on metal-content value and kept out of the parts subtotal.",
      });
    } catch (e) {
      diagnostics.push({
        severity: "ERROR",
        code: "REVIEW_REQUIRED",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  partsDuty = money2(
    layers
      .filter((l) => l.basis !== "METAL_CONTENT_VALUE")
      .reduce((a, l) => a + l.duty_amount, 0),
  );
  const totalDuty = money2(partsDuty + metalsDuty);
  const effective = entered > 0 ? money2((partsDuty / entered) * 100) : 0;

  const seq = layers.filter((l) => l.ch99).map((l) => l.ch99 as string);
  const ordered = [
    ...seq.filter((c) => c.startsWith("9903.88")),
    ...seq.filter((c) => c === "9903.05.90"),
    ...seq.filter((c) => c.startsWith("9903.94") || c.startsWith("9903.74")),
    ...seq.filter((c) => c.startsWith("9903.05") && c !== "9903.05.90"),
    ...seq.filter((c) => c.startsWith("9903.03")),
  ];
  const ch99_sequence_unique = [...new Set(ordered.length ? ordered : seq)];

  return {
    line_id,
    hts,
    coo,
    entered_value: entered,
    col1_rate_pct: col1Pct,
    col1_source: col1Source,
    rate_determination_date: rd.date,
    rate_date_basis: rd.basis,
    layers,
    suppressed,
    diagnostics,
    ch99_sequence: ch99_sequence_unique,
    totals: {
      duty: totalDuty,
      parts_duty: partsDuty,
      metals_duty: metalsDuty,
      effective_duty_rate_pct: effective,
    },
    blocked,
  };
}

function computeTradeDealBlocked(): never {
  throw new Error(
    "MFN cap mechanic for trade-deal codes (9903.94.43/.45/.55/.63) is unresolved (R6_MFN_CAP_RULE).",
  );
}

function push301FlSuppression(
  coo: string,
  entered: number,
  col1: number,
  layers: DutyLayer[],
  suppressed: SuppressedLayer[],
) {
  layers.push(
    layer({
      slot: "3.2",
      program: "SEC_301_FL",
      ch99: "9903.05.90",
      label: "301-FL suppressed — Section 232 wins (R1)",
      reason: "232 autos/parts and 301-FL are mutually exclusive; 232 wins (US Note 52(f)).",
      source_ref: "CSMS #69326983 — 9903.05.90",
      basis_amount: entered,
      rate_pct: 0,
    }),
  );

  const would = assessS301fl(coo, col1);
  if (would.kind === "out_of_scope") return;
  const rate =
    would.kind === "threshold_no_add" ? 0 : would.rate_pct_decimal;
  const heading = would.heading;
  const wouldDuty = money2(entered * rate);
  suppressed.push({
    ...layer({
      slot: "3.2",
      program: "SEC_301_FL",
      ch99: heading,
      label: `${would.label} (suppressed)`,
      reason: `Suppressed by 9903.05.90. Would otherwise have assessed $${wouldDuty.toFixed(2)}. ${would.reason}`,
      source_ref: "CSMS #69326983",
      basis_amount: entered,
      rate_pct: rate,
    }),
    reason: `Suppressed by 9903.05.90. Would otherwise have assessed $${wouldDuty.toFixed(2)}.`,
  });
}

function add301Fl(
  coo: string,
  entered: number,
  col1: number,
  layers: DutyLayer[],
  _suppressed: SuppressedLayer[],
  diagnostics: Diagnostic[],
) {
  const fl = assessS301fl(coo, col1);
  if (fl.kind === "out_of_scope") {
    diagnostics.push({
      severity: "INFO",
      code: "FL301_OUT_OF_SCOPE",
      message: fl.reason,
    });
    return;
  }

  const rate = fl.kind === "threshold_no_add" ? 0 : fl.rate_pct_decimal;
  layers.push(
    layer({
      slot: "3.2",
      program: "SEC_301_FL",
      ch99: fl.heading,
      label: fl.label,
      reason: fl.reason,
      source_ref: "CSMS #69326983",
      basis_amount: entered,
      rate_pct: rate,
    }),
  );
  diagnostics.push({
    severity: "INFO",
    code: "FL301_APPLIED",
    message: fl.reason,
  });
}

export function assessEntry(body: {
  lines: LineIn[];
  formal_entry?: boolean;
  mode_of_transport?: string | null;
  entry_number?: string;
  knowledge_date?: string;
}) {
  const lines = (body.lines || []).map((l, i) => assessLine(l, i));
  const duty = money2(lines.reduce((a, l) => a + l.totals.duty, 0));
  return {
    entry_number: body.entry_number || null,
    jurisdiction: "US",
    rulepack: rulepackPublic(),
    lines,
    totals: { duty, fees: 0 },
    entry_fees: [],
  };
}

export function auditEntry(body: {
  lines: LineIn[];
  formal_entry?: boolean;
  mode_of_transport?: string | null;
  entry_number?: string;
  knowledge_date?: string;
}) {
  const assessed = assessEntry(body);
  const findings: Array<{
    severity: string;
    category: string;
    line_id: string;
    message: string;
    remediation?: string;
    duty_impact: number;
  }> = [];

  (body.lines || []).forEach((raw, i) => {
    const L = assessed.lines[i];
    if (!L) return;
    const filed = new Set((raw.filed_ch99 || []).map(normalizeCh99));
    const computed = new Set(L.ch99_sequence);
    for (const c of computed) {
      if (!filed.has(c) && getCh99(c)?.kind === "DUTY") {
        const layer = L.layers.find((x) => x.ch99 === c);
        findings.push({
          severity: "ERROR",
          category: "MISSING_CH99",
          line_id: L.line_id,
          message: `Computed Chapter 99 ${c} was not filed.`,
          remediation: `Add ${c} to the entry line in CBP reporting order.`,
          duty_impact: layer?.duty_amount ?? 0,
        });
      }
    }
    for (const c of filed) {
      if (c.startsWith("9903.01.")) {
        findings.push({
          severity: "ERROR",
          category: "DEAD_PROGRAM",
          line_id: L.line_id,
          message: `Filed ${c} (IEEPA) is not a live program.`,
          remediation: "Remove the IEEPA heading from the filing.",
          duty_impact: 0,
        });
      } else if (!computed.has(c) && !L.suppressed.some((s) => s.ch99 === c)) {
        findings.push({
          severity: "WARNING",
          category: "EXTRA_CH99",
          line_id: L.line_id,
          message: `Filed Chapter 99 ${c} was not produced by the current pack.`,
          remediation: "Confirm the claim flags and annex determinations, or remove the code.",
          duty_impact: 0,
        });
      }
    }
  });

  const net = money2(findings.reduce((a, f) => a + (f.duty_impact || 0), 0));
  return {
    ...assessed,
    findings,
    summary: { net_duty_impact: net, finding_count: findings.length },
  };
}
