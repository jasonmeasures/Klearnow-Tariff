import {
  assertComputable,
  assertRateKnown,
  getCh99,
  normalizeCh99,
} from "../../tariff-rules/src/tariffRules.ts";
import {
  assessS301fl,
  flClaimMatches,
  flPharmaClaimed,
  flPharmaMeta,
  lookupFlClaimExemption,
  matchFlPharmaHts,
  s301flMeta,
  type FlAssessment,
  type FlEconomyExemption,
} from "../../tariff-rules/src/s301fl.ts";
import { matchFlExcept } from "../../tariff-rules/src/s301flExcept.ts";
import {
  assessBrazil301,
  brazil301AppliesOn,
  isBrazil301Heading,
  s301BrazilMeta,
} from "../../tariff-rules/src/s301Brazil.ts";
import {
  ch99ForChinaList,
  chinaListIdFromFlags,
  lookupChina301List,
} from "../../tariff-rules/src/s301China.ts";
import {
  isChina301Note31Heading,
  lookupChina301Note31,
  type Note31Hit,
} from "../../tariff-rules/src/s301ChinaNote31.ts";
import {
  classify232Metals,
  isMetalsDutyHit,
  resolve232Metals,
} from "../../tariff-rules/src/s232Metals.ts";
import { match232AutoPartsAnnex } from "../../tariff-rules/src/s232Autos.ts";
import { resolveS232EnteredValue } from "../../tariff-rules/src/s232Resolve.ts";
import {
  assessS232Pharma,
  s232PharmaClaimed,
} from "../../tariff-rules/src/s232Pharma.ts";
import {
  assessS338Canada,
  assertNoS338DutyWithNote51c,
  isS338Heading,
  normalizeCanadaCoo,
  s338AppliesOn,
  s338FtzWarning,
  s338Meta,
  s338SuspendedOn,
} from "../../tariff-rules/src/s338Canada.ts";
import {
  assessS201Qsp,
  isS201QspHeading,
  matchS201QspHts,
  s201QspMeta,
} from "../../tariff-rules/src/s201Qsp.ts";
import { S232_UAS_NOT_FOR_USE } from "../../tariff-rules/src/s232Uas.ts";
import { formatHtsDisplay, lookupHts, resolveCol1 } from "./htsLookup.ts";
import { computeEntryFees } from "./fees.ts";
import { rulepackPublic } from "./state.ts";
import {
  SEC_122_CH99,
  filingEra,
  filingEraLabel,
  s301flAppliesOn as s301flEraApplies,
  sec122AppliesOn,
  wrongEraFiledCode,
} from "./programEras.ts";

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
  /** Metal content as percent of entered value (e.g. 80 = 80%). Alternative to metal_content_value. */
  metal_content_pct?: number | string;
  /**
   * Mixed metals — steel / aluminum / copper content separately.
   * Each: { value?: number, pct?: number, melt_pour?: string }
   */
  metal_contents?: Record<
    string,
    { value?: number | string; pct?: number | string; melt_pour?: string }
  >;
  country_of_melt_pour?: string;
  quantity?: number | string;
  quantity_uom?: string;
  filed_ch99?: string[];
  filed_duty_total?: number | string;
  flags?: Record<string, boolean>;
  /**
   * Preferential claim that unlocks a 301-FL economy exemption (Note 52).
   * Values: USMCA | CAFTA_DR | NOTE_52 | exemption heading (e.g. 9903.05.94).
   * Also accepted via flags.fta_usmca / fta_cafta_dr / fta_note_52.
   */
  fta_claim?: string;
  /** Chapter 98 provision claimed on the line (e.g. 9802.00.80). */
  ch98_provision?: string;
  /** US-content cost/value for 9802.00.80 (assembled abroad less US content). */
  ch98_us_content_value?: number | string;
  /** Value of repairs/alterations/processing for 9802.00.40 / .50 / .60. */
  ch98_repair_value?: number | string;
  /** True when the article is admitted to a US FTZ. */
  ftz?: boolean;
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

function fmtPctNum(n: number): string {
  return money2(n).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

type AppliedFl = Exclude<FlAssessment, { kind: "out_of_scope" }>;

/** Conversational copy for Pharma use vs the 301-FL heading it replaced. Duty math is unchanged. */
function pharmaVsFlCopy(
  fl: AppliedFl,
  col1Pct: number,
  wouldDuty: number,
  pharmaHeading: string,
): { diagnostic: string; suppressed: string; layerReason: string } {
  const addPct = fl.kind === "threshold_no_add" ? 0 : money2(fl.rate_pct_decimal * 100);
  const isEuCap = fl.heading === "9903.05.38" || fl.heading === "9903.05.39";
  const extra = `$${wouldDuty.toFixed(2)}`;
  if (fl.kind === "threshold_topup") {
    const cap = fmtPctNum(fl.cap_pct);
    const col1 = fmtPctNum(col1Pct);
    const add = fmtPctNum(addPct);
    const skipped =
      `Pharma use (${pharmaHeading}) skipped this ${isEuCap ? "EU" : "301-FL"} cap. ` +
      `Without it, this line would have been capped at ${cap}% — that's Column-1 ${col1}% plus an extra ${add}% (${extra}), not a second ${cap}%.`;
    return {
      diagnostic: `${skipped} Column-1 and MPF still apply.`,
      suppressed: skipped,
      layerReason: `${skipped} Report ${pharmaHeading} @ 0%. Column-1 and MPF still apply.`,
    };
  }
  if (fl.kind === "threshold_no_add") {
    const skipped =
      `Pharma use (${pharmaHeading}) skipped ${fl.heading}. Column-1 is already at ${fmtPctNum(col1Pct)}%, so the ${isEuCap ? "EU cap" : `${fmtPctNum(fl.cap_pct)}% 301-FL cap`} would not have added extra duty.`;
    return {
      diagnostic: `${skipped} Column-1 and MPF still apply.`,
      suppressed: skipped,
      layerReason: `${skipped} Report ${pharmaHeading} @ 0%. Column-1 and MPF still apply.`,
    };
  }
  const skipped =
    `Pharma use (${pharmaHeading}) skipped ${fl.heading}. Without it, 301-FL would have added a flat ${fmtPctNum(addPct)}% (${extra}) on top of Column-1 ${fmtPctNum(col1Pct)}%.`;
  return {
    diagnostic: `${skipped} Column-1 and MPF still apply.`,
    suppressed: skipped,
    layerReason: `${skipped} Report ${pharmaHeading} @ 0%. Column-1 and MPF still apply.`,
  };
}

/** Resolve FTA / Note 52 claim from line field or boolean flags. */
export function resolveFtaClaim(line: LineIn): string | null {
  const raw = String(line.fta_claim || "").trim();
  if (raw) return raw;
  const flags = line.flags || {};
  if (flags.fta_usmca || flags.usmca) return "USMCA";
  if (flags.fta_cafta_dr || flags.cafta_dr || flags.cafta) return "CAFTA_DR";
  if (flags.fta_note_52 || flags.note_52) return "NOTE_52";
  return null;
}

const CAFTA_DR_ORIGINS = new Set(["CR", "DO", "SV", "GT", "HN", "NI"]);
const USMCA_ORIGINS = new Set(["CA", "MX"]);

export type SpiPreference = {
  claim_id: "USMCA" | "CAFTA_DR";
  label: string;
  /** SPI claim letter(s) typically filed with the preference. */
  spi: string;
};

/**
 * USMCA / CAFTA-DR preferential claim: zeros Column-1 (Ch.1–97) and MPF.
 * Does NOT alone suppress 301-FL, 232, China 301, etc. — those need their own Ch.99 exemptions.
 */
export function resolveSpiPreference(
  line: LineIn,
  coo: string,
  diagnostics?: Diagnostic[],
): SpiPreference | null {
  const claim = resolveFtaClaim(line);
  if (!claim) return null;
  const c = claim.trim().toUpperCase().replace(/-/g, "_");
  const iso = String(coo || "").trim().toUpperCase();

  const wantsUsmca =
    c === "USMCA" || c === "S" || c === "S+" || c === "S/S+";
  const wantsCafta =
    c === "CAFTA_DR" || c === "CAFTA" || c === "CAFTA_DR_R" || c === "R";

  if (wantsUsmca) {
    if (!USMCA_ORIGINS.has(iso)) {
      diagnostics?.push({
        severity: "WARNING",
        code: "USMCA_COO_MISMATCH",
        message: `USMCA (SPI S/S+) claimed but origin is ${iso || "(blank)"} — expected CA or MX. Column-1 / MPF not suppressed.`,
      });
      return null;
    }
    return { claim_id: "USMCA", label: "USMCA", spi: "S/S+" };
  }
  if (wantsCafta) {
    if (!CAFTA_DR_ORIGINS.has(iso)) {
      diagnostics?.push({
        severity: "WARNING",
        code: "CAFTA_COO_MISMATCH",
        message: `CAFTA-DR preferential claim but origin is ${iso || "(blank)"} — expected CR/DO/SV/GT/HN/NI. Column-1 / MPF not suppressed.`,
      });
      return null;
    }
    return { claim_id: "CAFTA_DR", label: "CAFTA-DR", spi: "R" };
  }
  return null;
}

/** 301-FL (CSMS #69326983) — pack effective date; not applied before that day. */
export function s301flAppliesOn(rateDay: string): boolean {
  return s301flEraApplies(rateDay);
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
    SEC_301_CHINA_FY: "s301",
    SEC_301: "s301",
    SEC_301_BRAZIL: "s301br",
    SEC_301_FL: "s301fl",
    SEC_232_AUTOS: "s232",
    SEC_232_METALS: "s232",
    SEC_232_PHARMA: "s232",
    SEC_232_MHDV: "s232",
    SEC_232_WOOD: "s232",
    SEC_232_SEMI: "s232",
    SEC_232_UAS: "s232",
    SECTION_338_CANADA: "s338",
    SEC_201_QSP: "s201",
    SEC_122: "s122",
    TRADE_DEAL_JP: "s232",
    TRADE_DEAL_EU: "s232",
    TRADE_DEAL_KR: "s232",
    TBC_LABELING: "s232",
    base: "base",
  };
  return map[id] || id.toLowerCase();
}

function s232SuppressesFl(hit: { heading?: string | null } | null | undefined): boolean {
  return Boolean(hit && hit.heading && hit.heading !== S232_UAS_NOT_FOR_USE);
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
  rate_label?: string;
  duty_amount?: number;
}): DutyLayer {
  const duty =
    opts.duty_amount != null
      ? money2(opts.duty_amount)
      : money2(opts.basis_amount * opts.rate_pct);
  return {
    stack_slot: opts.slot,
    program: uiProgram(opts.program),
    ch99: opts.ch99,
    label: opts.label,
    reason: opts.reason,
    source_ref: opts.source_ref,
    basis: opts.basis || "ENTERED_VALUE",
    basis_amount: money2(opts.basis_amount),
    rate: opts.rate_label || pctLabel(opts.rate_pct),
    rate_pct: opts.rate_pct,
    duty_amount: duty,
  };
}

