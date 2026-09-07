/**
 * Section 232 unmanned aircraft systems — Proclamation 11055 / U.S. note 43 /
 * CSMS #69738151. Effective 2026-09-03. Suppresses 301-FL (R1).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileStems, matchStem, onOrAfter } from "./s232Stems.ts";

export const S232_UAS_100 = "9903.08.21";
export const S232_UAS_25 = "9903.08.22";
export const S232_UAS_UK = "9903.08.23";
export const S232_UAS_PARTNER = "9903.08.24";
export const S232_UAS_NOT_FOR_USE = "9903.08.20";
export const S232_UAS_START = "2026-09-03";
export const S232_UAS_ANNEX_III = "2027-02-09";

type Pack = {
  program: {
    id: string;
    name: string;
    effective: string;
    annex_iii_effective: string;
    duty_100: string;
    duty_25: string;
    uk_cap: string;
    partner_cap: string;
    not_for_use: string;
  };
  lists: Record<string, string[]>;
  docking_claim_only: string[];
  partner_iso2_15: string[];
  partner_iso2_10: string[];
  sources: string[];
};

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../data/s232_uas.json");

let pack: Pack | null = null;
let stems100: string[] = [];
let stems25: string[] = [];
let stemsDock: string[] = [];
let stems8807: string[] = [];
let partner15 = new Set<string>();
let partner10 = new Set<string>();

function load(): Pack {
  if (pack) return pack;
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  const auto100 = pack.lists.annex_i_100.filter(
    (h) => !pack!.docking_claim_only.includes(h),
  );
  stems100 = compileStems(auto100);
  stems25 = compileStems(pack.lists.annex_ii_25);
  stemsDock = compileStems(pack.docking_claim_only);
  stems8807 = compileStems(pack.lists.heavy_parts_8807);
  partner15 = new Set(pack.partner_iso2_15);
  partner10 = new Set(pack.partner_iso2_10);
  return pack;
}

export function reloadS232Uas(): Pack {
  pack = null;
  return load();
}

export function s232UasMeta() {
  const p = load();
  return {
    id: p.program.id,
    name: p.program.name,
    effective: p.program.effective,
    annex_iii_effective: p.program.annex_iii_effective,
    sources: p.sources,
  };
}

export function s232UasAppliesOn(rateDay: string | null | undefined): boolean {
  return onOrAfter(rateDay, S232_UAS_START);
}

export function isS232UasHeading(code: string): boolean {
  return /^9903\.08\.2[0-6]$/.test(String(code || "").trim());
}

function flag(flags: Record<string, boolean> | null | undefined, ...keys: string[]): boolean {
  const f = flags || {};
  return keys.some((k) => Boolean(f[k]));
}

function prettyStem(stem: string): string {
  const d = String(stem || "").replace(/\D/g, "");
  if (d.length >= 10) return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 10)}`;
  if (d.length >= 6) return `${d.slice(0, 4)}.${d.slice(4, 6)}${d.length > 6 ? "." + d.slice(6) : ""}`;
  return stem;
}

export function s232UasPartnerCapFor(coo: string): {
  heading: string;
  cap_pct: number;
  iso2: string;
} | null {
  load();
  const iso2 = String(coo || "").trim().toUpperCase();
  if (!iso2) return null;
  if (partner10.has(iso2)) return { heading: S232_UAS_UK, cap_pct: 10, iso2 };
  if (partner15.has(iso2)) return { heading: S232_UAS_PARTNER, cap_pct: 15, iso2 };
  return null;
}

/** CBP has published the heading but told filers not to report it yet. */
export function s232UasPartnerCapMessage(coo: string): string | null {
  const cap = s232UasPartnerCapFor(coo);
  if (!cap) return null;
  return (
    `${cap.iso2} origin can eventually use ${cap.heading} for a ${cap.cap_pct}% combined ` +
    `Column-1 + Section 232 rate on qualifying UAS goods (Proclamation 11055 clause 4 / U.S. note 43(d)). ` +
    `That is not automatic: Commerce must first certify that substantially all critical components ` +
    `and technology are from the United States or listed partners. CBP CSMS #69738151 currently ` +
    `says do not report ${cap.heading} until further guidance — do not file it on this entry.`
  );
}

export function previewS232Uas(hts: string): {
  annex_i: { matched_stem: string } | null;
  annex_ii: { matched_stem: string } | null;
  docking: { matched_stem: string } | null;
  parts_8807: { matched_stem: string } | null;
} {
  load();
  return {
    annex_i: matchStem(hts, stems100),
    annex_ii: matchStem(hts, stems25),
    docking: matchStem(hts, stemsDock),
    parts_8807: matchStem(hts, stems8807),
  };
}

export type S232UasHit = {
  heading: string;
  rate_pct_decimal: number;
  label: string;
  reason: string;
  matched_stem: string;
  suppresses_301fl: boolean;
  needs_claim?: boolean;
};

/**
 * Auto: large UAS 8806.24/.29/.94/.99 → 100%; small UAS 8806.21–.23/.91–.93 → 25%.
 * Thermal on the small-UAS stems upgrades to 100% when claimed.
 * Docking 8504.40.9580 / 8537.10.9170 and 8807 parts are claim-gated.
 * From 2027-02-09, claim flags.s232_uas_annex_ii for 8807 parts in note 43(c)(5)
 * to assess 9903.08.22 @ 25%.
 * Partner 10/15% caps are claim-gated (critical-component certification).
 */
