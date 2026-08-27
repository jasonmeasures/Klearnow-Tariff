import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REPORTING_SLOTS,
  buildFilingSequence,
  orderCh99Sequence,
  sortLayersForDisplay,
} from "./stackingOrder.ts";

describe("stackingOrder — CSMS #69668138", () => {
  it("orders Section 301 suppression marker before Section 338", () => {
    const seq = orderCh99Sequence(["9903.03.15", "9903.05.90", "9903.82.02"]);
    assert.equal(seq.indexOf("9903.05.90") < seq.indexOf("9903.03.15"), true);
  });

  it("orders Section 301 before Section 338 before Section 232", () => {
    const seq = orderCh99Sequence([
      "9903.82.02",
      "9903.03.14",
      "9903.05.84",
      "9903.91.01",
    ]);
    assert.equal(seq.indexOf("9903.91.01") < seq.indexOf("9903.03.14"), true);
    assert.equal(seq.indexOf("9903.03.14") < seq.indexOf("9903.82.02"), true);
  });

  it("buildFilingSequence puts Ch.98 first and commodity last", () => {
    const filing = buildFilingSequence({
      ch98: "9823.01.01",
      ch99: ["9903.05.90", "9903.03.15", "9903.82.02"],
      commodityHts: "7203.10.00",
    });
    assert.equal(filing[0], "9823.01.01");
    assert.equal(filing[filing.length - 1], "7203.10.00");
  });

  it("sortLayersForDisplay follows reporting slots", () => {
    const layers = [
      { stack_slot: REPORTING_SLOTS.COMMODITY, ch99: null },
      { stack_slot: REPORTING_SLOTS.S338, ch99: "9903.03.14" },
      { stack_slot: REPORTING_SLOTS.S301, ch99: "9903.05.84" },
      { stack_slot: REPORTING_SLOTS.CH98, ch99: "9802.00.80" },
    ];
    const sorted = sortLayersForDisplay(layers, ["9903.05.84", "9903.03.14"]);
    assert.deepEqual(
      sorted.map((l) => l.stack_slot),
      [REPORTING_SLOTS.CH98, REPORTING_SLOTS.S301, REPORTING_SLOTS.S338, REPORTING_SLOTS.COMMODITY],
    );
  });
});
