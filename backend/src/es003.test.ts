import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  auditEs003,
  groupEs003Lines,
  inIeepaRefundWindow,
  parseEs003Buffer,
  parseEs003Date,
  parseMoney,
} from "./es003.ts";
import { auditEntry } from "./assess.ts";

describe("ES-003 audit", () => {
  it("parses ACE dates and money", () => {
    assert.equal(parseEs003Date("04/08/2025"), "2025-04-08");
    assert.equal(parseEs003Date("2025-04-08"), "2025-04-08");
    assert.equal(parseMoney("$2,567.49"), 2567.49);
    assert.equal(inIeepaRefundWindow("2025-04-08"), true);
    assert.equal(inIeepaRefundWindow("2026-02-24"), false);
  });

  it("groups commodity + Ch.99 ordinals and windows IEEPA as refund candidate", () => {
    const wb = XLSX.utils.book_new();
    const aoa = [
      [
        "Entry Summary Number",
        "Entry Summary Line Number",
        "Entry Type Code",
        "Importer Number",
        "Port of Entry Code",
        "Entry Date",
        "Entry Summary Date",
        "Country of Origin Code",
        "Country of Export Code",
        "Tariff Ordinal Number",
        "HTS Number - Full",
        "Line Tariff Goods Value Amount",
        "Line Tariff Duty Amount",
        "Line Tariff Quantity (1)",
        "Line Tariff UOM (1) Code",
      ],
      [
        "BII0001",
        "1",
        "01",
        "12-345",
        "4601",
        "04/08/2025",
        "04/15/2025",
        "IN",
        "IN",
        "1",
        "99030128",
        "$0.00",
        "$850.00",
        "",
        "",
      ],
      [
        "BII0001",
        "1",
        "01",
        "12-345",
        "4601",
        "04/08/2025",
        "04/15/2025",
        "IN",
        "IN",
        "2",
        "3923900080",
        "$10,000.00",
        "$300.00",
        "100",
        "NO",
      ],
      [
        "BII0002",
        "1",
        "01",
        "12-345",
        "4601",
        "03/01/2026",
        "03/05/2026",
        "IN",
        "IN",
        "1",
        "99030128",
        "$0.00",
        "$0.00",
        "",
        "",
      ],
      [
        "BII0002",
        "1",
        "01",
        "12-345",
        "4601",
        "03/01/2026",
        "03/05/2026",
        "IN",
        "IN",
        "2",
        "3923900080",
        "$5,000.00",
        "$150.00",
        "50",
        "NO",
      ],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Main Report");
    const buf = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const { lines, meta } = parseEs003Buffer(buf);
    assert.equal(meta.entry_lines, 2);
    assert.equal(lines[0].hts, "3923900080");
    assert.equal(lines[0].entered_value, 10000);
    assert.deepEqual(lines[0].filed_ch99, ["9903.01.28"]);
    assert.equal(lines[0].ieepa_duty, 850);
    assert.equal(inIeepaRefundWindow(lines[0].entry_date), true);

    const result = auditEs003({ xlsx_base64: buf.toString("base64"), filename: "test.xlsx" });
    assert.ok(result.findings.some((f) => f.category === "IEEPA_REFUND_CANDIDATE"));
    assert.ok(
      result.findings.some(
        (f) =>
          (f.category === "WRONG_ERA" || f.category === "DEAD_PROGRAM") &&
          String(f.line_id).includes("BII0002"),
      ),
    );
    assert.ok(result.ieepa.lines_in_window >= 1);
  });

  it("auditEntry marks in-window IEEPA as CAPE candidate not dead error", () => {
    const r = auditEntry({
      lines: [
        {
          line_id: "1",
          hts: "3923900080",
          coo: "IN",
          entered_value: 10000,
          entry_date: "2025-06-01",
          release_date: "2025-06-01",
          filed_ch99: ["9903.01.28"],
        },
      ],
    });
    const ieepa = r.findings.filter((f) => String(f.message).includes("9903.01.28"));
    assert.equal(ieepa.length, 1);
    assert.equal(ieepa[0].category, "IEEPA_REFUND_CANDIDATE");
    assert.equal(ieepa[0].severity, "INFO");
  });

  it("parses Uflex ES-003 sample when present", () => {
    const path =
      "/Users/jasonmeasures/Library/CloudStorage/OneDrive-KlearNow/ES-003 Entry Summary Line Tariff Details_Uflex_2025-2026[80].xlsx";
    if (!existsSync(path)) return;
    const { lines, meta } = parseEs003Buffer(readFileSync(path));
    assert.ok(meta.tariff_rows >= 1000);
    assert.ok(meta.entry_lines >= 500);
    assert.ok(meta.ieepa_lines > 0);
    assert.ok(lines.every((l) => l.entry_date));
    // commodity HTS present on grouped lines that have goods value
    const withVal = lines.filter((l) => l.entered_value > 0);
    assert.ok(withVal.length > 400);
    assert.ok(withVal.every((l) => l.hts && !l.hts.startsWith("99")));

    const result = auditEs003({
      xlsx_base64: readFileSync(path).toString("base64"),
      filename: "Uflex_ES-003.xlsx",
    });
    assert.equal(result.summary.entry_lines_audited, withVal.length);
    assert.ok((result.summary.by_category.IEEPA_REFUND_CANDIDATE || 0) > 0);
  });

  it("groupEs003Lines prefers non-99 commodity with value", () => {
    const lines = groupEs003Lines([
      {
        entry_number: "E1",
        line_number: "2",
        entry_date: "2025-05-01",
        entry_summary_date: null,
        entry_type: "01",
        importer: "",
        port: "",
        coo: "VN",
        country_export: "VN",
        hts: "99030531",
        ordinal: 1,
        goods_value: 0,
        duty: 0,
        qty: null,
        uom: null,
      },
      {
        entry_number: "E1",
        line_number: "2",
        entry_date: "2025-05-01",
        entry_summary_date: null,
        entry_type: "01",
        importer: "",
        port: "",
        coo: "VN",
        country_export: "VN",
        hts: "6203424010",
        ordinal: 2,
        goods_value: 2000,
        duty: 50,
        qty: 10,
        uom: "DZ",
      },
    ]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].hts, "6203424010");
    assert.deepEqual(lines[0].filed_ch99, ["9903.05.31"]);
  });

  it("aggregates Uflex into entry reviews with CAPE-style statuses", () => {
    const path =
      "/Users/jasonmeasures/Library/CloudStorage/OneDrive-KlearNow/ES-003 Entry Summary Line Tariff Details_Uflex_2025-2026[80].xlsx";
    if (!existsSync(path)) return;
    const result = auditEs003({
      xlsx_base64: readFileSync(path).toString("base64"),
      filename: "Uflex_ES-003.xlsx",
    });
    assert.ok(Array.isArray(result.entries));
    assert.equal(result.entries.length, result.meta.entries);
    assert.ok(result.totals.ieepa_duty > 0);
    assert.ok(result.totals.ieepa_cape_entries > 0);
    const sample = result.entries.find((e) => e.has_ieepa_window);
    assert.ok(sample);
    assert.equal(sample.status, "ieepa_cape");
    assert.ok(sample.observations.length > 0);
    assert.ok(sample.guidance);
  });

  it("Sec 122–era sample (10).xlsx — all 8 entries clean under live stack", () => {
    const path =
      "/Users/jasonmeasures/Downloads/ES-003 Entry Summary Line Tariff Details (10).xlsx";
    if (!existsSync(path)) return;
    const result = auditEs003({
      xlsx_base64: readFileSync(path).toString("base64"),
      filename: "ES-003-(10).xlsx",
    });
    assert.equal(result.meta.entries, 8);
    for (const e of result.entries) {
      assert.equal(
        e.status,
        "clean",
        `${e.id} expected clean, got ${e.status}: ${JSON.stringify(e.by_category)}`,
      );
      assert.equal(e.by_category.EXTRA_CH99 || 0, 0, e.id);
      assert.equal(e.by_category.MISSING_CH99 || 0, 0, e.id);
      assert.equal(e.by_category.WRONG_ERA || 0, 0, e.id);
    }
    // Spot-check the previous false-positive entries
    const bii = result.entries.find((e) => e.id === "BII05992854")!;
    assert.ok(bii.computed_ch99.includes("9903.03.01"));
    assert.ok(bii.computed_ch99.includes("9903.88.15"));
    assert.ok(bii.computed_ch99.includes("9903.82.09"));
    assert.ok(bii.computed_ch99.includes("9903.03.06"));
    const prefab = result.entries.find((e) => e.id === "BII05999206")!;
    assert.ok(prefab.computed_ch99.includes("9903.82.09"));
    assert.ok(prefab.computed_ch99.includes("9903.88.03"));
    assert.ok(!prefab.computed_ch99.includes("9903.03.01")); // metals ESLs + China only entry's non-metals? actually entry has 9406 metals only + 7321 — no Sec 122. Correct.
  });
});
