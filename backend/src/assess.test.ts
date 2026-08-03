import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTradeDealTotal } from "../../tariff-rules/src/tariffRules.ts";
import { assessLine, auditEntry } from "./assess.ts";
import { resolveCol1 } from "./htsLookup.ts";

describe("golden duty paths", () => {
  it("CN List 3 + 232 + 2.5% col-1 → 52.5%", () => {
    const L = assessLine(
      {
        hts: "8708.29.5160",
        coo: "CN",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: "2026-07-25",
        flags: { s301_list_3: true, s232_auto_part: true },
      },
      0,
    );
    assert.equal(L.totals.effective_duty_rate_pct, 52.5);
    assert.equal(L.totals.duty, 5250);
    assert.ok(L.ch99_sequence.includes("9903.88.03"));
    assert.ok(L.ch99_sequence.includes("9903.94.05"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.ok(L.suppressed.some((s) => s.ch99 === "9903.05.31")); // CN flat FL heading
  });

  it("CN lubricating oil 2710193020 → List 2 9903.88.02 even if List 3 claimed", () => {
    const L = assessLine(
      {
        hts: "2710193020",
        coo: "CN",
        entered_value: 1000,
        entry_date: "2026-08-03",
        quantity: 100,
        quantity_uom: "BBL",
        flags: { s301_list_3: true, s232_auto_part: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.88.02"));
    assert.ok(!L.ch99_sequence.includes("9903.88.03"));
    assert.ok(L.diagnostics.some((d) => d.code === "S301_LIST_CLAIM_MISMATCH"));
    assert.ok(L.china_301?.list === "list_2");
    // 25% 301 + 25% 232 + 100 BBL × $0.84 = 250 + 250 + 84
    assert.equal(L.totals.specific_duty, 84);
    assert.equal(L.totals.duty, 584);
    assert.ok(L.usitc_url.includes("2710193020"));
  });

  it("oil specific rate requires BBL quantity", () => {
    const L = assessLine(
      {
        hts: "2710193020",
        coo: "CN",
        entered_value: 1000,
        entry_date: "2026-08-03",
        flags: {},
      },
      0,
    );
    assert.ok(L.needs_quantity);
    assert.ok(L.diagnostics.some((d) => d.code === "QTY_REQUIRED_FOR_SPECIFIC"));
    assert.match(L.col1_rate_label || "", /84¢\/BBL|84¢\/bbl/i);
  });

  it("7307923030 steel fittings require metal content + melt/pour", () => {
    const L = assessLine(
      {
        hts: "7307923030",
        coo: "TH",
        entered_value: 10000,
        entry_date: "2026-07-27",
        flags: {},
      },
      0,
    );
    assert.ok(L.metals?.metal === "steel");
    assert.ok(L.diagnostics.some((d) => d.code === "METAL_CONTENT_REQUIRED"));
    assert.equal(L.blocked, true);
  });

  it("7307923030 TH + CN melt/pour → 9903.05.90 + 9903.82.02 @ 50%", () => {
    const L = assessLine(
      {
        hts: "7307923030",
        coo: "TH",
        entered_value: 10000,
        metal_content_value: 10000,
        country_of_melt_pour: "CN",
        entry_date: "2026-07-27",
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.ok(L.ch99_sequence.includes("9903.82.02"));
    assert.ok(!L.ch99_sequence.some((c) => c.startsWith("9903.05.") && c !== "9903.05.90"));
    assert.equal(L.totals.metals_duty, 5000);
    assert.equal(L.totals.duty, 5000);
    assert.equal(L.totals.effective_duty_rate_pct, 50);
    assert.ok(L.diagnostics.some((d) => d.code === "ADCVD_MAY_APPLY"));
    const m = L.layers.find((x) => x.ch99 === "9903.82.02");
    assert.equal(m?.duty_amount, 5000);
    assert.equal(m?.rate_pct, 0.5);
  });

  it("7307923030 accepts metal content as % of entered value", () => {
    const L = assessLine(
      {
        hts: "7307923030",
        coo: "TH",
        entered_value: 10000,
        metal_content_pct: 80,
        country_of_melt_pour: "CN",
        entry_date: "2026-07-27",
        flags: {},
      },
      0,
    );
    assert.equal(L.metals?.metal_basis_mode, "PCT");
    assert.equal(L.metals?.metal_content_value, 8000);
    assert.equal(L.totals.metals_duty, 4000); // 50% × 8000
    assert.equal(L.totals.duty, 4000);
  });

  it("mixed steel + aluminum content sums for 232 metals basis", () => {
    const L = assessLine(
      {
        hts: "7307923030",
        coo: "TH",
        entered_value: 10000,
        metal_contents: {
          steel: { value: 6000, melt_pour: "CN" },
          aluminum: { value: 2000, melt_pour: "CA" },
        },
        entry_date: "2026-07-27",
        flags: {},
      },
      0,
    );
    assert.ok(L.diagnostics.some((d) => d.code === "MIXED_METAL_CONTENT"));
    assert.equal(L.metals?.metal_content_value, 8000);
    assert.equal(L.totals.metals_duty, 4000);
    assert.equal(L.ch99_sequence.includes("9903.82.02"), true);
  });

  it("compound Column-1: % ad valorem + ¢/unit when both present", () => {
    const hit = resolveCol1("2710193020", "2026-08-03");
    assert.ok(hit);
    assert.equal(hit!.col1_pct, 0);
    assert.ok((hit!.col1_specific_usd || 0) > 0.8);
    assert.equal(hit!.uom1, "BBL");
    assert.equal(hit!.needs_quantity, true);
    assert.ok(hit!.rate_label.includes("84¢/BBL") || hit!.rate_label.includes("84¢/bbl"));
  });

  it("JP 232 top-up 2.5% col-1 → 15.0%", () => {
    const L = assessLine(
      {
        hts: "8708.29.5160",
        coo: "JP",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: "2026-07-25",
        flags: { s232_auto_part: true },
      },
      0,
    );
    assert.equal(L.totals.effective_duty_rate_pct, 15);
    assert.equal(L.totals.duty, 1500);
    const commodity = L.layers.find((x) => x.program === "base");
    assert.equal(commodity?.duty_amount, 0);
  });

  it("JP non-232 → 12.5% (301-FL combined-to-cap via 9903.05.49)", () => {
    const L = assessLine(
      {
        hts: "8708.29.5160",
        coo: "JP",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: "2026-07-25",
        flags: {},
      },
      0,
    );
    assert.equal(L.totals.effective_duty_rate_pct, 12.5);
    assert.equal(L.totals.duty, 1250);
    assert.ok(L.ch99_sequence.includes("9903.05.49"));
  });

  it("BR flat 301-FL 12.5% via 9903.05.27", () => {
    const L = assessLine(
      {
        hts: "8708.10.3050",
        coo: "BR",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: "2026-07-25",
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.05.27"));
    assert.equal(L.totals.effective_duty_rate_pct, 15); // 12.5 + 2.5
  });

  it("DE maps to EU threshold (cap 10%)", () => {
    const L = assessLine(
      {
        hts: "8708.10.3050",
        coo: "DE",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: "2026-07-25",
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.05.39"));
    assert.equal(L.totals.effective_duty_rate_pct, 10);
  });
});

describe("safety contract", () => {
  it("rejects filed IEEPA headings", () => {
    const L = assessLine(
      {
        hts: "8708.29.5160",
        coo: "JP",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: "2026-07-25",
        filed_ch99: ["9903.01.33"],
        flags: {},
      },
      0,
    );
    assert.ok(L.diagnostics.some((d) => d.code === "DEAD_PROGRAM_IEEPA"));
  });

  it("blocks trade-deal MFN totals (R6)", () => {
    assert.throws(() => computeTradeDealTotal("9903.94.45", 0.025));
    const L = assessLine(
      {
        hts: "3926.90.9985",
        coo: "DE",
        entered_value: 10000,
        col1_rate_pct: 5.9,
        entry_date: "2026-07-25",
        flags: { trade_deal_eu: true },
      },
      0,
    );
    assert.ok(L.diagnostics.some((d) => d.code === "DATA_GAP_MFN_CAP_RULE"));
    assert.equal(L.blocked, true);
  });

  it("audit flags missing filed Chapter 99", () => {
    const R = auditEntry({
      lines: [
        {
          line_id: "1",
          hts: "8708.29.5160",
          coo: "CN",
          entered_value: 10000,
          col1_rate_pct: 2.5,
          entry_date: "2026-07-25",
          flags: { s301_list_3: true, s232_auto_part: true },
          filed_ch99: ["9903.88.03"],
        },
      ],
    });
    assert.ok(R.findings.some((f) => f.category === "MISSING_CH99"));
  });
});

describe("HTS column-1 table", () => {
  it("resolves 8708103050 from the imported table", () => {
    const hit = resolveCol1("8708.10.3050", "2026-07-17");
    assert.ok(hit, "expected HTS hit");
    assert.equal(hit!.col1_pct, 2.5);
  });

  it("auto-fills col1 when omitted on assess", () => {
    const L = assessLine(
      {
        hts: "8708.10.3050",
        coo: "JP",
        entered_value: 10000,
        entry_date: "2026-07-25",
        flags: {},
      },
      0,
    );
    assert.equal(L.col1_source, "hts_table");
    assert.equal(L.col1_rate_pct, 2.5);
    assert.ok(L.diagnostics.some((d) => d.code === "COL1_RESOLVED"));
    assert.equal(L.totals.effective_duty_rate_pct, 12.5);
  });
});
