/**
 * HTS list coverage — which baseline rates + Chapter 99 rules apply.
 * No entered value required (duty dollars are not the goal).
 */
import * as XLSX from "xlsx";
import { assessS301fl, lookupS301fl } from "../../tariff-rules/src/s301fl.ts";
import {
  previewS232Universe,
  type S232UniversePreview,
} from "../../tariff-rules/src/s232Resolve.ts";
import { assessLine, type LineIn } from "./assess.ts";
import {
  formatHtsDisplay,
  lookupHts,
  normalizeHtsDigits,
  resolveCol1,
  suggestRelatedHts,
  usitcSearchUrl,
} from "./htsLookup.ts";
import { LIMITS, assertMaxItems, decodeXlsxBase64, yieldEventLoop } from "./loadGuard.ts";
import { rulepackPublic } from "./state.ts";

export type CoverageRowIn = {
  hts?: string;
  coo?: string;
  origin?: string;
  country?: string;
  /** Part number / item id from source sheet — retained in coverage output. */
  part?: string;
  /** SKU / product code from source sheet — retained in coverage output. */
  sku?: string;
  as_of?: string;
  entry_date?: string;
  flags?: Record<string, boolean>;
  s301_list_3?: boolean | string;
  s232_auto_part?: boolean | string;
  s232_mhdv_part?: boolean | string;
  s232_mhdv?: boolean | string;
  s232_semiconductor?: boolean | string;
  s232_vehicle_vintage?: boolean | string;
  s232_wood_not_cabinet?: boolean | string;
};

export type AppliedRule = {
  program: string;
  ch99: string | null;
  label: string;
  rate: string;
  rate_pct: number | null;
  reason: string;
  source_ref: string;
  status: "applies" | "reporting" | "needs_claim" | "info";
};

