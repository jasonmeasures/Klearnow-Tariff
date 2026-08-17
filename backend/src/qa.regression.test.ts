/**
 * Data-driven regression: tariff-rules/data/qa_goldens.json
 *
 * After a product change:
 *   1. Add/adjust a scenario in qa_goldens.json
 *   2. npm run qa:dump -- <id>   (prints expect numbers)
 *   3. npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessLine } from "./assess.ts";
import { lineForScenario, loadGoldens } from "./qa.catalog.ts";

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

  it("catalog has Quick Check examples and scenarios", () => {
    assert.ok(examples.length >= 3);
    assert.ok(scenarios.length >= 3);
    for (const ex of examples) {
      assert.ok(ex.id && ex.hts && ex.coo, `example ${ex.id} incomplete`);
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
