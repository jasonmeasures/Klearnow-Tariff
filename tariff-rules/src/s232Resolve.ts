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
import {
  resolve232PartsOrigin,
  resolve232VehicleOrigin,
  ukVehicleTrqNote,
} from "./s232AutoOrigin.ts";
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
import { assessS232Uas, previewS232Uas } from "./s232Uas.ts";

export type S232Family =
  | "autos_parts"
  | "autos_vehicles"
  | "mhdv"
  | "wood"
  | "semiconductors"
  | "uas";

export type S232EnteredHit = {
  family: S232Family;
  program: "SEC_232_AUTOS" | "SEC_232_MHDV" | "SEC_232_WOOD" | "SEC_232_SEMI" | "SEC_232_UAS";
  heading: string;
  rate_pct_decimal: number;
  label: string;
  reason: string;
  source: string;
  matched_stem?: string;
  /** JP/EU/KR/UK CSMS combined-cap filing (15% or 10% on Ch.99; Ch.1–97 $0 when under the cap). */
  combined_cap: boolean;
  cap_pct_decimal: number | null;
  zero_commodity: boolean;
  /** @deprecated use combined_cap — kept for JP parts callers. */
  jp_parts_topup: boolean;
  /** MHDV / semiconductor CSMS: do not also assess metals/wood. */
  suppresses_metals: boolean;
  suppresses_wood: boolean;
};

/**
 * 9903.74.11 @ 0% — MHDV parts-list exclusion stacked alongside an auto-parts
 * (or other non-MHDV) 232 winner when the HTS is on both lists.
 */
export type S232MhdvNotPartCompanion = {
  heading: "9903.74.11";
  matched_stem: string;
  reason: string;
  source: string;
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
  uas: ReturnType<typeof previewS232Uas> | null;
};

export function previewS232Universe(
  hts: string,
  coo = "",
  opts?: { rateDay?: string; col1Rate?: number; flags?: Record<string, boolean> | null },
): S232UniversePreview {
  const pv = match232PassengerVehicle(hts);
  const mv = match232MhdvVehicle(hts);
  const mb = match232MhdvBus(hts);
  const mp = match232MhdvPart(hts);
  const wood = match232Wood(hts, coo);
  const semi = match232SemiconductorHts(hts);
  const annex = match232AutoPartsAnnex(hts);
  const day = opts?.rateDay || "";
  const col1 = opts?.col1Rate ?? 0;
  const flags = opts?.flags || {};
  const pvHeading = pv
    ? resolve232VehicleOrigin({
        coo,
        rateDay: day || "9999-12-31",
        col1Rate: col1,
        flags,
        matchedStem: pv.matched_stem,
      }).heading
    : null;
  const partsHeading = annex
    ? resolve232PartsOrigin({
        coo,
        rateDay: day || "9999-12-31",
        col1Rate: col1,
        flags,
        matchedStem: annex.matched_stem,
      }).heading
    : null;
  return {
    passenger_vehicle: pv
      ? { matched_stem: pv.matched_stem, ch99: pvHeading || pv.ch99_duty }
      : null,
    mhdv_vehicle: mv ? { matched_stem: mv.matched_stem, ch99: mv.ch99_duty } : null,
    mhdv_bus: mb ? { matched_stem: mb.matched_stem, ch99: mb.ch99_duty } : null,
    mhdv_part_list: mp ? { matched_stem: mp.matched_stem, ch99: mp.ch99_duty } : null,
    wood: wood ? { matched_stem: wood.matched_stem, bucket: wood.bucket, ch99: wood.heading } : null,
    semiconductor: semi ? { matched_stem: semi.matched_stem } : null,
    auto_parts: annex
      ? { matched_stem: annex.matched_stem, ch99: partsHeading || annex.ch99_duty }
      : null,
    uas: previewS232Uas(hts),
  };
}

function flag(flags: Record<string, boolean> | null | undefined, ...keys: string[]): boolean {
  const f = flags || {};
  return keys.some((k) => Boolean(f[k]));
}

const NO_CAP = {
  combined_cap: false as const,
  cap_pct_decimal: null as number | null,
  zero_commodity: false,
  jp_parts_topup: false,
};

function mhdvNotPartCompanion(matchedStem: string, source: string): S232MhdvNotPartCompanion {
  return {
    heading: "9903.74.11",
    matched_stem: matchedStem,
    reason: `On MHDV parts list stem ${matchedStem} but not claimed as an MHDV part — 9903.74.11 @ 0% (CSMS #66665333). Auto-parts / other 232 duty remains the operative additional when applicable.`,
    source,
  };
}

