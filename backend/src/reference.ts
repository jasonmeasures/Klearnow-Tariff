import { Router } from "express";
import { listCh99 } from "../../tariff-rules/src/tariffRules.ts";
import { htsTableMeta, resolveCol1 } from "./htsLookup.ts";
import { STACKING_CONTRACT } from "./rulesContract.ts";
import { STATE } from "./state.ts";

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

referenceRouter.post("/reference/hts", (_req, res) => {
  res.status(403).json({
    detail:
      "HTS rate upload is disabled in v1. Re-import with: cd backend && npm run import:hts",
  });
});

referenceRouter.get("/reference/hts/:hts", (req, res) => {
  const asOf = String(req.query.as_of || new Date().toISOString().slice(0, 10));
  const hit = resolveCol1(String(req.params.hts), asOf);
  if (!hit) {
    res.status(404).json({ detail: `No column-1 rate for ${req.params.hts} on ${asOf}` });
    return;
  }
  res.json({ ...hit, as_of: asOf, table: htsTableMeta() });
});
