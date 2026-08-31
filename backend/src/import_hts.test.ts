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
        "PGACD",
        "ADD",
        "CVD",
        "Add. HTS",
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
        null,
        "N",
        "N",
        "N",
      ],
      [
        "0101210010",
        "2012-02-03",
        "2049-12-31",
        "0",
        0,
        null,
        null,
        "NO",
        null,
        "0",
        "MALE HORSES",
        "AM7,FD3",
        "N",
        "N",
        "N",
      ],
      [
        "7208101500",
        "2024-01-01",
        "2049-12-31",
        "0",
        0,
        null,
        null,
        null,
        null,
        null,
        "STEEL",
        "AM8,FD4",
        "Y",
        "Y",
        "N",
      ],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const parsed = parseHtsClassificationWorkbook(buf);
    assert.equal(parsed.rates.length, 3);
    assert.equal(parsed.rates[0].hts, "0101210010");
    assert.deepEqual(parsed.rates[0].pga_codes, ["AM7", "FD3"]);
    assert.equal(parsed.rates[0].add, undefined);
    const steel = parsed.rates.find((r) => r.hts === "7208101500");
    assert.ok(steel);
    assert.deepEqual(steel!.pga_codes, ["AM8", "FD4"]);
    assert.equal(steel!.add, true);
    assert.equal(steel!.cvd, true);
    assert.equal(steel!.add_hts, undefined);
    const plastic = parsed.rates.find((r) => r.hts === "3926909989");
    assert.ok(plastic);
    assert.ok(plastic!.col1_pct > 5);
    assert.equal(plastic!.pga_codes, undefined);
  });

  it("normalizes CSV flag columns", () => {
    const { rates, problems } = normalizeCsvHtsRows([
      {
        hts: "0101.21.0010",
        effective_start: "2012-02-03",
        col1_rate_pct: "0",
        PGACD: "AM7,FD3",
        ADD: "N",
        CVD: "N",
        "Add. HTS": "Y",
      },
    ]);
    assert.equal(problems.length, 0);
    assert.equal(rates.length, 1);
    assert.deepEqual(rates[0].pga_codes, ["AM7", "FD3"]);
    assert.equal(rates[0].add_hts, true);
    assert.equal(rates[0].add, undefined);
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
