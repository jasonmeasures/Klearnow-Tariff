import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessLine } from "./assess.ts";
import { matchFlExcept, s301flExceptMeta } from "../../tariff-rules/src/s301flExcept.ts";
import { matchBrazil301Annex } from "../../tariff-rules/src/s301BrazilHts.ts";
import { lookupChina301List, s301ChinaListsMeta } from "../../tariff-rules/src/s301China.ts";
import { selectMetalsExtendedHeading } from "../../tariff-rules/src/s232MetalsMatrix.ts";
import { matchFlPharmaHts } from "../../tariff-rules/src/s301fl.ts";

describe("imported workbook packs", () => {
  it("301-FL except meta includes .86 list", () => {
    const m = s301flExceptMeta();
    assert.ok((m.headings["9903.05.86"] ?? 0) > 800);
  });

  it("matchFlExcept → 9903.05.86 for listed HTS", () => {
    const hit = matchFlExcept({ hts: "0201.10.05", coo: "VN" });
    assert.equal(hit?.heading, "9903.05.86");
  });

  it("assess applies 301-FL .86 on listed HTS", () => {
    const L = assessLine(
      {
        hts: "0201.10.05",
        coo: "VN",
        entered_value: 10000,
        col1_rate_pct: 4,
        entry_date: "2026-08-01",
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.05.86"));
    assert.ok(!L.ch99_sequence.includes("9903.05.84"));
  });

  it("Brazil annex .03 auto on listed HTS", () => {
    const hit = matchBrazil301Annex("0201.10.05");
    assert.equal(hit?.heading, "9903.05.03");
    const L = assessLine(
      {
        hts: "0201.10.05",
        coo: "BR",
        entered_value: 10000,
        col1_rate_pct: 4,
        entry_date: "2026-08-01",
      },
      0,
    );
    assert.ok(L.ch99_sequence.includes("9903.05.03"));
    assert.ok(!L.ch99_sequence.includes("9903.05.01"));
  });

  it("China list 3 has thousands of hts8 rows", () => {
    const m = s301ChinaListsMeta();
    assert.ok(Number(m.counts.list_3) > 5000);
    const hit = lookupChina301List("8544.42.90");
    assert.ok(hit?.list === "list_3" || hit?.list === "list_1");
  });

  it("pharma HTS list expanded from workbook", () => {
    const hit = matchFlPharmaHts("2933.99.22.00");
    assert.equal(hit?.heading, "9903.05.89");
  });

  it("metals matrix partner path for JP", () => {
    const pick = selectMetalsExtendedHeading({
      hts: "7601.10.30",
      coo: "JP",
      col1_pct: 2.6,
      aggregate_metal_pct: 50,
    });
    assert.ok(pick?.heading === "9903.82.22" || pick?.heading === "9903.82.02");
  });
});
