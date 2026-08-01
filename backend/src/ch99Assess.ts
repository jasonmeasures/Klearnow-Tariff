/**
 * Wrap tariff-rules US Ch99 engine into the TRE-shaped assess response
 * (same ledger fields as assess.ts so Calculator / scenario compare work).
 */
import {
  assessLineCh99,
  ENGINE_AS_OF,
  ENGINE_VERSION,
  type Ch99Layer,
} from "../../tariff-rules/src/ch99Engine.ts";
import { resolveCol1 } from "./htsLookup.ts";
import { rulepackPublic } from "./state.ts";

type LineIn = {
  line_id?: string;
  hts: string;
  coo: string;
  entered_value?: number | string;
  col1_rate_pct?: number | string;
  entry_date?: string;
  release_date?: string;
  filed_ch99?: string[];
};

function money2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function num(v: unknown, fallback = NaN): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function layerDuty(ev: number, e: Ch99Layer): number {
  // Engine rates are percent points (e.g. 15), not decimals
  const pct = e.rate_pct == null ? 0 : Number(e.rate_pct);
  return money2(ev * (pct / 100));
}

function programId(category: string | undefined): string {
  const c = (category || "").toLowerCase();
  if (c.includes("301") && c.includes("fl")) return "s301fl";
  if (c.includes("301")) return "s301";
  if (c.includes("232")) return "s232";
  if (c.includes("122")) return "s122";
  if (c.includes("ieepa")) return "ieepa";
  if (c.includes("mfn") || c.includes("col") || c.includes("column")) return "base";
  return "ch99";
}

function rateLabel(pctPoints: number): string {
  const s = String(Number(pctPoints.toFixed(4))).replace(/0+$/, "").replace(/\.$/, "");
  return `${s}% ad valorem`;
}

function toLayer(e: Ch99Layer, ev: number, seq: number) {
  const pctPoints = e.rate_pct == null ? 0 : Number(e.rate_pct);
  const duty = layerDuty(ev, e);
  const program = programId(e.category);
  return {
    stack_slot: String(seq),
    program,
    ch99: e.ch99 === "—" ? null : e.ch99,
    label: e.basis || e.category || e.ch99,
    reason: e.notes || e.basis || "",
    source_ref: e.authority || `US Ch99 pack ${ENGINE_VERSION}`,
    basis: "ENTERED_VALUE",
    basis_amount: ev,
    rate: rateLabel(pctPoints),
    rate_pct: pctPoints / 100,
    duty_amount: duty,
    // legacy aliases kept for any ch99-specific callers
    seq,
    amount: duty,
  };
}

export function assessCh99Entry(body: {
  lines?: LineIn[];
  entry_date?: string;
  release_date?: string;
  engine?: string;
}) {
  const linesIn = Array.isArray(body.lines) ? body.lines : [];
  const defaultDate = body.release_date || body.entry_date || null;

  const lines = linesIn.map((line, i) => {
    const ev = num(line.entered_value, 0);
    let col1 = num(line.col1_rate_pct, NaN);
    if (!Number.isFinite(col1)) {
      const hit = resolveCol1(line.hts, defaultDate || undefined);
      col1 = hit?.col1_pct ?? 0;
    }
    // resolveCol1 may return decimal (0.025) or percent — normalize to percent points
    if (col1 > 0 && col1 < 1) col1 = col1 * 100;

    const rateDate = line.release_date || line.entry_date || defaultDate;
    const { expected, opts } = assessLineCh99({
      coo: line.coo,
      hts: line.hts,
      mfnPct: col1,
      rateDate,
    });

    const layers = [
      {
        stack_slot: "1",
        program: "base",
        ch99: null as string | null,
        label: "Column 1 general",
        reason: "Commodity MFN / Column 1 duty on entered value",
        source_ref: "HTS Column 1",
        basis: "ENTERED_VALUE",
        basis_amount: ev,
        rate: rateLabel(col1),
        rate_pct: col1 / 100,
        duty_amount: money2(ev * (col1 / 100)),
        seq: 0,
        amount: money2(ev * (col1 / 100)),
      },
      ...expected.map((e, idx) => toLayer(e, ev, idx + 2)),
    ];

    const ch99Duty = money2(
      layers.filter((l) => l.program !== "base").reduce((s, l) => s + (l.duty_amount || 0), 0),
    );
    const mfnDuty = money2(ev * (col1 / 100));
    const total = money2(ch99Duty + mfnDuty);
    const effective = ev > 0 ? money2((total / ev) * 100) : 0;

    return {
      line_id: line.line_id || `L${i + 1}`,
      hts: line.hts,
      coo: line.coo,
      entered_value: ev,
      col1_rate_pct: col1,
      rate_date: opts.rateDate,
      rate_determination_date: opts.rateDate,
      rate_date_basis: "US Ch99 engine / 19 CFR 141.68",
      layers,
      suppressed: [] as unknown[],
      ch99_sequence: layers.map((l) => l.ch99).filter(Boolean) as string[],
      ch99_duty: ch99Duty,
      mfn_duty: mfnDuty,
      total_duty: total,
      totals: {
        duty: total,
        parts_duty: total,
        metals_duty: 0,
        effective_duty_rate_pct: effective,
      },
      diagnostics: expected
        .filter((e) => e.review_code)
        .map((e) => ({
          severity: "WARNING" as const,
          code: e.review_code || "REVIEW",
          message: e.notes || "Review required",
          remediation: null as string | null,
        })),
      filed_ch99: line.filed_ch99 || [],
    };
  });

  const totalDuty = money2(lines.reduce((s, l) => s + l.total_duty, 0));

  return {
    ok: true,
    jurisdiction: "US",
    engine: "ch99",
    rulepack: {
      ...rulepackPublic(),
      engine_version: ENGINE_VERSION,
      engine_as_of: ENGINE_AS_OF,
      rate_date_basis: "US Ch99 engine / 19 CFR 141.68",
    },
    lines,
    totals: {
      duty: totalDuty,
      fees: 0,
    },
    total_duty: totalDuty,
    summary: {
      line_count: lines.length,
      engine: "ch99",
    },
  };
}

/** @deprecated use assessCh99Entry */
export const assessInditexEntry = assessCh99Entry;
