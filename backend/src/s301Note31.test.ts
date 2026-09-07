import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lookupChina301Note31 } from "../../tariff-rules/src/s301ChinaNote31.ts";

describe("U.S. note 31 four-year review", () => {
  it("7601.10.30 → 9903.91.01 from 2024-09-27", () => {
    const hit = lookupChina301Note31({
      hts: "7601.10.3000",
      date: "2026-08-18",
    }).hit;
    assert.equal(hit?.ch99, "9903.91.01");
    assert.equal(hit?.rate_pct, 25);
  });

  it("8541.42.00 → 9903.91.02 @ 50%", () => {
    const hit = lookupChina301Note31({ hts: "8541420000", date: "2026-08-18" }).hit;
    assert.equal(hit?.ch99, "9903.91.02");
    assert.equal(hit?.rate_pct, 50);
  });

  it("8703.80.00 → 9903.91.03 @ 100%", () => {
    const hit = lookupChina301Note31({ hts: "8703800000", date: "2026-08-18" }).hit;
    assert.equal(hit?.ch99, "9903.91.03");
    assert.equal(hit?.rate_pct, 100);
  });

  it("8507.60.0010 moves from 91.01 to 91.06 on 2026-01-01", () => {
    const y25 = lookupChina301Note31({ hts: "8507600010", date: "2025-06-01" }).hit;
    const y26 = lookupChina301Note31({ hts: "8507600010", date: "2026-01-01" }).hit;
    assert.equal(y25?.ch99, "9903.91.01");
    assert.equal(y26?.ch99, "9903.91.06");
  });

  it("8426.19.00 requires a crane claim", () => {
    const none = lookupChina301Note31({ hts: "8426190000", date: "2026-08-18" });
    assert.equal(none.hit, null);
    assert.equal(none.skip_legacy, true);
    assert.ok(none.diagnostics.some((d) => d.code === "S301_NOTE31_STS_CLAIM_REQUIRED"));
    const duty = lookupChina301Note31({
      hts: "8426190000",
      date: "2026-08-18",
      flags: { s301_sts_crane: true },
    }).hit;
    assert.equal(duty?.ch99, "9903.92.10");
  });
});
