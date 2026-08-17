/**
 * Pick the entered-value Section 232 winner for a line.
 * Precedence (CSMS):
 *   1. Claimed semiconductors 9903.79.01 (beats autos / MHDV / metals)
 *   2. MHDV vehicles / buses (auto); MHDV parts when claimed
 *   3. Passenger vehicles (auto)
 *   4. Auto-parts annex / claim (R5: chapter metals still win)
 *   5. Wood (skipped if autos/parts already won)
 */
import { match232AutoPartsAnnex } from "./s232Autos.ts";
import { match232PassengerVehicle, s232VehiclesAppliesOn } from "./s232Vehicles.ts";
import {
  match232MhdvBus,
  match232MhdvPart,
  match232MhdvVehicle,
  s232MhdvAppliesOn,
} from "./s232Mhdv.ts";
import { match232Wood, s232WoodAppliesOn } from "./s232Wood.ts";
import {
  assessS232Semiconductors,
  match232SemiconductorHts,
} from "./s232Semiconductors.ts";

export type S232Family =
  | "autos_parts"
  | "autos_vehicles"
  | "mhdv"
  | "wood"
  | "semiconductors";

export type S232EnteredHit = {
  family: S232Family;
  program: "SEC_232_AUTOS" | "SEC_232_MHDV" | "SEC_232_WOOD" | "SEC_232_SEMI";
  heading: string;
  rate_pct_decimal: number;
  label: string;
  reason: string;
  source: string;
  matched_stem?: string;
  /** JP 9903.94.43 top-up applies only to auto-parts, not vehicles. */
  jp_parts_topup: boolean;
  /** MHDV / semiconductor CSMS: do not also assess metals/wood. */
  suppresses_metals: boolean;
  suppresses_wood: boolean;
};

export type S232Note = {
  severity: "INFO" | "WARNING";
  code: string;
  message: string;
};

export type S232UniversePreview = {
  passenger_vehicle: { matched_stem: string; ch99: string } | null;
  mhdv_vehicle: { matched_stem: string; ch99: string } | null;
  mhdv_bus: { matched_stem: string; ch99: string } | null;
  mhdv_part_list: { matched_stem: string; ch99: string } | null;
  wood: { matched_stem: string; bucket: string; ch99: string } | null;
  semiconductor: { matched_stem: string } | null;
  auto_parts: { matched_stem: string; ch99: string } | null;
};

export function previewS232Universe(hts: string, coo = ""): S232UniversePreview {
  const pv = match232PassengerVehicle(hts);
  const mv = match232MhdvVehicle(hts);
  const mb = match232MhdvBus(hts);
  const mp = match232MhdvPart(hts);
  const wood = match232Wood(hts, coo);
  const semi = match232SemiconductorHts(hts);
  const annex = match232AutoPartsAnnex(hts);
  return {
    passenger_vehicle: pv ? { matched_stem: pv.matched_stem, ch99: pv.ch99_duty } : null,
    mhdv_vehicle: mv ? { matched_stem: mv.matched_stem, ch99: mv.ch99_duty } : null,
    mhdv_bus: mb ? { matched_stem: mb.matched_stem, ch99: mb.ch99_duty } : null,
    mhdv_part_list: mp ? { matched_stem: mp.matched_stem, ch99: mp.ch99_duty } : null,
    wood: wood ? { matched_stem: wood.matched_stem, bucket: wood.bucket, ch99: wood.heading } : null,
    semiconductor: semi ? { matched_stem: semi.matched_stem } : null,
    auto_parts: annex ? { matched_stem: annex.matched_stem, ch99: annex.ch99_duty } : null,
  };
}

function flag(flags: Record<string, boolean> | null | undefined, ...keys: string[]): boolean {
  const f = flags || {};
  return keys.some((k) => Boolean(f[k]));
}

