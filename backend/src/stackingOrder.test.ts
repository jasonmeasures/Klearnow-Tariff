import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REPORTING_SLOTS,
  buildFilingSequence,
  orderCh99Sequence,
  sortLayersForDisplay,
} from "./stackingOrder.ts";

describe("stackingOrder — CSMS #69668138", () => {
  it("orders Section 301 before Section 338 before Section 232", () => {
    const seq = orderCh99Sequence([
      "9903.82.02",
      "9903.03.14",
      "9903.05.84",
      "9903.91.01",
    ]);
    assert.equal(seq.indexOf("9903.91.01") < seq.indexOf("9903.03.14"), true);
    assert.equal(seq.indexOf("9903.05.84") < seq.indexOf("9903.03.14"), true);
    assert.equal(seq.indexOf("9903.03.14") < seq.indexOf("9903.82.02"), true);
  });

  it("orders Section 301 suppression marker before Section 338", () => {
    const seq = orderCh99Sequence(["9903.03.15", "9903.05.90", "9903.82.02"]);
    assert.equal(seq.indexOf("9903.05.90") < seq.indexOf("9903.03.15"), true);
    assert.equal(seq.indexOf("9903.03.15") < seq.indexOf("9903.82.02"), true);
  });

  it("preserves within-Section-301 order (no ascending / China-before-FL invent)", () => {
    // IMCR patterns that v5.30 falsely reordered
    assert.deepEqual(
      orderCh99Sequence(["9903.88.03", "9903.05.90", "9903.82.02"]),
      ["9903.88.03", "9903.05.90", "9903.82.02"],
    );
    assert.deepEqual(
      orderCh99Sequence(["9903.88.15", "9903.05.90", "9903.82.02"]),
      ["9903.88.15", "9903.05.90", "9903.82.02"],
    );
    assert.deepEqual(
      orderCh99Sequence(["9903.88.03", "9903.05.31"]),
      ["9903.88.03", "9903.05.31"],
    );
    assert.deepEqual(
      orderCh99Sequence(["9903.88.03", "9903.05.90", "9903.74.11", "9903.94.05"]),
      ["9903.88.03", "9903.05.90", "9903.74.11", "9903.94.05"],
    );
    assert.deepEqual(
      orderCh99Sequence(["9903.05.90", "9903.82.02"]),
      ["9903.05.90", "9903.82.02"],
    );
    // Opposite within-301 order also preserved
    assert.deepEqual(
      orderCh99Sequence(["9903.05.90", "9903.88.03", "9903.82.02"]),
      ["9903.05.90", "9903.88.03", "9903.82.02"],
    );
    assert.deepEqual(
      orderCh99Sequence(["9903.05.31", "9903.88.03"]),
      ["9903.05.31", "9903.88.03"],
    );
  });

  it("still corrects genuine cross-section violations (232 before 301)", () => {
    assert.deepEqual(orderCh99Sequence(["9903.94.05", "9903.88.03"]), [
      "9903.88.03",
      "9903.94.05",
    ]);
    assert.deepEqual(orderCh99Sequence(["9903.88.03", "9903.94.05"]), [
      "9903.88.03",
      "9903.94.05",
    ]);
  });

  it("preserves within-Section-232 order", () => {
    assert.deepEqual(
      orderCh99Sequence(["9903.74.11", "9903.94.05"]),
      ["9903.74.11", "9903.94.05"],
    );
    assert.deepEqual(
      orderCh99Sequence(["9903.94.05", "9903.74.11"]),
      ["9903.94.05", "9903.74.11"],
    );
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
