import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeTradeDealTotal } from "../../tariff-rules/src/tariffRules.ts";
import { assessLine, auditEntry, assessEntry } from "./assess.ts";
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

  it("CN 7601103000 on 2026-08-18 → 9903.91.01 + 232 metals 9903.82.02", () => {
    const L = assessLine(
      {
        hts: "7601103000",
        coo: "CN",
        entered_value: 10000,
        metal_content_value: 10000,
        country_of_melt_pour: "CN",
        entry_date: "2026-08-18",
        flags: { s301_list_3: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.91.01"));
    assert.ok(L.ch99_sequence.includes("9903.82.02"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.ok(!L.ch99_sequence.includes("9903.88.03"));
    assert.ok(
      L.ch99_sequence.indexOf("9903.91.01") < L.ch99_sequence.indexOf("9903.82.02"),
    );
    assert.equal(L.china_301_fy?.ch99, "9903.91.01");
    // 2.6% col-1 + 25% note 31 + 50% 232 on metal content
    assert.equal(L.totals.effective_duty_rate_pct, 77.6);
    assert.equal(L.totals.duty, 7760);
  });

  it("VN 7601103000 does not get 9903.91.01", () => {
    const L = assessLine(
      {
        hts: "7601103000",
        coo: "VN",
        entered_value: 10000,
        metal_content_value: 10000,
        country_of_melt_pour: "VN",
        entry_date: "2026-08-18",
      },
      0,
    );
    assert.ok(!L.ch99_sequence.includes("9903.91.01"));
    assert.ok(L.ch99_sequence.includes("9903.82.02"));
  });

  it("CN 7601103000 before 2024-09-27 does not get 9903.91.01", () => {
    const L = assessLine(
      {
        hts: "7601103000",
        coo: "CN",
        entered_value: 10000,
        metal_content_value: 10000,
        country_of_melt_pour: "CN",
        entry_date: "2024-09-26",
      },
      0,
    );
    assert.ok(!L.ch99_sequence.includes("9903.91.01"));
  });

  it("CN 4015.12.10 gloves → 9903.91.05 in 2025 and 9903.91.08 in 2026", () => {
    const y25 = assessLine(
      {
        hts: "4015121000",
        coo: "CN",
        entered_value: 1000,
        col1_rate_pct: 7.5,
        entry_date: "2025-06-01",
      },
      0,
    );
    const y26 = assessLine(
      {
        hts: "4015121000",
        coo: "CN",
        entered_value: 1000,
        col1_rate_pct: 7.5,
        entry_date: "2026-08-18",
      },
      0,
    );
    assert.ok(y25.ch99_sequence.includes("9903.91.05"));
    assert.ok(!y25.ch99_sequence.includes("9903.91.08"));
    assert.ok(y26.ch99_sequence.includes("9903.91.08"));
    assert.ok(!y26.ch99_sequence.includes("9903.91.05"));
  });

  it("CN enteral syringe 9018310080 exclusion expires 2026-01-01", () => {
    const y25 = assessLine(
      { hts: "9018310080", coo: "CN", entered_value: 1000, entry_date: "2025-10-01" },
      0,
    );
    const y26 = assessLine(
      { hts: "9018310080", coo: "CN", entered_value: 1000, entry_date: "2026-08-18" },
      0,
    );
    assert.ok(y25.ch99_sequence.includes("9903.91.10"));
    assert.ok(!y25.ch99_sequence.includes("9903.91.03"));
    assert.ok(y26.ch99_sequence.includes("9903.91.03"));
    assert.ok(!y26.ch99_sequence.includes("9903.91.10"));
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
    // Metals duty held back, but Sec 122 / 301-FL era layers can still resolve on entered value.
    assert.ok(!L.ch99_sequence.includes("9903.82.02"));
    assert.ok(L.ch99_sequence.includes("9903.05.77") || L.ch99_sequence.some((c) => c.startsWith("9903.05.")));
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
    // Off Proclamation 10908 annex (8544.42 ≠ 8544.30) so 232 does not auto-apply
    const L = assessLine(
      {
        hts: "8544429090",
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

  it("TW 8544.42.9090 + 10% copper → 9903.82.03 and 9903.05.76 (not 05.90)", () => {
    const L = assessLine(
      {
        hts: "8544429090",
        coo: "TW",
        entered_value: 10000,
        col1_rate_pct: 2.6,
        entry_date: "2026-08-21",
        metal_contents: { copper: { pct: 10 } },
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.82.03"));
    assert.ok(L.ch99_sequence.includes("9903.05.76"));
    assert.ok(!L.ch99_sequence.includes("9903.05.90"));
    assert.ok(!L.ch99_sequence.includes("9903.82.09"));
    const ex = L.layers.find((x) => x.ch99 === "9903.82.03");
    assert.equal(ex?.duty_amount, 0);
    assert.ok(L.diagnostics.some((d) => d.code === "S232_METALS_DE_MINIMIS"));
  });

  it("TW 8544.42.9090 + 15% copper → 9903.82.09 and 9903.05.90", () => {
    const L = assessLine(
      {
        hts: "8544429090",
        coo: "TW",
        entered_value: 10000,
        col1_rate_pct: 2.6,
        entry_date: "2026-08-21",
        metal_contents: { copper: { pct: 15 } },
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.82.09"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.ok(!L.ch99_sequence.includes("9903.82.03"));
    assert.ok(!L.ch99_sequence.includes("9903.05.76"));
    assert.equal(L.totals.metals_duty, 2500);
  });

  it("Ch.73 article with 10% metal still uses 9903.82.02, not 82.03", () => {
    const L = assessLine(
      {
        hts: "7307923030",
        coo: "TH",
        entered_value: 10000,
        metal_content_pct: 10,
        country_of_melt_pour: "CN",
        entry_date: "2026-07-27",
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.82.02"));
    assert.ok(!L.ch99_sequence.includes("9903.82.03"));
    assert.equal(L.totals.metals_duty, 500); // 50% × $1,000
  });

  it("BR stacks Brazil 301 9903.05.01 @ 25% + 301-FL 9903.05.27 @ 12.5%", () => {
    const L = assessLine(
      {
        hts: "8544429090",
        coo: "BR",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: "2026-07-25",
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.05.01"));
    assert.ok(L.ch99_sequence.includes("9903.05.27"));
    assert.equal(L.ch99_sequence.indexOf("9903.05.01") < L.ch99_sequence.indexOf("9903.05.27"), true);
    assert.equal(L.totals.effective_duty_rate_pct, 40); // 25 + 12.5 + 2.5
    assert.equal(L.totals.duty, 4000);
  });

  it("BR plastic 3926909989 → Brazil 301 + 301-FL + col-1 (screenshot path)", () => {
    const L = assessLine(
      {
        hts: "3926909989",
        coo: "BR",
        entered_value: 10000,
        col1_rate_pct: 5.29,
        entry_date: "2026-08-06",
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.05.01"));
    assert.ok(L.ch99_sequence.includes("9903.05.27"));
    assert.equal(L.totals.effective_duty_rate_pct, 42.79); // 25 + 12.5 + 5.29
    assert.equal(L.totals.duty, 4279);
  });

  it("BR + 232 → Brazil 301 exempt 9903.05.07 and FL suppressed via 9903.05.90", () => {
    const L = assessLine(
      {
        hts: "8708103050",
        coo: "BR",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: "2026-08-06",
        flags: { s232_auto_part: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.05.07"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.ok(!L.ch99_sequence.includes("9903.05.01"));
    assert.ok(!L.ch99_sequence.includes("9903.05.27"));
    // 232 25% + col-1 2.5% (Brazil 301 @ 0)
    assert.equal(L.totals.effective_duty_rate_pct, 27.5);
  });

  it("BR before 2026-07-22 → no Brazil 301; Sec 122 only if in window", () => {
    const L = assessLine(
      {
        hts: "3926909989",
        coo: "BR",
        entered_value: 10000,
        col1_rate_pct: 5.29,
        entry_date: "2026-07-21",
        flags: {},
      },
      0,
    );
    assert.ok(!L.ch99_sequence.includes("9903.05.01"));
    assert.ok(!L.ch99_sequence.includes("9903.05.27"));
    assert.ok(L.ch99_sequence.includes("9903.03.01"));
  });

  it("CN plastic 3926909989 → List 4A 9903.88.15 @ 7.5% + 301-FL 12.5% + col-1", () => {
    const L = assessLine(
      {
        hts: "3926909989",
        coo: "CN",
        entered_value: 10000,
        col1_rate_pct: 5.29,
        entry_date: "2026-08-06",
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.88.15"));
    assert.ok(L.ch99_sequence.includes("9903.05.31"));
    assert.equal(
      L.ch99_sequence.indexOf("9903.88.15") < L.ch99_sequence.indexOf("9903.05.31"),
      true,
    );
    assert.equal(L.totals.effective_duty_rate_pct, 25.29); // 7.5 + 12.5 + 5.29
    assert.equal(L.totals.duty, 2529);
    assert.ok(L.diagnostics.some((d) => d.code === "S301_LIST_RESOLVED"));
  });

  it("CN HTS with no seeded list membership warns and does not invent China 301", () => {
    const L = assessLine(
      {
        hts: "9703000000",
        coo: "CN",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: "2026-08-06",
        flags: {},
      },
      0,
    );
    assert.ok(!L.ch99_sequence.some((c) => String(c).startsWith("9903.88")));
    assert.ok(L.ch99_sequence.includes("9903.05.31"));
    assert.ok(
      L.diagnostics.some(
        (d) => d.severity === "WARNING" && d.code === "S301_LIST_UNKNOWN",
      ),
    );
  });

  it("DE maps to EU threshold (cap 10%)", () => {
    const L = assessLine(
      {
        hts: "8544429090",
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

  it("unknown HTS with no replacement blocks the stack (no Free / no Ch.99 invent)", () => {
    const L = assessLine(
      {
        hts: "1805.00.0000",
        coo: "DE",
        entered_value: 10000,
        entry_date: "2026-08-07",
        flags: {},
      },
      0,
    );
    assert.equal(L.blocked, true);
    assert.equal(L.layers.length, 0);
    assert.equal(L.ch99_sequence.length, 0);
    assert.equal(L.totals.duty, 0);
    assert.equal(L.totals.effective_duty_rate_pct, null);
    assert.ok(L.diagnostics.some((d) => d.severity === "ERROR" && d.code === "UNKNOWN_HTS"));
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
        hts: "8544429090",
        coo: "JP",
        entered_value: 10000,
        entry_date: "2026-07-25",
        flags: {},
      },
      0,
    );
    assert.equal(L.col1_source, "hts_table");
    assert.equal(L.col1_rate_pct, 2.6);
    assert.ok(L.diagnostics.some((d) => d.code === "COL1_RESOLVED"));
    // Off-annex JP → 301-FL combined to 12.5% (2.6 + 9.9)
    assert.equal(L.totals.effective_duty_rate_pct, 12.5);
  });
});

describe("program era routing", () => {
  it("Jul 10 expects Sec 122; Jul 25 expects 301-FL and flags late Sec 122", () => {
    const a = auditEntry({
      lines: [
        {
          line_id: "jul10",
          hts: "6306120000",
          coo: "CN",
          entered_value: 10000,
          entry_date: "2026-07-10",
          release_date: "2026-07-10",
          filed_ch99: ["9903.03.01"],
        },
        {
          line_id: "jul25",
          hts: "6306120000",
          coo: "CN",
          entered_value: 10000,
          entry_date: "2026-07-25",
          release_date: "2026-07-25",
          filed_ch99: ["9903.03.01"],
        },
      ],
    });
    const jul10 = a.lines.find((l) => l.line_id === "jul10")!;
    const jul25 = a.lines.find((l) => l.line_id === "jul25")!;
    assert.ok(jul10.ch99_sequence.includes("9903.03.01"));
    assert.ok(!jul10.ch99_sequence.some((c) => c.startsWith("9903.05.") && c !== "9903.05.90"));
    assert.ok(jul25.ch99_sequence.some((c) => c.startsWith("9903.05.")));
    assert.ok(!jul25.ch99_sequence.includes("9903.03.01"));
    assert.equal(a.findings.filter((f) => f.line_id === "jul10").length, 0);
    assert.ok(a.findings.some((f) => f.line_id === "jul25" && f.category === "WRONG_ERA"));
    assert.ok(a.findings.some((f) => f.line_id === "jul25" && f.category === "MISSING_CH99"));
  });

  it("Sec 122 filed on one ESL satisfies other ESLs on the same entry", () => {
    const a = auditEntry({
      lines: [
        {
          line_id: "BII1:1",
          hts: "6306120000",
          coo: "CN",
          entered_value: 10000,
          entry_date: "2026-06-25",
          release_date: "2026-06-25",
          filed_ch99: ["9903.03.01"],
        },
        {
          line_id: "BII1:2",
          hts: "7321890050",
          coo: "CN",
          entered_value: 7000,
          entry_date: "2026-06-25",
          release_date: "2026-06-25",
          filed_ch99: ["9903.88.15", "9903.82.09", "9903.03.06"],
        },
      ],
    });
    assert.ok(!a.findings.some((f) => f.category === "MISSING_CH99" && f.message.includes("9903.03.01")));
    assert.ok(!a.findings.some((f) => f.category === "EXTRA_CH99" && f.message.includes("9903.88.15")));
    assert.ok(!a.findings.some((f) => f.category === "EXTRA_CH99" && f.message.includes("9903.82.09")));
    assert.ok(!a.findings.some((f) => f.category === "EXTRA_CH99" && f.message.includes("9903.03.06")));
    const metals = a.lines.find((l) => l.line_id === "BII1:2")!;
    assert.ok(metals.ch99_sequence.includes("9903.88.15"));
    assert.ok(metals.ch99_sequence.includes("9903.03.06"));
    assert.ok(metals.ch99_sequence.includes("9903.82.09"));
    assert.ok(!metals.ch99_sequence.includes("9903.03.01"));
  });

  it("China List 4A stacks with Sec 122 on non-metals CN lines", () => {
    const L = assessLine(
      {
        hts: "6306120000",
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-06-25",
        flags: { s301_list_4a: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.88.15"));
    assert.ok(L.ch99_sequence.includes("9903.03.01"));
  });

  it("9903.82.09 + 9903.03.06 produce for derivative HTS (9406) — not EXTRA", () => {
    const a = auditEntry({
      lines: [
        {
          line_id: "prefab:1",
          hts: "9406900190",
          coo: "CN",
          entered_value: 21560,
          entry_date: "2026-07-07",
          filed_ch99: ["9903.88.03", "9903.03.06", "9903.82.09"],
        },
      ],
    });
    const L = a.lines[0];
    assert.ok(L.ch99_sequence.includes("9903.88.03"));
    assert.ok(L.ch99_sequence.includes("9903.03.06"));
    assert.ok(L.ch99_sequence.includes("9903.82.09"));
    assert.ok(!L.ch99_sequence.includes("9903.03.01"));
    assert.ok(!a.findings.some((f) => f.category === "EXTRA_CH99"));
    assert.ok(!a.findings.some((f) => f.category === "MISSING_CH99"));
    // 25% 301 List 3 + 25% 232.09 on entered = 50% → $10,780 (+ col1 if any)
    assert.ok(L.totals.duty >= 10780);
  });

  it("8544.30.00 annex → auto 232 for DE; suppresses 301-FL", () => {
    const L = assessLine(
      {
        hts: "8544.30.0000",
        coo: "DE",
        entered_value: 566,
        entry_date: "2026-08-04",
      },
      0,
    );
    assert.ok(L.diagnostics.some((d) => d.code === "S232_ANNEX_HIT"));
    assert.ok(L.ch99_sequence.includes("9903.94.53"));
    assert.ok(!L.ch99_sequence.includes("9903.94.05"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.ok(!L.ch99_sequence.includes("9903.05.39"));
  });

  it("8544.42.9090 is NOT on annex → 301-FL for DE unless claimed", () => {
    const plain = assessLine(
      {
        hts: "8544429090",
        coo: "DE",
        entered_value: 566,
        entry_date: "2026-08-04",
      },
      0,
    );
    assert.ok(plain.diagnostics.some((d) => d.code === "S232_ANNEX_MISS"));
    assert.ok(plain.ch99_sequence.includes("9903.05.39"));
    assert.ok(!plain.ch99_sequence.includes("9903.94.05"));

    const claimed = assessLine(
      {
        hts: "8544429090",
        coo: "DE",
        entered_value: 566,
        entry_date: "2026-08-04",
        flags: { s232_auto_part: true },
      },
      0,
    );
    assert.ok(claimed.diagnostics.some((d) => d.code === "S232_ANNEX_CLAIM_GATED"));
    assert.ok(claimed.ch99_sequence.includes("9903.94.53"));
    assert.ok(!claimed.ch99_sequence.includes("9903.94.05"));
    assert.ok(claimed.ch99_sequence.includes("9903.05.90"));
  });

  it("HK 8483.50.9040 off-list auto-part claim → 9903.94.07 + 9903.05.90", () => {
    const plain = assessLine(
      {
        hts: "8483509040",
        coo: "HK",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: "2026-08-21",
        flags: {},
      },
      0,
    );
    assert.ok(plain.ch99_sequence.includes("9903.05.43"));
    assert.ok(!plain.ch99_sequence.includes("9903.94.07"));
    assert.ok(!plain.ch99_sequence.includes("9903.94.05"));

    const claimed = assessLine(
      {
        hts: "8483509040",
        coo: "HK",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: "2026-08-21",
        flags: { s232_auto_part: true },
      },
      0,
    );
    assert.ok(claimed.diagnostics.some((d) => d.code === "S232_ANNEX_CLAIM_GATED"));
    assert.ok(claimed.ch99_sequence.includes("9903.94.07"));
    assert.ok(claimed.ch99_sequence.includes("9903.05.90"));
    assert.ok(!claimed.ch99_sequence.includes("9903.94.05"));
    assert.ok(!claimed.ch99_sequence.includes("9903.05.43"));
  });

  it("MX plastics without USMCA → Col-1 + 301-FL flat 10%; with fta_usmca → Free Col-1 + 9903.05.94 + MPF exempt", () => {
    const base = {
      hts: "3907690050",
      coo: "MX",
      entered_value: 37626.88,
      entry_date: "2026-08-07",
    };
    const without = assessLine({ ...base, flags: {} }, 0);
    assert.ok(without.ch99_sequence.includes("9903.05.55"));
    assert.ok(without.fta_compare?.available);
    assert.equal(without.fta_compare?.claimed, false);
    assert.equal(without.fta_compare?.label, "USMCA");
    assert.ok(without.diagnostics.some((d) => d.code === "FTA_CLAIM_AVAILABLE"));
    // 6.5% + 10% = 16.5%
    assert.equal(without.totals.effective_duty_rate_pct, 16.5);
    assert.equal(without.mpf_exempt, false);

    const withClaim = assessLine({ ...base, flags: { fta_usmca: true } }, 0);
    assert.ok(withClaim.ch99_sequence.includes("9903.05.94"));
    assert.ok(!withClaim.ch99_sequence.includes("9903.05.55"));
    assert.equal(withClaim.fta_compare?.claimed, true);
    assert.equal(withClaim.totals.effective_duty_rate_pct, 0);
    assert.equal(withClaim.totals.ad_valorem_commodity_duty, 0);
    assert.equal(withClaim.col1_rate_label, "Free");
    assert.equal(withClaim.mpf_exempt, true);
    assert.ok(withClaim.spi_preference?.claim_id === "USMCA");
    assert.ok(withClaim.suppressed.some((s) => s.ch99 === "9903.05.55"));
    assert.ok(withClaim.diagnostics.some((d) => d.code === "SPI_PREFERENCE_APPLIED"));
    assert.equal(withClaim.fta_compare?.with_claim?.effective_duty_rate_pct, 0);
    assert.equal(withClaim.fta_compare?.without_claim?.effective_duty_rate_pct, 16.5);
  });

  it("USMCA entry: MPF amount is $0; HMF still applies on ocean", () => {
    const R = assessEntry({
      mode_of_transport: "OCEAN",
      formal_entry: true,
      lines: [
        {
          hts: "3907690050",
          coo: "MX",
          entered_value: 37626.88,
          entry_date: "2026-08-07",
          flags: { fta_usmca: true },
        },
      ],
    });
    const mpf = R.entry_fees.find((f: { code: string }) => f.code === "MPF");
    assert.ok(mpf);
    assert.equal(mpf!.amount, 0);
    assert.match(mpf!.rate_note, /Exempt/i);
    const hmf = R.entry_fees.find((f: { code: string }) => f.code === "HMF");
    assert.ok(hmf && hmf.amount > 0);
    assert.equal(R.totals.duty, 0);
    assert.equal(R.hmf_applies, true);
    assert.equal(R.mode_of_transport, "OCEAN");
  });

  it("air MOT: MPF still due; HMF is $0", () => {
    const R = assessEntry({
      mode_of_transport: "AIR",
      formal_entry: true,
      lines: [
        {
          hts: "6203420711",
          coo: "VN",
          entered_value: 25000,
          entry_date: "2026-07-25",
        },
      ],
    });
    const hmf = R.entry_fees.find((f: { code: string }) => f.code === "HMF");
    assert.ok(hmf);
    assert.equal(hmf!.amount, 0);
    assert.match(hmf!.rate_note, /Not due/i);
    assert.equal(R.hmf_applies, false);
    const mpf = R.entry_fees.find((f: { code: string }) => f.code === "MPF");
    assert.ok(mpf && mpf.amount > 0);
  });

  it("CA USMCA claim → 9903.05.93 + Free Col-1; DE Note 52 claim → 9903.05.97 only (Col-1 stays)", () => {
    const ca = assessLine(
      {
        hts: "3907690050",
        coo: "CA",
        entered_value: 10000,
        entry_date: "2026-08-07",
        flags: { fta_usmca: true },
      },
      0,
    );
    assert.ok(ca.ch99_sequence.includes("9903.05.93"));
    assert.equal(ca.fta_compare?.label, "USMCA");
    assert.equal(ca.totals.effective_duty_rate_pct, 0);
    assert.equal(ca.mpf_exempt, true);

    const de = assessLine(
      {
        hts: "3907690050",
        coo: "DE",
        entered_value: 10000,
        entry_date: "2026-08-07",
        flags: { fta_note_52: true },
      },
      0,
    );
    assert.ok(de.ch99_sequence.includes("9903.05.97"));
    assert.equal(de.fta_compare?.label, "Note 52 preference");
    assert.equal(de.mpf_exempt, false);
    // Col-1 still due under Note 52-only (plastics 6.5%); FL exempt
    assert.equal(de.totals.effective_duty_rate_pct, 6.5);
  });

  it("MX plastics pharma use → 9903.05.89 @ 0% FL + Col-1 still due; USMCA wins if both claimed", () => {
    const base = {
      hts: "3907690050",
      coo: "MX",
      entered_value: 37626.88,
      entry_date: "2026-08-07",
    };
    const available = assessLine({ ...base, flags: {} }, 0);
    assert.ok(available.diagnostics.some((d) => d.code === "FL_PHARMA_AVAILABLE"));
    assert.ok(available.ch99_sequence.includes("9903.05.55"));
    assert.equal(available.totals.effective_duty_rate_pct, 16.5);

    const pharma = assessLine({ ...base, flags: { s301fl_pharma: true } }, 0);
    assert.ok(pharma.ch99_sequence.includes("9903.05.89"));
    assert.ok(!pharma.ch99_sequence.includes("9903.05.55"));
    assert.ok(pharma.diagnostics.some((d) => d.code === "FL_PHARMA_APPLIED"));
    // Col-1 6.5% remains — pharma does not zero Col-1 / MPF
    assert.equal(pharma.totals.effective_duty_rate_pct, 6.5);
    assert.equal(pharma.mpf_exempt, false);

    const both = assessLine(
      { ...base, flags: { fta_usmca: true, s301fl_pharma: true } },
      0,
    );
    assert.ok(both.ch99_sequence.includes("9903.05.94"));
    assert.ok(!both.ch99_sequence.includes("9903.05.89"));
    assert.equal(both.totals.effective_duty_rate_pct, 0);
    assert.ok(both.diagnostics.some((d) => d.code === "FL_PHARMA_SUPERSEDED"));
  });

  it("DE 2933.99.2200 pharma use → 9903.05.89 instead of EU 301-FL cap; Col-1 stays", () => {
    const base = {
      hts: "2933992200",
      coo: "DE",
      entered_value: 10000,
      entry_date: "2026-08-07",
    };
    const cap = assessLine({ ...base, flags: {} }, 0);
    assert.ok(
      cap.ch99_sequence.includes("9903.05.38") || cap.ch99_sequence.includes("9903.05.39"),
      `expected EU FL cap, got ${cap.ch99_sequence.join(",")}`,
    );
    assert.ok(!cap.ch99_sequence.includes("9903.05.89"));

    const pharma = assessLine({ ...base, flags: { s301fl_pharma: true } }, 0);
    assert.ok(pharma.ch99_sequence.includes("9903.05.89"));
    assert.ok(!pharma.ch99_sequence.includes("9903.05.38"));
    assert.ok(!pharma.ch99_sequence.includes("9903.05.39"));
    assert.ok(!pharma.ch99_sequence.includes("9903.04.62"));
    assert.ok(pharma.diagnostics.some((d) => d.code === "FL_PHARMA_APPLIED"));
    assert.equal(pharma.totals.effective_duty_rate_pct, 6.5);
    assert.equal(pharma.mpf_exempt, false);
    assert.ok(!pharma.fta_compare, "Note 52 compare should not replace the pharma vs EU-cap story");
    const pc = pharma.pharma_compare;
    assert.ok(pc?.claimed);
    assert.equal(pc.heading, "9903.05.89");
    assert.equal(pc.instead_of, "9903.05.39");
    assert.equal(pc.kind, "threshold_topup");
    assert.equal(pc.eu_cap, true);
    assert.equal(pc.cap_pct, 10);
    assert.equal(pc.col1_pct, 6.5);
    assert.equal(pc.additional_pct, 3.5);
    assert.equal(pc.additional_duty, 350);
    assert.equal(pc.with_claim.effective_duty_rate_pct, 6.5);
    assert.equal(pc.without_claim.effective_duty_rate_pct, 10);
    assert.equal(pc.without_claim.line_duty, 1000);
    const msg = pharma.diagnostics.find((d) => d.code === "FL_PHARMA_APPLIED")?.message || "";
    assert.match(msg, /skipped this EU cap/);
    assert.match(msg, /capped at 10%/);
    assert.match(msg, /Column-1 6\.5%/);
    assert.match(msg, /extra 3\.5%/);
    assert.match(msg, /\$350\.00/);
    assert.match(msg, /not a second 10%/);
    const suppressedEu = pharma.suppressed.find((s) => s.ch99 === "9903.05.39");
    assert.ok(suppressedEu);
    assert.match(suppressedEu.reason, /skipped this EU cap/);
    assert.match(suppressedEu.reason, /capped at 10%/);
    assert.match(suppressedEu.reason, /Column-1 6\.5%/);
    assert.match(suppressedEu.reason, /extra 3\.5%/);
    assert.match(suppressedEu.reason, /\$350\.00/);
    assert.match(suppressedEu.reason, /not a second 10%/);

    const both232 = assessLine(
      { ...base, flags: { s301fl_pharma: true, s232_pharma_patented: true } },
      0,
    );
    assert.ok(both232.ch99_sequence.includes("9903.05.89"));
    assert.ok(!both232.ch99_sequence.includes("9903.04.62"));
  });

  it("GB patented pharma Ch.29 → 9903.04.63 @ 0% + FL suppress; 3907 off-scope for 232 pharma", () => {
    const gb = assessLine(
      {
        hts: "2933990000",
        coo: "GB",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: "2026-08-01",
        flags: { s232_pharma_patented: true },
      },
      0,
    );
    assert.ok(gb.ch99_sequence.includes("9903.04.63"));
    assert.ok(gb.ch99_sequence.includes("9903.05.90"));
    assert.ok(!gb.ch99_sequence.some((c: string) => /^9903\.05\.(?!90)/.test(c)));
    assert.equal(gb.totals.duty, 0);
    assert.ok(gb.diagnostics.some((d) => d.code === "S232_PHARMA_APPLIED"));

    const plastics = assessLine(
      {
        hts: "3907690050",
        coo: "GB",
        entered_value: 10000,
        entry_date: "2026-08-01",
        flags: { s232_pharma_patented: true },
      },
      0,
    );
    assert.ok(plastics.diagnostics.some((d) => d.code === "S232_PHARMA_SCOPE"));
    assert.ok(!plastics.ch99_sequence.includes("9903.04.63"));
  });
});
