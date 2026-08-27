/**
 * Section 338 additional duties on certain goods of Canada.
 * CSMS #69606660 / Proclamations 11046–11048, 11056 / U.S. note 51.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileStems, matchStem } from "./s232Stems.ts";
import { classifyChapter98 } from "./ch98Basis.ts";

export const S338_DUTY_HEADINGS = ["9903.03.12", "9903.03.13", "9903.03.14"] as const;
export const S338_EXCLUSION_15 = "9903.03.15";
export const S338_EXCLUSION_16 = "9903.03.16";
export const S338_PROGRAM = "SECTION_338_CANADA";

/** CATAIR Appendix B Canadian province X-codes → product of Canada. */
export const CA_PROVINCE_X_CODES = new Set([
  "XA", "XB", "XC", "XM", "XN", "XO", "XP", "XQ", "XS", "XT", "XV", "XW", "XY",
]);

type Pack = {
  program: {
    id: string;
    name: string;
    authority: string;
    source_csms: string;
    source_url: string;
    drawback_eligible: boolean;
    knowledge_time: string;
  };
  headings: Record<string, { rate_pct: number; kind: string; note: string }>;
  dates: {
    original_effective: string;
    reinstatement: string;
    reinstatement_timezone_string: string;
    suspension_start: string;
    suspension_end: string;
  };
  lists: Record<string, string[]>;
  exclusion_headings_note51c: string[];
  canadian_province_x_codes: string[];
  chapter_98: {
    repair_provisions: string[];
    assembly_provision: string;
    csms_typo_note: string;
  };
  ftz: { privileged_foreign_required: boolean; cfr: string; domestic_status_exception: string };
  governance: Record<string, unknown>;
  sources: string[];
};

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../data/s338_canada.json");

let pack: Pack | null = null;
let stems12: string[] = [];
let stems13: string[] = [];
let stems14: string[] = [];
let stems16: string[] = [];
let exclusionSet = new Set<string>();

function load(): Pack {
  if (pack) return pack;
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  stems12 = compileStems(pack.lists["9903.03.12"] || []);
  stems13 = compileStems(pack.lists["9903.03.13"] || []);
  stems14 = compileStems(pack.lists["9903.03.14"] || []);
  stems16 = compileStems(pack.lists["9903.03.16"] || []);
  exclusionSet = new Set(pack.exclusion_headings_note51c || []);
  return pack;
}

export function reloadS338Canada(): Pack {
  pack = null;
  return load();
}

export function s338Meta() {
  const p = load();
  return {
    id: p.program.id,
    name: p.program.name,
    source_csms: p.program.source_csms,
    source_url: p.program.source_url,
    drawback_eligible: p.program.drawback_eligible,
    knowledge_time: p.program.knowledge_time,
    original_effective: p.dates.original_effective,
    reinstatement: p.dates.reinstatement,
    reinstatement_timezone: p.dates.reinstatement_timezone_string,
    list_counts: {
      "9903.03.12": (p.lists["9903.03.12"] || []).length,
      "9903.03.13": (p.lists["9903.03.13"] || []).length,
      "9903.03.14": (p.lists["9903.03.14"] || []).length,
      "9903.03.16": (p.lists["9903.03.16"] || []).length,
    },
    governance: p.governance,
    sources: p.sources,
  };
}

export function s338DrawbackEligible(): boolean {
  return load().program.drawback_eligible === true;
}

export function isS338DutyHeading(code: string): boolean {
  return (S338_DUTY_HEADINGS as readonly string[]).includes(String(code || "").trim());
}

export function isS338Heading(code: string): boolean {
  const c = String(code || "").trim();
  return isS338DutyHeading(c) || c === S338_EXCLUSION_15 || c === S338_EXCLUSION_16;
}

export function isNote51cExclusionHeading(code: string): boolean {
  load();
  return exclusionSet.has(String(code || "").trim());
}

export function normalizeCanadaCoo(raw: string): { coo: string; normalized_from: string | null } {
  const iso = String(raw || "").trim().toUpperCase();
  if (!iso) return { coo: "", normalized_from: null };
  load();
  if (iso === "CA") return { coo: "CA", normalized_from: null };
  if (CA_PROVINCE_X_CODES.has(iso)) return { coo: "CA", normalized_from: iso };
  return { coo: iso, normalized_from: null };
}

