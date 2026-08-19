import { Router } from "express";
import { listCh99 } from "../../tariff-rules/src/tariffRules.ts";
import { requireAdmin, requireScope } from "./auth.ts";
import { htsTableMeta, lookupHts, reloadHtsTable, resolveCol1 } from "./htsLookup.ts";
import {
  mergeHtsRateRows,
  mergeHtsReplacements,
  normalizeCsvHtsRows,
} from "./import_hts.ts";
import { STACKING_CONTRACT } from "./rulesContract.ts";
import { refreshRulepackState, STATE } from "./state.ts";
import { lookupFlClaimExemption, matchFlPharmaHts } from "../../tariff-rules/src/s301fl.ts";

export const referenceRouter = Router();

referenceRouter.get("/reference/claim-flags", (_req, res) => {
  const codes = listCh99();
  const headings = (pred: (c: (typeof codes)[0]) => boolean) =>
    codes.filter(pred).map((c) => c.code);

  res.json({
    flags: [
      {
        flag: "s232_auto_part",
        label: "Section 232 auto part (Proclamation 10908 annex)",
        kind: "annex_membership",
        programs: ["s232", "s301fl"],
        headings: headings((c) => c.program.includes("232") || c.code === "9903.05.90"),
        rule_count: 1,
      },
      {
        flag: "s232_pharma_patented",
        label: "Section 232 patented pharma (Proclamation 11020 / 9903.04.60–.66) — UK → 9903.04.63 @ 0%",
        kind: "claim",
        programs: ["s232", "s301fl"],
        headings: ["9903.04.60", "9903.04.61", "9903.04.62", "9903.04.63", "9903.04.64", "9903.04.65", "9903.04.66", "9903.05.90"],
        rule_count: 1,
      },
      {
        flag: "s232_pharma_generic",
        label: "Section 232 generic pharma reporting (9903.04.67 @ 0%)",
        kind: "claim",
        programs: ["s232"],
        headings: ["9903.04.67"],
        rule_count: 1,
      },
      {
        flag: "s232_mhdv_part",
        label: "Section 232 MHDV part (Proclamation 10984 / 9903.74.08) — claim when the article is a part of an MHDV",
        kind: "claim",
        programs: ["s232", "s301fl"],
        headings: ["9903.74.08", "9903.74.10", "9903.74.11", "9903.05.90"],
        rule_count: 1,
      },
      {
        flag: "s232_mhdv",
        label: "Section 232 MHDV vehicle (9903.74.01) — use on 8704.60 overlap with passenger vehicles",
        kind: "claim",
        programs: ["s232"],
        headings: ["9903.74.01", "9903.05.90"],
        rule_count: 1,
      },
      {
        flag: "s232_mhdv_not_part",
        label: "On MHDV parts list but not an MHDV part (9903.74.11 @ 0%)",
        kind: "exclusion",
        programs: ["s232"],
        headings: ["9903.74.11"],
        rule_count: 1,
      },
      {
        flag: "s232_vehicle_vintage",
        label: "Vehicle manufactured ≥25 years before entry (9903.94.04 / 9903.74.07 @ 0%)",
        kind: "exclusion",
        programs: ["s232"],
        headings: ["9903.94.04", "9903.74.07"],
        rule_count: 1,
      },
      {
        flag: "s232_semiconductor",
        label: "Section 232 semiconductor Note 39(b) params met (9903.79.01 @ 25%)",
        kind: "claim",
        programs: ["s232", "s301fl"],
        headings: ["9903.79.01", "9903.05.90"],
        rule_count: 1,
      },
      {
        flag: "s232_semiconductor_params_not_met",
        label: "On semiconductor 232 HTS list but TPP/DRAM params not met (9903.79.02 @ 0%)",
        kind: "exclusion",
        programs: ["s232"],
        headings: ["9903.79.02"],
        rule_count: 1,
      },
      {
        flag: "s232_wood_not_cabinet",
        label: "On kitchen-cabinet HTS list but not a completed cabinet/vanity (9903.76.04 @ 0%)",
        kind: "exclusion",
        programs: ["s232"],
        headings: ["9903.76.04"],
        rule_count: 1,
      },
      {
        flag: "s301fl_pharma",
        label: "Pharmaceutical use — 301-FL Note 52(e) via 9903.05.89 (does not zero Col-1 / MPF)",
        kind: "exclusion",
        programs: ["s301fl"],
        headings: ["9903.05.89"],
        rule_count: 1,
      },
      {
        flag: "fta_usmca",
        label: "USMCA preference — SPI S/S+ zeros Col-1 + MPF; 301-FL via 9903.05.93/.94",
        kind: "fta",
        programs: ["s301fl"],
        headings: ["9903.05.93", "9903.05.94"],
        rule_count: 1,
      },
      {
        flag: "fta_cafta_dr",
        label: "CAFTA-DR preference — SPI zeros Col-1 + MPF; textiles/apparel 301-FL via 9903.05.95",
        kind: "fta",
        programs: ["s301fl"],
        headings: ["9903.05.95"],
        rule_count: 1,
      },
      {
        flag: "fta_note_52",
        label: "Note 52 preference (301-FL exemption only — does not zero Col-1 / MPF)",
        kind: "fta",
        programs: ["s301fl"],
        headings: [],
        rule_count: 1,
      },
      {
        flag: "s301_list_1",
        label: "China Section 301 List 1",
        kind: "annex_membership",
        programs: ["s301"],
        headings: ["9903.88.01"],
        rule_count: 1,
      },
      {
        flag: "s301_list_2",
        label: "China Section 301 List 2",
        kind: "annex_membership",
        programs: ["s301"],
        headings: ["9903.88.02"],
        rule_count: 1,
      },
      {
        flag: "s301_list_3",
        label: "China Section 301 List 3",
        kind: "annex_membership",
        programs: ["s301"],
        headings: ["9903.88.03"],
        rule_count: 1,
      },
      {
        flag: "s301_list_4a",
        label: "China Section 301 List 4A",
        kind: "annex_membership",
        programs: ["s301"],
        headings: ["9903.88.15"],
        rule_count: 1,
      },
      {
        flag: "s301_sts_crane",
        label: "China 301 ship-to-shore gantry crane (9903.92.10)",
        kind: "claim",
        programs: ["s301"],
        headings: ["9903.92.10"],
        rule_count: 1,
      },
      {
        flag: "s301_sts_exclusion",
        label: "China 301 STS crane pre-May 14 2024 contract exclusion (9903.91.09)",
        kind: "claim",
        programs: ["s301"],
        headings: ["9903.91.09"],
        rule_count: 1,
      },
      {
        flag: "s301_sts_other_crane",
        label: "8426.19.00 not a ship-to-shore gantry crane (9903.92.80)",
        kind: "claim",
        programs: ["s301"],
        headings: ["9903.92.80"],
        rule_count: 1,
      },
      {
        flag: "s232_uk_auto_trq",
        label: "UK passenger vehicle TRQ (9903.94.31)",
        kind: "claim",
        programs: ["s232"],
        headings: ["9903.94.31"],
        rule_count: 1,
      },
      {
        flag: "s232_drawback_col1",
        label: "232 auto combined-cap drawback split (col-1 on Ch.1–97)",
        kind: "claim",
        programs: ["s232"],
        headings: [],
        rule_count: 1,
      },
      {
        flag: "s232_kr_self_cert",
        label: "Korea self-certified auto parts (9903.94.64/.65)",
        kind: "claim",
        programs: ["s232"],
        headings: ["9903.94.64", "9903.94.65"],
        rule_count: 1,
      },
      {
        flag: "trade_deal_eu",
        label: "EU trade-deal heading (blocked until R6)",
        kind: "claim",
        programs: ["s232"],
        headings: ["9903.94.45"],
        rule_count: 1,
      },
      {
        flag: "trade_deal_kr",
        label: "Korea trade-deal heading (blocked until R6)",
        kind: "claim",
        programs: ["s232"],
        headings: ["9903.94.63"],
        rule_count: 1,
      },
    ],
  });
});

