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
        entry_date: "2026-07-17",
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

  it("JP 232 top-up 2.5% col-1 → 15.0%", () => {
    const L = assessLine(
      {
        hts: "8708.29.5160",
        coo: "JP",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: "2026-07-17",
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
        entry_date: "2026-07-17",
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
        entry_date: "2026-07-17",
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
        entry_date: "2026-07-17",
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
        entry_date: "2026-07-17",
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
        entry_date: "2026-07-17",
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
          entry_date: "2026-07-17",
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
        entry_date: "2026-07-17",
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
