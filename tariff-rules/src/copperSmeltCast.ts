/**
 * ACE filing compliance — copper primary smelt / cast country on entry summary lines.
 * CSMS #69711865 (effective 2026-09-14) / #69252300 / #69247555.
 * Fatal ACE F794 when 54 record type 12 is missing on listed HTS (non-US origin).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileStems, matchStem, onOrAfter } from "./s232Stems.ts";

export type CopperSmeltCastFields = {
  primary_smelt?: string | null;
  secondary_smelt?: string | null;
  cast?: string | null;
};

export type CopperSmeltCastHit = {
  program: "COPPER_SMELT_CAST_FILING";
  effective: string;
  matched_stem: string;
  matched_stem_display: string;
  ace_record_type: string;
  ace_error_fatal: string;
  ace_error_message: string;
  source_csms: string;
  /** True when HTS + date require reporting (non-US COO). */
  required: boolean;
  /** US origin — no smelt/cast reporting on the line. */
  exempt: boolean;
  reason: string;
};

export type CopperSmeltCastValidation = {
  hit: CopperSmeltCastHit | null;
  fields: CopperSmeltCastFields;
  missing: Array<"primary_smelt" | "cast">;
  complete: boolean;
};

type Pack = {
  program: {
    id: string;
    name: string;
    source_csms: string;
    source_csms_amended?: string[];
    effective: string;
    ace_record_type: string;
    ace_error_fatal: string;
    ace_error_message: string;
  };
  exempt_coo: string[];
  allow_unknown: string;
  required_fields: string[];
  optional_fields: string[];
  hts_list: string[];
};

const DATA = join(
  dirname(fileURLToPath(import.meta.url)),
  "../data/copper_smelt_cast.json",
);

let pack: Pack | null = null;
let stems: string[] = [];
const exemptCoo = new Set<string>();

function load(): Pack {
  if (pack) return pack;
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  stems = compileStems(pack.hts_list || []);
  exemptCoo.clear();
  for (const c of pack.exempt_coo || []) exemptCoo.add(String(c).toUpperCase());
  return pack;
}

export function reloadCopperSmeltCast(): Pack {
  pack = null;
  return load();
}

export function copperSmeltCastMeta() {
  const p = load();
  return {
    id: p.program.id,
    name: p.program.name,
    effective: p.program.effective,
    source_csms: p.program.source_csms,
    ace_record_type: p.program.ace_record_type,
    ace_error_fatal: p.program.ace_error_fatal,
    hts_count: p.hts_list.length,
  };
}

function formatStemDisplay(stem: string): string {
  const d = String(stem).replace(/\D/g, "");
  if (d.length < 8) return d;
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;
}

/** Normalize smelt/cast country — ISO-2 or OTH when unknown. */
export function normalizeCopperCountry(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^(oth(er)?)$/i.test(s)) return "OTH";
  const upper = s.toUpperCase();
  if (upper === "OTH") return "OTH";
  const code = upper.match(/^([A-Z]{2})\b/);
  if (code) return code[1];
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return upper.slice(0, 2);
}

function hitFor(
  matched_stem: string,
  opts: { coo: string; date: string; required: boolean; exempt: boolean },
): CopperSmeltCastHit {
  const p = load();
  const reason = opts.exempt
    ? "U.S. origin — copper smelt/cast ACE 54-12 not required on this line."
    : opts.required
      ? `Listed copper conductor HTS (${formatStemDisplay(matched_stem)}+) requires primary country of smelt and country of cast on the entry summary line (ACE 54 record type 12). Missing data → fatal ${p.program.ace_error_fatal}.`
      : `Copper smelt/cast reporting applies from ${p.program.effective}; rate/entry date ${opts.date} is before enforcement.`;
  return {
    program: "COPPER_SMELT_CAST_FILING",
    effective: p.program.effective,
    matched_stem,
    matched_stem_display: formatStemDisplay(matched_stem),
    ace_record_type: p.program.ace_record_type,
    ace_error_fatal: p.program.ace_error_fatal,
    ace_error_message: p.program.ace_error_message,
    source_csms: p.program.source_csms,
    required: opts.required,
    exempt: opts.exempt,
    reason,
  };
}

/** Whether HTS is on the copper smelt/cast list (stem match). */
export function matchCopperSmeltCastHts(hts: string): { matched_stem: string } | null {
  load();
  const m = matchStem(hts, stems);
  if (!m) return null;
  return { matched_stem: m.matched_stem };
}

/** Preview for /v1/hts and coverage — no field validation. */
export function previewCopperSmeltCast(
  hts: string,
  coo: string,
  date: string,
): CopperSmeltCastHit | null {
  const stemHit = matchCopperSmeltCastHts(hts);
  if (!stemHit) return null;
  const cooNorm = String(coo || "").trim().toUpperCase();
  const exempt = Boolean(cooNorm && exemptCoo.has(cooNorm));
  const p = load();
  const required = !exempt && onOrAfter(date, p.program.effective);
  return hitFor(stemHit.matched_stem, { coo: cooNorm, date, required, exempt });
}

export function validateCopperSmeltCast(opts: {
  hts: string;
  coo: string;
  date: string;
  primary_smelt?: string | null;
  secondary_smelt?: string | null;
  cast?: string | null;
}): CopperSmeltCastValidation {
  const hit = previewCopperSmeltCast(opts.hts, opts.coo, opts.date);
  const fields: CopperSmeltCastFields = {
    primary_smelt: normalizeCopperCountry(opts.primary_smelt) || null,
    secondary_smelt: normalizeCopperCountry(opts.secondary_smelt) || null,
    cast: normalizeCopperCountry(opts.cast) || null,
  };
  if (!hit?.required) {
    return { hit, fields, missing: [], complete: true };
  }
  const missing: CopperSmeltCastValidation["missing"] = [];
  if (!fields.primary_smelt) missing.push("primary_smelt");
  if (!fields.cast) missing.push("cast");
  return {
    hit,
    fields,
    missing,
    complete: missing.length === 0,
  };
}
