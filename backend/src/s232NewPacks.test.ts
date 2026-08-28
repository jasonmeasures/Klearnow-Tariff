import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessLine } from "./assess.ts";
import { previewS232Universe } from "../../tariff-rules/src/s232Resolve.ts";

const DATE = "2026-08-01";

describe("Section 232 new packs (wood / vehicles / MHDV / semiconductors)", () => {
  it("previews list membership without assessing", () => {
    const wood = previewS232Universe("4407110000");
    assert.equal(wood.wood?.ch99, "9903.76.01");
    const pv = previewS232Universe("8703230100");
    assert.equal(pv.passenger_vehicle?.ch99, "9903.94.01");
    const jp = previewS232Universe("8703230120", "JP", {
      rateDay: "2026-08-18",
      col1Rate: 0.025,
    });
    assert.equal(jp.passenger_vehicle?.ch99, "9903.94.41");
    const mhdv = previewS232Universe("8704230100");
    assert.equal(mhdv.mhdv_vehicle?.ch99, "9903.74.01");
    const bus = previewS232Universe("8702103100");
    assert.equal(bus.mhdv_bus?.ch99, "9903.74.02");
    const semi = previewS232Universe("8473300000");
    assert.ok(semi.semiconductor?.matched_stem);
  });

  it("CA softwood lumber → 9903.76.01 @ 10% and suppresses 301-FL", () => {
    const L = assessLine(
      {
        hts: "4407.11.00",
        coo: "CA",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.76.01"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.ok(!L.ch99_sequence.some((c) => c.startsWith("9903.05.") && c !== "9903.05.90"));
    assert.equal(L.totals.duty, 1000);
    assert.equal(L.totals.effective_duty_rate_pct, 10);
  });

  it("DE upholstered wooden furniture → 9903.76.22 @ 15%", () => {
    const L = assessLine(
      {
        hts: "9401.61.4011",
        coo: "DE",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.76.22"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.equal(L.totals.duty, 1500);
  });

  it("VN upholstered wooden furniture → 9903.76.02 @ 25%", () => {
    const L = assessLine(
      {
        hts: "9401.61.4011",
        coo: "VN",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.76.02"));
    assert.equal(L.totals.duty, 2500);
  });

  it("GB kitchen cabinets → 9903.76.20 @ 10%", () => {
    const L = assessLine(
      {
        hts: "9403.40.9060",
        coo: "GB",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.76.20"));
    assert.equal(L.totals.duty, 1000);
  });

  it("TW kitchen cabinets 9403.60.8093 → 9903.76.24 @ 15% (not .03 @ 25%)", () => {
    const L = assessLine(
      {
        hts: "9403.60.8093",
        coo: "TW",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.76.24"));
    assert.ok(!L.ch99_sequence.includes("9903.76.03"));
    assert.equal(L.totals.duty, 1500);
    assert.equal(L.totals.effective_duty_rate_pct, 15);
  });

  it("KR upholstered wooden furniture → 9903.76.23 @ 15%", () => {
    const L = assessLine(
      {
        hts: "9401.61.4011",
        coo: "KR",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.76.23"));
    assert.ok(!L.ch99_sequence.includes("9903.76.02"));
    assert.equal(L.totals.duty, 1500);
  });

  it("JP passenger vehicle → 9903.94.41 combined 15% (not .01, not parts .43)", () => {
    const L = assessLine(
      {
        hts: "8703.23.01",
        coo: "JP",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.94.41"));
    assert.ok(!L.ch99_sequence.includes("9903.94.01"));
    assert.ok(!L.ch99_sequence.includes("9903.94.43"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.equal(L.totals.effective_duty_rate_pct, 15);
    const commodity = L.layers.find((x) => x.program === "base");
    assert.equal(commodity?.duty_amount, 0);
  });

  it("vintage passenger vehicle claim → 9903.94.04 @ 0%", () => {
    const L = assessLine(
      {
        hts: "8703.23.01",
        coo: "DE",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: DATE,
        flags: { s232_vehicle_vintage: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.94.04"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    const layer = L.layers.find((x) => x.ch99 === "9903.94.04");
    assert.equal(layer?.duty_amount, 0);
  });

  it("MHDV dump truck 8704.23.01 → 9903.74.01 @ 25%", () => {
    const L = assessLine(
      {
        hts: "8704.23.01",
        coo: "DE",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.74.01"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.equal(L.totals.duty, 2500);
  });

  it("bus 8702.10.31 → 9903.74.02 @ 10%", () => {
    const L = assessLine(
      {
        hts: "8702.10.31",
        coo: "KR",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.74.02"));
    assert.equal(L.totals.duty, 1000);
  });

  it("MHDV parts list without claim does not auto-assess 25%", () => {
    const L = assessLine(
      {
        hts: "8709.90.00",
        coo: "DE",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.diagnostics.some((d) => d.code === "S232_MHDV_PARTS_LIST"));
    assert.ok(!L.ch99_sequence.includes("9903.74.08"));
  });

  it("MHDV parts claim on 8709.90.00 → 9903.74.08 @ 25%", () => {
    const L = assessLine(
      {
        hts: "8709.90.00",
        coo: "DE",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: { s232_mhdv_part: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.74.08"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.equal(L.totals.duty, 2500);
  });

  it("auto-parts annex still wins over MHDV parts list unless MHDV is claimed", () => {
    const L = assessLine(
      {
        hts: "8544.30.00",
        coo: "DE",
        entered_value: 10000,
        col1_rate_pct: 5,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.94.53"));
    // Dual-list: MHDV parts-list exclusion stacks @ 0% alongside auto-parts.
    assert.ok(L.ch99_sequence.includes("9903.74.11"));
    assert.ok(!L.ch99_sequence.includes("9903.74.08"));
    assert.ok(!L.ch99_sequence.includes("9903.94.05"));
    assert.equal(L.totals.effective_duty_rate_pct, 15);
  });

  it("dual-list 9401.20.00 / AT stacks EU auto-parts .53 with MHDV not-part .11", () => {
    const L = assessLine(
      {
        hts: "9401.20.00",
        coo: "AT",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.94.53"), `got ${L.ch99_sequence.join(",")}`);
    assert.ok(L.ch99_sequence.includes("9903.74.11"), `got ${L.ch99_sequence.join(",")}`);
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.ok(!L.ch99_sequence.includes("9903.74.08"));
    assert.equal(L.totals.effective_duty_rate_pct, 15);
  });

  it("MHDV-only parts list with s232_mhdv_not_part → 9903.74.11 alone", () => {
    const L = assessLine(
      {
        hts: "8709.90.00",
        coo: "DE",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: { s232_mhdv_not_part: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.74.11"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.ok(!L.ch99_sequence.includes("9903.74.08"));
    assert.equal(L.totals.duty, 0);
  });

  it("dual-list with s232_mhdv_part claim uses .08 not auto-parts", () => {
    const L = assessLine(
      {
        hts: "9401.20.00",
        coo: "AT",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: { s232_mhdv_part: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.74.08"));
    assert.ok(!L.ch99_sequence.includes("9903.94.53"));
    assert.ok(!L.ch99_sequence.includes("9903.74.11"));
    assert.equal(L.totals.duty, 2500);
  });

  it("semiconductor HTS without claim stays auto-parts for 8471.50; 8473.30 only warns", () => {
    const adp = assessLine(
      {
        hts: "8471.50.00",
        coo: "TW",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(adp.ch99_sequence.includes("9903.94.05"));
    assert.ok(adp.diagnostics.some((d) => d.code === "S232_SEMI_LIST"));

    const parts = assessLine(
      {
        hts: "8473.30.00",
        coo: "TW",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(parts.diagnostics.some((d) => d.code === "S232_SEMI_LIST"));
    assert.ok(!parts.ch99_sequence.includes("9903.79.01"));
  });

  it("semiconductor params claim on 8473.30 → 9903.79.01 @ 25%", () => {
    const L = assessLine(
      {
        hts: "8473.30.00",
        coo: "TW",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: { s232_semiconductor: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.79.01"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.equal(L.totals.duty, 2500);
  });

  it("semiconductor claim on 8471.50 beats auto-parts annex", () => {
    const L = assessLine(
      {
        hts: "8471.50.00",
        coo: "TW",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: DATE,
        flags: { s232_semiconductor: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.79.01"));
    assert.ok(!L.ch99_sequence.includes("9903.94.05"));
  });

  it("wood does not apply when auto-parts 232 already won", () => {
    // 8544.30 is auto-parts, not wood — sanity that wood pack doesn't leak
    const L = assessLine(
      {
        hts: "8544.30.00",
        coo: "CA",
        entered_value: 10000,
        col1_rate_pct: 5,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(!L.ch99_sequence.some((c) => c.startsWith("9903.76")));
  });

  it("DE passenger vehicle → 9903.94.51 combined 15%", () => {
    const L = assessLine(
      {
        hts: "8703.23.0120",
        coo: "DE",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.94.51"));
    assert.ok(!L.ch99_sequence.includes("9903.94.01"));
    assert.equal(L.totals.effective_duty_rate_pct, 15);
  });

  it("KR passenger vehicle → 9903.94.61 combined 15%", () => {
    const L = assessLine(
      {
        hts: "8703.23.0120",
        coo: "KR",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.94.61"));
    assert.equal(L.totals.effective_duty_rate_pct, 15);
  });

  it("TH passenger vehicle stays on 9903.94.01 @ 25% additional", () => {
    const L = assessLine(
      {
        hts: "8703.23.0120",
        coo: "TH",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.94.01"));
    assert.ok(!L.ch99_sequence.includes("9903.94.41"));
    assert.equal(L.totals.effective_duty_rate_pct, 27.5);
  });

  it("JP auto part stays 9903.94.43 not vehicle 9903.94.41", () => {
    const L = assessLine(
      {
        hts: "8708.10.3050",
        coo: "JP",
        entered_value: 10000,
        col1_rate_pct: 2.5,
        entry_date: DATE,
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.94.43"));
    assert.ok(!L.ch99_sequence.includes("9903.94.41"));
    assert.equal(L.totals.effective_duty_rate_pct, 15);
  });
});