/** Map filed legacy China 301 headings → list id (U.S. note 20 / CSMS Tranche codes). */
const FILED_CHINA_301: Record<string, "list_1" | "list_2" | "list_3" | "list_4a"> = {
  "9903.88.01": "list_1",
  "9903.88.02": "list_2",
  "9903.88.03": "list_3",
  "9903.88.15": "list_4a",
};

function inferChinaFlagsFromFiled(
  filed: string[],
  flags: Record<string, boolean>,
): Record<string, boolean> {
  const next = { ...flags };
  for (const c of filed) {
    const list = FILED_CHINA_301[normalizeCh99(c)];
    if (list === "list_1") next.s301_list_1 = true;
    if (list === "list_2") next.s301_list_2 = true;
    if (list === "list_3") next.s301_list_3 = true;
    if (list === "list_4a") next.s301_list_4a = true;
  }
  return next;
}

function chinaListCode(
  hts: string,
  flags: Record<string, boolean>,
  diagnostics: Diagnostic[],
  filed: string[] = [],
): string | null {
  const fromHts = lookupChina301List(hts);
  const fromFlag = chinaListIdFromFlags(flags);
  const fromFiled = filed
    .map(normalizeCh99)
    .map((c) => FILED_CHINA_301[c])
    .find(Boolean);

  if (fromHts && fromFlag && fromHts.list !== fromFlag) {
    diagnostics.push({
      severity: "WARNING",
      code: "S301_LIST_CLAIM_MISMATCH",
      message: `HTS ${fromHts.hts8} is on China 301 ${fromHts.list.replace("_", " ")} → ${fromHts.ch99}, but the claim flag says ${fromFlag}. Using HTS membership.`,
      remediation: `Clear the wrong list claim and report ${fromHts.ch99} (Cervó / USTR list notes).`,
    });
  }

  if (fromHts) {
    diagnostics.push({
      severity: "INFO",
      code: "S301_LIST_RESOLVED",
      message: `China 301 ${fromHts.list.replace(/_/g, " ")} resolved from 8-digit HTS ${fromHts.hts8} → ${fromHts.ch99}.`,
    });
    return fromHts.ch99;
  }

  if (fromFlag) return ch99ForChinaList(fromFlag);

  if (fromFiled) {
    const code = ch99ForChinaList(fromFiled);
    diagnostics.push({
      severity: "INFO",
      code: "S301_LIST_FROM_FILED",
      message: `China 301 ${fromFiled.replace(/_/g, " ")} inferred from filed ${code} (HTS not in seeded USTR list pack — membership claim accepted).`,
    });
    return code;
  }

  diagnostics.push({
    severity: "WARNING",
    code: "S301_LIST_UNKNOWN",
    message:
      "Country of origin is China, but this HTS is not on U.S. note 31 (9903.91.xx) or the seeded USTR List 1/2/3/4A pack and no China 301 list was claimed or filed. China 301 was not assessed — only other live layers (e.g. 301-FL) apply.",
    remediation:
      "Confirm U.S. note 31 (four-year review) or note 20 list membership. Steel/aluminum of China often report 9903.91.01. Legacy lists: 4A → 9903.88.15 @ 7.5%; Lists 1–3 → 9903.88.01/.02/.03 @ 25%.",
  });
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
  const rawCoo = String(line.coo || "").trim().toUpperCase();
  const caNorm = normalizeCanadaCoo(rawCoo);
  const coo = caNorm.coo;
  const entered = num(line.entered_value);
  const rd = rateDate(line);
  if (caNorm.normalized_from) {
    diagnostics.push({
      severity: "INFO",
      code: "COO_NORMALIZED_CA_XCODE",
      message: `Country of origin ${caNorm.normalized_from} is a CATAIR Canadian province X-code; evaluated as product of Canada (CA).`,
    });
  }

  let col1Pct = num(line.col1_rate_pct, NaN);
  let col1Source = "supplied";
  let col1SpecificUsd = 0;
  let col1Uom = String(line.quantity_uom || "").trim().toUpperCase();
  let rateLabel = "";
  const look = lookupHts(hts, rd.date);
  const resolved = look.window_status === "active" ? look.hit : resolveCol1(hts, rd.date);
  const unknownHts = look.window_status === "unknown";
  const suppliedCol1 = Number.isFinite(col1Pct);

  // Unknown HTS with no manual Col-1 override: do not invent Free / Ch.99 stacks.
  if (unknownHts && !suppliedCol1) {
    const repl = look.replacement_hts
      ? ` Suggested replacement: ${formatHtsDisplay(look.replacement_hts)} — accept it in Quick check, then re-run.`
      : "";
    diagnostics.push({
      severity: "ERROR",
      code: "UNKNOWN_HTS",
      message:
        `HTS ${hts || "(blank)"} is not in the baseline Column-1 table — no duty rate can be calculated.${repl}`,
      remediation: look.replacement_hts
        ? `Use replacement ${formatHtsDisplay(look.replacement_hts)}, or confirm the 10-digit HTS on USITC and re-import the classification table.`
        : "Confirm the 10-digit statistical reporting number on USITC (e.g. cocoa powder is 1805.00.0010 / .0090, not .0000). Do not run duty until the HTS is valid.",
    });
    return {
      line_id,
      hts,
      coo,
      entered_value: entered,
      col1_rate_pct: null,
      col1_source: "missing",
      col1_rate_label: null,
      col1_specific_usd: null,
      quantity: null,
      quantity_uom: null,
      needs_quantity: false,
      metals: null,
      china_301: look.hit?.china_301 || null,
      china_301_fy: look.hit?.china_301_fy || null,
      usitc_url:
        look.hit?.usitc_url ||
        `https://hts.usitc.gov/search?query=${encodeURIComponent(hts.replace(/\D/g, "") || hts)}`,
      rate_determination_date: rd.date,
      rate_date_basis: rd.basis,
      layers: [],
      suppressed: [],
      diagnostics,
      ch99_sequence: [],
      totals: {
        duty: 0,
        parts_duty: 0,
        metals_duty: 0,
        specific_duty: 0,
        ad_valorem_commodity_duty: 0,
        effective_duty_rate_pct: null,
      },
      blocked: true,
      replacement_hts: look.replacement_hts,
      replacement_hts_display: look.replacement_hts_display,
      window_status: look.window_status,
    };
  }

  if (!suppliedCol1) {
    if (resolved) {
      col1Pct = resolved.col1_pct;
      col1Source = "hts_table";
      diagnostics.push({
        severity: "INFO",
        code: "COL1_RESOLVED",
        message: `Column-1 ${resolved.rate_label} resolved from HTS table for ${resolved.hts} (window ${resolved.start} → ${resolved.end}).`,
      });
      if (look.window_status === "ended") {
        diagnostics.push({
          severity: "WARNING",
          code: "HTS_ENDED",
          message: `HTS rate window ended${look.ended_on ? ` on ${look.ended_on}` : ""} — using last published Column-1. Confirm the current statistical reporting number.`,
          remediation: look.replacement_hts
            ? `Suggested replacement ${formatHtsDisplay(look.replacement_hts)}.`
            : "Look up the current HTS on USITC.",
        });
      }
    } else {
      // Should be unreachable after UNKNOWN_HTS gate; keep as hard stop.
      diagnostics.push({
        severity: "ERROR",
        code: "MISSING_COL1",
        message: "No column-1 rate supplied and HTS was not found in the classification table.",
        remediation: "Confirm the 10-digit HTS, or enter an explicit col1_rate_pct override in Advanced.",
      });
      return {
        line_id,
        hts,
        coo,
        entered_value: entered,
        col1_rate_pct: null,
        col1_source: "missing",
        col1_rate_label: null,
        col1_specific_usd: null,
        quantity: null,
        quantity_uom: null,
        needs_quantity: false,
        metals: null,
        china_301: null,
        china_301_fy: null,
        usitc_url: `https://hts.usitc.gov/search?query=${encodeURIComponent(hts.replace(/\D/g, "") || hts)}`,
        rate_determination_date: rd.date,
        rate_date_basis: rd.basis,
        layers: [],
        suppressed: [],
        diagnostics,
        ch99_sequence: [],
        totals: {
          duty: 0,
          parts_duty: 0,
          metals_duty: 0,
          specific_duty: 0,
          ad_valorem_commodity_duty: 0,
          effective_duty_rate_pct: null,
        },
        blocked: true,
        window_status: "unknown",
      };
    }
  } else if (unknownHts) {
    diagnostics.push({
      severity: "WARNING",
      code: "UNKNOWN_HTS_OVERRIDE",
      message:
        "HTS is not in the baseline Column-1 table; using the manual Col-1 override you entered. Chapter 99 still stacks on that override.",
      remediation: "Confirm the 10-digit HTS on USITC when you can — override rates are not validated against the classification table.",
    });
  }
  if (resolved) {
    col1SpecificUsd = resolved.col1_specific_usd || 0;
    col1Uom = col1Uom || (resolved.uom1 || "").toUpperCase();
    rateLabel = resolved.rate_label;
  }
  const col1 = col1Pct / 100;
  const qty = num(line.quantity, NaN);
  let specificDuty = 0;
  if (col1SpecificUsd > 0) {
    if (!Number.isFinite(qty) || qty <= 0) {
      diagnostics.push({
        severity: "ERROR",
        code: "QTY_REQUIRED_FOR_SPECIFIC",
        message: `Column-1 includes a specific rate (${rateLabel || `${col1SpecificUsd}/${col1Uom || "unit"}`}). Enter quantity in ${col1Uom || "the HTS UOM"} (e.g. BBL for lubricating oils at 84¢/bbl).`,
        remediation: `Add quantity (${col1Uom || "UOM"}) — Cervó’s BBL QTY field for barrel-based oils.`,
      });
    } else {
      specificDuty = money2(qty * col1SpecificUsd);
    }
  }
  const filed = (line.filed_ch99 || []).map(normalizeCh99);
  const flags = inferChinaFlagsFromFiled(filed, line.flags || {});

  /** Set before any pushCommodity() call when USMCA / CAFTA-DR SPI Free applies. */
  let spiPref: SpiPreference | null = null;

  const pushCommodity = (zeroCommodity = false) => {
    if (spiPref) {
      const wouldAdValorem = money2(entered * col1);
      const wouldSpecific = specificDuty > 0 ? specificDuty : 0;
      const wouldTotal = money2(wouldAdValorem + wouldSpecific);
      layers.push(
        layer({
          slot: "6.0",
          program: "base",
          ch99: null,
          label: `Column-1 Free — ${spiPref.label} (SPI ${spiPref.spi})`,
          reason: `${spiPref.label} preferential claim (SPI ${spiPref.spi}) suppresses Chapters 1–97 / Column-1 duty and MPF. Other programs (301-FL, 232, China 301, etc.) are NOT auto-suppressed — each needs its own ${spiPref.label} / Note 52 Chapter 99 exemption when applicable.`,
          source_ref: "R10_SPI_FTA_COL1_MPF",
          basis_amount: entered,
          rate_pct: 0,
          rate_label: "Free",
        }),
      );
      if (wouldTotal > 0) {
        suppressed.push({
          ...layer({
            slot: "6.0",
            program: "base",
            ch99: null,
            label: "Column-1 (suppressed by preference)",
            reason: `Suppressed by ${spiPref.label} SPI ${spiPref.spi}. Would otherwise assess $${wouldTotal.toFixed(2)}.`,
            source_ref: "R10_SPI_FTA_COL1_MPF",
            basis_amount: entered,
            rate_pct: col1,
            rate_label: rateLabel || pctLabel(col1),
            duty_amount: wouldTotal,
          }),
          reason: `Suppressed by ${spiPref.label}. Would otherwise assess $${wouldTotal.toFixed(2)}.`,
        });
      }
      return;
    }
    if (zeroCommodity) {
      layers.push(
        layer({
          slot: "6.0",
          program: "base",
          ch99: null,
          label: "Column-1 / Chapters 1–97",
          reason: "Commodity line rate zeroed on this path (Ch.99 reports the operative rate).",
          basis_amount: entered,
          rate_pct: 0,
          rate_label: rateLabel || pctLabel(0),
        }),
      );
      return;
    }
    if (col1 > 0) {
      layers.push(
        layer({
          slot: "6.0",
          program: "base",
          ch99: null,
          label: "Column-1 ad valorem",
          reason: "Ad valorem portion of Chapters 1–97 / Column 1.",
          basis_amount: entered,
          rate_pct: col1,
        }),
      );
    }
    if (specificDuty > 0) {
      const cents =
        resolved?.col1_specific_cents ??
        Math.round(col1SpecificUsd * 10000) / 100;
      layers.push(
        layer({
          slot: "6.0",
          program: "base",
          ch99: null,
          label: `Column-1 specific (${col1Uom || "UOM"})`,
          reason: `${trimDisp(cents)}¢/${col1Uom || "unit"} × ${qty} ${col1Uom || "units"}.`,
          basis: "QUANTITY",
          basis_amount: qty,
          rate_pct: 0,
          rate_label: `${trimDisp(cents)}¢/${col1Uom || "unit"}`,
          duty_amount: specificDuty,
        }),
      );
    } else if (!(col1 > 0)) {
      layers.push(
        layer({
          slot: "6.0",
          program: "base",
          ch99: null,
          label: "Column-1 / Chapters 1–97",
          reason: rateLabel ? `Column-1 ${rateLabel}.` : "Commodity line rate.",
          basis_amount: entered,
          rate_pct: 0,
          rate_label: rateLabel || "Free",
        }),
      );
    }
  };
  function trimDisp(n: number) {
    return String(Number(n.toFixed(4))).replace(/0+$/, "").replace(/\.$/, "");
  }

  spiPref = resolveSpiPreference(line, coo, diagnostics);
  if (spiPref) {
    diagnostics.push({
      severity: "INFO",
      code: "SPI_PREFERENCE_APPLIED",
      message: `${spiPref.label} (SPI ${spiPref.spi}): Column-1 duty and MPF suppressed. Other tariff programs need their own ${spiPref.label} Chapter 99 exception (e.g. 301-FL Note 52 headings) — SPI alone does not clear them.`,
    });
  }

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

  const legacyMelt = String(line.country_of_melt_pour || "")
    .trim()
    .toUpperCase()
    .slice(0, 2);

  type MetalPart = {
    kind: string;
    basis: number;
    pct: number | null;
    mode: "USD" | "PCT";
    melt_pour: string;
  };
  const metalParts: MetalPart[] = [];
  const rawContents = line.metal_contents && typeof line.metal_contents === "object"
    ? line.metal_contents
    : null;

  if (rawContents) {
    for (const kind of ["steel", "aluminum", "copper"] as const) {
      const row = rawContents[kind];
      if (!row || typeof row !== "object") continue;
      const melt = String(row.melt_pour || "")
        .trim()
        .toUpperCase()
        .slice(0, 2);
      const pctRaw = num(row.pct, NaN);
      const valRaw = num(row.value, NaN);
      let basis = 0;
      let mode: "USD" | "PCT" = "USD";
      let pct: number | null = null;
      if (Number.isFinite(valRaw) && valRaw > 0) {
        basis = valRaw;
        mode = "USD";
        if (entered > 0) pct = money2((basis / entered) * 100);
      } else if (Number.isFinite(pctRaw) && pctRaw > 0) {
        mode = "PCT";
        pct = pctRaw;
        basis = money2(entered * (pctRaw / 100));
      } else {
        continue;
      }
      metalParts.push({ kind, basis, pct, mode, melt_pour: melt });
    }
  }

  // Legacy single-content fields (primary metal)
  if (!metalParts.length) {
    const metalPctRaw = num(line.metal_content_pct, NaN);
    let metalValLegacy = num(line.metal_content_value, NaN);
    if (Number.isFinite(metalValLegacy) && metalValLegacy > 0) {
      metalParts.push({
        kind: "steel",
        basis: metalValLegacy,
        pct: entered > 0 ? money2((metalValLegacy / entered) * 100) : null,
        mode: "USD",
        melt_pour: legacyMelt,
      });
    } else if (Number.isFinite(metalPctRaw) && metalPctRaw > 0) {
      metalParts.push({
        kind: "steel",
        basis: money2(entered * (metalPctRaw / 100)),
        pct: metalPctRaw,
        mode: "PCT",
        melt_pour: legacyMelt,
      });
    }
  }

  const metalVal = money2(metalParts.reduce((a, p) => a + p.basis, 0));
  const metalBasisMode: "USD" | "PCT" | "MIXED" | null = metalParts.length
    ? metalParts.every((p) => p.mode === metalParts[0].mode)
      ? metalParts[0].mode
      : "MIXED"
    : null;
  const metalContentPct =
    entered > 0 && metalVal > 0 ? money2((metalVal / entered) * 100) : null;
  const meltPour =
    metalParts.map((p) => p.melt_pour).filter(Boolean)[0] || legacyMelt;
  const primaryMetal = (["copper", "aluminum", "steel"] as const).find((k) =>
    metalParts.some((p) => p.kind === k),
  );

  const metalsHit = resolve232Metals({
    hts,
    filed_ch99: filed,
    flags,
    aggregate_metal_pct: metalContentPct,
    primary_metal: primaryMetal,
    coo,
    col1_pct: money2(col1 * 100),
  });
  const metalsDutyHit = isMetalsDutyHit(metalsHit) ? metalsHit : null;

  const claimedAuto232 = Boolean(flags.s232_auto_part || flags.s232_auto || flags.s232);
  const annex232 = match232AutoPartsAnnex(hts);
  const chapterMetals = classify232Metals(hts);
  const s232Res = resolveS232EnteredValue({
    hts,
    coo,
    rateDay: rd.date,
    flags,
    chapterMetals: Boolean(chapterMetals),
    col1Rate: col1,
  });
  const s232Hit = s232Res.hit;
  for (const n of s232Res.notes) {
    diagnostics.push({
      severity: n.severity,
      code: n.code,
      message: n.message,
    });
  }
  const pharma232 = assessS232Pharma({
    hts,
    coo,
    rateDay: rd.date,
    flags,
  });
  const pharmaClaim = s232PharmaClaimed(flags);
  const flPharmaWanted = flPharmaClaimed(flags);
  if (flPharmaWanted && pharma232?.applies) {
    diagnostics.push({
      severity: "INFO",
      code: "FL_PHARMA_OVER_S232",
      message: `Pharma use (9903.05.89) is claimed — 232 patented pharma (${pharma232.heading}, EU 15% cap) is not applied. Clear Pharma use if you intend to file ${pharma232.heading}.`,
    });
  }
  if ((pharmaClaim.patented || pharmaClaim.generic) && pharma232 && !pharma232.applies) {
    diagnostics.push({
      severity: "WARNING",
      code: "S232_PHARMA_SCOPE",
      message: pharma232.reason,
      remediation:
        "Proclamation 11020 covers subject Chapter 29/30 classifications (U.S. note 40(c)). Plastics such as 3907.69 use Note 52(e) pharmaceutical-use 9903.05.89 under 301-FL — not 9903.04.63.",
    });
  }
  // Pure metal articles (Ch.72–74/76): metals path wins over an accidental autos claim (R5).
  if (metalsHit && (claimedAuto232 || annex232) && chapterMetals && !s232Hit?.suppresses_metals) {
    diagnostics.push({
      severity: "WARNING",
      code: "R5_METALS_OVER_AUTOS",
      message: `HTS chapter ${metalsHit.chapter} (${metalsHit.metal}) is treated as Section 232 metals (${metalsHit.duty_ch99}), not 232 auto-parts. Clear the auto-part claim unless annex evidence says otherwise.`,
    });
  }
  // Annex membership auto-applies 232. Off-list needs an explicit claim (evidence required).
  const is232 = Boolean(s232Hit);
  if (annex232 && s232Hit?.family === "autos_parts") {
    diagnostics.push({
      severity: "INFO",
      code: "S232_ANNEX_HIT",
      message: `HTS matches Proclamation 10908 auto-parts annex stem ${annex232.matched_stem} → ${s232Hit.heading} (232 supersedes 301-FL via 9903.05.90).`,
      remediation: annex232.source,
    });
  } else if (claimedAuto232 && !annex232 && is232) {
    diagnostics.push({
      severity: "WARNING",
      code: "S232_ANNEX_CLAIM_GATED",
      message:
        "Section 232 auto-part claim asserted, but this HTS is NOT on the published Proclamation 10908 / U.S. note 33 auto-parts list (e.g. 8483.50 ≠ 8483.10; 8544.42.xx ≠ 8544.30.00). Off-list self-cert files 9903.94.07, not annex 9903.94.05.",
      remediation: "Attach Commerce/CBP annex evidence, reclassify to an in-annex HTS if applicable, or clear the 232 claim.",
    });
  } else if (!claimedAuto232 && !annex232 && !metalsDutyHit) {
    // Helpful only for Ch.85 / common miss when filer expected wiring-set 232
    const d = String(hts).replace(/\D/g, "");
    if (d.startsWith("854442") || d.startsWith("854449")) {
      diagnostics.push({
        severity: "INFO",
        code: "S232_ANNEX_MISS",
        message:
          "8544.42 / 8544.49 fitted conductors are not on the CBP Automobile Parts HTS list. In-annex wiring sets are 8544.30.00. Without an annex hit or 232 claim, 301-FL (or Sec 122 historically) applies for this origin/date.",
        remediation: "If the goods are vehicle ignition/wiring sets, confirm HTS 8544.30.00. Enter copper % on this card if the line is a 232 metal derivative (under 15% → 9903.82.03).",
      });
    }
  }

  if (metalsHit?.kind === "EXCLUSION") {
    diagnostics.push({
      severity: "INFO",
      code: "S232_METALS_DE_MINIMIS",
      message:
        metalContentPct != null
          ? `Aggregate metal ${metalContentPct}% is under 15% → ${metalsHit.duty_ch99} at 0% additional. 301-FL still applies. Not available for Ch.72–74/76 articles.`
          : `${metalsHit.duty_ch99} @ 0% additional (Note 16 exclusion). 301-FL still applies.`,
    });
  } else if (metalsHit) {
    const basisNote =
      metalsHit.basis === "ENTERED_VALUE"
        ? `${metalsHit.duty_ch99} @ ${metalsHit.rate_pct}% on entered value (derivative / copper path — U.S. note 16 / CSMS #68253075).`
        : `Chapter ${metalsHit.chapter} ${metalsHit.metal} article → ${metalsHit.duty_ch99} at ${metalsHit.rate_pct}% on metal-content value (CSMS #68253075). Mixed steel/aluminum/copper content is summed. Enter melt/pour (or smelt) per metal.`;
    diagnostics.push({
      severity: "INFO",
      code: metalsHit.claim_gated ? "S232_METALS_CLAIM" : "S232_METALS_TRIAGE",
      message: metalsHit.claim_gated
        ? `Section 232 metals claimed via filed Chapter 99 or metal content (${metalsHit.duty_ch99}). ${basisNote}`
        : basisNote,
    });
    diagnostics.push({
      severity: "WARNING",
      code: "ADCVD_MAY_APPLY",
      message:
        "This product may also be subject to anti-dumping and/or countervailing duties. Confirm open AD/CVD orders for the HTS and exporter before filing.",
    });
  }

  let blocked = false;
  /** Metals content/melt-pour gaps must not block Sec 122 / China 301 / 301-FL on entered value. */
  let metalsReady = true;
  const metalsNeedsContent = Boolean(
    metalsHit && metalsHit.basis === "METAL_CONTENT_VALUE" && !s232Hit?.suppresses_metals,
  );
  if (metalsNeedsContent && !(metalVal > 0)) {
    metalsReady = false;
    diagnostics.push({
      severity: "ERROR",
      code: "METAL_CONTENT_REQUIRED",
      message: metalsHit!.content_prompt,
      remediation:
        "Enter steel and/or aluminum and/or copper content as USD or % of entered. Duty basis is the sum of those contents. Other layers (Sec 122 / 301-FL / China 301) still assess on entered value.",
    });
  }
  for (const p of metalParts) {
    if (metalsNeedsContent && p.basis > 0 && !p.melt_pour) {
      metalsReady = false;
      diagnostics.push({
        severity: "ERROR",
        code: "MELT_POUR_REQUIRED",
        message: `${p.kind} content is set but melt/pour (or smelt) country is missing.`,
        remediation: `Enter ISO-2 for ${p.kind} melt & pour / smelt.`,
      });
    }
  }
  if (metalsNeedsContent && metalVal > 0 && !metalParts.length && !meltPour) {
    metalsReady = false;
    diagnostics.push({
      severity: "ERROR",
      code: "MELT_POUR_REQUIRED",
      message: `${metalsHit!.melt_pour_label} is required for Section 232 metals (ISO-2).`,
      remediation: "Enter the melt & pour / smelt country (e.g. CN).",
    });
  }
  if (metalsHit && metalVal > entered && entered > 0) {
    diagnostics.push({
      severity: "WARNING",
      code: "METAL_CONTENT_GT_ENTERED",
      message: `Combined metal content $${metalVal.toFixed(2)} exceeds entered value $${entered.toFixed(2)}.`,
    });
  }
  if (metalParts.length > 1) {
    diagnostics.push({
      severity: "INFO",
      code: "MIXED_METAL_CONTENT",
      message: `Mixed metals: ${metalParts
        .map((p) => `${p.kind} $${p.basis.toFixed(2)}${p.melt_pour ? ` (${p.melt_pour})` : ""}`)
        .join(" + ")} = $${metalVal.toFixed(2)} basis.`,
    });
  }

  let chinaNote31: Note31Hit | null = null;
  let chinaCode: string | null = null;
  if (coo === "CN") {
    const n31 = lookupChina301Note31({
      hts,
      date: rd.date,
      flags,
      filed_ch99: filed,
    });
    diagnostics.push(...n31.diagnostics);
    if (n31.hit) {
      chinaNote31 = n31.hit;
      chinaCode = n31.hit.ch99;
    } else if (!n31.skip_legacy) {
      chinaCode = chinaListCode(hts, flags, diagnostics, filed);
    }
  }
  let partsDuty = 0;
  let metalsDuty = 0;

  /** Filled by add301Fl when a Note 52 economy exemption is available / claimed. */
  const ftaTrack: {
    available: FlEconomyExemption | null;
    claimed: FlEconomyExemption | null;
    without_fl_heading: string | null;
    without_fl_rate_pct: number;
    without_fl_duty: number;
    col1_without_spi_duty: number;
    spi_applied: boolean;
    pharma_applied: boolean;
    pharma_heading: string | null;
    fl_kind: AppliedFl["kind"] | null;
    fl_cap_pct: number | null;
  } = {
    available: lookupFlClaimExemption(coo),
    claimed: null,
    without_fl_heading: null,
    without_fl_rate_pct: 0,
    without_fl_duty: 0,
    col1_without_spi_duty: money2(entered * col1 + (specificDuty > 0 ? specificDuty : 0)),
    spi_applied: Boolean(spiPref),
    pharma_applied: false,
    pharma_heading: null,
    fl_kind: null,
    fl_cap_pct: null,
  };

  // Leftover trade-deal flags / TBC headings (9903.94.45/.55) stay blocked by R6.
  // JP/EU/KR/UK CSMS origin splits compute via combined_cap and are not R6.
  const tradeDealAttempt =
    Boolean(flags.trade_deal_eu || flags.trade_deal_kr || flags.trade_deal_tw) ||
    filed.some((c) => ["9903.94.45", "9903.94.55"].includes(c));
  if (tradeDealAttempt && !s232Hit?.combined_cap) {
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

  const applyMetals232 = Boolean(
    metalsDutyHit &&
      metalsDutyHit.suppresses_301fl &&
      !s232Hit?.suppresses_metals &&
      !blocked &&
      (metalsDutyHit.basis === "ENTERED_VALUE" || (metalVal > 0 && metalsReady)),
  );

  let zeroCommodity232 = false;

  const applyEntered232Layer = (): boolean => {
    if (!s232Hit) return false;
    if (s232Hit.combined_cap) {
      layers.push(
        layer({
          slot: "3.3",
          program: s232Hit.program,
          ch99: s232Hit.heading,
          label: s232Hit.label,
          reason: s232Hit.reason,
          source_ref: s232Hit.source,
          basis_amount: entered,
          rate_pct: s232Hit.rate_pct_decimal,
        }),
      );
      return s232Hit.zero_commodity;
    }
    if (s232Hit.family === "autos_parts") {
      const meta = assertRateKnown(s232Hit.heading);
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
          reason: s232Hit.reason,
          source_ref: s232Hit.source || meta.notes,
          basis_amount: entered,
          rate_pct: meta.rate,
        }),
      );
      return false;
    }
    const meta = assertComputable(s232Hit.heading);
    layers.push(
      layer({
        slot: "3.3",
        program: s232Hit.program,
        ch99: meta.code,
        label: s232Hit.label,
        reason: s232Hit.reason,
        source_ref: s232Hit.source,
        basis_amount: entered,
        rate_pct: s232Hit.rate_pct_decimal,
      }),
    );
    return false;
  };

  if (!blocked && chinaCode) {
    try {
      const c301 = assertComputable(chinaCode);
      const note31 = chinaNote31 && chinaNote31.ch99 === c301.code;
      layers.push(
        layer({
          slot: "3.1",
          program: c301.program,
          ch99: c301.code,
          label: note31
            ? chinaNote31!.label
            : c301.notes.split(".")[0] || "Legacy China 301",
          reason: note31
            ? `${chinaNote31!.reason} Not suppressed by Section 232 (R2). Reports first.`
            : "Legacy China 301 is not suppressed by Section 232 (R2). Reports first.",
          source_ref: note31 ? chinaNote31!.source : c301.notes,
          basis_amount: entered,
          rate_pct: c301.rate,
        }),
      );

      if (s232Hit) {
        zeroCommodity232 = applyEntered232Layer();
        if (s232SuppressesFl(s232Hit)) {
          push301FlSuppression(coo, entered, col1, layers, suppressed, rd.date);
          applySec122Or232Exclusion(entered, layers, suppressed, diagnostics, rd.date, true);
        } else {
          applySec122Or232Exclusion(entered, layers, suppressed, diagnostics, rd.date, false);
          add301Fl(coo, entered, col1, layers, suppressed, diagnostics, rd.date, line, ftaTrack);
        }
      } else if (metalsDutyHit) {
        // China 301 + 232 metals triage: China first; Sec 122 out via 9903.03.06; FL suppressed when metals ready
        applySec122Or232Exclusion(entered, layers, suppressed, diagnostics, rd.date, true);
        if (applyMetals232) {
          push301FlSuppression(coo, entered, col1, layers, suppressed, rd.date);
        } else {
          add301Fl(coo, entered, col1, layers, suppressed, diagnostics, rd.date, line, ftaTrack);
        }
      } else {
        applySec122Or232Exclusion(entered, layers, suppressed, diagnostics, rd.date, false);
        add301Fl(coo, entered, col1, layers, suppressed, diagnostics, rd.date, line, ftaTrack);
      }

      pushCommodity(zeroCommodity232);
    } catch (e) {
      diagnostics.push({
        severity: "ERROR",
        code: "REVIEW_REQUIRED",
        message: e instanceof Error ? e.message : String(e),
      });
      blocked = true;
    }
  } else if (!blocked && is232 && s232Hit) {
    // Entered-value 232 (vehicles, parts, MHDV, wood, semiconductors)
    try {
      const zero = applyEntered232Layer();
      addBrazil301(coo, hts, entered, layers, diagnostics, rd.date, {
        in232Universe: s232SuppressesFl(s232Hit),
        flags,
      });
      if (s232SuppressesFl(s232Hit)) {
        push301FlSuppression(coo, entered, col1, layers, suppressed, rd.date);
        applySec122Or232Exclusion(entered, layers, suppressed, diagnostics, rd.date, true);
      } else {
        applySec122Or232Exclusion(entered, layers, suppressed, diagnostics, rd.date, false);
        add301Fl(coo, entered, col1, layers, suppressed, diagnostics, rd.date, line, ftaTrack);
      }
      pushCommodity(zero);
    } catch (e) {
      diagnostics.push({
        severity: "ERROR",
        code: "REVIEW_REQUIRED",
        message: e instanceof Error ? e.message : String(e),
      });
      blocked = true;
    }
  } else if (!blocked && applyMetals232 && metalsDutyHit) {
    // 232 metals wins over 301-FL (US Note 52(f) / 9903.05.90) — Cervó parity
    addBrazil301(coo, hts, entered, layers, diagnostics, rd.date, {
      in232Universe: true,
      flags,
    });
    push301FlSuppression(coo, entered, col1, layers, suppressed, rd.date);
    applySec122Or232Exclusion(entered, layers, suppressed, diagnostics, rd.date, true);
    pushCommodity(false);
  } else if (!blocked && metalsDutyHit) {
    // Metals triage without content yet: still carve Sec 122 out of the 232 universe
    addBrazil301(coo, hts, entered, layers, diagnostics, rd.date, {
      in232Universe: true,
      flags,
    });
    applySec122Or232Exclusion(entered, layers, suppressed, diagnostics, rd.date, true);
    add301Fl(coo, entered, col1, layers, suppressed, diagnostics, rd.date, line, ftaTrack);
    pushCommodity(false);
  } else if (!blocked && pharma232?.applies && !flPharmaWanted) {
    // Section 232 patented / generic pharma — Proclamation 11020 (CSMS #69395344 / #69415934)
    try {
      const meta = assertComputable(pharma232.heading);
      layers.push(
        layer({
          slot: "3.3",
          program: "SEC_232_PHARMA",
          ch99: meta.code,
          label: pharma232.label,
          reason: pharma232.reason,
          source_ref: meta.notes,
          basis_amount: entered,
          rate_pct: pharma232.rate_pct_decimal,
        }),
      );
      if (pharma232.combined_rate_tbc) {
        diagnostics.push({
          severity: "WARNING",
          code: "S232_PHARMA_COMBINED_TBC",
          message: `${pharma232.heading} is a combined Column-1 + 232 rate (${(pharma232.rate_pct_decimal * 100).toFixed(0)}%). Confirm whether Ch.1–97 should report zero on this path.`,
          remediation: "CSMS #69395344 describes combined rates for 9903.04.60 / .62. Review filing practice before relying on the stacked Col-1 line.",
        });
      }
      diagnostics.push({
        severity: "INFO",
        code: "S232_PHARMA_APPLIED",
        message: pharma232.reason,
      });
      addBrazil301(coo, hts, entered, layers, diagnostics, rd.date, {
        in232Universe: pharma232.suppresses_301fl,
        flags,
      });
      if (pharma232.suppresses_301fl) {
        push301FlSuppression(coo, entered, col1, layers, suppressed, rd.date);
        applySec122Or232Exclusion(entered, layers, suppressed, diagnostics, rd.date, true);
      } else {
        applySec122Or232Exclusion(entered, layers, suppressed, diagnostics, rd.date, false);
        add301Fl(coo, entered, col1, layers, suppressed, diagnostics, rd.date, line, ftaTrack);
      }
      pushCommodity(pharma232.rate_kind === "combined_col1_and_232");
    } catch (e) {
      diagnostics.push({
        severity: "ERROR",
        code: "REVIEW_REQUIRED",
        message: e instanceof Error ? e.message : String(e),
      });
      blocked = true;
    }
  } else if (!blocked) {
    // Non-232 → Brazil 301 (from 2026-07-22) + Sec 122 (historical) or 301-FL (from 2026-07-24)
    addBrazil301(coo, hts, entered, layers, diagnostics, rd.date, {
      in232Universe: false,
      flags,
    });
    applySec122Or232Exclusion(entered, layers, suppressed, diagnostics, rd.date, false);
    add301Fl(coo, entered, col1, layers, suppressed, diagnostics, rd.date, line, ftaTrack);
    pushCommodity(false);
  }

  // Metals layer (R4) — 9903.82.02 on metal-content; 9903.82.09 on entered value
  if (applyMetals232 && metalsDutyHit) {
    try {
      const steel = assertComputable(metalsDutyHit.duty_ch99);
      const onEntered = metalsDutyHit.basis === "ENTERED_VALUE";
      const Lm = layer({
        slot: "3.3",
        program: steel.program,
        ch99: steel.code,
        label: onEntered
          ? `Section 232 metals / derivatives — ${steel.code} (${metalsDutyHit.rate_pct}% entered value)`
          : `Section 232 metal products — ${metalsDutyHit.metal} (${metalsDutyHit.rate_pct}%)`,
        reason: onEntered
          ? `Entered-value basis $${entered.toFixed(2)}; U.S. note 16 derivative/copper path. ${steel.notes}`
          : `Metal-content basis $${metalVal.toFixed(2)}${
              metalParts.length
                ? ` [${metalParts.map((p) => `${p.kind} $${p.basis.toFixed(2)}`).join(" + ")}]`
                : ""
            }; melt/pour ${metalParts.map((p) => (p.melt_pour ? `${p.kind}:${p.melt_pour}` : "")).filter(Boolean).join(", ") || meltPour}. ${steel.notes}`,
        source_ref: "CSMS #68253075 / U.S. note 16",
        basis: onEntered ? "ENTERED_VALUE" : "METAL_CONTENT_VALUE",
        basis_amount: onEntered ? entered : metalVal,
        rate_pct: steel.rate,
      });
      layers.push(Lm);
      metalsDuty += Lm.duty_amount;
      diagnostics.push({
        severity: "INFO",
        code: "METALS_SEPARATE_LINE",
        message: onEntered
          ? `232 metals derivative via ${steel.code} on entered value; kept out of parts subtotal (R4).`
          : `232 metals on metal-content value via ${steel.code} (input as ${metalBasisMode === "PCT" ? "percent of entered" : metalBasisMode === "MIXED" ? "mixed USD/%" : "USD"}); kept out of parts subtotal (R4). Potential exclusions: ${metalsDutyHit.potential_exclusions.map((e) => e.ch99).join(", ")}.`,
      });
    } catch (e) {
      diagnostics.push({
        severity: "ERROR",
        code: "REVIEW_REQUIRED",
        message: e instanceof Error ? e.message : String(e),
      });
      blocked = true;
    }
  }

  if (metalsHit?.kind === "EXCLUSION") {
    try {
      const ex = assertComputable(metalsHit.duty_ch99);
      layers.push(
        layer({
          slot: "3.3",
          program: ex.program,
          ch99: ex.code,
          label: `Section 232 metals exclusion — ${ex.code} (0% additional)`,
          reason:
            metalContentPct != null
              ? `Aggregate metal ${metalContentPct}% is under 15% (U.S. note 16). Not for Ch.72–74/76 articles. 301-FL is not suppressed. ${ex.notes}`
              : `Note 16 exclusion ${ex.code} @ 0%. 301-FL is not suppressed. ${ex.notes}`,
          source_ref: "U.S. note 16 / CSMS #68253075",
          basis: "ENTERED_VALUE",
          basis_amount: entered,
          rate_pct: ex.rate,
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
  }

  addS338Canada(line, hts, coo, entered, layers, diagnostics, rd.date, flags, filed);
  addS201Qsp(line, hts, coo, entered, layers, diagnostics, rd.date, flags, filed);

  partsDuty = money2(
    layers
      .filter(
        (l) =>
          l.basis !== "METAL_CONTENT_VALUE" &&
          !String(l.ch99 || "").startsWith("9903.82."),
      )
      .reduce((a, l) => a + l.duty_amount, 0),
  );
  const totalDuty = money2(partsDuty + metalsDuty);
  // Effective rate includes metals — matches Cervó "duty rate" display
  const effective = entered > 0 ? money2((totalDuty / entered) * 100) : 0;

  const seq = layers.filter((l) => l.ch99).map((l) => l.ch99 as string);
  const brazil301 = (c: string) => isBrazil301Heading(c);
  const s338 = (c: string) => isS338Heading(c);
  const ordered = [
    // CSMS #69606660 slot 2 — Chapter 99 additional (Section 338) before trade remedies
    ...seq.filter(s338),
    ...seq.filter(
      (c) =>
        c.startsWith("9903.88") ||
        c.startsWith("9903.91") ||
        isChina301Note31Heading(c),
    ),
    ...seq.filter(brazil301), // Brazil country 301 before other 9903.05 / FL
    ...seq.filter((c) => c === "9903.05.90" || c === "9903.03.06" || c === "9903.03.03"),
    ...seq.filter((c) => c.startsWith("9903.82")),
    ...seq.filter((c) => c.startsWith("9903.04")), // Proclamation 11020 pharma
    ...seq.filter(
      (c) =>
        c.startsWith("9903.94") ||
        c.startsWith("9903.74") ||
        c.startsWith("9903.76") ||
        c.startsWith("9903.79") ||
        c.startsWith("9903.08"),
    ),
    ...seq.filter(
      (c) => c.startsWith("9903.05") && c !== "9903.05.90" && !brazil301(c),
    ),
    ...seq.filter((c) => c.startsWith("9903.45")),
    ...seq.filter((c) => c.startsWith("9903.03") && c !== "9903.03.06" && c !== "9903.03.03" && !s338(c)),
  ];
  const ch99_sequence_unique = [...new Set(ordered.length ? ordered : seq)];
  const ch98Filed = String(line.ch98_provision || "").trim();
  const filing_sequence = [
    ...(ch98Filed ? [ch98Filed] : []),
    ...ch99_sequence_unique,
    hts,
  ];

  const pctOf = (d: number) => (entered > 0 ? money2((d / entered) * 100) : 0);

  let pharma_compare: Record<string, unknown> | null = null;
  if (ftaTrack.pharma_applied && ftaTrack.pharma_heading) {
    const addDuty = ftaTrack.without_fl_duty;
    const addPct = ftaTrack.without_fl_rate_pct;
    const capPct =
      ftaTrack.fl_cap_pct != null ? ftaTrack.fl_cap_pct : money2(col1Pct + addPct);
    const withDuty = money2(totalDuty);
    const withoutDuty = money2(totalDuty + addDuty);
    const isEuCap =
      ftaTrack.without_fl_heading === "9903.05.38" ||
      ftaTrack.without_fl_heading === "9903.05.39";
    pharma_compare = {
      claimed: true,
      heading: ftaTrack.pharma_heading,
      instead_of: ftaTrack.without_fl_heading,
      kind: ftaTrack.fl_kind,
      cap_pct: capPct,
      col1_pct: col1Pct,
      additional_pct: addPct,
      additional_duty: addDuty,
      eu_cap: isEuCap,
      with_claim: {
        fl_heading: ftaTrack.pharma_heading,
        fl_duty: 0,
        fl_rate_pct: 0,
        col1_duty: ftaTrack.col1_without_spi_duty,
        line_duty: withDuty,
        effective_duty_rate_pct: pctOf(withDuty),
      },
      without_claim: {
        fl_heading: ftaTrack.without_fl_heading,
        fl_duty: addDuty,
        fl_rate_pct: addPct,
        col1_duty: ftaTrack.col1_without_spi_duty,
        line_duty: withoutDuty,
        effective_duty_rate_pct: pctOf(withoutDuty),
      },
      extra_without_exception: addDuty,
    };
  }

  let fta_compare: Record<string, unknown> | null = null;
  const hasFtaStory =
    !ftaTrack.pharma_applied &&
    (Boolean(ftaTrack.available && ftaTrack.without_fl_heading) || ftaTrack.spi_applied);
  if (hasFtaStory) {
    const flClaimed = Boolean(ftaTrack.claimed);
    const spiOn = ftaTrack.spi_applied;
    const flDuty = ftaTrack.without_fl_heading ? ftaTrack.without_fl_duty : 0;
    const col1Duty = ftaTrack.col1_without_spi_duty;
    // SPI Free (Col-1 + MPF) only for USMCA / CAFTA-DR — not bare Note 52(j) claims.
    const spiEligible =
      spiOn ||
      ftaTrack.available?.claim_id === "USMCA" ||
      ftaTrack.available?.claim_id === "CAFTA_DR";
    const withoutDuty = money2(
      totalDuty + (flClaimed ? flDuty : 0) + (spiOn ? col1Duty : 0),
    );
    const withDutyClamped = Math.max(
      0,
      money2(
        totalDuty -
          (!flClaimed ? flDuty : 0) -
          (spiEligible && !spiOn ? col1Duty : 0),
      ),
    );
    const claimLabel =
      spiPref?.label ||
      ftaTrack.claimed?.label ||
      ftaTrack.available?.label ||
      "FTA";
    fta_compare = {
      available: true,
      claim_id: spiPref?.claim_id || ftaTrack.available?.claim_id || null,
      label: claimLabel,
      exemption_heading: ftaTrack.available?.heading || null,
      basis: ftaTrack.available?.basis || null,
      claimed: flClaimed || spiOn,
      spi_applied: spiOn,
      col1_suppressed: spiOn,
      mpf_suppressed: spiOn,
      without_claim: {
        fl_heading: ftaTrack.without_fl_heading,
        fl_duty: flDuty,
        fl_rate_pct: ftaTrack.without_fl_rate_pct,
        col1_duty: col1Duty,
        line_duty: withoutDuty,
        effective_duty_rate_pct: pctOf(withoutDuty),
      },
      with_claim: {
        fl_heading: ftaTrack.claimed?.heading || ftaTrack.available?.heading || null,
        fl_duty: 0,
        fl_rate_pct: 0,
        col1_duty: spiEligible ? 0 : col1Duty,
        line_duty: withDutyClamped,
        effective_duty_rate_pct: pctOf(withDutyClamped),
      },
      duty_saved: money2(withoutDuty - withDutyClamped),
    };
  }

  return {
    line_id,
    hts,
    coo,
    entered_value: entered,
    col1_rate_pct: col1Pct,
    col1_source: col1Source,
    col1_rate_label: spiPref ? "Free" : rateLabel || null,
    col1_specific_usd: col1SpecificUsd || null,
    quantity: Number.isFinite(qty) ? qty : null,
    quantity_uom: col1Uom || null,
    needs_quantity: Boolean(col1SpecificUsd > 0),
    metals: metalsHit
      ? {
          ...metalsHit,
          needs_metal_content: true,
          metal_content_value: metalVal > 0 ? metalVal : null,
          metal_content_pct: metalContentPct,
          metal_basis_mode: metalBasisMode,
          metal_parts: metalParts,
          country_of_melt_pour: meltPour || null,
        }
      : null,
    china_301: resolved?.china_301 || lookupChina301List(hts),
    china_301_fy: chinaNote31,
    usitc_url: resolved?.usitc_url || `https://hts.usitc.gov/search?query=${encodeURIComponent(hts.replace(/\D/g, "") || hts)}`,
    rate_determination_date: rd.date,
    rate_date_basis: rd.basis,
    layers,
    suppressed,
    diagnostics,
    ch99_sequence: ch99_sequence_unique,
    filing_sequence,
    section_338: layers.some((l) => l.ch99 && isS338Heading(l.ch99))
      ? {
          program: "SECTION_338_CANADA",
          heading: layers.find((l) => l.ch99 && isS338Heading(l.ch99))?.ch99 || null,
          drawback_eligible: true,
          source: s338Meta().source_csms,
        }
      : null,
    section_201: layers.some((l) => l.ch99 && isS201QspHeading(l.ch99))
      ? {
          program: "SEC_201_QSP",
          heading: layers.find((l) => l.ch99 && isS201QspHeading(l.ch99))?.ch99 || null,
          source: s201QspMeta().source_url,
        }
      : matchS201QspHts(hts)
        ? { program: "SEC_201_QSP", heading: null, covered: true, source: s201QspMeta().source_url }
        : null,
    fta_compare,
    pharma_compare,
    fta_claim: resolveFtaClaim(line),
    spi_preference: spiPref,
    mpf_exempt: Boolean(spiPref),
    totals: {
      duty: totalDuty,
      parts_duty: partsDuty,
      metals_duty: metalsDuty,
      specific_duty: spiPref ? 0 : specificDuty,
      ad_valorem_commodity_duty: spiPref ? 0 : money2(entered * col1),
      effective_duty_rate_pct: effective,
    },
    blocked,
  };
}

function computeTradeDealBlocked(): never {
  throw new Error(
    "MFN cap mechanic for leftover trade-deal flags (9903.94.45/.55) is unresolved (R6_MFN_CAP_RULE).",
  );
}

function push301FlSuppression(
  coo: string,
  entered: number,
  col1: number,
  layers: DutyLayer[],
  suppressed: SuppressedLayer[],
  rateDay?: string,
) {
  if (rateDay && !s301flAppliesOn(rateDay)) return;
  layers.push(
    layer({
      slot: "3.2",
      program: "SEC_301_FL",
      ch99: "9903.05.90",
      label: "301-FL suppressed — Section 232 exclusion (9903.05.90)",
      reason: "232 autos/parts/metals and 301-FL are mutually exclusive; 232 wins (US Note 52(f)).",
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

function addSec122(
  entered: number,
  layers: DutyLayer[],
  diagnostics: Diagnostic[],
  rateDay?: string,
) {
  if (!rateDay || !sec122AppliesOn(rateDay)) return;
  if (layers.some((l) => l.ch99 === SEC_122_CH99)) return;
  try {
    const meta = assertComputable(SEC_122_CH99);
    layers.push(
      layer({
        slot: "3.2",
        program: "SEC_122",
        ch99: meta.code,
        label: "Section 122 — 10% surcharge",
        reason: `Entry/rate date ${rateDay} falls in the Sec 122 window (${filingEraLabel("sec_122")}: 2026-02-24–2026-07-23). Sunset 2026-07-24 when 301-FL replaced it.`,
        source_ref: meta.notes,
        basis_amount: entered,
        rate_pct: meta.rate,
      }),
    );
    diagnostics.push({
      severity: "INFO",
      code: "SEC_122_APPLIED",
      message: `Section 122 ${meta.code} @ ${(meta.rate * 100).toFixed(0)}% applied for ${rateDay}.`,
    });
  } catch (e) {
    diagnostics.push({
      severity: "ERROR",
      code: "REVIEW_REQUIRED",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Sec 122 stacks with China 301; it does not stack with Section 232 (autos or metals) — report 9903.03.06. */
function applySec122Or232Exclusion(
  entered: number,
  layers: DutyLayer[],
  suppressed: SuppressedLayer[],
  diagnostics: Diagnostic[],
  rateDay: string | undefined,
  in232Universe: boolean,
) {
  if (!rateDay || !sec122AppliesOn(rateDay)) return;
  if (!in232Universe) {
    addSec122(entered, layers, diagnostics, rateDay);
    return;
  }
  if (!layers.some((l) => l.ch99 === "9903.03.06")) {
    layers.push(
      layer({
        slot: "3.2",
        program: "SEC_232_METALS",
        ch99: "9903.03.06",
        label: "Excluded from Section 122 (232 universe)",
        reason:
          "Section 232 autos/parts or metals coverage removes the Section 122 surcharge — report 9903.03.06 (R2b).",
        source_ref: getCh99("9903.03.06")?.notes || "Sec 122 vs 232 carve-out",
        basis_amount: entered,
        rate_pct: 0,
      }),
    );
  }
  try {
    const meta = assertComputable(SEC_122_CH99);
    const would = money2(entered * meta.rate);
    if (!suppressed.some((s) => s.ch99 === SEC_122_CH99)) {
      suppressed.push({
        ...layer({
          slot: "3.2",
          program: "SEC_122",
          ch99: meta.code,
          label: "Section 122 — 10% surcharge (suppressed)",
          reason: `Suppressed by 9903.03.06. Would otherwise have assessed $${would.toFixed(2)}.`,
          source_ref: meta.notes,
          basis_amount: entered,
          rate_pct: meta.rate,
        }),
        reason: `Suppressed by 9903.03.06. Would otherwise have assessed $${would.toFixed(2)}.`,
      });
    }
    diagnostics.push({
      severity: "INFO",
      code: "SEC_122_SUPPRESSED_BY_232",
      message: `Section 122 ${SEC_122_CH99} suppressed by 9903.03.06 (232 universe) on ${rateDay}.`,
    });
  } catch {
    /* registry gap — still reported 9903.03.06 above */
  }
}

function addS201Qsp(
  line: LineIn,
  hts: string,
  coo: string,
  entered: number,
  layers: DutyLayer[],
  diagnostics: Diagnostic[],
  rateDay: string | undefined,
  flags: Record<string, boolean>,
  filed: string[],
) {
  if (layers.some((l) => l.ch99 && isS201QspHeading(l.ch99))) return;
  const covered = matchS201QspHts(hts);
  const hit = assessS201Qsp({
    hts,
    coo,
    rateDay,
    flags,
    filed_ch99: filed,
  });
  if (!hit) {
    if (covered && rateDay) {
      diagnostics.push({
        severity: "INFO",
        code: "S201_QSP_NOT_IN_WINDOW",
        message: `HTS stem ${covered.matched_stem} is on the Section 201 QSP list, but ${String(rateDay).slice(0, 10)} is outside 2026-08-15–2030-08-14 (U.S. note 41).`,
      });
    }
    return;
  }
  if (hit.exempt) {
    diagnostics.push({
      severity: "INFO",
      code: "S201_QSP_EXEMPT",
      message: hit.reason,
    });
    return;
  }
  try {
    const meta = assertComputable(hit.heading);
    layers.push(
      layer({
        slot: "3.4",
        program: "SEC_201_QSP",
        ch99: hit.heading,
        label: hit.label,
        reason: hit.reason,
        source_ref: meta.notes,
        basis_amount: entered,
        rate_pct: hit.rate_pct_decimal,
      }),
    );
    diagnostics.push({
      severity: "INFO",
      code: hit.over_quota ? "S201_QSP_OVER_QUOTA" : "S201_QSP_APPLIED",
      message: hit.reason,
    });
    if (!hit.over_quota) {
      diagnostics.push({
        severity: "WARNING",
        code: "S201_QSP_QUOTA_ASSUMED_IN",
        message: `Defaulted to in-quota ${hit.heading} @ ${hit.rate_pct}%. CBP assesses 9903.45.31 at the over-quota rate once the quarterly TRQ is exhausted. Tick over-quota if you know the quota is closed.`,
        remediation: "Set flags.s201_qsp_over_quota or file 9903.45.31.",
      });
    }
    diagnostics.push({
      severity: "WARNING",
      code: "S201_QSP_ADCVD",
      message: "Quartz surface products often carry separate AD/CVD orders (producer/exporter specific). Those duties are not in this Ch.99 stack.",
    });
  } catch (e) {
    diagnostics.push({
      severity: "ERROR",
      code: "REVIEW_REQUIRED",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

function addBrazil301(
  coo: string,
  hts: string,
  entered: number,
  layers: DutyLayer[],
  diagnostics: Diagnostic[],
  rateDay: string | undefined,
  opts: { in232Universe: boolean; flags?: Record<string, boolean> },
) {
  if (coo !== "BR") return;
  if (rateDay && !brazil301AppliesOn(rateDay)) {
    diagnostics.push({
      severity: "INFO",
      code: "BRAZIL_301_NOT_YET_EFFECTIVE",
      message: `Brazil Section 301 (CSMS #69302472) is not applied on ${rateDay} — effective ${String(s301BrazilMeta().effective || "").slice(0, 10)}.`,
    });
    return;
  }
  if (layers.some((l) => l.ch99 && isBrazil301Heading(l.ch99))) return;

  const br = assessBrazil301({
    coo,
    hts,
    in232Universe: opts.in232Universe,
    flags: opts.flags,
  });
  if (!br) return;

  try {
    const meta = assertComputable(br.heading);
    layers.push(
      layer({
        slot: "3.1",
        program: "SEC_301_BRAZIL",
        ch99: br.heading,
        label: br.label,
        reason: br.reason,
        source_ref: meta.notes,
        basis_amount: entered,
        rate_pct: br.rate_pct_decimal,
      }),
    );
    diagnostics.push({
      severity: "INFO",
      code: br.exempt ? "BRAZIL_301_EXEMPT" : "BRAZIL_301_APPLIED",
      message: br.reason,
    });
  } catch (e) {
    diagnostics.push({
      severity: "ERROR",
      code: "REVIEW_REQUIRED",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

function addS338Canada(
  line: LineIn,
  hts: string,
  coo: string,
  entered: number,
  layers: DutyLayer[],
  diagnostics: Diagnostic[],
  rateDay: string | undefined,
  flags: Record<string, boolean>,
  filed: string[],
) {
  if (coo !== "CA") return;
  if (layers.some((l) => l.ch99 && isS338Heading(l.ch99))) return;

  if (rateDay && s338SuspendedOn(rateDay) && !s338AppliesOn(rateDay)) {
    diagnostics.push({
      severity: "INFO",
      code: "S338_SUSPENDED",
      message: `Section 338 Canada additional duties are suspended on ${String(rateDay).slice(0, 10)} (Proc. 11056). They resume 12:01 a.m. eastern standard time on 2026-08-22 (CSMS #69606660).`,
    });
  }

  const attracted = [
    ...layers.map((l) => l.ch99).filter((c): c is string => Boolean(c)),
    ...filed,
  ];
  const ch98 = String(line.ch98_provision || "").trim();
  const hit = assessS338Canada({
    hts,
    coo,
    rateDay,
    flags,
    attracted_ch99: attracted,
    ch98_provision: ch98,
  });
  if (!hit) return;

  let basisAmount = entered;
  let basis: string = "ENTERED_VALUE";
  if (hit.basis === "REPAIR_VALUE") {
    const repair = num(line.ch98_repair_value, NaN);
    basisAmount = Number.isFinite(repair) && repair >= 0 ? repair : entered;
    basis = "REPAIR_VALUE";
  } else if (hit.basis === "ASSEMBLY_LESS_US_CONTENT") {
    const us = Math.max(0, num(line.ch98_us_content_value));
    basisAmount = Math.max(0, money2(entered - us));
    basis = "ASSEMBLY_LESS_US_CONTENT";
  }

  try {
    const meta = assertComputable(hit.heading);
    layers.push(
      layer({
        slot: "2",
        program: "SECTION_338_CANADA",
        ch99: hit.heading,
        label: hit.label,
        reason: hit.reason,
        source_ref: meta.notes,
        basis,
        basis_amount: basisAmount,
        rate_pct: hit.rate_pct_decimal,
      }),
    );
    diagnostics.push({
      severity: "INFO",
      code: hit.exempt ? "S338_EXCLUDED" : "S338_APPLIED",
      message: hit.reason,
    });
  } catch (e) {
    diagnostics.push({
      severity: "ERROR",
      code: "REVIEW_REQUIRED",
      message: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  const ftz = s338FtzWarning({ flags, ftz: Boolean(line.ftz || flags.ftz_admission || flags.ftz) });
  if (ftz) {
    diagnostics.push({
      severity: "WARNING",
      code: "S338_FTZ_PRIVILEGED_FOREIGN",
      message: ftz,
      remediation: "Admit covered merchandise in privileged foreign status (19 CFR 146.41) unless domestic status applies (19 CFR 146.43).",
    });
  }

  const invariant = assertNoS338DutyWithNote51c(
    layers.map((l) => l.ch99).filter((c): c is string => Boolean(c)),
  );
  if (invariant) {
    diagnostics.push({
      severity: "ERROR",
      code: "S338_NOTE51C_INVARIANT",
      message: invariant,
    });
  }
}

function add301Fl(
  coo: string,
  entered: number,
  col1: number,
  layers: DutyLayer[],
  suppressed: SuppressedLayer[],
  diagnostics: Diagnostic[],
  rateDay?: string,
  line?: LineIn,
  ftaTrack?: {
    available: FlEconomyExemption | null;
    claimed: FlEconomyExemption | null;
    without_fl_heading: string | null;
    without_fl_rate_pct: number;
    without_fl_duty: number;
    pharma_applied: boolean;
    pharma_heading: string | null;
    fl_kind: AppliedFl["kind"] | null;
    fl_cap_pct: number | null;
  },
) {
  if (rateDay && !s301flAppliesOn(rateDay)) {
    diagnostics.push({
      severity: "INFO",
      code: "S301FL_NOT_YET_EFFECTIVE",
      message: `Section 301-FL (CSMS #69326983) is not applied on ${rateDay} — pack effective ${String(s301flMeta().effective || "").slice(0, 10)}.`,
    });
    return;
  }
  const fl = assessS301fl(coo, col1);
  if (fl.kind === "out_of_scope") {
    diagnostics.push({
      severity: "INFO",
      code: "FL301_OUT_OF_SCOPE",
      message: fl.reason,
    });
    return;
  }

  const wouldRate = fl.kind === "threshold_no_add" ? 0 : fl.rate_pct_decimal;
  const wouldDuty = money2(entered * wouldRate);
  if (ftaTrack) {
    ftaTrack.without_fl_heading = fl.heading;
    ftaTrack.without_fl_rate_pct = money2(wouldRate * 100);
    ftaTrack.without_fl_duty = wouldDuty;
  }

  const claimRaw = line ? resolveFtaClaim(line) : null;
  const matched = flClaimMatches(coo, claimRaw);
  const available = ftaTrack?.available || lookupFlClaimExemption(coo);
  const flags = line?.flags || {};
  const pharmaHit = matchFlPharmaHts(line?.hts || "");
  const pharmaClaim = flPharmaClaimed(flags);

  if (matched) {
    if (ftaTrack) ftaTrack.claimed = matched;
    layers.push(
      layer({
        slot: "3.2",
        program: "SEC_301_FL",
        ch99: matched.heading,
        label: `301-FL exempt — ${matched.label}`,
        reason: `${matched.basis}. Claimed ${matched.label}: report ${matched.heading} @ 0% instead of ${fl.heading}. SPI Free (Column-1 / MPF) is separate — applied only for USMCA / CAFTA-DR preferential claims.`,
        source_ref: "CSMS #69326983 — Note 52 economy exemption",
        basis_amount: entered,
        rate_pct: 0,
      }),
    );
    suppressed.push({
      ...layer({
        slot: "3.2",
        program: "SEC_301_FL",
        ch99: fl.heading,
        label: `${fl.label} (not claimed)`,
        reason: `Superseded by ${matched.label} claim (${matched.heading}). Would otherwise assess $${wouldDuty.toFixed(2)}. ${fl.reason}`,
        source_ref: "CSMS #69326983",
        basis_amount: entered,
        rate_pct: wouldRate,
      }),
      reason: `Not applied — ${matched.label} claim (${matched.heading}). Would otherwise assess $${wouldDuty.toFixed(2)}.`,
    });
    diagnostics.push({
      severity: "INFO",
      code: "FTA_CLAIM_APPLIED",
      message: `${matched.label} Note 52 exemption for ${coo}: 301-FL reports ${matched.heading} @ 0% instead of ${fl.heading} ($${wouldDuty.toFixed(2)} avoided).`,
      remediation:
        "SPI S/S+ (or CAFTA SPI) separately zeros Column-1 and MPF. Other programs still need their own USMCA/FTA Chapter 99 exception.",
    });

    if (matched.claim_id === "CAFTA_DR") {
      const digits = String(line?.hts || "").replace(/\D/g, "");
      const ch = Number(digits.slice(0, 2));
      if (!(ch >= 50 && ch <= 63)) {
        diagnostics.push({
          severity: "WARNING",
          code: "CAFTA_TEXTILE_SCOPE",
          message: `CAFTA-DR exemption ${matched.heading} is scoped to textiles/apparel (Note 52(i)). This HTS chapter ${Number.isFinite(ch) ? ch : "?"} may not qualify — confirm product scope before filing.`,
        });
      }
    }
    if (pharmaClaim && pharmaHit) {
      diagnostics.push({
        severity: "INFO",
        code: "FL_PHARMA_SUPERSEDED",
        message: `Pharmaceutical-use claim (${pharmaHit.heading}) is available for this HTS, but ${matched.label} (${matched.heading}) already clears 301-FL. Pharma claim is not needed on this path.`,
      });
    }
    return;
  }

  const flExcept = matchFlExcept({
    hts: line?.hts || "",
    coo,
    flags,
  });
  if (flExcept) {
    layers.push(
      layer({
        slot: "3.2",
        program: "SEC_301_FL",
        ch99: flExcept.heading,
        label: `301-FL exempt — ${flExcept.basis}`,
        reason: `${flExcept.basis}. HTS matches imported exception list (stem ${flExcept.matched_stem}).`,
        source_ref: "CSMS #69326983 — Forced Labor HTS exception list",
        basis_amount: entered,
        rate_pct: 0,
      }),
    );
    suppressed.push({
      ...layer({
        slot: "3.2",
        program: "SEC_301_FL",
        ch99: fl.heading,
        label: `${fl.label} (HTS except)`,
        reason: `Superseded by ${flExcept.heading} (${flExcept.basis}). Would otherwise assess $${wouldDuty.toFixed(2)}.`,
        source_ref: "CSMS #69326983",
        basis_amount: entered,
        rate_pct: wouldRate,
      }),
      reason: `Not applied — ${flExcept.heading} HTS exception. Would otherwise assess $${wouldDuty.toFixed(2)}.`,
    });
    diagnostics.push({
      severity: "INFO",
      code: "FL_HTS_EXCEPT_APPLIED",
      message: `301-FL reports ${flExcept.heading} @ 0% for this HTS (${flExcept.basis}) instead of ${fl.heading}.`,
    });
    return;
  }

  // Note 52(e) pharmaceutical applications — claim-gated; does NOT zero Col-1 / MPF (R10).
  // Replaces 301-FL EU combined-to-cap (9903.05.38/.39) and other FL headings.
  if (pharmaClaim) {
    const heading = pharmaHit?.heading || flPharmaMeta().heading;
    const digits = String(line?.hts || "").replace(/\D/g, "");
    const ch = Number(digits.slice(0, 2));
    const allowClaim = Boolean(pharmaHit) || ch === 29 || ch === 30;
    if (!allowClaim) {
      diagnostics.push({
        severity: "WARNING",
        code: "FL_PHARMA_OFF_LIST",
        message: `Pharmaceutical-use claim asserted, but this HTS is not on the seeded Note 52(e) list for ${heading}. Confirm Forced Labor HTS List membership before filing; 301-FL still assessed.`,
        remediation: "Clear the Pharma use claim, or confirm the HTS appears under U.S. Note 52(e) on the CBP Forced Labor HTS List.",
      });
    } else {
      const copy = pharmaVsFlCopy(fl, money2(col1 * 100), wouldDuty, heading);
      if (ftaTrack) {
        ftaTrack.pharma_applied = true;
        ftaTrack.pharma_heading = heading;
        ftaTrack.fl_kind = fl.kind;
        ftaTrack.fl_cap_pct = "cap_pct" in fl ? fl.cap_pct : null;
      }
      layers.push(
        layer({
          slot: "3.2",
          program: "SEC_301_FL",
          ch99: heading,
          label: "301-FL exempt — pharmaceutical applications",
          reason: `${pharmaHit?.basis || flPharmaMeta().basis}. ${copy.layerReason}`,
          source_ref: "CSMS #69326983 — U.S. Note 52(e)",
          basis_amount: entered,
          rate_pct: 0,
        }),
      );
      suppressed.push({
        ...layer({
          slot: "3.2",
          program: "SEC_301_FL",
          ch99: fl.heading,
          label: `${fl.label} (pharma exempt)`,
          reason: copy.suppressed,
          source_ref: "CSMS #69326983",
          basis_amount: entered,
          rate_pct: wouldRate,
        }),
        reason: copy.suppressed,
      });
      if (!pharmaHit) {
        diagnostics.push({
          severity: "WARNING",
          code: "FL_PHARMA_OFF_LIST_APPLIED",
          message: `Note 52(e) list seed does not yet include this HTS. Pharma use is claimed, so ${heading} @ 0% is reported instead of ${fl.heading}. Confirm membership on the CBP Forced Labor HTS List before filing.`,
        });
      }
      diagnostics.push({
        severity: "INFO",
        code: "FL_PHARMA_APPLIED",
        message: copy.diagnostic,
        remediation:
          "Actual use must be pharmaceutical. This does not suppress Column-1 or MPF — only USMCA/CAFTA SPI does that (R10). Do not also claim 232 patented pharma (9903.04.62 EU 15%) unless that program applies.",
      });
      return;
    }
  } else if (pharmaHit) {
    diagnostics.push({
      severity: "INFO",
      code: "FL_PHARMA_AVAILABLE",
      message: `This HTS matches the Note 52(e) pharmaceutical-use list (stem ${pharmaHit.matched_stem}). If actual use is pharmaceutical, claim Pharma use to report ${pharmaHit.heading} @ 0% instead of ${fl.heading}.`,
      remediation: "Check Pharma use on Quick Check, or set flags.s301fl_pharma. Prefer USMCA when originating under USMCA (zeros Col-1 + MPF + FL).",
    });
  }

  if (available && !matched) {
    const spiNote =
      available.claim_id === "USMCA" || available.claim_id === "CAFTA_DR"
        ? ` Claiming ${available.label} also zeros Column-1 and MPF (R10); other programs still need their own Ch.99 exception.`
        : ` This Note 52 claim only clears 301-FL — it does not zero Column-1 or MPF.`;
    diagnostics.push({
      severity: "INFO",
      code: "FTA_CLAIM_AVAILABLE",
      message: `${available.label} may exempt 301-FL for ${coo} via ${available.heading} (${available.basis}). Check the FTA claim box (or set flags.fta_usmca / fta_cafta_dr / fta_note_52) if the goods qualify.${spiNote}`,
      remediation: `Re-run with fta_claim=${available.claim_id} to compare duties with and without the preference.`,
    });
  }

  const rate = wouldRate;
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
  const enteredTotal = money2(
    lines.reduce((a, l) => a + (Number(l.entered_value) || 0), 0),
  );
  const mpfExemptValue = money2(
    lines.reduce((a, l) => {
      if (l.mpf_exempt || l.spi_preference) {
        return a + (Number(l.entered_value) || 0);
      }
      return a;
    }, 0),
  );
  const feePack = computeEntryFees({
    entered_value_total: enteredTotal,
    formal_entry: body.formal_entry !== false,
    mode_of_transport: body.mode_of_transport,
    mpf_exempt_value: mpfExemptValue,
  });
  const landed = money2(enteredTotal + duty + feePack.total);
  return {
    entry_number: body.entry_number || null,
    jurisdiction: "US",
    rulepack: rulepackPublic(),
    mode_of_transport: feePack.mode_of_transport,
    hmf_applies: feePack.hmf_applies,
    lines,
    totals: {
      duty,
      fees: feePack.total,
      entered_value: enteredTotal,
      landed_cost: landed,
      effective_duty_rate_pct:
        enteredTotal > 0 && duty > 0
          ? money2((duty / enteredTotal) * 100)
          : lines.some((l) => l.blocked || l.totals?.effective_duty_rate_pct == null)
            ? null
            : 0,
    },
    entry_fees: feePack.fees,
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

  /** Entry Summary Number from ES-003 line_id `ENTRY:ESL`, else each line is its own entry. */
  const entryKeyFor = (lineId: string, index: number) => {
    const id = String(lineId || "");
    const i = id.indexOf(":");
    if (i > 0) return id.slice(0, i);
    return id || String(index + 1);
  };

  // Sec 122 is an entry-level surcharge — filing 9903.03.01 on any ESL satisfies the entry.
  const filedByEntry = new Map<string, Set<string>>();
  (body.lines || []).forEach((raw, i) => {
    const key = entryKeyFor(raw.line_id || String(i + 1), i);
    if (!filedByEntry.has(key)) filedByEntry.set(key, new Set());
    const set = filedByEntry.get(key)!;
    for (const c of raw.filed_ch99 || []) set.add(normalizeCh99(c));
  });

  (body.lines || []).forEach((raw, i) => {
    const L = assessed.lines[i];
    if (!L) return;
    const entryKey = entryKeyFor(L.line_id, i);
    const entryFiled = filedByEntry.get(entryKey) || new Set();
    const filed = new Set((raw.filed_ch99 || []).map(normalizeCh99));
    const computed = new Set(L.ch99_sequence);
    for (const c of computed) {
      if (filed.has(c) || getCh99(c)?.kind !== "DUTY") continue;
      // Global Sec 122: already on another ESL of this entry → not missing.
      if (c === SEC_122_CH99 && entryFiled.has(SEC_122_CH99)) continue;
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
    // Prefer Entry Date (rate date) for era checks (IEEPA → Sec 122 → 301-FL).
    const rateDay = String(
      (L as { rate_determination_date?: string }).rate_determination_date ||
        raw.entry_date ||
        raw.release_date ||
        "",
    ).slice(0, 10);
    const metals = resolve232Metals({
      hts: String(L.hts || raw.hts || ""),
      filed_ch99: [...filed],
      flags: raw.flags || {},
    });
    for (const c of filed) {
      if (c.startsWith("9903.01.") || c.startsWith("9903.02.")) {
        const inWindow =
          Boolean(rateDay) && rateDay >= "2025-02-04" && rateDay <= "2026-02-23";
        if (inWindow) {
          findings.push({
            severity: "INFO",
            category: "IEEPA_REFUND_CANDIDATE",
            line_id: L.line_id,
            message: `Filed ${c} (IEEPA) on ${rateDay} — within CAPE window (2025-02-04–2026-02-23). Not a live forward program; evaluate refund.`,
            remediation:
              "Review CAPE / PSC eligibility with the broker. Do not refile 9903.01.xx prospectively after 2026-02-23.",
            duty_impact: 0,
          });
          continue;
        }
      }

      const wrong = rateDay ? wrongEraFiledCode(c, rateDay) : null;
      if (wrong) {
        findings.push({
          severity: wrong.severity,
          category: wrong.category === "WRONG_ERA" ? "WRONG_ERA" : wrong.category,
          line_id: L.line_id,
          message: wrong.message,
          remediation: wrong.remediation,
          duty_impact: 0,
        });
        continue;
      }

      if (computed.has(c) || L.suppressed.some((s) => s.ch99 === c)) continue;

      // Article-path metals (82.02) need content — ES-003 cannot supply it.
      if (
        metals &&
        metals.basis === "METAL_CONTENT_VALUE" &&
        (c.startsWith("9903.82.") || c === "9903.03.06" || c === "9903.03.03")
      ) {
        findings.push({
          severity: "INFO",
          category: "NEEDS_INPUTS",
          line_id: L.line_id,
          message: `Filed ${c} on metals HTS ${L.hts} — Section 232 article path needs metal-content value + melt/pour to confirm (not on ES-003).`,
          remediation: "Open in Quick Check with metal content to validate 9903.82.02 / exclusions.",
          duty_impact: 0,
        });
        continue;
      }

      findings.push({
        severity: "WARNING",
        category: "EXTRA_CH99",
        line_id: L.line_id,
        message: `Filed Chapter 99 ${c} was not produced by the pack for ${rateDay || "this rate date"} (${filingEraLabel(filingEra(rateDay))}).`,
        remediation: "Confirm the claim flags and annex determinations, or remove the code.",
        duty_impact: 0,
      });
    }
  });

  const net = money2(findings.reduce((a, f) => a + (f.duty_impact || 0), 0));
  return {
    ...assessed,
    findings,
    summary: { net_duty_impact: net, finding_count: findings.length },
  };
}