referenceRouter.get("/reference/fl-pharma/:hts", (req, res) => {
  const hts = String(req.params.hts || "").trim();
  const hit = matchFlPharmaHts(hts);
  if (!hit) {
    res.json({ available: false, hts, heading: "9903.05.89" });
    return;
  }
  res.json({
    available: true,
    hts,
    matched_stem: hit.matched_stem,
    heading: hit.heading,
    basis: hit.basis,
    claim_flag: "s301fl_pharma",
    hint: `If actual use is pharmaceutical, claim Pharma use to report ${hit.heading} @ 0% instead of 301-FL (including the EU combined-to-cap headings). Does not zero Column-1 or MPF. Do not also claim 232 patented pharma unless filing 9903.04.xx.`,
  });
});

referenceRouter.get("/reference/fta-claim/:coo", (req, res) => {
  const coo = String(req.params.coo || "").trim().toUpperCase();
  const ex = lookupFlClaimExemption(coo);
  if (!ex) {
    res.json({ available: false, coo });
    return;
  }
  res.json({
    available: true,
    coo,
    claim_id: ex.claim_id,
    label: ex.label,
    heading: ex.heading,
    basis: ex.basis,
    zeros_col1_and_mpf: ex.claim_id === "USMCA" || ex.claim_id === "CAFTA_DR",
    hint:
      ex.claim_id === "USMCA" || ex.claim_id === "CAFTA_DR"
        ? `Claim ${ex.label}: Free Column-1 + MPF exempt. Also reports ${ex.heading} @ 0% for 301-FL when that program applies. Other programs need their own ${ex.label} Chapter 99 exception.`
        : `Claim ${ex.label} if goods qualify — reports ${ex.heading} @ 0% for 301-FL only. Does not zero Column-1 or MPF.`,
  });
});

