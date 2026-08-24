import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessLine } from "./assess.ts";
import {
  assertNoS338DutyWithNote51c,
  normalizeCanadaCoo,
  s338AppliesOn,
  s338DrawbackEligible,
  s338Meta,
} from "../../tariff-rules/src/s338Canada.ts";

const LIVE = "2026-08-23";
const SUSPEND = "2026-08-20";

function line(over: Record<string, unknown> = {}) {
  return assessLine(
    {
      hts: "2208.30.30",
      coo: "CA",
      entered_value: 10000,
      col1_rate_pct: 0,
      entry_date: LIVE,
      flags: {},
      ...over,
    },
    0,
  );
}

describe("Section 338 Canada (CSMS #69606660)", () => {
  it("Canadian whiskey 2208.30.30 entered 2026-08-23 → 9903.03.12 +50% stacked on Column 1", () => {
    const L = line({ col1_rate_pct: 5 });
    assert.ok(L.ch99_sequence.includes("9903.03.12"));
    const s338 = L.layers.find((x) => x.ch99 === "9903.03.12");
    assert.equal(s338?.duty_amount, 5000);
    assert.equal(s338?.rate_pct, 0.5);
    const col1 = L.layers.find((x) => x.program === "base");
    assert.equal(col1?.duty_amount, 500);
    assert.ok(L.section_338?.drawback_eligible);
  });

  it("same whiskey entered 2026-08-20 (suspension) → no Section 338 duty", () => {
    const L = line({ entry_date: SUSPEND, release_date: SUSPEND });
    assert.ok(!L.ch99_sequence.some((c) => c.startsWith("9903.03.1")));
    assert.ok(L.diagnostics.some((d) => d.code === "S338_SUSPENDED"));
  });

  it("boundary: 2026-08-22 00:00 EST no duty; 00:01 EST applies", () => {
    const before = line({
      entry_date: "2026-08-22 00:00 EST",
      release_date: "2026-08-22 00:00 EST",
    });
    assert.ok(!before.ch99_sequence.includes("9903.03.12"));
    assert.equal(s338AppliesOn("2026-08-22 00:00 EST"), false);
    assert.equal(s338AppliesOn("2026-08-22 00:01 EST"), true);
    const after = line({
      entry_date: "2026-08-22 00:01 EST",
      release_date: "2026-08-22 00:01 EST",
    });
    assert.ok(after.ch99_sequence.includes("9903.03.12"));
    const dateOnly = line({ entry_date: "2026-08-22", release_date: "2026-08-22" });
    assert.ok(dateOnly.ch99_sequence.includes("9903.03.12"));
  });

  it("milk powder 0402.21.05 product of Canada → 9903.03.13 +50%", () => {
    const L = line({ hts: "0402.21.05" });
    assert.ok(L.ch99_sequence.includes("9903.03.13"));
    const s338 = L.layers.find((x) => x.ch99 === "9903.03.13");
    assert.equal(s338?.duty_amount, 5000);
  });

  it("milk powder 0402.21.05 product of New Zealand → no Section 338", () => {
    const L = line({ hts: "0402.21.05", coo: "NZ" });
    assert.ok(!L.ch99_sequence.some((c) => c.startsWith("9903.03.1")));
  });

  it("softwood plywood 4412.39.10 carrying 9903.76.x → 9903.03.15, no .14", () => {
    const L = line({
      hts: "4412.39.10",
      filed_ch99: ["9903.76.01"],
    });
    assert.ok(L.ch99_sequence.includes("9903.03.15"));
    assert.ok(!L.ch99_sequence.includes("9903.03.14"));
    const ex = L.layers.find((x) => x.ch99 === "9903.03.15");
    assert.equal(ex?.duty_amount, 0);
  });

  it("steel article carrying 9903.82.04 → excluded via 03.15", () => {
    const L = line({
      hts: "7203.10.00",
      filed_ch99: ["9903.82.04"],
      metal_content_value: 4000,
      country_of_melt_pour: "CA",
    });
    assert.ok(L.ch99_sequence.includes("9903.03.15"));
    assert.ok(!L.ch99_sequence.includes("9903.03.14"));
  });

  it("aircraft part 8411.91.90 with civil_aircraft_gn6 → 9903.03.16 @ 0%", () => {
    const L = line({
      hts: "8411.91.90",
      flags: { civil_aircraft_gn6: true },
    });
    assert.ok(L.ch99_sequence.includes("9903.03.16"));
    const ex = L.layers.find((x) => x.ch99 === "9903.03.16");
    assert.equal(ex?.duty_amount, 0);
  });

  it("same aircraft part with flag false and HTS not on a duty list → no 338 heading", () => {
    const L = line({ hts: "8411.91.90", flags: {} });
    assert.ok(!L.ch99_sequence.some((c) => c.startsWith("9903.03.1")));
  });

  it("8418.69.01 dual list: GN6 true → .16; false → .14 +50%", () => {
    const air = line({
      hts: "8418.69.01",
      flags: { civil_aircraft_gn6: true },
    });
    assert.ok(air.ch99_sequence.includes("9903.03.16"));
    assert.ok(!air.ch99_sequence.includes("9903.03.14"));
    const duty = line({ hts: "8418.69.01", flags: {} });
    assert.ok(duty.ch99_sequence.includes("9903.03.14"));
    assert.equal(duty.layers.find((x) => x.ch99 === "9903.03.14")?.duty_amount, 5000);
  });

  it("9802.00.80 assembly from Canada with US content → duty on assembled less US content", () => {
    const L = line({
      hts: "3926.90.99",
      ch98_provision: "9802.00.80",
      ch98_us_content_value: 4000,
    });
    assert.ok(L.ch99_sequence.includes("9903.03.14"));
    const s338 = L.layers.find((x) => x.ch99 === "9903.03.14");
    assert.equal(s338?.basis, "ASSEMBLY_LESS_US_CONTENT");
    assert.equal(s338?.basis_amount, 6000);
    assert.equal(s338?.duty_amount, 3000);
  });

  it("9802.00.50 repair in Canada → duty on repair value only", () => {
    const L = line({
      hts: "3926.90.99",
      ch98_provision: "9802.00.50",
      ch98_repair_value: 2000,
    });
    const s338 = L.layers.find((x) => x.ch99 === "9903.03.14");
    assert.equal(s338?.basis, "REPAIR_VALUE");
    assert.equal(s338?.basis_amount, 2000);
    assert.equal(s338?.duty_amount, 1000);
  });

  it("drawback eligibility for SECTION_338_CANADA is true", () => {
    assert.equal(s338DrawbackEligible(), true);
    assert.equal(s338Meta().drawback_eligible, true);
  });

  it("FTZ admission of covered goods emits privileged-foreign warning", () => {
    const L = line({ flags: { ftz_admission: true } });
    assert.ok(L.ch99_sequence.includes("9903.03.12"));
    assert.ok(L.diagnostics.some((d) => d.code === "S338_FTZ_PRIVILEGED_FOREIGN"));
  });

  it("sequencing: Ch.98 + 338 + 301 + 232 + Ch.1–97 in CSMS #69606660 order", () => {
    const L = line({
      hts: "7203.10.00",
      ch98_provision: "9823.01.01",
      metal_content_value: 4000,
      country_of_melt_pour: "CA",
    });
    const seq = L.filing_sequence;
    assert.equal(seq[0], "9823.01.01");
    assert.ok(seq.includes("9903.03.15"));
    assert.ok(seq.includes("9903.05.90"));
    assert.ok(seq.some((c: string) => String(c).startsWith("9903.82")));
    assert.equal(seq[seq.length - 1], "7203.10.00");
    const i338 = seq.indexOf("9903.03.15");
    const i301 = seq.indexOf("9903.05.90");
    const i232 = seq.findIndex((c: string) => String(c).startsWith("9903.82"));
    assert.ok(i338 < i301 && i301 < i232 && i232 < seq.length - 1);
  });

  it("invariant: never emit 9903.03.12–.14 with a Note 51(c) heading", () => {
    assert.ok(assertNoS338DutyWithNote51c(["9903.03.14", "9903.82.02"]));
    assert.equal(assertNoS338DutyWithNote51c(["9903.03.15", "9903.82.02"]), null);
    const L = line({
      hts: "7203.10.00",
      metal_content_value: 4000,
      country_of_melt_pour: "CA",
    });
    const duty = L.ch99_sequence.filter((c) =>
      ["9903.03.12", "9903.03.13", "9903.03.14"].includes(c),
    );
    const excl = L.ch99_sequence.filter((c) => c.startsWith("9903.82"));
    assert.equal(duty.length, 0);
    assert.ok(excl.length);
    assert.ok(L.ch99_sequence.includes("9903.03.15"));
  });

  it("USMCA does not exempt 338: CA 3926.90.99 with SPI → .14 +50%, Column 1 Free", () => {
    const L = line({
      hts: "3926.90.99",
      flags: { fta_usmca: true },
      col1_rate_pct: 5.3,
    });
    assert.ok(L.ch99_sequence.includes("9903.03.14"));
    assert.equal(L.layers.find((x) => x.ch99 === "9903.03.14")?.duty_amount, 5000);
    assert.equal(L.col1_rate_label, "Free");
    assert.equal(L.layers.find((x) => x.program === "base")?.duty_amount, 0);
  });

  it("without USMCA on 2026-08-23: .14 + 301-FL, no 122, no IEEPA", () => {
    const L = line({ hts: "3926.90.99", flags: {} });
    assert.ok(L.ch99_sequence.includes("9903.03.14"));
    assert.ok(L.ch99_sequence.includes("9903.05.29"));
    assert.ok(!L.ch99_sequence.includes("9903.03.01"));
    assert.ok(!L.ch99_sequence.some((c) => c.startsWith("9903.01.")));
  });

  it("bitemporal: 2026-05-01 still has Section 122; 2026-08-23 does not", () => {
    const hist = line({
      hts: "3926.90.99",
      entry_date: "2026-05-01",
      release_date: "2026-05-01",
    });
    assert.ok(hist.ch99_sequence.includes("9903.03.01"));
    assert.ok(!hist.ch99_sequence.includes("9903.03.14"));
    const now = line({ hts: "3926.90.99" });
    assert.ok(!now.ch99_sequence.includes("9903.03.01"));
    assert.ok(now.ch99_sequence.includes("9903.03.14"));
  });

  it("USMCA suppresses 301-FL; 232 heading suppresses FL via .90 and 338 via .15", () => {
    const usmca = line({
      hts: "3926.90.99",
      flags: { fta_usmca: true },
    });
    assert.ok(usmca.ch99_sequence.includes("9903.05.93"));
    assert.ok(!usmca.ch99_sequence.includes("9903.05.29"));
    assert.ok(usmca.ch99_sequence.includes("9903.03.14"));

    const steel = line({
      hts: "7203.10.00",
      metal_content_value: 4000,
      country_of_melt_pour: "CA",
    });
    assert.ok(steel.ch99_sequence.includes("9903.05.90"));
    assert.ok(steel.ch99_sequence.includes("9903.03.15"));
    assert.ok(!steel.ch99_sequence.includes("9903.05.29"));
    assert.ok(!steel.ch99_sequence.includes("9903.03.14"));
  });

  it("COO XO normalizes to CA with identical evaluation and a trace note", () => {
    const xo = line({ coo: "XO" });
    const ca = line({ coo: "CA" });
    assert.equal(xo.coo, "CA");
    assert.deepEqual(xo.ch99_sequence, ca.ch99_sequence);
    assert.ok(xo.diagnostics.some((d) => d.code === "COO_NORMALIZED_CA_XCODE"));
    assert.equal(normalizeCanadaCoo("XO").coo, "CA");
    assert.equal(normalizeCanadaCoo("XO").normalized_from, "XO");
  });

  it("Chapter 98 generally exempts 338 except Subchapter XXIII and 9802 carve-outs", () => {
    const exempt = line({ hts: "3926.90.99", ch98_provision: "9801.00.10" });
    assert.ok(!exempt.ch99_sequence.some((c) => c.startsWith("9903.03.1")));
    const xxiii = line({ hts: "3926.90.99", ch98_provision: "9823.01.01" });
    assert.ok(xxiii.ch99_sequence.includes("9903.03.14"));
  });
});