export function resolveS232EnteredValue(opts: {
  hts: string;
  coo: string;
  rateDay: string;
  flags?: Record<string, boolean> | null;
  chapterMetals?: boolean;
  /** Decimal Column-1 rate (0.025 = 2.5%). Used to pick JP/EU/KR .40 vs .41 (etc.). */
  col1Rate?: number;
}): {
  hit: S232EnteredHit | null;
  /** Dual-list: stack 9903.74.11 with auto-parts (or when s232_mhdv_not_part is claimed with annex). */
  companion?: S232MhdvNotPartCompanion | null;
  notes: S232Note[];
} {
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
        ...NO_CAP,
        suppresses_metals: semi.heading === "9903.79.01",
        suppresses_wood: true,
      },
      notes: [{ severity: "INFO", code: "S232_SEMI_APPLIED", message: semi.reason }],
    };
  }
  if (semi && !semi.applies) {
    notes.push({ severity: "INFO", code: "S232_SEMI_LIST", message: semi.reason });
  }

  const uas = assessS232Uas({ hts, coo, rateDay: day, flags });
  if (uas && "preview_only" in uas) {
    notes.push({ severity: "INFO", code: "S232_UAS_PENDING", message: uas.reason });
  } else if (uas && "heading" in uas) {
    return {
      hit: {
        family: "uas",
        program: "SEC_232_UAS",
        heading: uas.heading,
        rate_pct_decimal: uas.rate_pct_decimal,
        label: uas.label,
        reason: uas.reason,
        source: "Proclamation 11055 / U.S. note 43",
        matched_stem: uas.matched_stem,
        ...NO_CAP,
        suppresses_metals: false,
        suppresses_wood: true,
      },
      notes,
    };
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
        ...NO_CAP,
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
        ...NO_CAP,
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
        ...NO_CAP,
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
          ...NO_CAP,
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
        ...NO_CAP,
        suppresses_metals: true,
        suppresses_wood: true,
      },
      notes,
    };
  }

  if (mp) {
    if (flag(flags, "s232_mhdv_not_part")) {
      // Dual-list: fall through to auto-parts and stack .11 as companion.
      // MHDV-parts-list-only: report .11 alone (exclusion claim).
      const annexForNotPart = match232AutoPartsAnnex(hts);
      if (
        !annexForNotPart &&
        !flag(flags, "s232_auto_part", "s232_auto", "s232")
      ) {
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
            ...NO_CAP,
            suppresses_metals: true,
            suppresses_wood: true,
          },
          notes,
        };
      }
    } else if (flag(flags, "s232_mhdv_part", "s232_mhdv")) {
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
          ...NO_CAP,
          suppresses_metals: true,
          suppresses_wood: true,
        },
        notes,
      };
    } else {
      const annexOnly = match232AutoPartsAnnex(hts);
      if (!annexOnly && !flag(flags, "s232_auto_part", "s232_auto", "s232")) {
        notes.push({
          severity: "INFO",
          code: "S232_MHDV_PARTS_LIST",
          message: `HTS matches MHDV parts list stem ${mp.matched_stem}. 9903.74.08 @ 25% applies only if the article is a part of an MHDV (claim s232_mhdv_part). Otherwise 9903.74.11 @ 0% (not an MHDV part).`,
        });
      }
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
          ...NO_CAP,
          suppresses_metals: false,
          suppresses_wood: true,
        },
        notes,
      };
    }
    const origin = resolve232VehicleOrigin({
      coo,
      rateDay: day,
      col1Rate: opts.col1Rate ?? 0,
      flags,
      matchedStem: pv.matched_stem,
    });
    const ukNote = ukVehicleTrqNote(coo, day, flags);
    if (ukNote) {
      notes.push({ severity: "INFO", code: "S232_UK_VEHICLE_TRQ", message: ukNote });
    }
    return {
      hit: {
        family: "autos_vehicles",
        program: "SEC_232_AUTOS",
        heading: origin.heading,
        rate_pct_decimal: origin.rate_pct_decimal,
        label: origin.label,
        reason: origin.reason,
        source: origin.source,
        matched_stem: pv.matched_stem,
        combined_cap: origin.combined_cap,
        cap_pct_decimal: origin.cap_pct_decimal,
        zero_commodity: origin.zero_commodity,
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
    const krSelfCert = Boolean(claimedAuto && !annex && flag(flags, "s232_kr_self_cert"));
    const origin = resolve232PartsOrigin({
      coo,
      rateDay: day,
      col1Rate: opts.col1Rate ?? 0,
      flags,
      krSelfCert,
      matchedStem: annex?.matched_stem,
    });
    // Dual-list (annex + MHDV parts) or explicit not-part claim with annex:
    // stack 9903.74.11 @ 0% alongside auto-parts. Pack note: auto-parts is the
    // default unless MHDV part is claimed.
    const companion =
      mp && !flag(flags, "s232_mhdv_part", "s232_mhdv")
        ? mhdvNotPartCompanion(mp.matched_stem, mp.source)
        : null;
    if (companion) {
      notes.push({
        severity: "INFO",
        code: "S232_MHDV_NOT_PART_STACKED",
        message: companion.reason,
      });
    }
    return {
      hit: {
        family: "autos_parts",
        program: "SEC_232_AUTOS",
        heading: origin.heading,
        rate_pct_decimal: origin.rate_pct_decimal,
        label: origin.label,
        reason: annex
          ? origin.reason
          : `${origin.reason} Off-list claim asserted.`,
        source: origin.source,
        matched_stem: annex?.matched_stem,
        combined_cap: origin.combined_cap,
        cap_pct_decimal: origin.cap_pct_decimal,
        zero_commodity: origin.zero_commodity,
        jp_parts_topup: origin.combined_cap,
        suppresses_metals: false,
        suppresses_wood: true,
      },
      companion,
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
          ...NO_CAP,
          suppresses_metals: false,
          suppresses_wood: false,
        },
        notes,
      };
    }
  }

  return { hit: null, notes };
}