export function matchS338DutyList(hts: string): { heading: "9903.03.12" | "9903.03.13" | "9903.03.14"; matched_stem: string } | null {
  load();
  const a = matchStem(hts, stems12);
  if (a) return { heading: "9903.03.12", matched_stem: a.matched_stem };
  const b = matchStem(hts, stems13);
  if (b) return { heading: "9903.03.13", matched_stem: b.matched_stem };
  const c = matchStem(hts, stems14);
  if (c) return { heading: "9903.03.14", matched_stem: c.matched_stem };
  return null;
}

export function previewS338(hts: string): {
  duty: { heading: string; matched_stem: string } | null;
  aircraft: { heading: "9903.03.16"; matched_stem: string } | null;
} {
  const duty = matchS338DutyList(hts);
  const air = matchS338AircraftList(hts);
  return {
    duty: duty ? { heading: duty.heading, matched_stem: duty.matched_stem } : null,
    aircraft: air ? { heading: "9903.03.16", matched_stem: air.matched_stem } : null,
  };
}

export function matchS338AircraftList(hts: string): { matched_stem: string } | null {
  load();
  const hit = matchStem(hts, stems16);
  return hit ? { matched_stem: hit.matched_stem } : null;
}

/**
 * CSMS reinstatement is 12:01 a.m. eastern standard time on 2026-08-22.
 * Date-only values use the calendar day. Datetimes before 00:01 EST do not apply.
 */
export function s338AppliesOn(rateDay: string | null | undefined): boolean {
  const raw = String(rateDay || "").trim();
  if (!raw) return false;
  const day = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  if (day < "2026-08-22") return false;
  if (day > "2026-08-22") return true;
  const instant = parseRateInstant(raw);
  if (instant == null) return true; // date-only 2026-08-22
  const cutoff = Date.parse("2026-08-22T00:01:00-05:00");
  return instant >= cutoff;
}

export function s338SuspendedOn(rateDay: string | null | undefined): boolean {
  const day = String(rateDay || "").slice(0, 10);
  return day >= "2026-08-19" && day <= "2026-08-21";
}