referenceRouter.get("/reference/rate-date-hierarchy", (_req, res) => {
  res.json({
    authority: "19 CFR 141.68 / 141.69",
    hierarchy: [
      {
        cite: "141.68(a)",
        branch: "latest_release",
        explanation: "Consumption entry — rate in effect on the date of release.",
      },
      {
        cite: "141.68(b)",
        branch: "IT date",
        explanation: "Immediate transportation — rate in effect on the IT date.",
      },
      {
        cite: "141.69",
        branch: "warehouse_withdrawal",
        explanation: "Warehouse withdrawal — rate in effect on the withdrawal date.",
      },
    ],
  });
});

referenceRouter.get("/reference/stacking-order", (_req, res) => {
  void STATE;
  res.json({
    authority: "CBP Form 7501 / Chapter 99 reporting sequence",
    sequence: [
      { slot: "3.1", line: "Section 301 (incl. China legacy lists)" },
      { slot: "3.2", line: "Section 122 / 301-FL (incl. suppressions)" },
      { slot: "3.3", line: "Section 232 (autos, metals, trade-deal headings)" },
      { slot: "3.4", line: "Section 201" },
      { slot: "6.0", line: "Chapters 1–97 commodity line" },
    ],
    note:
      "CBP entry-summary reporting sequence: Ch.99 lines report before the Ch.1–97 line. Where legacy China 301 and 232 both apply, 301 reports first.",
    hts_table: htsTableMeta(),
  });
});

referenceRouter.get("/reference/program-eras", (_req, res) => {
  res.json(STACKING_CONTRACT);
});

referenceRouter.post(
  "/reference/hts",
  requireScope("write_rules"),
  requireAdmin,
  (req, res) => {
    try {
      const body = req.body;
      const rowsIn = Array.isArray(body) ? body : body?.rows;
      if (!Array.isArray(rowsIn) || !rowsIn.length) {
        res.status(400).json({ detail: "Body must be a non-empty array of HTS rate rows." });
        return;
      }
      const { rates, replacements, problems } = normalizeCsvHtsRows(rowsIn);
      if (problems.length && !rates.length && !replacements.length) {
        res.status(400).json({ detail: "No valid rows", problems: problems.slice(0, 40) });
        return;
      }
      const replace = Boolean(body?.replace);
      const source =
        String(body?.source_ref || body?.source || "HTSUS CSV upload").slice(0, 200) ||
        "HTSUS CSV upload";
      const asOf = body?.as_of ? String(body.as_of).slice(0, 10) : undefined;
      let result: ReturnType<typeof mergeHtsRateRows> | null = null;
      if (rates.length) {
        result = mergeHtsRateRows(rates, {
          source,
          as_of: asOf,
          replace,
        });
      }
      let replResult: ReturnType<typeof mergeHtsReplacements> | null = null;
      if (replacements.length) {
        replResult = mergeHtsReplacements(replacements, {
          source,
          as_of: asOf,
          replace: Boolean(body?.replace_replacements),
        });
      }
      const hts = reloadHtsTable();
      refreshRulepackState();
      res.json({
        ok: true,
        loaded: result?.upserted ?? 0,
        row_count: result?.row_count ?? hts.row_count,
        with_specific: result?.with_specific ?? null,
        replacements_upserted: replResult?.upserted ?? 0,
        replacements_total: replResult?.row_count ?? hts.replacements ?? 0,
        replace,
        source: result?.source || source,
        as_of: result?.as_of || asOf || null,
        hash: result?.hash || null,
        problems: problems.slice(0, 40),
        hts,
        reference_epoch: result?.hash || null,
      });
    } catch (e) {
      res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
    }
  },
);

referenceRouter.get("/reference/hts/:hts", (req, res) => {
  const asOf = String(req.query.as_of || new Date().toISOString().slice(0, 10));
  const look = lookupHts(String(req.params.hts), asOf);
  if (look.window_status === "unknown" && !look.replacement_hts) {
    res.status(404).json({
      detail: `No column-1 rate for ${req.params.hts} on ${asOf}`,
      window_status: look.window_status,
      as_of: asOf,
    });
    return;
  }
  const hit = look.hit || resolveCol1(String(req.params.hts), asOf);
  res.json({
    ...(hit || {}),
    as_of: asOf,
    table: htsTableMeta(),
    window_status: look.window_status,
    ended_on: look.ended_on,
    replacement_hts: look.replacement_hts,
    replacement_hts_display: look.replacement_hts_display,
    replacement_note: look.replacement_note,
    replacement_effective: look.replacement_effective,
    replacement: look.replacement,
  });
});
