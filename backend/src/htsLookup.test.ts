import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import * as XLSX from "xlsx";
import { coverOne } from "./coverage.ts";
import {
  formatHtsDisplay,
  lookupHts,
  reloadHtsTable,
  resolveCol1,
  suggestHtsPrefix,
  suggestRelatedHts,
} from "./htsLookup.ts";
import {
  HTS_REPLACEMENTS_PATH,
  mergeHtsRateRows,
  mergeHtsReplacements,
  normalizeCsvHtsRows,
  parseHtsClassificationWorkbook,
} from "./import_hts.ts";

describe("HTS ended → replacement", () => {
  const ENDED = "8888888810";
  const REPL = "8888888820";
  const snapshot = readFileSync(HTS_REPLACEMENTS_PATH, "utf8");

  after(() => {
    writeFileSync(HTS_REPLACEMENTS_PATH, snapshot);
    reloadHtsTable();
  });

  it("formats 10-digit HTS as XXXX.XX.XXXX", () => {
    assert.equal(formatHtsDisplay("3926909989"), "3926.90.9989");
  });

  it("detects ended windows and surfaces mapped replacement", () => {
    mergeHtsRateRows(
      [
        {
          hts: ENDED,
          start: "2020-01-01",
          end: "2024-12-31",
          col1_pct: 3.5,
          desc: "ENDED-TEST",
        },
        {
          hts: REPL,
          start: "2025-01-01",
          end: "9999-12-31",
          col1_pct: 4.2,
          desc: "REPL-TEST",
        },
      ],
      { source: "unit-test-ended", as_of: "2026-08-06", replace: false },
    );
    mergeHtsReplacements(
      [
        {
          from: ENDED,
          to: REPL,
          effective: "2025-01-01",
          note: "unit test successor",
        },
      ],
      { source: "unit-test-ended", as_of: "2026-08-06", replace: false },
    );
    reloadHtsTable();

    const onWindow = lookupHts(ENDED, "2024-06-01");
    assert.equal(onWindow.window_status, "active");
    assert.equal(onWindow.hit?.col1_pct, 3.5);

    const ended = lookupHts(ENDED, "2026-08-06");
    assert.equal(ended.window_status, "ended");
    assert.equal(ended.ended_on, "2024-12-31");
    assert.equal(ended.replacement_hts, REPL);
    assert.equal(ended.replacement_hts_display, formatHtsDisplay(REPL));
    assert.ok(ended.replacement);
    assert.equal(ended.replacement?.col1_pct, 4.2);

    // Legacy assess path still returns last-known rate
    const legacy = resolveCol1(ENDED, "2026-08-06");
    assert.ok(legacy);
    assert.equal(legacy!.col1_pct, 3.5);

    const cov = coverOne(
      { hts: ENDED, coo: "VN" },
      { as_of: "2026-08-06", default_coo: null },
    );
    assert.equal(cov.window_status, "ended");
    assert.equal(cov.replacement_hts, REPL);
    assert.ok((cov.notes as string[]).some((n) => /ended/i.test(n)));
    assert.ok((cov.notes as string[]).some((n) => /replacement/i.test(n)));
  });

  it("parses Replacement HTS from workbook columns", () => {
    const wb = XLSX.utils.book_new();
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
        "Replacement HTS",
      ],
      [
        "7777777710",
        "2020-01-01",
        "2023-12-31",
        "1.1",
        1.1,
        null,
        null,
        null,
        null,
        null,
        "OLD",
        "7777777720",
      ],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const parsed = parseHtsClassificationWorkbook(buf);
    assert.equal(parsed.rates.length, 1);
    assert.equal(parsed.replacements.length, 1);
    assert.equal(parsed.replacements[0].from, "7777777710");
    assert.equal(parsed.replacements[0].to, "7777777720");
  });

  it("accepts pure from/to CSV replacement rows", () => {
    const { rates, replacements, problems } = normalizeCsvHtsRows([
      { from: "6666666610", to: "6666666620", note: "map only" },
    ]);
    assert.equal(rates.length, 0);
    assert.equal(problems.length, 0);
    assert.equal(replacements.length, 1);
    assert.equal(replacements[0].from, "6666666610");
    assert.equal(replacements[0].to, "6666666620");
  });

  it("suggests sibling statistical lines under the same 8-digit heading", () => {
    const related = suggestRelatedHts("1805.00.0000", "2026-08-07");
    assert.ok(related.length >= 2);
    const codes = related.map((r) => r.hts);
    assert.ok(codes.includes("1805000010"));
    assert.ok(codes.includes("1805000090"));
  });

  it("typeahead matches 10-digit lines from 4+ digits", () => {
    assert.deepEqual(suggestHtsPrefix("87", "2026-08-18"), []);
    const heading = suggestHtsPrefix("8703", "2026-08-18", 12);
    assert.ok(heading.length >= 1 && heading.length <= 12);
    assert.ok(heading.every((h) => h.hts.startsWith("8703")));
    assert.ok(heading[0].hts_display.startsWith("8703."));
    const stem = suggestHtsPrefix("87032301", "2026-08-18", 12);
    assert.ok(stem.some((h) => h.hts === "8703230120" || h.hts.startsWith("87032301")));
    const exact = suggestHtsPrefix("8703230120", "2026-08-18");
    assert.equal(exact[0]?.hts, "8703230120");
  });

  it("coverage blocks unknown HTS and returns plain-text help + related", () => {
    const cov = coverOne(
      { hts: "1805.00.0000", coo: "" },
      { as_of: "2026-08-07", default_coo: null },
    );
    assert.equal(cov.blocked, true);
    assert.equal(cov.in_table, false);
    assert.equal((cov.rules as unknown[]).length, 0);
    assert.ok((cov.related_hts as unknown[]).length >= 2);
    const help = cov.help as { title: string; steps: string[] };
    assert.ok(help?.title);
    assert.ok(help.steps?.length);
    assert.ok(!(cov.notes as string[]).some((n) => /[—·]/.test(n)));
  });
});
