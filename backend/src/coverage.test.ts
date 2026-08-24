import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import { coverRows, coverRowsAsync, isPlausibleHtsCell, parseCoverageInput } from "./coverage.ts";

describe("HTS coverage", () => {
  it("parses paste with header and bare HTS lines", () => {
    const rows = parseCoverageInput({
      text: `hts,coo
8708.10.3050,CN
6203.42.0711,VN`,
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
        { hts: "6203.42.0711", coo: "VN" },
      ],
    });
    assert.equal(r.summary.rows, 2);
    const vn = r.rows.find((x) => String(x.coo) === "VN")!;
    assert.equal(vn.in_table, true);
    assert.ok((vn.rules as unknown[]).some((rule: { program?: string }) => rule.program === "s301fl"));
    const cn = r.rows.find((x) => String(x.coo) === "CN")!;
    assert.ok((cn.ch99_sequence as string[]).length >= 1);
  });

  it("coverRowsAsync matches coverRows", async () => {
    const body = {
      as_of: "2026-07-25",
      assume_cn_list3: false,
      rows: [
        { hts: "8708.10.3050", coo: "CN", s301_list_3: true },
        { hts: "6203.42.0711", coo: "VN" },
      ],
    };
    const sync = coverRows(body);
    const asyncOut = await coverRowsAsync(body, 1);
    assert.deepEqual(asyncOut.summary, sync.summary);
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

  it("surfaces new 232 packs (vehicles / MHDV / wood / semiconductors) on HTS list", () => {
    const r = coverRows({
      as_of: "2026-08-01",
      rows: [
        { hts: "4407.11.00", coo: "CA" },
        { hts: "8703.23.01", coo: "JP" },
        { hts: "8704.23.01", coo: "DE" },
        { hts: "8702.10.31", coo: "KR" },
        { hts: "9401.61.4011", coo: "VN" },
        { hts: "8473.30.00", coo: "TW" },
        { hts: "8709.90.00", coo: "DE" },
      ],
    });
    const by = (hts: string) =>
      r.rows.find((x) => String(x.hts).replace(/\D/g, "").startsWith(hts.replace(/\D/g, "").slice(0, 8)))!;
    const wood = by("440711");
    assert.ok(
      (wood.rules as { ch99?: string }[]).some((x) => x.ch99 === "9903.76.01"),
      "softwood lumber should hit 9903.76.01",
    );
    const pv = by("870323");
    assert.ok((pv.s232_universe as { passenger_vehicle?: unknown }).passenger_vehicle);
    assert.ok((pv.rules as { ch99?: string }[]).some((x) => x.ch99 === "9903.94.41"));
    const mhdv = by("870423");
    assert.ok((mhdv.rules as { ch99?: string }[]).some((x) => x.ch99 === "9903.74.01"));
    const bus = by("870210");
    assert.ok((bus.rules as { ch99?: string }[]).some((x) => x.ch99 === "9903.74.02"));
    const furniture = by("940161");
    assert.ok((furniture.rules as { ch99?: string }[]).some((x) => x.ch99 === "9903.76.02"));
    const semi = by("847330");
    assert.ok(
      (semi.rules as { ch99?: string; status?: string }[]).some(
        (x) => x.ch99 === "9903.79.01" && x.status === "needs_claim",
      ),
      "semiconductor list without claim is needs_claim",
    );
    const parts = by("870990");
    assert.ok(
      (parts.rules as { ch99?: string; status?: string }[]).some(
        (x) => x.ch99 === "9903.74.08" && x.status === "needs_claim",
      ),
    );
    assert.ok((r.summary as { with_s232?: number }).with_s232 >= 6);
    assert.ok((r.summary as { needs_claim?: number }).needs_claim >= 2);
  });

  it("shows 232 list membership even without origin or Column-1", () => {
    const r = coverRows({
      as_of: "2026-08-01",
      rows: [{ hts: "8703.23.01" }, { hts: "8473.30.00" }],
    });
    const pv = r.rows[0];
    assert.ok((pv.s232_universe as { passenger_vehicle?: unknown }).passenger_vehicle);
    assert.ok((pv.rules as { ch99?: string }[]).some((x) => x.ch99 === "9903.94.01"));
    const semi = r.rows[1];
    assert.ok(
      (semi.rules as { status?: string; ch99?: string }[]).some(
        (x) => x.ch99 === "9903.79.01" && x.status === "needs_claim",
      ),
    );
  });

  it("parses MHDV / semiconductor claim columns from CSV", () => {
    const rows = parseCoverageInput({
      text: `hts,coo,s232_mhdv_part,s232_semiconductor
8709.90.00,DE,Y,
8473.30.00,TW,,Y`,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].s232_mhdv_part, true);
    assert.equal(rows[1].s232_semiconductor, true);
    const covered = coverRows({ as_of: "2026-08-01", rows });
    const mhdv = covered.rows[0];
    assert.ok(
      (mhdv.rules as { ch99?: string; status?: string }[]).some(
        (x) => x.ch99 === "9903.74.08" && x.status === "applies",
      ),
    );
    const semi = covered.rows[1];
    assert.ok(
      (semi.rules as { ch99?: string; status?: string }[]).some(
        (x) => x.ch99 === "9903.79.01" && x.status === "applies",
      ),
    );
    if ((mhdv.ch99_sequence as string[])?.length) {
      assert.ok((mhdv.ch99_sequence as string[]).includes("9903.74.08"));
    }
    if ((semi.ch99_sequence as string[])?.length) {
      assert.ok((semi.ch99_sequence as string[]).includes("9903.79.01"));
    }
  });
});