export function resolveS232EnteredValue(opts: {
  hts: string;
  coo: string;
  rateDay: string;
  flags?: Record<string, boolean> | null;
  chapterMetals?: boolean;
}): { hit: S232EnteredHit | null; notes: S232Note[] } {
  const notes: S232Note[] = [];
  const flags = opts.flags || {};
  const hts = opts.hts;
  const coo = opts.coo;
  const day = opts.rateDay;

  const semi = assessS232Semiconductors({ hts, rateDay: day, flags });
  if (semi?.applies) {
    return {
      hit: {
        family: "semiconductors",
        program: "SEC_232_SEMI",
        heading: semi.heading,
        rate_pct_decimal: semi.rate_pct / 100,
        label: semi.label,
        reason: semi.reason,
        source: "CSMS #67400472",
        jp_parts_topup: false,
        suppresses_metals: semi.heading === "9903.79.01",
        suppresses_wood: true,
      },
      notes: [{ severity: "INFO", code: "S232_SEMI_APPLIED", message: semi.reason }],
    };
  }
  if (semi && !semi.applies) {
    notes.push({ severity: "INFO", code: "S232_SEMI_LIST", message: semi.reason });
  }

  const mhdvOn = s232MhdvAppliesOn(day);
  const mv = mhdvOn ? match232MhdvVehicle(hts) : null;
  const mb = mhdvOn ? match232MhdvBus(hts) : null;
  const mp = mhdvOn ? match232MhdvPart(hts) : null;
  const pvOn = s232VehiclesAppliesOn(day);
  const pv = pvOn ? match232PassengerVehicle(hts) : null;

  const vintage = flag(flags, "s232_vehicle_vintage", "s232_auto_vintage", "s232_mhdv_vintage");
  const claimMhdv = flag(flags, "s232_mhdv", "s232_mhdv_part");

  if (mv && pv && !claimMhdv && !vintage) {
    notes.push({
      severity: "INFO",
      code: "S232_PV_MHDV_OVERLAP",
      message: `HTS stem is on both the passenger-vehicle list (9903.94.01) and the MHDV vehicle list (9903.74.01). Default is passenger vehicles; claim s232_mhdv to file MHDV instead.`,
    });
  }

  if (vintage && (mv || mb) && mhdvOn) {
    return {
      hit: {
        family: "mhdv",
        program: "SEC_232_MHDV",
        heading: "9903.74.07",
        rate_pct_decimal: 0,
        label: "232 MHDV — 25-year vehicle",
        reason: `Manufactured ≥25 years before entry — 9903.74.07 @ 0% additional (CSMS #66665333). 301-FL suppressed via 9903.05.90.`,
        source: "CSMS #66665333",
        matched_stem: (mv || mb)!.matched_stem,
        jp_parts_topup: false,
        suppresses_metals: true,
        suppresses_wood: true,
      },
      notes,
    };
  }
  if (vintage && pv && pvOn) {
    return {
      hit: {
        family: "autos_vehicles",
        program: "SEC_232_AUTOS",
        heading: "9903.94.04",
        rate_pct_decimal: 0,
        label: "232 autos — 25-year passenger vehicle / light truck",
        reason: `Manufactured ≥25 years before entry — 9903.94.04 @ 0% additional (CSMS #64624801). 301-FL suppressed via 9903.05.90.`,
        source: "CSMS #64624801",
        matched_stem: pv.matched_stem,
        jp_parts_topup: false,
        suppresses_metals: false,
        suppresses_wood: true,
      },
      notes,
    };
  }

  if (mb) {
    return {
      hit: {
        family: "mhdv",
        program: "SEC_232_MHDV",
        heading: "9903.74.02",
        rate_pct_decimal: 0.1,
        label: "Section 232 — buses and other vehicles",
        reason: `MHDV bus list stem ${mb.matched_stem} → 9903.74.02 @ 10% additional (CSMS #66665333 / Proclamation 10984). 301-FL suppressed via 9903.05.90.`,
        source: mb.source,
        matched_stem: mb.matched_stem,
        jp_parts_topup: false,
        suppresses_metals: true,
        suppresses_wood: true,
      },
      notes,
    };
  }

  if (mv && (claimMhdv || !pv)) {
    if (flag(flags, "s232_mhdv_not_vehicle")) {
      return {
        hit: {
          family: "mhdv",
          program: "SEC_232_MHDV",
          heading: "9903.74.05",
          rate_pct_decimal: 0,
          label: "232 MHDV list — not an MHDV",
          reason: `On MHDV vehicle list stem ${mv.matched_stem} but claimed not an MHDV — 9903.74.05 @ 0% (CSMS #66665333).`,
          source: mv.source,
          matched_stem: mv.matched_stem,
          jp_parts_topup: false,
          suppresses_metals: true,
          suppresses_wood: true,
        },
        notes,
      };
    }
    return {
      hit: {
        family: "mhdv",
        program: "SEC_232_MHDV",
        heading: "9903.74.01",
        rate_pct_decimal: 0.25,
        label: "Section 232 — medium- and heavy-duty vehicles",
        reason: `MHDV vehicle list stem ${mv.matched_stem} → 9903.74.01 @ 25% additional (CSMS #66665333 / Proclamation 10984). 301-FL suppressed via 9903.05.90.`,
        source: mv.source,
        matched_stem: mv.matched_stem,
        jp_parts_topup: false,
        suppresses_metals: true,
        suppresses_wood: true,
      },
      notes,
    };
  }

  if (mp) {
    if (flag(flags, "s232_mhdv_not_part")) {
      return {
        hit: {
          family: "mhdv",
          program: "SEC_232_MHDV",
          heading: "9903.74.11",
          rate_pct_decimal: 0,
          label: "232 MHDV parts list — not an MHDV part",
          reason: `On MHDV parts list stem ${mp.matched_stem} but claimed not an MHDV part — 9903.74.11 @ 0% (CSMS #66665333). 301-FL suppressed via 9903.05.90.`,
          source: mp.source,
          matched_stem: mp.matched_stem,
          jp_parts_topup: false,
          suppresses_metals: true,
          suppresses_wood: true,
        },
        notes,
      };
    }
    if (flag(flags, "s232_mhdv_part", "s232_mhdv")) {
      const usmca = flag(flags, "fta_usmca");
      const heading = usmca ? "9903.74.10" : "9903.74.08";
      const rate = usmca ? 0 : 0.25;
      return {
        hit: {
          family: "mhdv",
          program: "SEC_232_MHDV",
          heading,
          rate_pct_decimal: rate,
          label: usmca
            ? "Section 232 — MHDV parts (USMCA 9903.74.10)"
            : "Section 232 — medium- and heavy-duty vehicle parts",
          reason: usmca
            ? `MHDV parts list stem ${mp.matched_stem} with USMCA claim → 9903.74.10 @ 0% (CSMS #66665333). 301-FL suppressed via 9903.05.90.`
            : `MHDV parts claim on list stem ${mp.matched_stem} → 9903.74.08 @ 25% additional (CSMS #66665333). 301-FL suppressed via 9903.05.90.`,
          source: mp.source,
          matched_stem: mp.matched_stem,
          jp_parts_topup: false,
          suppresses_metals: true,
          suppresses_wood: true,
        },
        notes,
      };
    }
    const annex = match232AutoPartsAnnex(hts);
    if (!annex && !flag(flags, "s232_auto_part", "s232_auto", "s232")) {
      notes.push({
        severity: "INFO",
        code: "S232_MHDV_PARTS_LIST",
        message: `HTS matches MHDV parts list stem ${mp.matched_stem}. 9903.74.08 @ 25% applies only if the article is a part of an MHDV (claim s232_mhdv_part). Otherwise 9903.74.11 @ 0% (not an MHDV part).`,
      });
    }
  }

  if (pv && pvOn) {
    if (flag(flags, "s232_auto_not_pv")) {
      return {
        hit: {
          family: "autos_vehicles",
          program: "SEC_232_AUTOS",
          heading: "9903.94.02",
          rate_pct_decimal: 0,
          label: "232 autos list — not a passenger vehicle / light truck",
          reason: `On passenger-vehicle list stem ${pv.matched_stem} but claimed not a PV/light truck — 9903.94.02 @ 0% (CSMS #64624801).`,
          source: pv.source,
          matched_stem: pv.matched_stem,
          jp_parts_topup: false,
          suppresses_metals: false,
          suppresses_wood: true,
        },
        notes,
      };
    }
    return {
      hit: {
        family: "autos_vehicles",
        program: "SEC_232_AUTOS",
        heading: "9903.94.01",
        rate_pct_decimal: 0.25,
        label: "Section 232 — passenger vehicles and light trucks",
        reason: `Passenger-vehicle / light-truck list stem ${pv.matched_stem} → 9903.94.01 @ 25% additional (CSMS #64624801 / Proclamation 10908). 301-FL suppressed via 9903.05.90.`,
        source: pv.source,
        matched_stem: pv.matched_stem,
        jp_parts_topup: false,
        suppresses_metals: false,
        suppresses_wood: true,
      },
      notes,
    };
  }

  const claimedAuto = flag(flags, "s232_auto_part", "s232_auto", "s232");
  const annex = match232AutoPartsAnnex(hts);
  if (!opts.chapterMetals && (annex || claimedAuto)) {
    return {
      hit: {
        family: "autos_parts",
        program: "SEC_232_AUTOS",
        heading: annex?.ch99_duty || "9903.94.05",
        rate_pct_decimal: 0.25,
        label: "Section 232 — auto parts",
        reason: annex
          ? `Proclamation 10908 annex stem ${annex.matched_stem} → ${annex.ch99_duty} @ 25%.`
          : "Default 232 auto-parts duty while off-list claim is asserted.",
        source: annex?.source || "Proclamation 10908",
        matched_stem: annex?.matched_stem,
        jp_parts_topup: true,
        suppresses_metals: false,
        suppresses_wood: true,
      },
      notes,
    };
  }

  if (s232WoodAppliesOn(day)) {
    const wood = match232Wood(hts, coo, flags);
    if (wood) {
      return {
        hit: {
          family: "wood",
          program: "SEC_232_WOOD",
          heading: wood.heading,
          rate_pct_decimal: wood.rate_pct / 100,
          label: `Section 232 — ${wood.label}`,
          reason: `Wood 232 ${wood.bucket} stem ${wood.matched_stem} → ${wood.heading} @ ${wood.rate_pct}% additional (CSMS #66492057 / Proclamation 10976). 301-FL suppressed via 9903.05.90.`,
          source: wood.source,
          matched_stem: wood.matched_stem,
          jp_parts_topup: false,
          suppresses_metals: false,
          suppresses_wood: false,
        },
        notes,
      };
    }
  }

  return { hit: null, notes };
}
