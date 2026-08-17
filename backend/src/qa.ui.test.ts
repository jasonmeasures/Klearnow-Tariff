/**
 * Frontend contract: Quick Check chips and PWA layout stay in sync with goldens.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadGoldens, REPO_ROOT } from "./qa.catalog.ts";

const html = readFileSync(join(REPO_ROOT, "frontend/index.html"), "utf8");
const css = readFileSync(join(REPO_ROOT, "frontend/styles.css"), "utf8");

describe("QA UI contract", () => {
  it("Quick Check example chips match qa_goldens.json", () => {
    const { examples } = loadGoldens();
    const bundled = JSON.parse(
      readFileSync(join(REPO_ROOT, "frontend/qc-examples.json"), "utf8"),
    );
    assert.deepEqual(
      bundled.examples,
      examples,
      "frontend/qc-examples.json must match tariff-rules/data/qa_goldens.json examples (Docker SPA build cannot see the parent tree)",
    );
    for (const ex of examples) {
      const re = new RegExp(`data-example="${ex.id}"`);
      assert.ok(re.test(html), `index.html missing data-example="${ex.id}"`);
      assert.ok(html.includes(ex.name), `index.html missing example name ${ex.name}`);
      const hts = ex.hts.replace(/(\d{4})(\d{2})(\d{4})/, "$1.$2.$3");
      assert.ok(
        html.includes(ex.hts) || html.includes(hts),
        `index.html missing HTS for ${ex.id}`,
      );
    }
  });

  it("stack result is above multi-line tools in the DOM (PWA / mobile order)", () => {
    const resultAt = html.indexOf('class="calc-result"');
    const toolsAt = html.indexOf('class="calc-tools"');
    assert.ok(resultAt > 0 && toolsAt > 0, "calc-result / calc-tools missing");
    assert.ok(resultAt < toolsAt, "calc-result must come before calc-tools so phones show the stack first");
  });

  it("narrow / PWA CSS stacks calc-body to one column", () => {
    assert.ok(css.includes(".cols.c2.calc-body"));
    assert.ok(/@media \(max-width:1180px\)[\s\S]*calc-body/.test(css));
  });

  it("Run the stack is the primary Quick Check action", () => {
    assert.ok(html.includes('id="qc-run"'));
    assert.match(html, /id="qc-run"[^>]*>Run the stack/);
    const runAt = html.indexOf('id="qc-run"');
    const examplesAt = html.indexOf("qc-examples");
    assert.ok(runAt < examplesAt, "Run the stack should sit above example chips");
  });

  it("MOT is a primary Quick Check field (not buried in metals)", () => {
    const modeAt = html.indexOf('id="qc-mode"');
    const metalAt = html.indexOf('id="qc-metal-wrap"');
    assert.ok(modeAt > 0, "qc-mode missing");
    assert.ok(metalAt > 0, "qc-metal-wrap missing");
    assert.ok(modeAt < metalAt, "MOT must sit with HTS / origin / value, not inside metals");
    assert.match(html, /HMF 0\.125% on ocean only/);
  });
});