function parseRateInstant(raw: string): number | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const iso = Date.parse(s);
  if (Number.isFinite(iso)) return iso;
  const m = s.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(EST|EDT|ET)?$/i,
  );
  if (!m) return null;
  const tz = (m[5] || "ET").toUpperCase();
  const offset = tz === "EDT" ? "-04:00" : "-05:00";
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4] || "00"}${offset}`);
  return Number.isFinite(t) ? t : null;
}

import { classifyChapter98 } from "./ch98Basis.ts";

export type S338Ch98 =
  | { kind: "exempt" }
  | { kind: "repair"; provision: string }
  | { kind: "assembly"; provision: string }
  | { kind: "subchapter_xxiii"; provision: string }
  | { kind: "none" };

/** Map shared Chapter 98 classifier → Section 338 outcomes (general 98xx = exempt). */
export function classifyS338Chapter98(provision: string | null | undefined): S338Ch98 {
  const cls = classifyChapter98(provision);
  if (cls.kind === "none") return { kind: "none" };
  if (cls.kind === "suppress") return { kind: "exempt" };
  if (cls.kind === "repair") return { kind: "repair", provision: cls.provision };
  if (cls.kind === "assembly") return { kind: "assembly", provision: cls.provision };
  return { kind: "subchapter_xxiii", provision: cls.provision };
}

export type S338Assessment = {
  heading: string;
  rate_pct_decimal: number;
  label: string;
  reason: string;
  exempt: boolean;
  drawback_eligible: true;
  matched_stem: string | null;
  basis: "ENTERED_VALUE" | "REPAIR_VALUE" | "ASSEMBLY_LESS_US_CONTENT";
  coo_normalized_from: string | null;
};

export function assessS338Canada(opts: {
  hts: string;
  coo: string;
  rateDay?: string | null;
  flags?: Record<string, boolean> | null;
  attracted_ch99?: string[];
  ch98_provision?: string | null;
}): S338Assessment | null {
  const p = load();
  const { coo, normalized_from } = normalizeCanadaCoo(opts.coo);
  if (coo !== "CA") return null;

  if (!s338AppliesOn(opts.rateDay)) {
    return null;
  }

  const ch98 = classifyS338Chapter98(opts.ch98_provision);
  if (ch98.kind === "exempt") return null;

  const gn6 = Boolean(opts.flags?.civil_aircraft_gn6);
  const dutyHit = matchS338DutyList(opts.hts);
  const airHit = matchS338AircraftList(opts.hts);
  const attracted = new Set((opts.attracted_ch99 || []).map((c) => String(c || "").trim()));
  const note51c = [...attracted].find((c) => exclusionSet.has(c));

  let heading: string | null = null;
  let stem: string | null = null;
  let exempt = false;
  let reason = "";
  let label = "";

  if (dutyHit && note51c) {
    heading = S338_EXCLUSION_15;
    stem = dutyHit.matched_stem;
    exempt = true;
    label = "Section 338 Canada — excluded (Note 51(c) / 232 family)";
    reason = `${S338_EXCLUSION_15}: product of Canada on Note 51(b) list (stem ${dutyHit.matched_stem}) but already attracts ${note51c}. Report 0% additional (CSMS #69606660).`;
  } else if (airHit && gn6) {
    heading = S338_EXCLUSION_16;
    stem = airHit.matched_stem;
    exempt = true;
    label = "Section 338 Canada — civil aircraft exclusion (Note 51(d))";
    reason = `${S338_EXCLUSION_16}: civil aircraft article under General Note 6 (stem ${airHit.matched_stem}) — 0% additional regardless of Free (C) SPI (CSMS #69606660).`;
  } else if (dutyHit) {
    heading = dutyHit.heading;
    stem = dutyHit.matched_stem;
    exempt = false;
    const meta = p.headings[dutyHit.heading];
    label = `Section 338 Canada — ${meta.note}`;
    reason = `${dutyHit.heading}: product of Canada, Note 51 list stem ${dutyHit.matched_stem} — additional 50% ad valorem (CSMS #69606660 / ${meta.note}). USMCA / SPI does not exempt this duty.`;
  } else {
    return null;
  }

  let basis: S338Assessment["basis"] = "ENTERED_VALUE";
  if (ch98.kind === "repair") {
    basis = "REPAIR_VALUE";
    reason += ` Chapter 98 ${ch98.provision}: additional duty applies to the value of repairs, alterations, or processing only.`;
  } else if (ch98.kind === "assembly") {
    basis = "ASSEMBLY_LESS_US_CONTENT";
    reason += ` Chapter 98 ${ch98.provision}: additional duty applies to assembled-abroad value less US-content cost/value.`;
  }

  if (normalized_from) {
    reason += ` COO ${normalized_from} normalized to CA (CATAIR Canadian province X-code).`;
  }

  const rate = exempt ? 0 : (p.headings[heading]!.rate_pct || 0) / 100;
  return {
    heading,
    rate_pct_decimal: rate,
    label,
    reason,
    exempt,
    drawback_eligible: true,
    matched_stem: stem,
    basis,
    coo_normalized_from: normalized_from,
  };
}

export function s338FtzWarning(opts: { flags?: Record<string, boolean> | null; ftz?: boolean }): string | null {
  const p = load();
  if (!(opts.ftz || opts.flags?.ftz_admission || opts.flags?.ftz)) return null;
  return `FTZ: merchandise subject to Section 338 additional duty must be admitted in privileged foreign status (${p.ftz.cfr}), except domestic-status-eligible goods (${p.ftz.domestic_status_exception}). Duty rate locks at admission classification.`;
}

export function assertNoS338DutyWithNote51c(ch99s: string[]): string | null {
  const duty = ch99s.filter(isS338DutyHeading);
  const excl = ch99s.filter(isNote51cExclusionHeading);
  if (duty.length && excl.length) {
    return `Invariant: ${duty.join(", ")} cannot report with Note 51(c) headings ${excl.join(", ")}.`;
  }
  return null;
}
