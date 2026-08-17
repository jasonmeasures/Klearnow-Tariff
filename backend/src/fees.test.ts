import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeEntryFees, HMF_RATE, isOceanMot, normalizeMot } from "./fees.ts";

describe("MOT / HMF", () => {
  it("treats ocean aliases and ACE 10/11/12 as vessel", () => {
    for (const m of ["OCEAN", "ocean", "VESSEL", "SEA", "10", "11", "12"]) {
      assert.equal(normalizeMot(m), "OCEAN", m);
      assert.equal(isOceanMot(m), true, m);
    }
    assert.equal(normalizeMot("AIR"), "AIR");
    assert.equal(isOceanMot("AIR"), false);
    assert.equal(isOceanMot("TRUCK"), false);
    assert.equal(isOceanMot(""), false);
    assert.equal(isOceanMot(null), false);
  });

  it("charges HMF 0.125% on ocean only", () => {
    const ocean = computeEntryFees({
      entered_value_total: 10000,
      formal_entry: true,
      mode_of_transport: "OCEAN",
    });
    const hmf = ocean.fees.find((f) => f.code === "HMF");
    assert.ok(hmf);
    assert.equal(hmf!.amount, Math.round(10000 * HMF_RATE));
    assert.equal(ocean.hmf_applies, true);

    const air = computeEntryFees({
      entered_value_total: 10000,
      formal_entry: true,
      mode_of_transport: "AIR",
    });
    const airHmf = air.fees.find((f) => f.code === "HMF");
    assert.ok(airHmf);
    assert.equal(airHmf!.amount, 0);
    assert.equal(air.hmf_applies, false);
    assert.match(airHmf!.rate_note, /Not due/i);

    const missing = computeEntryFees({
      entered_value_total: 10000,
      formal_entry: true,
    });
    assert.equal(missing.fees.some((f) => f.code === "HMF"), false);
    assert.equal(missing.hmf_applies, false);
  });

  it("ACE code 11 still triggers HMF", () => {
    const R = computeEntryFees({
      entered_value_total: 8000,
      mode_of_transport: "11",
    });
    const hmf = R.fees.find((f) => f.code === "HMF");
    assert.ok(hmf && hmf.amount > 0);
  });
});
