import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolve232PartsOrigin,
  resolve232VehicleOrigin,
} from "../../tariff-rules/src/s232AutoOrigin.ts";

const COL1 = 0.025;
const DAY = "2026-08-18";

describe("232 auto origin splits", () => {
  it("JP vehicle col-1 2.5% → 9903.94.41 combined 15%, zero commodity", () => {
    const h = resolve232VehicleOrigin({ coo: "JP", rateDay: DAY, col1Rate: COL1 });
    assert.equal(h.heading, "9903.94.41");
    assert.equal(h.rate_pct_decimal, 0.15);
    assert.equal(h.combined_cap, true);
    assert.equal(h.zero_commodity, true);
  });

  it("JP vehicle col-1 15% → 9903.94.40 @ 0% additional", () => {
    const h = resolve232VehicleOrigin({ coo: "JP", rateDay: DAY, col1Rate: 0.15 });
    assert.equal(h.heading, "9903.94.40");
    assert.equal(h.rate_pct_decimal, 0);
    assert.equal(h.zero_commodity, false);
  });

  it("JP vehicle before 2025-09-16 → 9903.94.01", () => {
    const h = resolve232VehicleOrigin({
      coo: "JP",
      rateDay: "2025-09-15",
      col1Rate: COL1,
    });
    assert.equal(h.heading, "9903.94.01");
    assert.equal(h.combined_cap, false);
    assert.equal(h.rate_pct_decimal, 0.25);
  });

  it("DE/FR vehicles use EU 9903.94.51", () => {
    for (const coo of ["DE", "FR", "IT"]) {
      const h = resolve232VehicleOrigin({ coo, rateDay: DAY, col1Rate: COL1 });
      assert.equal(h.heading, "9903.94.51", coo);
    }
  });

  it("KR vehicle → 9903.94.61; TH stays 9903.94.01", () => {
    assert.equal(
      resolve232VehicleOrigin({ coo: "KR", rateDay: DAY, col1Rate: COL1 }).heading,
      "9903.94.61",
    );
    assert.equal(
      resolve232VehicleOrigin({ coo: "TH", rateDay: DAY, col1Rate: COL1 }).heading,
      "9903.94.01",
    );
  });

  it("GB vehicle default .01; TRQ claim .31 additional 7.5%", () => {
    const def = resolve232VehicleOrigin({ coo: "GB", rateDay: DAY, col1Rate: COL1 });
    assert.equal(def.heading, "9903.94.01");
    const trq = resolve232VehicleOrigin({
      coo: "GB",
      rateDay: DAY,
      col1Rate: COL1,
      flags: { s232_uk_auto_trq: true },
    });
    assert.equal(trq.heading, "9903.94.31");
    assert.equal(trq.rate_pct_decimal, 0.075);
    assert.equal(trq.combined_cap, false);
  });

  it("JP/DE parts use .43/.53 not vehicle headings", () => {
    assert.equal(
      resolve232PartsOrigin({ coo: "JP", rateDay: DAY, col1Rate: COL1 }).heading,
      "9903.94.43",
    );
    assert.equal(
      resolve232PartsOrigin({ coo: "DE", rateDay: DAY, col1Rate: COL1 }).heading,
      "9903.94.53",
    );
    assert.equal(
      resolve232PartsOrigin({ coo: "CN", rateDay: DAY, col1Rate: COL1 }).heading,
      "9903.94.05",
    );
  });

  it("drawback split keeps col-1 on Ch.1–97", () => {
    const h = resolve232VehicleOrigin({
      coo: "JP",
      rateDay: DAY,
      col1Rate: COL1,
      flags: { s232_drawback_col1: true },
    });
    assert.equal(h.heading, "9903.94.41");
    assert.equal(h.rate_pct_decimal, 0.125);
    assert.equal(h.zero_commodity, false);
  });
});
