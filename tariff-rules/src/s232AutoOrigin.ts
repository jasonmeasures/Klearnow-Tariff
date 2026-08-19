/**
 * Origin-driven Section 232 automobile headings (Proclamation 10908 as modified).
 * Default is 9903.94.01 / .05 @ 25% additional. JP / EU / KR / UK CSMS splits
 * replace that heading; they do not apply before each split's `from` date.
 */
import originPack from "../data/s232_auto_origin.json" with { type: "json" };
import { EU_MEMBERS } from "./s301fl.ts";
import { onOrAfter } from "./s232Stems.ts";

export type AutoOriginKind = "vehicles" | "parts";

export type AutoOriginHit = {
  heading: string;
  /** Rate reported on the Ch.99 line (decimal). Combined-cap: the cap, or 0 when col-1 ≥ cap. */
  rate_pct_decimal: number;
  combined_cap: boolean;
  cap_pct_decimal: number | null;
  /** CSMS default: Ch.1–97 reports $0 when col-1 is under the cap. */
  zero_commodity: boolean;
  label: string;
  reason: string;
  source: string;
  split_id: string | null;
};

type Pair = { cap_pct: number; lt: string; gte: string };
type Split = {
  id: string;
  match: { iso2?: string[]; group?: string };
  from: string;
  vehicles?: Pair;
  parts?: Pair;
  parts_self_cert?: { flag: string; lt: string; gte: string };
  source: string;
};

const SPLITS = originPack.splits as Split[];
const UK_TRQ = originPack.uk_vehicle_trq as {
  from: string;
  iso2: string[];
  flag: string;
  heading: string;
  additional_pct: number;
  source: string;
};

function iso2(coo: string): string {
  return String(coo || "").trim().toUpperCase();
}

function matches(coo: string, match: Split["match"]): boolean {
  const iso = iso2(coo);
  if (!iso) return false;
  if (match.iso2?.includes(iso)) return true;
  if (match.group === "EU" && EU_MEMBERS.has(iso)) return true;
  return false;
}

function flagOn(flags: Record<string, boolean> | null | undefined, key: string): boolean {
  return Boolean(flags && flags[key]);
}

function applyPair(
  pair: Pair,
  col1Rate: number,
  drawback: boolean,
  label: string,
  source: string,
  splitId: string,
): AutoOriginHit {
  const cap = pair.cap_pct / 100;
  const under = col1Rate < cap;
  const heading = under ? pair.lt : pair.gte;
  if (!under) {
    return {
      heading,
      rate_pct_decimal: 0,
      combined_cap: true,
      cap_pct_decimal: cap,
      zero_commodity: false,
      label,
      reason: `Column-1 ${(col1Rate * 100).toFixed(1)}% is already ≥ ${(cap * 100).toFixed(0)}%; ${heading} @ 0% additional (col-1 remains on Ch.1–97). ${source}`,
      source,
      split_id: splitId,
    };
  }
  if (drawback) {
    return {
      heading,
      rate_pct_decimal: cap - col1Rate,
      combined_cap: true,
      cap_pct_decimal: cap,
      zero_commodity: false,
      label,
      reason: `Drawback split: Column-1 stays on Ch.1–97; ${heading} reports the ${(cap * 100).toFixed(0)}% − col-1 difference. ${source}`,
      source,
      split_id: splitId,
    };
  }
  return {
    heading,
    rate_pct_decimal: cap,
    combined_cap: true,
    cap_pct_decimal: cap,
    zero_commodity: true,
    label,
    reason: `Column-1 ${(col1Rate * 100).toFixed(1)}% is below ${(cap * 100).toFixed(0)}%; ${heading} reports the combined ${(cap * 100).toFixed(0)}% and Ch.1–97 reports zero (CSMS default). ${source}`,
    source,
    split_id: splitId,
  };
}

function defaultVehicles(stemNote: string): AutoOriginHit {
  const h = originPack.default_vehicles.heading as string;
  const rate = (originPack.default_vehicles.rate_pct as number) / 100;
  return {
    heading: h,
    rate_pct_decimal: rate,
    combined_cap: false,
    cap_pct_decimal: null,
    zero_commodity: false,
    label: "Section 232 — passenger vehicles and light trucks",
    reason: `${stemNote} → ${h} @ ${originPack.default_vehicles.rate_pct}% additional (CSMS #64624801 / Proclamation 10908). 301-FL suppressed via 9903.05.90.`,
    source: "CSMS #64624801",
    split_id: null,
  };
}

