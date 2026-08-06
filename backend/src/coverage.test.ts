import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { coverRows, isPlausibleHtsCell, parseCoverageInput } from "./coverage.ts";

describe("HTS coverage", () => {
  it("parses paste with header and bare HTS lines", () => {
    const rows = parseCoverageInput({
      text: `hts,coo
8708.10.3050,CN
6203.42.4010,VN`,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].coo, "CN");
  });

  it("resolves 301-FL without entered value", () => {
    const r = coverRows({
      as_of: "2026-07-25",
      assume_cn_list3: false,
      rows: [
        { hts: "8708.10.3050", coo: "CN", s301_list_3: true },
        { hts: "6203.42.4010", coo: "VN" },
      ],
    });
    assert.equal(r.summary.rows, 2);
    const vn = r.rows.find((x) => String(x.coo) === "VN")!;
    assert.ok((vn.rules as unknown[]).some((rule: { program?: string }) => rule.program === "s301fl"));
    const cn = r.rows.find((x) => String(x.coo) === "CN")!;
    assert.ok((cn.ch99_sequence as string[]).length >= 1);
  });

  it("uses default_coo when column missing", () => {
    const r = coverRows({
      as_of: "2026-07-25",
      default_coo: "VN",
      rows: [{ hts: "8708103050" }],
    });
    assert.equal(r.rows[0].coo, "VN");
  });

  it("skips title rows and maps Primary HTS / COO headers", () => {
    const rows = parseCoverageInput({
      text: `Subaru — Full Tariff Stack
Notes about yellow cells
#,Primary HTS,HTS (formatted),COO,Entry Date
1,8708407580,8708.40.7580,BR,2026-07-27
2,8708915000,8708.91.5000,CN,2026-07-27`,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].hts.replace(/\D/g, ""), "8708407580");
    assert.equal(rows[0].coo, "BR");
    assert.equal(rows[1].coo, "CN");
  });

  it("retains Part and SKU from Excel/CSV headers in coverage output", () => {
    const rows = parseCoverageInput({
      text: `Part Number,SKU,HTS,COO
GO-1001,SKU-A,1704903590,BR
GO-1002,SKU-B,1806329000,CN`,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].part, "GO-1001");
    assert.equal(rows[0].sku, "SKU-A");
    assert.equal(rows[1].part, "GO-1002");
    assert.equal(rows[1].sku, "SKU-B");

    const covered = coverRows({
      as_of: "2026-08-06",
      rows,
      assume_cn_list3: false,
    });
    assert.equal(covered.rows[0].part, "GO-1001");
    assert.equal(covered.rows[0].sku, "SKU-A");
    assert.equal(covered.rows[1].part, "GO-1002");
    assert.equal(covered.rows[1].sku, "SKU-B");
  });

  it("retains part/sku from xlsx Workbook sheets", () => {
    const wb = XLSX.utils.book_new();
    const sheet = [
      ["Item Number", "Product Code", "Primary HTS", "Country"],
      ["P-77", "PC-77", "8708407580", "BR"],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), "Sheet1");
    const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    const rows = parseCoverageInput({ xlsx_base64: b64, filename: "parts.xlsx" });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].part, "P-77");
    assert.equal(rows[0].sku, "PC-77");
    assert.equal(rows[0].coo, "BR");
  });

  it("rejects footnote cells that mention Ch.99 codes as HTS", () => {
    assert.equal(isPlausibleHtsCell("8708407580"), true);
    assert.equal(isPlausibleHtsCell("8708.40.7580"), true);
    assert.equal(
      isPlausibleHtsCell(
        "THE MASTER SWITCH. Y suppresses 301-FL (9903.05.90) and routes the line.",
      ),
      false,
    );
  });

  it("skips Full Stack column footnotes in xlsx workbooks", () => {
    const wb = XLSX.utils.book_new();
    const full = [
      ["Subaru — Full Tariff Stack"],
      ["notes"],
      ["#", "Primary HTS", "HTS (formatted)", "COO", "Entry Date"],
      [1, "8708407580", "8708.40.7580", "BR", "2026-07-27"],
      [2, "8708915000", "8708.91.5000", "CN", "2026-07-27"],
      [
        "Col G — 232 Auto Part?",
        "",
        "THE MASTER SWITCH. Y suppresses 301-FL (9903.05.90) and routes the line to the 232 autos/parts regime.",
        "",
        "",
      ],
      [
        "Col L — Entry Date",
        "",
        "Text, ISO format. Anything before 2026-07-24 turns the Section 122 layer on.",
        "",
        "",
      ],
    ];
    const sheet1 = [
      ["HTS code", "COO"],
      ["8708407580", "BR"],
      ["8708915000", "CN"],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(full), "Full Stack");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1), "Sheet1");
    const b64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    const rows = parseCoverageInput({ xlsx_base64: b64, filename: "stack.xlsx" });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.coo));
  });

  it("parses Subaru Full Tariff Stack workbook as 251 codes", () => {
    const path = "/Users/jasonmeasures/Downloads/Subaru_Full_Tariff_Stack_v2.xlsx";
    if (!existsSync(path)) return;
    const rows = parseCoverageInput({
      xlsx_base64: readFileSync(path).toString("base64"),
      filename: "Subaru_Full_Tariff_Stack_v2.xlsx",
    });
    assert.equal(rows.length, 251);
    assert.equal(rows.filter((r) => !r.coo).length, 0);
    const covered = coverRows({ as_of: "2026-08-03", rows, assume_cn_list3: true });
    assert.equal(covered.summary.rows, 251);
    assert.equal(covered.summary.missing_coo, 0);
    assert.equal(covered.summary.in_table, 251);
  });
});