function truthy(v: unknown): boolean {
  if (v === true || v === 1) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

function pctPoints(col1: number): number {
  // table stores percent points (2.5) or occasionally decimal
  if (col1 > 0 && col1 < 1) return col1 * 100;
  return col1;
}

function rateLabel(pctPointsVal: number): string {
  const s = String(Number(pctPointsVal.toFixed(4))).replace(/0+$/, "").replace(/\.$/, "");
  return `${s}% ad valorem`;
}

function pickCoo(row: CoverageRowIn, defaultCoo: string | null): string {
  return String(row.coo || row.origin || row.country || defaultCoo || "")
    .trim()
    .toUpperCase();
}

function rowFlags(row: CoverageRowIn): Record<string, boolean> {
  const flags = { ...(row.flags || {}) };
  if (truthy(row.s301_list_3) || truthy((row as { s301_list3?: unknown }).s301_list3)) {
    flags.s301_list_3 = true;
  }
  if (truthy(row.s232_auto_part) || truthy((row as { s232?: unknown }).s232)) {
    flags.s232_auto_part = true;
  }
  if (truthy(row.s232_mhdv_part) || truthy(row.s232_mhdv)) {
    flags.s232_mhdv_part = true;
    if (truthy(row.s232_mhdv)) flags.s232_mhdv = true;
  }
  if (truthy(row.s232_semiconductor)) flags.s232_semiconductor = true;
  if (truthy(row.s232_vehicle_vintage)) flags.s232_vehicle_vintage = true;
  if (truthy(row.s232_wood_not_cabinet)) flags.s232_wood_not_cabinet = true;
  if (truthy((row as { civil_aircraft_gn6?: unknown }).civil_aircraft_gn6)) {
    flags.civil_aircraft_gn6 = true;
  }
  return flags;
}

function claimed(flags: Record<string, boolean>, ...keys: string[]): boolean {
  return keys.some((k) => Boolean(flags[k]));
}

function auto232Rate(ch99: string): { rate: string; rate_pct: number | null } {
  if (
    [
      "9903.94.41",
      "9903.94.43",
      "9903.94.51",
      "9903.94.53",
      "9903.94.61",
      "9903.94.63",
      "9903.94.65",
    ].includes(ch99)
  ) {
    return { rate: "combined 15%", rate_pct: 0.15 };
  }
  if (ch99 === "9903.94.32") return { rate: "combined 10%", rate_pct: 0.1 };
  if (ch99 === "9903.94.31") return { rate: "7.5% additional (UK TRQ)", rate_pct: 0.075 };
  if (
    [
      "9903.94.40",
      "9903.94.42",
      "9903.94.50",
      "9903.94.52",
      "9903.94.60",
      "9903.94.62",
      "9903.94.64",
    ].includes(ch99)
  ) {
    return { rate: "0% additional", rate_pct: 0 };
  }
  return { rate: "25% additional", rate_pct: 0.25 };
}

/** Section 232 list membership — auto-apply vs claim-gated — independent of entered value. */
export function s232MembershipRules(
  uni: S232UniversePreview,
  flags: Record<string, boolean>,
  coo: string,
): AppliedRule[] {
  const out: AppliedRule[] = [];

  if (uni.semiconductor) {
    if (claimed(flags, "s232_semiconductor", "s232_semi")) {
      out.push({
        program: "s232",
        ch99: "9903.79.01",
        label: "232 semiconductors — Note 39(b) params claimed",
        rate: "25% additional",
        rate_pct: 0.25,
        reason: `HTS on semiconductor list stem ${uni.semiconductor.matched_stem} with s232_semiconductor claimed → 9903.79.01 @ 25% (CSMS #67400472). 301-FL suppressed via 9903.05.90.`,
        source_ref: "CSMS #67400472 — Section 232 semiconductors",
        status: "applies",
      });
    } else {
      out.push({
        program: "s232",
        ch99: "9903.79.01",
        label: "232 semiconductors — Note 39(b) claim",
        rate: "25% additional if claimed",
        rate_pct: 0.25,
        reason: `HTS on semiconductor list stem ${uni.semiconductor.matched_stem} (8471.50 / 8471.80 / 8473.30). 9903.79.01 @ 25% applies only if U.S. note 39(b) TPP/DRAM bands are met — claim s232_semiconductor. HTS alone is not enough.`,
        source_ref: "CSMS #67400472 — Section 232 semiconductors",
        status: "needs_claim",
      });
    }
  }

  if (uni.mhdv_part_list) {
    if (claimed(flags, "s232_mhdv_part", "s232_mhdv")) {
      out.push({
        program: "s232",
        ch99: "9903.74.08",
        label: "232 MHDV parts — claimed",
        rate: "25% additional",
        rate_pct: 0.25,
        reason: `MHDV parts list stem ${uni.mhdv_part_list.matched_stem} with s232_mhdv_part claimed → 9903.74.08 @ 25% (CSMS #66665333). 301-FL suppressed via 9903.05.90.`,
        source_ref: "CSMS #66665333 — Section 232 MHDV",
        status: "applies",
      });
    } else {
      out.push({
        program: "s232",
        ch99: "9903.74.08",
        label: "232 MHDV parts — claim if part of an MHDV",
        rate: "25% additional if claimed",
        rate_pct: 0.25,
        reason: `HTS on MHDV parts list stem ${uni.mhdv_part_list.matched_stem}. 9903.74.08 @ 25% applies only if the article is a part of a medium- or heavy-duty vehicle. On-list goods that are not MHDV parts use 9903.74.11 @ 0%.`,
        source_ref: "CSMS #66665333 — Section 232 MHDV",
        status: "needs_claim",
      });
    }
  }

  if (uni.passenger_vehicle) {
    const heading = uni.passenger_vehicle.ch99;
    const rt = auto232Rate(heading);
    const originNote = coo
      ? ` Origin ${coo} drives the heading.`
      : " Default heading 9903.94.01 @ 25% additional until origin is set (JP 9903.94.41, EU .51, KR .61).";
    out.push({
      program: "s232",
      ch99: heading,
      label: "232 passenger vehicles / light trucks",
      rate: rt.rate,
      rate_pct: rt.rate_pct,
      reason: `On passenger-vehicle / light-truck list stem ${uni.passenger_vehicle.matched_stem} → ${heading} (${rt.rate}, auto).${originNote}`,
      source_ref: "CSMS #64624801 — Section 232 passenger vehicles (origin splits: JP/EU/KR CSMS)",
      status: "applies",
    });
  }

  if (uni.mhdv_vehicle) {
    const overlap =
      Boolean(uni.passenger_vehicle) && !claimed(flags, "s232_mhdv", "s232_mhdv_part");
    out.push({
      program: "s232",
      ch99: uni.mhdv_vehicle.ch99,
      label: overlap
        ? "232 MHDV vehicle list (default is passenger)"
        : "232 medium- and heavy-duty vehicles",
      rate: overlap ? "not the default heading" : "25% additional",
      rate_pct: overlap ? null : 0.25,
      reason: overlap
        ? `Also on MHDV vehicle list stem ${uni.mhdv_vehicle.matched_stem}. Default is passenger ${uni.passenger_vehicle?.ch99}; claim s232_mhdv to file ${uni.mhdv_vehicle.ch99} instead.`
        : `On MHDV vehicle list stem ${uni.mhdv_vehicle.matched_stem} → ${uni.mhdv_vehicle.ch99} @ 25% (auto).`,
      source_ref: "CSMS #66665333 — Section 232 MHDV",
      status: overlap ? "info" : "applies",
    });
  }

  if (uni.mhdv_bus) {
    out.push({
      program: "s232",
      ch99: uni.mhdv_bus.ch99,
      label: "232 buses and other vehicles",
      rate: "10% additional",
      rate_pct: 0.1,
      reason: `On MHDV bus list stem ${uni.mhdv_bus.matched_stem} → ${uni.mhdv_bus.ch99} @ 10% (auto).`,
      source_ref: "CSMS #66665333 — Section 232 MHDV",
      status: "applies",
    });
  }

  if (uni.wood) {
    const originNote = coo
      ? ""
      : " Set origin for UK 10% / JP 15% / EU 15% furniture and cabinet headings.";
    out.push({
      program: "s232",
      ch99: uni.wood.ch99,
      label: `232 wood — ${uni.wood.bucket}`,
      rate: uni.wood.ch99 === "9903.76.01" ? "10% additional" : "origin-based additional",
      rate_pct: uni.wood.ch99 === "9903.76.01" ? 0.1 : null,
      reason: `On wood 232 ${uni.wood.bucket} list stem ${uni.wood.matched_stem} → ${uni.wood.ch99}.${originNote} Autos/parts 232 wins if both apply.`,
      source_ref: "CSMS #66492057 — Section 232 wood",
      status: "applies",
    });
  }

  if (uni.auto_parts) {
    const heading = uni.auto_parts.ch99;
    const rt = auto232Rate(heading);
    out.push({
      program: "s232",
      ch99: heading,
      label: "232 auto parts annex",
      rate: rt.rate,
      rate_pct: rt.rate_pct,
      reason: `On Proclamation 10908 auto-parts annex stem ${uni.auto_parts.matched_stem} → ${heading} (${rt.rate}, auto). Chapter membership alone is not a determination.`,
      source_ref: "Proclamation 10908 / U.S. note 33 auto-parts annex",
      status: "applies",
    });
  }

  return out;
}

function mergeMembership(rules: AppliedRule[], membership: AppliedRule[]): void {
  for (const r of membership) {
    const same = rules.find((x) => x.ch99 && r.ch99 && x.ch99 === r.ch99);
    if (r.status === "applies" && same) continue;
    if (r.status === "needs_claim" && same?.status === "applies") continue;
    if (same && same.status === r.status) continue;
    rules.push(r);
  }
}

function universeHitCount(uni: S232UniversePreview): number {
  return [
    uni.passenger_vehicle,
    uni.mhdv_vehicle,
    uni.mhdv_bus,
    uni.mhdv_part_list,
    uni.wood,
    uni.semiconductor,
    uni.auto_parts,
  ].filter(Boolean).length;
}

export function coverOne(
  row: CoverageRowIn,
  opts: { as_of: string; default_coo: string | null; assume_cn_list3?: boolean },
): Record<string, unknown> {
  const htsRaw = String(row.hts || "").trim();
  const htsKey = normalizeHtsDigits(htsRaw);
  const asOf = String(row.as_of || row.entry_date || opts.as_of).slice(0, 10);
  const coo = pickCoo(row, opts.default_coo);
  const flags = rowFlags(row);
  const notes: string[] = [];
  const rules: AppliedRule[] = [];
  const uni = previewS232Universe(htsRaw, coo, { rateDay: asOf, col1Rate: 0, flags });
  const membership = s232MembershipRules(uni, flags, coo);

  if (!htsRaw) {
    return {
      hts: "",
      part: row.part || null,
      sku: row.sku || null,
      coo: coo || null,
      as_of: asOf,
      in_table: false,
      error: "Missing HTS",
      rules: [],
      ch99_sequence: [],
      s232_universe: uni,
      notes: ["Each row needs an HTS code."],
    };
  }

  const look = lookupHts(htsRaw, asOf);
  const related = look.window_status === "unknown" ? suggestRelatedHts(htsRaw, asOf, 8) : [];
  const hit = look.window_status === "active" ? look.hit : resolveCol1(htsRaw, asOf);
  const col1Pts = hit ? pctPoints(hit.col1_pct) : null;
  const col1Dec = col1Pts == null ? 0 : col1Pts / 100;
  const usitc_url = usitcSearchUrl(htsRaw);

  // Unknown HTS: do not invent Col-1 Free or a full stack. Still surface published
  // Section 232 list membership so HTS list supports the new 232 packs.
  if (look.window_status === "unknown") {
    const help_steps: string[] = [];
    if (look.replacement_hts) {
      help_steps.push(
        `Use mapped replacement ${formatHtsDisplay(look.replacement_hts)} if this line was retired.`,
      );
    }
    if (related.length) {
      help_steps.push(
        `Same 8-digit heading has ${related.length} active statistical line(s) in the table (e.g. ${related
          .slice(0, 2)
          .map((r) => r.hts_display)
          .join(", ")}). Pick the suffix that matches the product.`,
      );
    } else {
      help_steps.push("Confirm the full 10-digit statistical reporting number on USITC.");
    }
    if (!coo) {
      help_steps.push("Add an origin (COO column or Default origin) once the HTS is valid.");
    }
    help_steps.push("Re-run Find applicable rules after correcting the HTS.");

    notes.push(
      "HTS not found in the baseline Column-1 table - no duty rate until you use a valid 10-digit code.",
    );
    if (membership.length) {
      notes.push(
        "Published Section 232 list membership is shown from the rule packs (vehicles / MHDV / wood / semiconductors / auto parts). Confirm the 10-digit code before filing.",
      );
      mergeMembership(rules, membership);
    }
    if (!coo) {
      notes.push("No origin - set Default origin or a COO column for country stacks.");
    }

    return {
      hts: htsRaw,
      hts_key: htsKey,
      part: row.part ? String(row.part).trim() || null : null,
      sku: row.sku ? String(row.sku).trim() || null : null,
      coo: coo || null,
      as_of: asOf,
      in_table: false,
      blocked: true,
      window_status: "unknown",
      ended_on: null,
      replacement_hts: look.replacement_hts,
      replacement_hts_display: look.replacement_hts_display,
      replacement_note: look.replacement_note,
      replacement_col1_pct: look.replacement
        ? pctPoints(look.replacement.col1_pct)
        : null,
      replacement_desc: look.replacement?.desc || null,
      related_hts: related,
      usitc_url,
      help: {
        title: "This HTS is not in the Column-1 table",
        summary:
          "Duty dollars cannot be calculated for an unknown statistical line. Confirm the 10-digit code (not padded zeros). Section 232 list hits below are from published CSMS lists, not a filed stack.",
        steps: help_steps,
      },
      col1_pct: null,
      desc: null,
      rules,
      ch99_sequence: [],
      stack_preview: [],
      s232_universe: uni,
      diagnostics: [
        {
          severity: "ERROR",
          code: "UNKNOWN_HTS",
          message:
            "HTS not found in the baseline Column-1 table - no duty rate can be calculated.",
        },
      ],
      notes,
    };
  }

  if (look.window_status === "ended") {
    notes.push(
      `HTS rate window ended${look.ended_on ? ` on ${look.ended_on}` : ""} - last published Col-1 shown; confirm the current statistical reporting number.`,
    );
  }
  if (look.replacement_hts) {
    notes.push(
      `Suggested replacement ${formatHtsDisplay(look.replacement_hts)}${
        look.replacement_note ? ` (${look.replacement_note})` : ""
      }.`,
    );
  }

  // Column 1 always listed when known
  if (hit) {
    rules.push({
      program: "base",
      ch99: null,
      label: look.window_status === "ended" ? "Column 1 general (ended window)" : "Column 1 general",
      rate: rateLabel(col1Pts!),
      rate_pct: col1Dec,
      reason: hit.desc || "HTS Column 1 rate window",
      source_ref: `HTS table ${hit.start} -> ${hit.end}`,
      status: look.window_status === "ended" ? "info" : "applies",
    });
  }

  if (hit?.metals) {
    const m = hit.metals;
    rules.push({
      program: "s232",
      ch99: m.duty_ch99,
      label: `232 metals — ${m.metal}`,
      rate: `${m.rate_pct}% ${m.basis === "METAL_CONTENT_VALUE" ? "on metal content" : "on entered value"}`,
      rate_pct: m.rate_pct / 100,
      reason: m.content_prompt,
      source_ref: "CSMS #68253075 / #68855869 / U.S. note 16",
      status: m.basis === "METAL_CONTENT_VALUE" ? "info" : "applies",
    });
  }

  if (!coo) {
    notes.push("No origin - 301-FL and country stacks need a COO (set a Default origin or a coo column).");
  } else {
    const flRow = lookupS301fl(coo);
    const fl = assessS301fl(coo, col1Dec);
    if (fl.kind === "out_of_scope") {
      notes.push(fl.reason);
    } else if (fl.kind === "flat") {
      rules.push({
        program: "s301fl",
        ch99: fl.heading,
        label: fl.label,
        rate: rateLabel(fl.rate_pct_decimal * 100),
        rate_pct: fl.rate_pct_decimal,
        reason: fl.reason,
        source_ref: "CSMS #69326983 - Section 301 Forced Labor",
        status: "applies",
      });
    } else if (fl.kind === "threshold_topup") {
      rules.push({
        program: "s301fl",
        ch99: fl.heading,
        label: fl.label,
        rate: rateLabel(fl.rate_pct_decimal * 100),
        rate_pct: fl.rate_pct_decimal,
        reason: fl.reason,
        source_ref: "CSMS #69326983 - Section 301 Forced Labor",
        status: "applies",
      });
    } else if (fl.kind === "threshold_no_add") {
      rules.push({
        program: "s301fl",
        ch99: fl.heading,
        label: fl.label,
        rate: "0% (report heading)",
        rate_pct: 0,
        reason: fl.reason,
        source_ref: "CSMS #69326983 - Section 301 Forced Labor",
        status: "reporting",
      });
    }
    if (flRow) {
      notes.push(`301-FL economy: ${flRow.name} (${flRow.mechanic}).`);
    }
  }

  if (coo === "CN" && !flags.s301_list_3 && !flags.s301_list_4a && opts.assume_cn_list3) {
    flags.s301_list_3 = true;
    notes.push("Assumed China 301 List 3 for coverage (API override only).");
  } else if (coo === "CN" && !flags.s301_list_3 && !flags.s301_list_4a) {
    notes.push(
      "China origin: 301 four-year review (U.S. note 31 / 9903.91.xx) auto-applies by HTS and date. Legacy 9903.88.xx applies only when this HTS is on a seeded USTR list, or an explicit list flag is set.",
    );
  }

  // Full stack preview when we have COO (notional $10k - rates/sequence only)
  let ch99_sequence: string[] = [];
  let stack_preview: Array<Record<string, unknown>> = [];
  let diagnostics: unknown[] = [];
  if (coo) {
    const line: LineIn = {
      hts: htsRaw,
      coo,
      entered_value: 10000,
      col1_rate_pct: col1Pts ?? undefined,
      entry_date: asOf,
      release_date: asOf,
      flags,
    };
    try {
      const L = assessLine(line, 0);
      ch99_sequence = L.ch99_sequence || [];
      diagnostics = L.diagnostics || [];
      stack_preview = (L.layers || [])
        .filter((x) => x.program !== "base")
        .map((x) => ({
          program: x.program,
          ch99: x.ch99,
          label: x.label,
          rate: x.rate,
          reason: x.reason,
          source_ref: x.source_ref,
        }));
      for (const s of L.suppressed || []) {
        stack_preview.push({
          program: s.program,
          ch99: s.ch99,
          label: s.label,
          rate: s.rate,
          reason: `Suppressed: ${s.reason}`,
          source_ref: s.source_ref,
          suppressed: true,
        });
      }
      // Merge assess layers into rules if not already present
      for (const x of L.layers || []) {
        if (x.program === "base") continue;
        if (rules.some((r) => r.ch99 && r.ch99 === x.ch99)) continue;
        rules.push({
          program: x.program,
          ch99: x.ch99,
          label: x.label || x.program,
          rate: x.rate,
          rate_pct: x.rate_pct,
          reason: x.reason || "",
          source_ref: x.source_ref || "",
          status: Number(x.duty_amount) === 0 && x.ch99 ? "reporting" : "applies",
        });
      }
      if (L.blocked) {
        notes.push("Stack blocked - see diagnostics (HTS problem or missing metal content).");
      }
    } catch (e) {
      notes.push(e instanceof Error ? e.message : String(e));
    }
  }

  mergeMembership(rules, membership);
  if (ch99_sequence.includes("9903.05.90")) {
    for (const r of rules) {
      if (r.program === "s301fl" && r.ch99 && r.ch99 !== "9903.05.90" && r.status === "applies") {
        r.status = "info";
        r.reason = `Suppressed by Section 232 via 9903.05.90. ${r.reason}`;
      }
    }
  }
  if (universeHitCount(uni) && !coo) {
    notes.push(
      "Section 232 list membership is shown without origin. Add a COO to see 301-FL and the filed Chapter 99 sequence.",
    );
  }

  return {
    hts: htsRaw,
    hts_key: htsKey,
    part: row.part ? String(row.part).trim() || null : null,
    sku: row.sku ? String(row.sku).trim() || null : null,
    coo: coo || null,
    as_of: asOf,
    in_table: Boolean(hit) || look.window_status === "ended",
    blocked: false,
    window_status: look.window_status,
    ended_on: look.ended_on,
    replacement_hts: look.replacement_hts,
    replacement_hts_display: look.replacement_hts_display,
    replacement_note: look.replacement_note,
    replacement_col1_pct: look.replacement
      ? pctPoints(look.replacement.col1_pct)
      : null,
    replacement_desc: look.replacement?.desc || null,
    related_hts: [],
    usitc_url,
    help: null,
    col1_pct: col1Pts,
    desc: hit?.desc || null,
    rules,
    ch99_sequence,
    stack_preview,
    s232_universe: uni,
    diagnostics,
    notes,
  };
}

function coverContext(body: {
  as_of?: string;
  default_coo?: string;
  assume_cn_list3?: boolean;
  rows?: CoverageRowIn[];
}) {
  const as_of = String(body.as_of || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const default_coo = body.default_coo
    ? String(body.default_coo).trim().toUpperCase()
    : null;
  const rowsIn = Array.isArray(body.rows) ? body.rows : [];
  assertMaxItems(rowsIn.length, LIMITS.coverageRows, "HTS rows");
  return {
    as_of,
    default_coo,
    rowsIn,
    opts: {
      as_of,
      default_coo,
      assume_cn_list3: Boolean(body.assume_cn_list3),
    },
  };
}

function coverResult(
  ctx: ReturnType<typeof coverContext>,
  rows: ReturnType<typeof coverOne>[],
) {
  return {
    ok: true,
    as_of: ctx.as_of,
    default_coo: ctx.default_coo,
    rulepack: rulepackPublic(),
    summary: {
      rows: rows.length,
      in_table: rows.filter((r) => r.in_table).length,
      missing_hts: rows.filter((r) => !r.hts).length,
      missing_coo: rows.filter((r) => !r.coo).length,
      with_ch99: rows.filter((r) => (r.ch99_sequence as string[])?.length > 0).length,
      ended: rows.filter((r) => r.window_status === "ended").length,
      with_replacement: rows.filter((r) => Boolean(r.replacement_hts)).length,
      blocked: rows.filter((r) => Boolean(r.blocked)).length,
      with_related: rows.filter(
        (r) => Array.isArray(r.related_hts) && (r.related_hts as unknown[]).length > 0,
      ).length,
      with_s232: rows.filter((r) =>
        universeHitCount((r.s232_universe || {}) as S232UniversePreview),
      ).length,
      needs_claim: rows.filter(
        (r) =>
          Array.isArray(r.rules) &&
          (r.rules as AppliedRule[]).some((x) => x.status === "needs_claim"),
      ).length,
    },
    rows,
  };
}

export function coverRows(body: {
  as_of?: string;
  default_coo?: string;
  assume_cn_list3?: boolean;
  rows?: CoverageRowIn[];
}) {
  const ctx = coverContext(body);
  return coverResult(
    ctx,
    ctx.rowsIn.map((r) => coverOne(r, ctx.opts)),
  );
}

/** Same as coverRows, yielding every `yieldEvery` rows so Duty-stack requests can interleave. */
export async function coverRowsAsync(
  body: {
    as_of?: string;
    default_coo?: string;
    assume_cn_list3?: boolean;
    rows?: CoverageRowIn[];
  },
  yieldEvery = 25,
) {
  const ctx = coverContext(body);
  const rows: ReturnType<typeof coverOne>[] = [];
  for (let i = 0; i < ctx.rowsIn.length; i++) {
    rows.push(coverOne(ctx.rowsIn[i], ctx.opts));
    if (yieldEvery > 0 && (i + 1) % yieldEvery === 0) await yieldEventLoop();
  }
  return coverResult(ctx, rows);
}

const HTS_HEADER_RE =
  /^(primary[_\s-]?hts|hts([_\s-]?(code|formatted|number|us))?|tariff([_\s-]?code)?|htsus)$/i;
const COO_HEADER_RE =
  /^(coo|origin|country([_\s-]?(of[_\s-]?origin|code|bloc))?|iso2)$/i;
const PART_HEADER_RE =
  /^(part([_\s-]?(number|no|num|id))?|part_number|part_no|item([_\s-]?(number|no|num|id))?|item_number|material([_\s-]?(number|no|num))?|mpn|pn)$/i;
const SKU_HEADER_RE =
  /^(sku|skus|product([_\s-]?(code|id|number|no))?|article([_\s-]?(number|no|num))?)$/i;

function normHeaderCell(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .replace(/\n/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^\w]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isHtsHeader(h: string): boolean {
  return HTS_HEADER_RE.test(h) || h.includes("primary_hts") || h === "hts_formatted";
}

function isCooHeader(h: string): boolean {
  return COO_HEADER_RE.test(h);
}

function isPartHeader(h: string): boolean {
  return PART_HEADER_RE.test(h);
}

function isSkuHeader(h: string): boolean {
  return SKU_HEADER_RE.test(h);
}

function pickIdentityField(
  obj: Record<string, unknown>,
  headers: string[],
  test: (h: string) => boolean,
): string {
  const key = headers.find(test);
  if (!key) return "";
  return String(obj[key] ?? "").trim();
}

function rowLooksLikeHeader(cells: unknown[]): boolean {
  const headers = cells.map(normHeaderCell).filter(Boolean);
  return headers.some(isHtsHeader);
}

/** True for HTS code cells (digits / dotted); false for workbook footnotes that mention Ch.99 codes. */
export function isPlausibleHtsCell(raw: unknown): boolean {
  const s = String(raw ?? "").trim();
  if (!s || s.length > 20) return false;
  if (!/^[\d.\s-]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 10;
}

function pickHtsFromMappedCells(
  obj: Record<string, unknown>,
  headers: string[],
): string {
  const primaryKey = headers.find((h) => h.includes("primary_hts"));
  const htsKey = headers.find(isHtsHeader);
  const formattedKey = headers.find((h) => h.includes("hts_formatted") || h === "hts_formatted");
  for (const key of [primaryKey, htsKey, formattedKey]) {
    if (!key) continue;
    const v = obj[key];
    if (v !== undefined && v !== null && String(v).trim() && isPlausibleHtsCell(v)) {
      return String(v).trim();
    }
  }
  return "";
}

function sheetToCoverageRows(sheet: XLSX.WorkSheet): CoverageRowIn[] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  if (!matrix.length) return [];

  let headerIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 25); i++) {
    if (rowLooksLikeHeader(matrix[i] || [])) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    // Fall back: treat first non-empty row as data with col0=hts
    return matrix
      .map((row) => {
        const cells = row || [];
        const hts = String(cells[0] ?? "").trim();
        if (!isPlausibleHtsCell(hts)) return null;
        return normalizeParsedRow({ hts, coo: String(cells[1] ?? "").trim() });
      })
      .filter(Boolean) as CoverageRowIn[];
  }

  const headers = (matrix[headerIdx] || []).map(normHeaderCell);
  const out: CoverageRowIn[] = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const cells = matrix[r] || [];
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      if (!h) return;
      obj[h] = cells[i];
    });
    // Map Subaru / ops sheet aliases onto canonical keys before normalize
    const cooKey = headers.find(isCooHeader);
    const hts = pickHtsFromMappedCells(obj, headers);
    if (hts) obj.hts = hts;
    if (cooKey && obj[cooKey]) obj.coo = obj[cooKey];
    const part = pickIdentityField(obj, headers, isPartHeader);
    if (part) obj.part = part;
    const sku = pickIdentityField(obj, headers, isSkuHeader);
    if (sku) obj.sku = sku;

    const s232Key = headers.find((h) => h.includes("232") && h.includes("auto"));
    if (s232Key) {
      const v = String(obj[s232Key] ?? "").trim().toUpperCase();
      if (v === "Y" || v === "YES" || v === "TRUE" || v === "1") obj.s232_auto_part = true;
    }
    const mhdvKey = headers.find(
      (h) => h.includes("mhdv") || (h.includes("232") && h.includes("part") && !h.includes("auto")),
    );
    if (mhdvKey) {
      const v = String(obj[mhdvKey] ?? "").trim().toUpperCase();
      if (v === "Y" || v === "YES" || v === "TRUE" || v === "1") obj.s232_mhdv_part = true;
    }
    const semiKey = headers.find((h) => h.includes("semiconductor") || h.includes("s232_semi"));
    if (semiKey) {
      const v = String(obj[semiKey] ?? "").trim().toUpperCase();
      if (v === "Y" || v === "YES" || v === "TRUE" || v === "1") obj.s232_semiconductor = true;
    }
    const vintageKey = headers.find((h) => h.includes("vintage") || h.includes("25_year") || h.includes("25yr"));
    if (vintageKey) {
      const v = String(obj[vintageKey] ?? "").trim().toUpperCase();
      if (v === "Y" || v === "YES" || v === "TRUE" || v === "1") obj.s232_vehicle_vintage = true;
    }
    const listKey = headers.find((h) => h.includes("301") && h.includes("list"));
    if (listKey) {
      const v = String(obj[listKey] ?? "").trim().toUpperCase();
      if (v.includes("3") || v === "Y" || v === "LIST 3") obj.s301_list_3 = true;
      if (v.includes("4")) (obj as { s301_list_4a?: boolean }).s301_list_4a = true;
    }
    const dateKey = headers.find((h) => h.includes("entry_date") || h === "date" || h.includes("rate_date"));
    if (dateKey && obj[dateKey]) obj.as_of = obj[dateKey];

    const row = normalizeParsedRow(obj);
    if (!isPlausibleHtsCell(row.hts)) continue;
    out.push(row);
  }
  return out;
}