function defaultParts(stemNote: string): AutoOriginHit {
  const h = originPack.default_parts.heading as string;
  const rate = (originPack.default_parts.rate_pct as number) / 100;
  return {
    heading: h,
    rate_pct_decimal: rate,
    combined_cap: false,
    cap_pct_decimal: null,
    zero_commodity: false,
    label: "Section 232 — auto parts",
    reason: `${stemNote} → ${h} @ ${originPack.default_parts.rate_pct}%.`,
    source: "Proclamation 10908",
    split_id: null,
  };
}

export type AutoOriginOpts = {
  coo: string;
  rateDay: string;
  col1Rate: number;
  flags?: Record<string, boolean> | null;
  /** When true, KR self-cert headings apply instead of annex .62/.63. */
  krSelfCert?: boolean;
  matchedStem?: string;
};

export function resolve232VehicleOrigin(opts: AutoOriginOpts): AutoOriginHit {
  const iso = iso2(opts.coo);
  const day = opts.rateDay;
  const stem = opts.matchedStem ? `Passenger-vehicle / light-truck list stem ${opts.matchedStem}` : "Passenger-vehicle / light-truck list";
  const drawback = flagOn(opts.flags, "s232_drawback_col1");

  if (
    UK_TRQ.iso2.includes(iso) &&
    onOrAfter(day, UK_TRQ.from) &&
    flagOn(opts.flags, UK_TRQ.flag)
  ) {
    const add = UK_TRQ.additional_pct / 100;
    return {
      heading: UK_TRQ.heading,
      rate_pct_decimal: add,
      combined_cap: false,
      cap_pct_decimal: null,
      zero_commodity: false,
      label: "Section 232 — UK passenger vehicle TRQ",
      reason: `UK TRQ claimed → ${UK_TRQ.heading} @ ${UK_TRQ.additional_pct}% additional, stacking with Column 1 (typically 10% combined). ${UK_TRQ.source}`,
      source: UK_TRQ.source,
      split_id: "GB_TRQ",
    };
  }

  for (const s of SPLITS) {
    if (!s.vehicles || !matches(iso, s.match) || !onOrAfter(day, s.from)) continue;
    return applyPair(
      s.vehicles,
      opts.col1Rate,
      drawback,
      `Section 232 — ${s.id} passenger vehicles (combined ${(s.vehicles.cap_pct).toFixed(0)}%)`,
      s.source,
      s.id,
    );
  }

  return defaultVehicles(stem);
}

export function resolve232PartsOrigin(opts: AutoOriginOpts): AutoOriginHit {
  const iso = iso2(opts.coo);
  const day = opts.rateDay;
  const stem = opts.matchedStem
    ? `Proclamation 10908 annex stem ${opts.matchedStem}`
    : "Default 232 auto-parts duty while off-list claim is asserted";
  const drawback = flagOn(opts.flags, "s232_drawback_col1");

  for (const s of SPLITS) {
    if (!matches(iso, s.match) || !onOrAfter(day, s.from)) continue;
    if (opts.krSelfCert && s.parts_self_cert && flagOn(opts.flags, s.parts_self_cert.flag)) {
      return applyPair(
        { cap_pct: s.parts?.cap_pct ?? 15, lt: s.parts_self_cert.lt, gte: s.parts_self_cert.gte },
        opts.col1Rate,
        drawback,
        `Section 232 — ${s.id} self-certified auto parts (combined ${(s.parts?.cap_pct ?? 15).toFixed(0)}%)`,
        s.source,
        s.id,
      );
    }
    if (!s.parts) continue;
    return applyPair(
      s.parts,
      opts.col1Rate,
      drawback,
      `Section 232 — ${s.id} auto parts (combined ${s.parts.cap_pct.toFixed(0)}%)`,
      s.source,
      s.id,
    );
  }

  return defaultParts(stem);
}

/** Coverage / preview: origin heading when COO is known; otherwise the published default. */
export function preview232OriginHeading(
  kind: AutoOriginKind,
  coo: string,
  rateDay: string,
  col1Rate = 0,
  flags?: Record<string, boolean> | null,
): AutoOriginHit {
  if (kind === "vehicles") {
    return resolve232VehicleOrigin({ coo, rateDay, col1Rate, flags });
  }
  return resolve232PartsOrigin({ coo, rateDay, col1Rate, flags });
}

export function ukVehicleTrqNote(coo: string, rateDay: string, flags?: Record<string, boolean> | null): string | null {
  const iso = iso2(coo);
  if (!UK_TRQ.iso2.includes(iso) || !onOrAfter(rateDay, UK_TRQ.from)) return null;
  if (flagOn(flags, UK_TRQ.flag)) return null;
  return `UK passenger vehicles in-quota may use ${UK_TRQ.heading} @ ${UK_TRQ.additional_pct}% additional (combined ~10% with 2.5% Column 1) if the TRQ is claimed (s232_uk_auto_trq). Default remains 9903.94.01 @ 25% additional.`;
}
