/**
 * Print expect blocks for qa_goldens.json after a stack change.
 *   npx tsx src/qa.dump.ts
 *   npx tsx src/qa.dump.ts qc-de-pharma
 */
import { assessLine } from "./assess.ts";
import { lineForScenario, loadGoldens } from "./qa.catalog.ts";

const only = process.argv[2];
const { examples, scenarios } = loadGoldens();

for (const sc of scenarios) {
  if (only && sc.id !== only && sc.example !== only) continue;
  const L = assessLine(lineForScenario(sc, examples) as Parameters<typeof assessLine>[0], 0);
  const expect = {
    effective_duty_rate_pct: L.totals.effective_duty_rate_pct,
    duty: L.totals.duty,
    col1_rate_pct: L.col1_rate_pct,
    ch99_includes: L.ch99_sequence,
    codes: (L.diagnostics || []).map((d) => d.code),
    mpf_exempt: L.mpf_exempt,
  };
  console.log(`\n// ${sc.id} — ${sc.title || ""}`);
  console.log(JSON.stringify({ id: sc.id, expect }, null, 2));
}