function pickCoverageSheet(wb: XLSX.WorkBook): XLSX.WorkSheet {
  const names = wb.SheetNames;
  let best = names[0];
  let bestScore = -1;
  for (const n of names) {
    const rows = sheetToCoverageRows(wb.Sheets[n]);
    // Score by countable HTS lines; tiny ties favor clean sheet names over annotated workbooks.
    let score = rows.length;
    const lower = n.toLowerCase();
    if (lower === "sheet1" || /^hts/.test(lower) || lower.includes("lines")) score += 0.5;
    if (lower.includes("full stack") || lower.includes("notes")) score -= 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return wb.Sheets[best];
}

/** Parse paste / CSV / JSON / Excel (base64) into coverage rows. */
export function parseCoverageInput(body: {
  text?: string;
  json?: unknown;
  filename?: string;
  xlsx_base64?: string;
}): CoverageRowIn[] {
  if (Array.isArray(body.json)) {
    return body.json.map(normalizeParsedRow);
  }
  if (body.xlsx_base64) {
    const buf = decodeXlsxBase64(body.xlsx_base64);
    const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
    return sheetToCoverageRows(pickCoverageSheet(wb));
  }
  const text = String(body.text || "").trim();
  if (!text) return [];

  // JSON array pasted
  if (text.startsWith("[") || text.startsWith("{")) {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map(normalizeParsedRow);
  }

  // CSV / TSV — skip title rows until we see an HTS header
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const delim = lines[0].includes("\t") || lines.some((l) => l.includes("\t")) ? "\t" : ",";
  const cells = (line: string) => splitDelimited(line, delim);

  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    if (rowLooksLikeHeader(cells(lines[i]))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    return lines
      .map((line) => {
        const cols = cells(line);
        if (cols.length === 1) return normalizeParsedRow({ hts: cols[0] });
        return normalizeParsedRow({ hts: cols[0], coo: cols[1] });
      })
      .filter((r) => isPlausibleHtsCell(r.hts));
  }

  const keys = cells(lines[headerIdx]).map(normHeaderCell);
  return lines.slice(headerIdx + 1).map((line) => {
    const cols = cells(line);
    const obj: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      if (k && cols[i] !== undefined) obj[k] = cols[i];
    });
    const hts = pickHtsFromMappedCells(obj, keys);
    if (hts) obj.hts = hts;
    return normalizeParsedRow(obj);
  }).filter((r) => isPlausibleHtsCell(r.hts));
}

