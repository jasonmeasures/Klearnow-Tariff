/**
 * Section 201 QSP TRQ — competitor parity for VN 6810.99.0040.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessLine } from "./assess.ts";
import { assessS201Qsp, s201QspAppliesOn } from "../../tariff-rules/src/s201Qsp.ts";
import { resolveS232EnteredValue } from "../../tariff-rules/src/s232Resolve.ts";

describe("Section 201 QSP (U.S. note 41)", () => {
  it("VN 6810.99.0040 on 2026-08-25 → 9903.45.30 @ 25% stacked on 301-FL 12.5% = 37.5%", () => {
    const L = assessLine(
      {
        hts: "6810.99.0040",
        coo: "VN",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: "2026-08-25",
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.45.30"));
    assert.ok(L.ch99_sequence.includes("9903.05.84"));
    assert.ok(!L.ch99_sequence.includes("9903.05.90"));
    const qsp = L.layers.find((x) => x.ch99 === "9903.45.30");
    assert.equal(qsp?.rate_pct, 0.25);
    assert.equal(qsp?.duty_amount, 2500);
    assert.equal(qsp?.program, "s201");
    assert.equal(L.totals.effective_duty_rate_pct, 37.5);
    assert.equal(L.totals.duty, 3750);
    assert.ok(L.diagnostics.some((d) => d.code === "S201_QSP_QUOTA_ASSUMED_IN"));
  });

  it("over-quota claim → 9903.45.31 @ 50%", () => {
    const L = assessLine(
      {
        hts: "6810990040",
        coo: "VN",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: "2026-08-25",
        flags: { s201_qsp_over_quota: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.45.31"));
    assert.equal(L.layers.find((x) => x.ch99 === "9903.45.31")?.duty_amount, 5000);
    assert.equal(L.totals.effective_duty_rate_pct, 62.5);
  });

  it("Korea is note 41(c) exempt", () => {
    const L = assessLine(
      {
        hts: "6810.99.0040",
        coo: "KR",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: "2026-08-25",
      },
      0,
    );
    assert.ok(!L.ch99_sequence.includes("9903.45.30"));
    assert.ok(L.diagnostics.some((d) => d.code === "S201_QSP_EXEMPT"));
  });

  it("does not apply before 2026-08-15", () => {
    assert.equal(s201QspAppliesOn("2026-08-14"), false);
    const L = assessLine(
      {
        hts: "6810.99.0020",
        coo: "VN",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: "2026-08-14",
      },
      0,
    );
    assert.ok(!L.ch99_sequence.includes("9903.45.30"));
  });

  it("7020.00.6000 is covered; s201_not_qsp opts out", () => {
    const hit = assessS201Qsp({
      hts: "7020006000",
      coo: "CN",
      rateDay: "2026-08-20",
    });
    assert.equal(hit?.heading, "9903.45.30");
    const out = assessS201Qsp({
      hts: "7020006000",
      coo: "CN",
      rateDay: "2026-08-20",
      flags: { s201_not_qsp: true },
    });
    assert.equal(out?.exempt, true);
  });
});

describe("Section 232 UAS (Proc. 11055)", () => {
  it("does not compute before 2026-09-03", () => {
    const { hit, notes } = resolveS232EnteredValue({
      hts: "8806.21.00",
      coo: "CN",
      rateDay: "2026-08-25",
    });
    assert.equal(hit, null);
    assert.ok(notes.some((n) => n.code === "S232_UAS_PENDING"));
  });

  it("CN 8806.21.00 from 2026-09-03 → 9903.08.22 @ 25% and suppresses 301-FL", () => {
    const L = assessLine(
      {
        hts: "8806.21.00",
        coo: "CN",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: "2026-09-03",
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.08.22"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.equal(L.layers.find((x) => x.ch99 === "9903.08.22")?.duty_amount, 2500);
  });

  it("8806.24.00 auto 9903.08.21 @ 100%", () => {
    const L = assessLine(
      {
        hts: "8806240000",
        coo: "VN",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: "2026-09-03",
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.08.21"));
    assert.equal(L.layers.find((x) => x.ch99 === "9903.08.21")?.duty_amount, 10000);
  });

  it("thermal claim upgrades small UAS to 100%", () => {
    const L = assessLine(
      {
        hts: "8806.21.00",
        coo: "CN",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: "2026-09-03",
        flags: { s232_uas_thermal: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.08.21"));
  });

  it("8504.40.9580 docking is claim-gated", () => {
    const { hit, notes } = resolveS232EnteredValue({
      hts: "8504.40.9580",
      coo: "CN",
      rateDay: "2026-09-03",
    });
    assert.equal(hit, null);
    assert.ok(notes.some((n) => /docking/i.test(n.message)));
    assert.ok(!notes.some((n) => /flags\.s232_uas_docking/.test(n.message)));
  });

  it("JP 8537.10.9170 without docking claim stays on auto-parts 15% and does not file 9903.08.24", () => {
    const L = assessLine(
      {
        hts: "8537.10.9170",
        coo: "JP",
        entered_value: 10000,
        col1_rate_pct: 0.027,
        entry_date: "2026-09-04",
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.94.43"));
    assert.ok(!L.ch99_sequence.includes("9903.08.21"));
    assert.ok(!L.ch99_sequence.includes("9903.08.24"));
    assert.ok(L.diagnostics.some((d) => d.code === "S232_UAS_PENDING"));
    assert.ok(L.diagnostics.some((d) => d.code === "S232_UAS_PARTNER_CAP"));
    assert.ok(L.diagnostics.some((d) => d.code === "S232_UAS_PARTNER_CAP" && /do not report/i.test(d.message)));
  });

  it("8806.24.00 not-for-UAS-use claim → 9903.08.20 @ 0% and does not suppress 301-FL", () => {
    const L = assessLine(
      {
        hts: "8806240000",
        coo: "CN",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: "2026-09-04",
        flags: { s232_uas_not_for_use: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.08.20"));
    assert.ok(!L.ch99_sequence.includes("9903.08.21"));
    assert.ok(!L.ch99_sequence.includes("9903.05.90"));
    assert.equal(L.layers.find((x) => x.ch99 === "9903.08.20")?.duty_amount, 0);
  });

  it("JP 8537.10.9170 not-for-UAS-use keeps auto-parts 9903.94.43 and stacks 9903.08.20 @ 0%", () => {
    const L = assessLine(
      {
        hts: "8537.10.9170",
        coo: "JP",
        entered_value: 10000,
        col1_rate_pct: 0.027,
        entry_date: "2026-09-04",
        flags: { s232_uas_not_for_use: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.94.43"));
    assert.ok(L.ch99_sequence.includes("9903.08.20"));
    assert.ok(!L.ch99_sequence.includes("9903.08.21"));
    assert.equal(L.layers.find((x) => x.ch99 === "9903.94.43")?.duty_amount, 1500);
    assert.equal(L.layers.find((x) => x.ch99 === "9903.08.20")?.duty_amount, 0);
    assert.ok(L.diagnostics.some((d) => d.code === "S232_UAS_NOT_FOR_USE_STACKED"));
  });

  it("VN 8537.10.9170 not an auto part + not for UAS → 9903.94.06 + 9903.08.20 + 301-FL .84 (not .90)", () => {
    const L = assessLine(
      {
        hts: "8537.10.9170",
        coo: "VN",
        entered_value: 44204.61,
        col1_rate_pct: 0.027,
        entry_date: "2026-09-04",
        flags: { s232_auto_not_part: true, s232_uas_not_for_use: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.94.06"));
    assert.ok(L.ch99_sequence.includes("9903.08.20"));
    assert.ok(L.ch99_sequence.includes("9903.05.84"));
    assert.ok(!L.ch99_sequence.includes("9903.05.90"));
    assert.ok(!L.ch99_sequence.includes("9903.94.05"));
    assert.equal(L.layers.find((x) => x.ch99 === "9903.94.06")?.duty_amount, 0);
    assert.equal(L.layers.find((x) => x.ch99 === "9903.08.20")?.duty_amount, 0);
    assert.ok(L.diagnostics.some((d) => d.code === "S232_ANNEX_NOT_PART"));
  });

  it("JP 8537.10.9170 with docking claim files 9903.08.21 @ 100%, not 9903.08.24", () => {
    const L = assessLine(
      {
        hts: "8537.10.9170",
        coo: "JP",
        entered_value: 10000,
        col1_rate_pct: 0.027,
        entry_date: "2026-09-04",
        flags: { s232_uas_docking: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.08.21"));
    assert.ok(!L.ch99_sequence.includes("9903.08.24"));
    assert.equal(L.layers.find((x) => x.ch99 === "9903.08.21")?.duty_amount, 10000);
    assert.ok(L.diagnostics.some((d) => d.code === "S232_UAS_PARTNER_CAP"));
  });

  it("8807 Annex III path computes 9903.08.22 from 2027-02-09 when claimed", () => {
    const L = assessLine(
      {
        hts: "8807.10.00",
        coo: "CN",
        entered_value: 10000,
        col1_rate_pct: 0,
        entry_date: "2027-02-09",
        flags: { s232_uas_annex_ii: true },
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.08.22"));
    assert.ok(L.ch99_sequence.includes("9903.05.90"));
    assert.equal(L.layers.find((x) => x.ch99 === "9903.08.22")?.duty_amount, 2500);
  });
});
