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
import {
  assessS232Uas,
  previewS232Uas,
  s232UasPartnerCapMessage,
  S232_UAS_NOT_FOR_USE,
} from "./s232Uas.ts";

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
  /**
   * When false, report the 232 heading but still assess 301-FL (Note 52(f) does not
   * cover this use — e.g. 9903.94.06 “not a PV/LT part”, 9903.08.20, 9903.74.11 alone).
   * Omit / true → suppress FL via 9903.05.90.
   */
  suppresses_301fl?: boolean;
};

/**
 * 0% companion stacked alongside a primary 232 winner (MHDV dual-list .11, or
 * UAS not-for-use .20 on an auto-parts annex stem).
 */
export type S232Companion = {
  heading: string;
  program: "SEC_232_MHDV" | "SEC_232_UAS";
  label: string;
  matched_stem: string;
  reason: string;
  source: string;
};

/** @deprecated alias — prefer S232Companion */
export type S232MhdvNotPartCompanion = S232Companion;

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

function mhdvNotPartCompanion(matchedStem: string, source: string): S232Companion {
  return {
    heading: "9903.74.11",
    program: "SEC_232_MHDV",
    label: "232 MHDV parts list — not an MHDV part",
    matched_stem: matchedStem,
    reason: `On MHDV parts list stem ${matchedStem} but not claimed as an MHDV part — 9903.74.11 @ 0% (CSMS #66665333). Auto-parts / other 232 duty remains the operative additional when applicable.`,
    source,
  };
}

function uasNotForUseCompanion(matchedStem: string): S232Companion {
  return {
    heading: S232_UAS_NOT_FOR_USE,
    program: "SEC_232_UAS",
    label: "Section 232 UAS — not for UAS use (9903.08.20)",
    matched_stem: matchedStem,
    reason:
      `Claimed not for UAS use on dual-list stem ${matchedStem}: files 9903.08.20 @ 0% for the UAS program. ` +
      `Any separate auto-parts 232 duty still depends on whether this article is a passenger-vehicle / light-truck part (CSMS #69738151).`,
    source: "Proclamation 11055 / U.S. note 43 / CSMS #69738151",
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
  /** Dual-list companions: 9903.74.11 (MHDV) or 9903.08.20 (UAS not-for-use) stacked with auto-parts. */
  companion?: S232Companion | null;
  notes: S232Note[];
} {
  const notes: S232Note[] = [];
  const flags = opts.flags || {};
  const hts = opts.hts;
  const coo = opts.coo;
  const day = opts.rateDay;
  let pendingUasNotForUse: S232Companion | null = null;

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
  const partnerCapMsg = s232UasPartnerCapMessage(coo);
  if (uas && "preview_only" in uas) {
    notes.push({ severity: "INFO", code: "S232_UAS_PENDING", message: uas.reason });
    if (partnerCapMsg) {
      notes.push({ severity: "INFO", code: "S232_UAS_PARTNER_CAP", message: partnerCapMsg });
    }
  } else if (uas && "heading" in uas) {
    const annexForUas = match232AutoPartsAnnex(hts);
    // Dual-list (UAS list + auto-parts annex): "not for UAS use" is a 0% reporting
    // companion — keep resolving so auto-parts duty (e.g. JP 9903.94.43) still applies.
    if (uas.heading === S232_UAS_NOT_FOR_USE && annexForUas) {
      pendingUasNotForUse = uasNotForUseCompanion(uas.matched_stem || annexForUas.matched_stem);
      notes.push({
        severity: "INFO",
        code: "S232_UAS_NOT_FOR_USE_STACKED",
        message: pendingUasNotForUse.reason,
      });
    } else {
      if (partnerCapMsg && uas.heading !== S232_UAS_NOT_FOR_USE) {
        notes.push({ severity: "INFO", code: "S232_UAS_PARTNER_CAP", message: partnerCapMsg });
      }
      return {
        hit: {
          family: "uas",
          program: "SEC_232_UAS",
          heading: uas.heading,
          rate_pct_decimal: uas.rate_pct_decimal,
          label: uas.label,
          reason: uas.reason,
          source: "Proclamation 11055 / U.S. note 43 / CSMS #69738151",
          matched_stem: uas.matched_stem,
          ...NO_CAP,
          suppresses_metals: false,
          suppresses_wood: true,
          suppresses_301fl: uas.suppresses_301fl !== false,
        },
        notes,
      };
    }
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
            reason: `On MHDV parts list stem ${mp.matched_stem} but claimed not an MHDV part — 9903.74.11 @ 0% (CSMS #66665333). Note 52(f)(6) does not cover .11 — 301-FL still applies.`,
            source: mp.source,
            matched_stem: mp.matched_stem,
            ...NO_CAP,
            suppresses_metals: true,
            suppresses_wood: true,
            suppresses_301fl: false,
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
  const notAutoPart = flag(flags, "s232_auto_not_part", "s232_not_auto_part");
  const annex = match232AutoPartsAnnex(hts);
  if (!opts.chapterMetals && (annex || claimedAuto)) {
    const companion =
      pendingUasNotForUse ||
      (mp && !flag(flags, "s232_mhdv_part", "s232_mhdv")
        ? mhdvNotPartCompanion(mp.matched_stem, mp.source)
        : null);
    if (companion && companion.program === "SEC_232_MHDV") {
      notes.push({
        severity: "INFO",
        code: "S232_MHDV_NOT_PART_STACKED",
        message: companion.reason,
      });
    }

    // Annex HTS that are not parts of passenger vehicles / light trucks → 9903.94.06 @ 0%.
    // Note 52(f)(3) includes .06 only for the USMCA-eligible-parts use — not this path —
    // so 301-FL still applies (do not report 9903.05.90).
    if (annex && notAutoPart) {
      return {
        hit: {
          family: "autos_parts",
          program: "SEC_232_AUTOS",
          heading: "9903.94.06",
          rate_pct_decimal: 0,
          label: "232 auto-parts list — not a PV / light-truck part",
          reason:
            `On auto-parts annex stem ${annex.matched_stem} but claimed not a part of a passenger vehicle or light truck — 9903.94.06 @ 0% (U.S. note 33 / CSMS #64913145). Note 52(f)(3) covers .06 only for USMCA-eligible parts — 301-FL still applies.`,
          source: annex.source,
          matched_stem: annex.matched_stem,
          ...NO_CAP,
          suppresses_metals: false,
          suppresses_wood: true,
          suppresses_301fl: false,
        },
        companion,
        notes,
      };
    }

    const krSelfCert = Boolean(claimedAuto && !annex && flag(flags, "s232_kr_self_cert"));
    const origin = resolve232PartsOrigin({
      coo,
      rateDay: day,
      col1Rate: opts.col1Rate ?? 0,
      flags,
      krSelfCert,
      matchedStem: annex?.matched_stem,
    });
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

  // Dual-list path deferred .20, but no auto-parts/other winner — still report the claim.
  if (pendingUasNotForUse) {
    return {
      hit: {
        family: "uas",
        program: "SEC_232_UAS",
        heading: pendingUasNotForUse.heading,
        rate_pct_decimal: 0,
        label: pendingUasNotForUse.label,
        reason: pendingUasNotForUse.reason,
        source: pendingUasNotForUse.source,
        matched_stem: pendingUasNotForUse.matched_stem,
        ...NO_CAP,
        suppresses_metals: false,
        suppresses_wood: true,
      },
      notes,
    };
  }

  return { hit: null, notes };
}
