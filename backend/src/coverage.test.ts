import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coverRows, parseCoverageInput } from "./coverage.ts";

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
      assume_cn_list3: true,
      rows: [
        { hts: "8708.10.3050", coo: "CN" },
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
});
