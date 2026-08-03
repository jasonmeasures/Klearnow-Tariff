/**
 * Exact calendar-day boundaries for IEEPA → Sec 122 → 301-FL.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IEEPA_END,
  IEEPA_START,
  S301FL_START,
  SEC_122_END,
  SEC_122_START,
  filingEra,
  inIeepaWindow,
  s301flAppliesOn,
  sec122AppliesOn,
  wrongEraFiledCode,
} from "./programEras.ts";
import { STACKING_CONTRACT } from "./rulesContract.ts";

describe("program era calendar boundaries", () => {
  it("contract boundary_days match programEras constants", () => {
    assert.equal(STACKING_CONTRACT.boundary_days.last_ieepa, IEEPA_END);
    assert.equal(STACKING_CONTRACT.boundary_days.first_sec_122, SEC_122_START);
    assert.equal(STACKING_CONTRACT.boundary_days.last_sec_122, SEC_122_END);
    assert.equal(STACKING_CONTRACT.boundary_days.first_s301fl, S301FL_START);
    assert.equal(IEEPA_START, "2025-02-04");
  });

  it("day before Sec 122 is still IEEPA; first Sec 122 day is not IEEPA", () => {
    assert.equal(filingEra("2026-02-23"), "ieepa");
    assert.ok(inIeepaWindow("2026-02-23"));
    assert.ok(!sec122AppliesOn("2026-02-23"));
    assert.ok(!s301flAppliesOn("2026-02-23"));

    assert.equal(filingEra("2026-02-24"), "sec_122");
    assert.ok(!inIeepaWindow("2026-02-24"));
    assert.ok(sec122AppliesOn("2026-02-24"));
    assert.ok(!s301flAppliesOn("2026-02-24"));
  });

  it("last Sec 122 day vs first 301-FL day — exclusive replacement", () => {
    assert.equal(filingEra("2026-07-23"), "sec_122");
    assert.ok(sec122AppliesOn("2026-07-23"));
    assert.ok(!s301flAppliesOn("2026-07-23"));

    assert.equal(filingEra("2026-07-24"), "s301fl");
    assert.ok(!sec122AppliesOn("2026-07-24"));
    assert.ok(s301flAppliesOn("2026-07-24"));
  });

  it("mid-window sample dates map correctly", () => {
    assert.equal(filingEra("2025-06-01"), "ieepa");
    assert.equal(filingEra("2026-06-25"), "sec_122");
    assert.equal(filingEra("2026-07-10"), "sec_122");
    assert.equal(filingEra("2026-08-03"), "s301fl");
  });

  it("wrongEra: IEEPA after vacatur", () => {
    const w = wrongEraFiledCode("9903.01.25", "2026-06-01");
    assert.ok(w);
    assert.equal(w!.category, "WRONG_ERA");
    assert.equal(w!.severity, "ERROR");
  });

  it("wrongEra: Sec 122 after sunset", () => {
    const w = wrongEraFiledCode("9903.03.01", "2026-07-24");
    assert.ok(w);
    assert.equal(w!.category, "WRONG_ERA");
    assert.equal(w!.severity, "ERROR");
  });

  it("wrongEra: 301-FL family before effective", () => {
    const w = wrongEraFiledCode("9903.05.31", "2026-07-10");
    assert.ok(w);
    assert.equal(w!.category, "WRONG_ERA");
  });

  it("wrongEra: Sec 122 and IEEPA ok inside their windows", () => {
    assert.equal(wrongEraFiledCode("9903.03.01", "2026-07-10"), null);
    assert.equal(wrongEraFiledCode("9903.01.25", "2026-02-01"), null);
  });
});