function guessKeys(n: number): string[] {
  if (n <= 1) return ["hts"];
  if (n === 2) return ["hts", "coo"];
  return ["hts", "coo", "as_of"];
}

function splitDelimited(line: string, delim: string): string[] {
  if (delim === "\t") return line.split("\t");
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === delim && !q) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function normalizeParsedRow(raw: Record<string, unknown> | CoverageRowIn): CoverageRowIn {
  const r = raw as Record<string, unknown>;
  const get = (...keys: string[]) => {
    for (const k of keys) {
      if (r[k] !== undefined && r[k] !== "") return r[k];
      const hit = Object.keys(r).find((x) => normHeaderCell(x) === normHeaderCell(k));
      if (hit && r[hit] !== undefined && r[hit] !== "") return r[hit];
    }
    // fuzzy: any key that looks like HTS / COO
    return undefined;
  };
  let hts = String(
    get(
      "hts",
      "primary_hts",
      "hts_formatted",
      "hts_code",
      "htscode",
      "tariff",
      "tariff_code",
      "htsus",
      "code",
    ) ?? "",
  ).trim();
  if (!hts) {
    const hk = Object.keys(r).find((k) => isHtsHeader(normHeaderCell(k)));
    if (hk) hts = String(r[hk] ?? "").trim();
  }
  let coo = String(
    get("coo", "origin", "country", "country_of_origin", "country_bloc", "iso2") ?? "",
  ).trim();
  if (!coo) {
    const ck = Object.keys(r).find((k) => isCooHeader(normHeaderCell(k)));
    if (ck) coo = String(r[ck] ?? "").trim();
  }
  // COO cells sometimes "Brazil" — keep 2-letter if present elsewhere; strip to ISO2 when length 2
  if (coo.length > 2 && /^[A-Z]{2}\b/i.test(coo)) coo = coo.slice(0, 2);

  const listRaw = get("s301_list_3", "list_3", "list3", "legacy_china_301_list_input");
  const s232Raw = get("s232_auto_part", "s232", "auto_part", "232_auto_part_input_y_n_review");
  const mhdvRaw = get("s232_mhdv_part", "s232_mhdv", "mhdv_part", "mhdv");
  const semiRaw = get("s232_semiconductor", "s232_semi", "semiconductor");
  const vintageRaw = get("s232_vehicle_vintage", "s232_auto_vintage", "vintage", "vintage_25yr");
  const woodNotCabRaw = get("s232_wood_not_cabinet", "wood_not_cabinet");

  let part = String(
    get(
      "part",
      "part_number",
      "part_no",
      "part_num",
      "item",
      "item_number",
      "item_no",
      "material",
      "material_number",
      "mpn",
      "pn",
    ) ?? "",
  ).trim();
  if (!part) {
    const pk = Object.keys(r).find((k) => isPartHeader(normHeaderCell(k)));
    if (pk) part = String(r[pk] ?? "").trim();
  }

  let sku = String(
    get("sku", "skus", "product_code", "product_id", "article", "article_number") ?? "",
  ).trim();
  if (!sku) {
    const sk = Object.keys(r).find((k) => isSkuHeader(normHeaderCell(k)));
    if (sk) sku = String(r[sk] ?? "").trim();
  }

  return {
    hts,
    coo,
    part: part || undefined,
    sku: sku || undefined,
    as_of: String(get("as_of", "entry_date", "date", "rate_date", "entry_date_input") ?? "").trim() ||
      undefined,
    flags: (r.flags as Record<string, boolean> | undefined) || undefined,
    s301_list_3: truthy(listRaw) || undefined,
    s232_auto_part:
      truthy(s232Raw) ||
      String(s232Raw ?? "").trim().toUpperCase() === "Y" ||
      undefined,
    s232_mhdv_part:
      truthy(mhdvRaw) || String(mhdvRaw ?? "").trim().toUpperCase() === "Y" || undefined,
    s232_semiconductor:
      truthy(semiRaw) || String(semiRaw ?? "").trim().toUpperCase() === "Y" || undefined,
    s232_vehicle_vintage:
      truthy(vintageRaw) || String(vintageRaw ?? "").trim().toUpperCase() === "Y" || undefined,
    s232_wood_not_cabinet:
      truthy(woodNotCabRaw) || String(woodNotCabRaw ?? "").trim().toUpperCase() === "Y" || undefined,
  };
}