export function assessS232Uas(opts: {
  hts: string;
  coo: string;
  rateDay?: string | null;
  flags?: Record<string, boolean> | null;
}): S232UasHit | { preview_only: true; reason: string } | null {
  load();
  const flags = opts.flags || {};
  const day = opts.rateDay;
  const hit100 = matchStem(opts.hts, stems100);
  const hit25 = matchStem(opts.hts, stems25);
  const hitDock = matchStem(opts.hts, stemsDock);
  const hit8807 = matchStem(opts.hts, stems8807);

  if (!hit100 && !hit25 && !hitDock && !hit8807) return null;

  if (!s232UasAppliesOn(day)) {
    return {
      preview_only: true,
      reason: `Section 232 UAS duties start on ${S232_UAS_START}. This rate date is before that, so no UAS heading is applied.`,
    };
  }

  if (flag(flags, "s232_uas_not_for_use", "s232_uas_exclusion")) {
    return {
      heading: S232_UAS_NOT_FOR_USE,
      rate_pct_decimal: 0,
      label: "Section 232 UAS — not for UAS use (9903.08.20)",
      reason:
        `Claimed not for UAS use: ${prettyStem((hit100 || hit25 || hitDock || hit8807)!.matched_stem)} is on a UAS list but is not for use in or with covered unmanned aircraft. ` +
        `Files 9903.08.20 @ 0% additional (CSMS #69738151). Section 301-FL is not turned off by this heading.`,
      matched_stem: (hit100 || hit25 || hitDock || hit8807)!.matched_stem,
      suppresses_301fl: false,
    };
  }

  if (hitDock && !flag(flags, "s232_uas_docking", "s232_uas_annex_i")) {
    return {
      preview_only: true,
      reason:
        `${prettyStem(hitDock.matched_stem)} is on CBP’s unmanned-aircraft docking list, but the same HTS is also used for ordinary boards and panels. ` +
        `Tick “232 UAS docking” only if this article is a UAS docking station or a part for one — that assesses 100% additional duty (9903.08.21). ` +
        `Leave it off if this is not UAS docking equipment.`,
    };
  }

  const heavy8807 = flag(flags, "s232_uas_part", "s232_uas_annex_i", "s232_uas_heavy_part");
  const annexIii8807 = flag(flags, "s232_uas_annex_ii");

  if (hit8807 && !heavy8807 && !(annexIii8807 && onOrAfter(day, S232_UAS_ANNEX_III))) {
    const annexIii = onOrAfter(day, S232_UAS_ANNEX_III);
    return {
      preview_only: true,
      reason: annexIii
        ? `${prettyStem(hit8807.matched_stem)} is on the UAS parts lists. Claim it as a UAS part for 100% additional duty (9903.08.21), or tick “232 UAS Annex III parts” for 25% (9903.08.22).`
        : `${prettyStem(hit8807.matched_stem)} is on the heavy UAS parts list (>25 kg, except retail / agricultural / Department of War). Claim it as a UAS part to assess 100% additional duty (9903.08.21). A 25% Annex III path starts ${S232_UAS_ANNEX_III}.`,
    };
  }

  const thermal = flag(flags, "s232_uas_thermal");
  let heading = S232_UAS_25;
  let rate = 25;
  let stem = hit25?.matched_stem || hit100?.matched_stem || hitDock?.matched_stem || hit8807?.matched_stem || "";
  let bucket = "Annex II small UAS (no thermal)";

  if (hit100 || hitDock || (hit8807 && heavy8807)) {
    heading = S232_UAS_100;
    rate = 100;
    stem = (hit100 || hitDock || hit8807)!.matched_stem;
    bucket = hitDock ? "UAS docking (claimed)" : hit8807 ? "UAS heavy parts (claimed)" : "Annex I large UAS";
  } else if (hit8807 && annexIii8807 && onOrAfter(day, S232_UAS_ANNEX_III)) {
    heading = S232_UAS_25;
    rate = 25;
    stem = hit8807.matched_stem;
    bucket = "Annex III UAS parts (claimed)";
  } else if (hit25 && thermal) {
    heading = S232_UAS_100;
    rate = 100;
    stem = hit25.matched_stem;
    bucket = "Annex II HTS with thermal imaging claimed";
  } else if (hit25) {
    heading = S232_UAS_25;
    rate = 25;
    stem = hit25.matched_stem;
    bucket = "Annex II small UAS (no thermal)";
  }

  const partnerClaim = flag(flags, "s232_uas_partner_cert", "s232_uas_certified_components");
  const coo = String(opts.coo || "").trim().toUpperCase();
  if (partnerClaim && (partner10.has(coo) || partner15.has(coo))) {
    const capH = partner10.has(coo) ? S232_UAS_UK : S232_UAS_PARTNER;
    const capPct = partner10.has(coo) ? 10 : 15;
    bucket += `; ${coo} ${capPct}% partner heading ${capH} is not computed — CBP says do not report it yet`;
  }

  return {
    heading,
    rate_pct_decimal: rate / 100,
    label: `Section 232 UAS — ${heading} (${rate}%)`,
    reason: `Section 232 UAS ${bucket}: ${prettyStem(stem)} files ${heading} at ${rate}% additional from ${S232_UAS_START}. Section 301-FL is not stacked with this 232 layer.`,
    matched_stem: stem,
    suppresses_301fl: true,
  };
}
