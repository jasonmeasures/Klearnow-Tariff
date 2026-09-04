import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  matchCopperSmeltCastHts,
  normalizeCopperCountry,
  previewCopperSmeltCast,
  validateCopperSmeltCast,
} from "../../tariff-rules/src/copperSmeltCast.ts";

describe("copper smelt/cast filing (CSMS #69711865)", () => {
  it("matches listed 8544.42/49 stems", () => {
    assert.ok(matchCopperSmeltCastHts("8544429090"));
    assert.ok(matchCopperSmeltCastHts("8544.49.1010"));
    assert.equal(matchCopperSmeltCastHts("8544499010"), null);
    assert.equal(matchCopperSmeltCastHts("8544300000"), null);
  });

  it("accepts OTH for unknown countries", () => {
    assert.equal(normalizeCopperCountry("other"), "OTH");
    assert.equal(normalizeCopperCountry("OTH"), "OTH");
    assert.equal(normalizeCopperCountry("cl"), "CL");
  });

  it("US origin is exempt after effective date", () => {
    const hit = previewCopperSmeltCast("8544429090", "US", "2026-09-15");
    assert.ok(hit);
    assert.equal(hit!.exempt, true);
    assert.equal(hit!.required, false);
  });

  it("non-US requires fields from 2026-09-14", () => {
    const before = previewCopperSmeltCast("8544429090", "JP", "2026-09-13");
    assert.ok(before);
    assert.equal(before!.required, false);

    const after = previewCopperSmeltCast("8544429090", "JP", "2026-09-14");
    assert.ok(after);
    assert.equal(after!.required, true);

    const incomplete = validateCopperSmeltCast({
      hts: "8544429090",
      coo: "JP",
      date: "2026-09-15",
    });
    assert.deepEqual(incomplete.missing, ["primary_smelt", "cast"]);

    const complete = validateCopperSmeltCast({
      hts: "8544429090",
      coo: "JP",
      date: "2026-09-15",
      primary_smelt: "CL",
      cast: "OTH",
    });
    assert.equal(complete.complete, true);
    assert.equal(complete.fields.cast, "OTH");
  });
});
