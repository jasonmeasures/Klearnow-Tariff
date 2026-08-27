/**
 * Data-driven regression: tariff-rules/data/qa_goldens.json
 *
 * After a product change (including UI):
 *   1. Add/adjust a scenario in qa_goldens.json
 *   2. npm run qa:dump -- <id>   (prints expect numbers)
 *   3. npm test
 *
 * Pack health + Quick Check examples must resolve Column-1 even when no
 * scenario numbers changed — catches stubbed/clobbered hts_rates.json.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessLine } from "./assess.ts";
import { htsTableMeta, resolveCol1 } from "./htsLookup.ts";
import { lineForScenario, loadGoldens } from "./qa.catalog.ts";

/** Floor for a real Column-1 table (stubs used in unit tests are << this). */
const MIN_HTS_ROWS = 20_000;

function textAt(line: ReturnType<typeof assessLine>, where: string): string {
  const i = where.indexOf(".");
  const kind = i < 0 ? where : where.slice(0, i);
  const key = i < 0 ? "" : where.slice(i + 1);
  if (kind === "diagnostics") {
    return (line.diagnostics || [])
      .filter((d) => d.code === key)
      .map((d) => d.message || "")
      .join("\n");
  }
  if (kind === "suppressed") {
    return (line.suppressed || [])
      .filter((s) => s.ch99 === key)
      .map((s) => s.reason || "")
      .join("\n");
  }
  throw new Error(`Unknown copy path '${where}'`);
}

describe("QA goldens", () => {
  const { examples, scenarios } = loadGoldens();

  it("live HTS pack is a full Column-1 table (not a unit-test stub)", () => {
    const meta = htsTableMeta();
    assert.ok(
      meta.row_count >= MIN_HTS_ROWS,
      `hts_rates.json has ${meta.row_count} rows (need ≥${MIN_HTS_ROWS}). ` +
        "A unit test likely wrote a stub into the live pack — restore from git and re-run.",
    );
    assert.ok(
      !/unit-test/i.test(String(meta.source || "")),
      `hts_rates.json source is "${meta.source}" — live pack was polluted by a test write.`,
    );
  });

  it("catalog has Quick Check examples and scenarios", () => {
    assert.ok(examples.length >= 3);
    assert.ok(scenarios.length >= 3);
    for (const ex of examples) {
      assert.ok(ex.id && ex.hts && ex.coo, `example ${ex.id} incomplete`);
    }
  });

  it("Quick Check examples resolve Column-1 on the live table", () => {
    const asOf = "2026-08-27";
    for (const ex of examples) {
      const hit = resolveCol1(ex.hts, asOf);
      assert.ok(
        hit,
        `example "${ex.id}" HTS ${ex.hts} missing from Column-1 table as of ${asOf}`,
      );
      assert.ok(
        typeof hit.col1_pct === "number" && Number.isFinite(hit.col1_pct),
        `example "${ex.id}" has no col1_pct`,
      );
    }
  });

  for (const sc of scenarios) {
    it(sc.title || sc.id, () => {
      const L = assessLine(lineForScenario(sc, examples) as Parameters<typeof assessLine>[0], 0);
      const exp = sc.expect;
      if (exp.effective_duty_rate_pct != null) {
        assert.equal(L.totals.effective_duty_rate_pct, exp.effective_duty_rate_pct);
      }
      if (exp.duty != null) {
        assert.equal(L.totals.duty, exp.duty);
      }
      if (exp.col1_rate_pct != null) {
        assert.equal(L.col1_rate_pct, exp.col1_rate_pct);
      }
      if (exp.mpf_exempt != null) {
        assert.equal(L.mpf_exempt, exp.mpf_exempt);
      }
      for (const c of exp.ch99_includes || []) {
        assert.ok(L.ch99_sequence.includes(c), `${sc.id}: missing ${c} in ${L.ch99_sequence.join(",")}`);
      }
      for (const c of exp.ch99_excludes || []) {
        assert.ok(!L.ch99_sequence.includes(c), `${sc.id}: unexpected ${c}`);
      }
      const codes = (L.diagnostics || []).map((d) => d.code);
      for (const code of exp.codes || []) {
        assert.ok(codes.includes(code), `${sc.id}: missing diagnostic ${code} (got ${codes.join(",")})`);
      }
      if (exp.pharma_compare) {
        const pc = L.pharma_compare as Record<string, unknown> | null;
        assert.ok(pc, `${sc.id}: expected pharma_compare`);
        if (exp.pharma_compare.additional_pct != null) {
          assert.equal(pc.additional_pct, exp.pharma_compare.additional_pct);
        }
        if (exp.pharma_compare.additional_duty != null) {
          assert.equal(pc.additional_duty, exp.pharma_compare.additional_duty);
        }
        if (exp.pharma_compare.cap_pct != null) {
          assert.equal(pc.cap_pct, exp.pharma_compare.cap_pct);
        }
      }
      for (const check of exp.copy || []) {
        const text = textAt(L, check.where);
        for (const needle of check.includes) {
          assert.ok(
            text.includes(needle),
            `${sc.id} ${check.where} missing “${needle}”\n---\n${text}\n---`,
          );
        }
      }
    });
  }
});
