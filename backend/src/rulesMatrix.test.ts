/**
 * Solid stacking + audit matrix across eras.
 *
 * Timeframes (Entry / rate date):
 *   IEEPA     2025-02-04 … 2026-02-23
 *   Sec 122   2026-02-24 … 2026-07-23
 *   301-FL    2026-07-24 …
 *
 * Stacking (confirmed):
 *   R2  — China 301 stacks with 232 and with Sec 122
 *   R2b — Sec 122 does NOT stack with 232 → 9903.03.06
 *   R1  — 232 vs 301-FL → 9903.05.90
 *   R4b — 9903.82.09 = 25% entered value (derivatives/copper)
 *   R4c — Sec 122 is entry-level across ESLs
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessLine, auditEntry } from "./assess.ts";
import { STACKING_CONTRACT } from "./rulesContract.ts";

const CN_NON_METAL = "6306120000"; // apparel — Sec 122 / 301-FL territory
const CN_STEEL_ARTICLE = "7307923030"; // Ch.73 — article path 82.02 (content)
const CN_STEEL_DERIV_FILED = "7321890050"; // filed as 82.09 in ES-003
const CN_PREFAB_DERIV = "9406900190"; // Ch.94 derivative claim via 82.09

function seq(L: { ch99_sequence: string[] }) {
  return L.ch99_sequence;
}
function has(L: { ch99_sequence: string[] }, c: string) {
  return L.ch99_sequence.includes(c);
}
function hasFl(L: { ch99_sequence: string[] }) {
  return L.ch99_sequence.some((c) => c.startsWith("9903.05.") && c !== "9903.05.90");
}

describe("STACKING_CONTRACT metadata", () => {
  it("documents three eras with inclusive windows", () => {
    assert.equal(STACKING_CONTRACT.eras.length, 3);
    assert.equal(STACKING_CONTRACT.eras[1].ch99, "9903.03.01");
    assert.equal(STACKING_CONTRACT.eras[2].from, "2026-07-24");
    assert.ok(STACKING_CONTRACT.rules.some((r) => r.id === "R2b"));
    assert.ok(STACKING_CONTRACT.rules.some((r) => r.id === "R4b"));
  });
});

describe("era matrix — non-metals CN line (China List 4A claim)", () => {
  it("Sec 122 day 1 (2026-02-24): China 301 + Sec 122; no 301-FL", () => {
    const L = assessLine(
      {
        hts: CN_NON_METAL,
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-02-24",
        flags: { s301_list_4a: true },
      },
      0,
    );
    assert.ok(has(L, "9903.88.15"));
    assert.ok(has(L, "9903.03.01"));
    assert.ok(!hasFl(L));
    // 7.5% + 10% = 17.5% on $10k → $1,750 (+col1 if any)
    assert.ok(L.totals.duty >= 1750);
  });

  it("Sec 122 last day (2026-07-23): still Sec 122, not 301-FL", () => {
    const L = assessLine(
      {
        hts: CN_NON_METAL,
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-07-23",
        flags: { s301_list_4a: true },
      },
      0,
    );
    assert.ok(has(L, "9903.03.01"));
    assert.ok(has(L, "9903.88.15"));
    assert.ok(!hasFl(L));
  });

  it("301-FL first day (2026-07-24): China 301 + FL; no Sec 122", () => {
    const L = assessLine(
      {
        hts: CN_NON_METAL,
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-07-24",
        flags: { s301_list_4a: true },
      },
      0,
    );
    assert.ok(has(L, "9903.88.15"));
    assert.ok(hasFl(L));
    assert.ok(!has(L, "9903.03.01"));
  });

  it("IEEPA last day (2026-02-23): no Sec 122 surcharge layer", () => {
    const L = assessLine(
      {
        hts: CN_NON_METAL,
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-02-23",
        flags: { s301_list_4a: true },
      },
      0,
    );
    assert.ok(has(L, "9903.88.15"));
    assert.ok(!has(L, "9903.03.01"));
    assert.ok(!hasFl(L));
  });
});

describe("era matrix — 232 metals derivative 9903.82.09", () => {
  it("Sec 122 era: China 301 + 03.06 + 82.09; Sec 122 suppressed", () => {
    const L = assessLine(
      {
        hts: CN_STEEL_DERIV_FILED,
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-06-25",
        filed_ch99: ["9903.88.15", "9903.03.06", "9903.82.09"],
      },
      0,
    );
    assert.ok(has(L, "9903.88.15"));
    assert.ok(has(L, "9903.03.06"));
    assert.ok(has(L, "9903.82.09"));
    assert.ok(!has(L, "9903.03.01"));
    assert.ok(L.suppressed.some((s) => s.ch99 === "9903.03.01"));
    // 7.5% China + 25% 82.09 = 32.5% → $3,250
    assert.equal(L.totals.duty, 3250);
  });

  it("301-FL era: China 301 + 82.09 + 05.90; no live FL duty", () => {
    const L = assessLine(
      {
        hts: CN_STEEL_DERIV_FILED,
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-07-25",
        filed_ch99: ["9903.88.15", "9903.03.06", "9903.82.09"],
      },
      0,
    );
    assert.ok(has(L, "9903.88.15"));
    assert.ok(has(L, "9903.82.09"));
    assert.ok(has(L, "9903.05.90"));
    assert.ok(!hasFl(L));
    assert.ok(!has(L, "9903.03.01"));
  });

  it("Ch.94 prefab claim-gates 82.09 outside chapter triage", () => {
    const L = assessLine(
      {
        hts: CN_PREFAB_DERIV,
        coo: "CN",
        entered_value: 20000,
        entry_date: "2026-07-07",
        filed_ch99: ["9903.88.03", "9903.03.06", "9903.82.09"],
      },
      0,
    );
    assert.ok(has(L, "9903.88.03"));
    assert.ok(has(L, "9903.03.06"));
    assert.ok(has(L, "9903.82.09"));
    assert.ok(!has(L, "9903.03.01"));
    // 25% + 25% = 50% → $10,000 (+col1)
    assert.ok(L.totals.duty >= 10000);
  });
});

describe("era matrix — 232 metals article 9903.82.02 (content path)", () => {
  it("without content: no 82.02 duty; Sec 122 still suppressed in Sec 122 era", () => {
    const L = assessLine(
      {
        hts: CN_STEEL_ARTICLE,
        coo: "TH",
        entered_value: 10000,
        entry_date: "2026-06-25",
      },
      0,
    );
    assert.ok(L.diagnostics.some((d) => d.code === "METAL_CONTENT_REQUIRED"));
    assert.ok(!has(L, "9903.82.02"));
    assert.ok(has(L, "9903.03.06"));
    assert.ok(!has(L, "9903.03.01"));
  });

  it("with content + melt/pour in FL era: 82.02 + 05.90", () => {
    const L = assessLine(
      {
        hts: CN_STEEL_ARTICLE,
        coo: "TH",
        entered_value: 10000,
        metal_content_value: 10000,
        country_of_melt_pour: "CN",
        entry_date: "2026-07-27",
      },
      0,
    );
    assert.ok(has(L, "9903.82.02"));
    assert.ok(has(L, "9903.05.90"));
    assert.ok(!hasFl(L));
    assert.equal(L.totals.metals_duty, 5000);
  });
});

describe("audit matrix — filed vs computed", () => {
  it("aligned Sec 122 non-metals filing is clean", () => {
    const a = auditEntry({
      lines: [
        {
          line_id: "e1:1",
          hts: CN_NON_METAL,
          coo: "CN",
          entered_value: 10000,
          entry_date: "2026-07-10",
          filed_ch99: ["9903.03.01"],
        },
      ],
    });
    assert.equal(a.findings.length, 0);
    assert.ok(has(a.lines[0], "9903.03.01"));
  });

  it("late Sec 122 on 2026-07-24 → WRONG_ERA + MISSING_CH99 (FL)", () => {
    const a = auditEntry({
      lines: [
        {
          line_id: "late",
          hts: CN_NON_METAL,
          coo: "CN",
          entered_value: 10000,
          entry_date: "2026-07-24",
          filed_ch99: ["9903.03.01"],
        },
      ],
    });
    assert.ok(a.findings.some((f) => f.category === "WRONG_ERA"));
    assert.ok(a.findings.some((f) => f.category === "MISSING_CH99"));
    assert.ok(!has(a.lines[0], "9903.03.01"));
    assert.ok(hasFl(a.lines[0]));
  });

  it("IEEPA filed in CAPE window → IEEPA_REFUND_CANDIDATE not DEAD", () => {
    const a = auditEntry({
      lines: [
        {
          line_id: "cape",
          hts: CN_NON_METAL,
          coo: "CN",
          entered_value: 10000,
          entry_date: "2026-02-01",
          filed_ch99: ["9903.01.25"],
        },
      ],
    });
    assert.ok(a.findings.some((f) => f.category === "IEEPA_REFUND_CANDIDATE"));
    assert.ok(!a.findings.some((f) => f.category === "DEAD_PROGRAM"));
  });

  it("entry-level Sec 122 + metals ESL: 82.09/03.06 not EXTRA; 03.01 not missing on ESL2", () => {
    const a = auditEntry({
      lines: [
        {
          line_id: "ENT:1",
          hts: CN_NON_METAL,
          coo: "CN",
          entered_value: 11910,
          entry_date: "2026-06-25",
          filed_ch99: ["9903.03.01"],
        },
        {
          line_id: "ENT:2",
          hts: CN_STEEL_DERIV_FILED,
          coo: "CN",
          entered_value: 7088,
          entry_date: "2026-06-25",
          filed_ch99: ["9903.88.15", "9903.03.06", "9903.82.09"],
        },
      ],
    });
    assert.ok(
      !a.findings.some((f) => f.category === "MISSING_CH99" && f.message.includes("9903.03.01")),
    );
    assert.ok(!a.findings.some((f) => f.category === "EXTRA_CH99"));
    assert.ok(!a.findings.some((f) => f.category === "NEEDS_INPUTS"));
    assert.deepEqual(seq(a.lines[1]).sort(), ["9903.03.06", "9903.82.09", "9903.88.15"].sort());
  });

  it("missing Sec 122 on Sec 122-era non-metals entry → MISSING_CH99", () => {
    const a = auditEntry({
      lines: [
        {
          line_id: "gap",
          hts: CN_NON_METAL,
          coo: "CN",
          entered_value: 10000,
          entry_date: "2026-06-01",
          filed_ch99: [],
        },
      ],
    });
    assert.ok(
      a.findings.some(
        (f) => f.category === "MISSING_CH99" && f.message.includes("9903.03.01"),
      ),
    );
  });

  it("filed 301-FL during Sec 122 era → WRONG_ERA warning", () => {
    const a = auditEntry({
      lines: [
        {
          line_id: "earlyfl",
          hts: CN_NON_METAL,
          coo: "BR",
          entered_value: 10000,
          entry_date: "2026-07-10",
          filed_ch99: ["9903.03.01", "9903.05.27"],
        },
      ],
    });
    assert.ok(
      a.findings.some(
        (f) => f.category === "WRONG_ERA" && f.message.includes("9903.05.27"),
      ),
    );
  });

  it("prefab 9406 filed stack is fully produced — zero EXTRA/MISSING", () => {
    const a = auditEntry({
      lines: [
        {
          line_id: "p:1",
          hts: CN_PREFAB_DERIV,
          coo: "CN",
          entered_value: 21560,
          entry_date: "2026-07-07",
          filed_ch99: ["9903.88.03", "9903.03.06", "9903.82.09"],
        },
      ],
    });
    assert.equal(
      a.findings.filter((f) => f.category === "EXTRA_CH99" || f.category === "MISSING_CH99")
        .length,
      0,
    );
  });
});

describe("boundary pair — same HTS assessed on last Sec 122 vs first FL day", () => {
  it("July 23 vs July 24 flips Sec 122 ↔ 301-FL for CN apparel", () => {
    const jul23 = assessLine(
      {
        hts: CN_NON_METAL,
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-07-23",
        flags: { s301_list_4a: true },
      },
      0,
    );
    const jul24 = assessLine(
      {
        hts: CN_NON_METAL,
        coo: "CN",
        entered_value: 10000,
        entry_date: "2026-07-24",
        flags: { s301_list_4a: true },
      },
      0,
    );
    assert.ok(has(jul23, "9903.03.01") && !hasFl(jul23));
    assert.ok(!has(jul24, "9903.03.01") && hasFl(jul24));
    assert.ok(has(jul23, "9903.88.15") && has(jul24, "9903.88.15"));
  });
});
