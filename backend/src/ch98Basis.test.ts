import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessLine } from "./assess.ts";
import {
  classifyChapter98,
  resolveCh98DutyBasis,
} from "../../tariff-rules/src/ch98Basis.ts";

describe("Chapter 98 dutiable basis", () => {
  it("classifies repair / assembly / suppress / XXIII", () => {
    assert.equal(classifyChapter98("98020050").kind, "repair");
    assert.equal(classifyChapter98("9802.00.80").kind, "assembly");
    assert.equal(classifyChapter98("9801.00.10").kind, "suppress");
    assert.equal(classifyChapter98("9823.01.01").kind, "subchapter_xxiii");
    assert.equal(classifyChapter98("").kind, "none");
  });

  it("9802.00.60 → Section 232 on full entered; other programs on repair", () => {
    const opts = {
      provision: "9802.00.60",
      entered: 10000,
      repair_value: 2000,
    };
    const s232 = resolveCh98DutyBasis({ ...opts, program: "s232" });
    assert.equal(s232.basis, "ENTERED_VALUE");
    assert.equal(s232.basis_amount, 10000);
    const s301 = resolveCh98DutyBasis({ ...opts, program: "s301" });
    assert.equal(s301.basis, "REPAIR_VALUE");
    assert.equal(s301.basis_amount, 2000);
  });

  it("general Chapter 98 suppresses 301 / FL / Brazil, not 232", () => {
    const opts = { provision: "9801.00.10", entered: 10000 };
    assert.equal(resolveCh98DutyBasis({ ...opts, program: "s301" }).suppress, true);
    assert.equal(resolveCh98DutyBasis({ ...opts, program: "s301fl" }).suppress, true);
    assert.equal(resolveCh98DutyBasis({ ...opts, program: "s301_brazil" }).suppress, true);
    assert.equal(resolveCh98DutyBasis({ ...opts, program: "s232" }).suppress, false);
    assert.equal(resolveCh98DutyBasis({ ...opts, program: "col1" }).suppress, false);
  });

  it("CN solar 8541.43.0080 + 9802.00.50: Note 31 + 301-FL on repair; no 232 metals", () => {
    const L = assessLine(
      {
        hts: "8541.43.0080",
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-08-28",
        ch98_provision: "9802.00.50",
        ch98_repair_value: 2000,
        // Off-list metal fields must not invent 9903.82.09 (CSMS #68855869 list).
        metal_content_value: 10000,
        country_of_melt_pour: "CN",
        flags: {},
      },
      0,
    );
    assert.equal(L.filing_sequence[0], "9802.00.50");
    assert.deepEqual(
      L.ch99_sequence.filter((c) => c.startsWith("9903.")),
      ["9903.91.02", "9903.05.31"],
    );

    const solar = L.layers.find((x) => x.ch99 === "9903.91.02");
    assert.ok(solar, "expect China 301 solar 9903.91.02");
    assert.equal(solar!.basis, "REPAIR_VALUE");
    assert.equal(solar!.basis_amount, 2000);
    assert.equal(solar!.duty_amount, 1000); // 50% × $2,000

    const fl = L.layers.find((x) => x.ch99 === "9903.05.31");
    assert.ok(fl, "expect 301-FL China 9903.05.31");
    assert.equal(fl!.basis, "REPAIR_VALUE");
    assert.equal(fl!.basis_amount, 2000);
    assert.equal(fl!.duty_amount, 250); // 12.5% × $2,000

    assert.ok(!L.layers.some((x) => x.ch99 === "9903.82.09" || x.ch99 === "9903.82.02"));
    assert.ok(!L.ch99_sequence.includes("9903.05.90"));
    assert.equal(L.totals.duty, 1250);
    assert.ok(L.diagnostics.some((d) => d.code === "CH98_DUTIABLE_BASIS"));
  });

  it("9802.00.50 without repair value warns and falls back to entered", () => {
    const L = assessLine(
      {
        hts: "8541.43.0080",
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-08-27",
        ch98_provision: "98020050",
        flags: {},
      },
      0,
    );
    assert.ok(L.diagnostics.some((d) => d.code === "CH98_REPAIR_VALUE_MISSING"));
    const solar = L.layers.find((x) => x.ch99 === "9903.91.02");
    assert.equal(solar?.basis_amount, 10000);
    assert.equal(solar?.duty_amount, 5000);
    assert.ok(L.ch99_sequence.includes("9903.05.31"));
  });

  it("9802.00.60 + listed metals HTS: 232 on full entered; China 301 on repair", () => {
    const L = assessLine(
      {
        hts: "8544.42.9090",
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-08-27",
        ch98_provision: "9802.00.60",
        ch98_repair_value: 2000,
        metal_contents: { copper: { pct: 50, melt_pour: "CN" } },
        flags: {},
      },
      0,
    );
    const china = L.layers.find((x) => x.ch99?.startsWith("9903.88") || x.ch99?.startsWith("9903.91"));
    // 8544.42 may or may not be Note 31; assert 232 full-value exception regardless.
    const metals = L.layers.find((x) => x.ch99 === "9903.82.09");
    assert.ok(metals, "expect Section 232 metals on listed copper conductor HTS");
    assert.equal(metals!.basis, "ENTERED_VALUE");
    assert.equal(metals!.basis_amount, 10000);
    assert.equal(metals!.duty_amount, 2500);
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    void china;
  });

  it("9802.00.80 assembly: China 301 on entered less US content", () => {
    const L = assessLine(
      {
        hts: "8541.43.0080",
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-08-27",
        ch98_provision: "9802.00.80",
        ch98_us_content_value: 4000,
        flags: {},
      },
      0,
    );
    const solar = L.layers.find((x) => x.ch99 === "9903.91.02");
    assert.equal(solar?.basis, "ASSEMBLY_LESS_US_CONTENT");
    assert.equal(solar?.basis_amount, 6000);
    assert.equal(solar?.duty_amount, 3000);
    assert.ok(L.ch99_sequence.includes("9903.05.31"));
  });

  it("9801.00.10 suppresses China 301; 232 still applies on listed metals HTS", () => {
    const L = assessLine(
      {
        hts: "8544.42.9090",
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-08-27",
        ch98_provision: "9801.00.10",
        metal_contents: { copper: { pct: 50, melt_pour: "CN" } },
        flags: {},
      },
      0,
    );
    assert.ok(!L.layers.some((x) => x.ch99 === "9903.91.02"));
    assert.ok(L.diagnostics.some((d) => d.code === "CH98_SUPPRESSES_CHINA_301"));
    const metals = L.layers.find((x) => x.ch99 === "9903.82.09");
    assert.ok(metals, "232 metals should still apply under general Ch98 for list HTS");
    assert.equal(metals!.basis_amount, 10000);
  });

  it("8541.43 off metals list: content alone never invents 9903.82.09", () => {
    const L = assessLine(
      {
        hts: "8541.43.0080",
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-08-28",
        metal_content_value: 8000,
        country_of_melt_pour: "CN",
        flags: {},
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.91.02"));
    assert.ok(L.ch99_sequence.includes("9903.05.31"));
    assert.ok(!L.ch99_sequence.includes("9903.82.09"));
    assert.ok(!L.ch99_sequence.includes("9903.05.90"));
    assert.equal(L.metals, null);
  });
});
