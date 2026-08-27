import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  mergeHtsRateRows,
  normalizeCsvHtsRows,
  parseHtsClassificationWorkbook,
} from "./import_hts.ts";
import { resolveCol1, reloadHtsTable } from "./htsLookup.ts";
import { isolateHtsPacks } from "./htsTestIsolate.ts";

describe("HTS import", () => {
  it("normalizes CSV-style upload rows", () => {
    const { rates, problems } = normalizeCsvHtsRows([
      {
        hts: "1704.90.3590",
        effective_start: "2024-07-01",
        col1_rate_pct: "5.6",
        description: "CONFECTIONS",
      },
      { hts: "bad", effective_start: "2024-07-01", col1_rate_pct: "1" },
    ]);
    assert.equal(rates.length, 1);
    assert.equal(rates[0].hts, "1704903590");
    assert.equal(rates[0].col1_pct, 5.6);
    assert.ok(problems.some((p) => p.includes("invalid hts")));
  });

  it("parses a mini classification-style workbook", () => {
    const wb = XLSX.utils.book_new();
    // 5 title rows then headers (importer uses range: 5)
    const aoa = [
      ["title"],
      ["title"],
      ["title"],
      ["title"],
      ["title"],
      [
        "HTS No.",
        "Start Date",
        "End Date",
        "C1 Ad Valorem",
        "C1 Ad Valorem formula",
        "C1 Rate Specific",
        "C1 Rate Specific formula",
        "UOM1",
        "UOM2",
        "Duty Code",
        "Description",
      ],
      [
        "3926909989",
        "2024-07-01",
        "2049-12-31",
        "5.3",
        5.3,
        null,
        null,
        null,
        null,
        null,
        "OTH.PLSTIC MAT",
      ],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const parsed = parseHtsClassificationWorkbook(buf);
    assert.equal(parsed.rates.length, 1);
    assert.equal(parsed.rates[0].hts, "3926909989");
    assert.ok(parsed.rates[0].col1_pct > 5);
  });

  describe("merge into pack (temp isolate)", () => {
    let isolate: ReturnType<typeof isolateHtsPacks>;

    before(() => {
      isolate = isolateHtsPacks();
    });

    after(() => {
      isolate?.cleanup();
    });

    it("merges CSV rows into a temp pack (upsert by hts|start|end)", () => {
      const fake = {
        hts: "9999999910",
        start: "2026-01-01",
        end: "9999-12-31",
        col1_pct: 9.99,
        desc: "UPLOAD-TEST-ONLY",
      };
      const beforeSrc = reloadHtsTable().source;
      const result = mergeHtsRateRows([fake], {
        source: beforeSrc || "unit-test-merge",
        as_of: "2026-08-06",
        replace: false,
      });
      reloadHtsTable();
      const hit = resolveCol1("9999999910", "2026-08-06");
      assert.ok(hit);
      assert.equal(hit!.col1_pct, 9.99);
      assert.ok(result.row_count > 1000);
      assert.equal(result.upserted, 1);
    });
  });
});
