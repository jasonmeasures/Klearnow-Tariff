import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerFromTables, parseChatIntent } from "./chatLocal.ts";

describe("chat local tables (no Anthropic)", () => {
  it("parses HTS + COO MX + USMCA + entered value", () => {
    const q =
      "tariff stack for - 3907.69.0050, COO MX, USMCA entered value - 47000";
    const i = parseChatIntent(q);
    assert.equal(i.hts, "3907.69.0050");
    assert.equal(i.coo, "MX");
    assert.equal(i.usmca, true);
    assert.equal(i.entered_value, 47000);
    assert.equal(i.wants_stack, true);
  });

  it("runs the MX USMCA plastics stack from live tables", async () => {
    const q =
      "tariff stack for - 3907.69.0050, COO MX, USMCA entered value - 47000";
    const out = await answerFromTables(q);
    assert.ok(out);
    assert.match(out.reply, /Duty stack/i);
    assert.match(out.reply, /USMCA/i);
    assert.match(out.reply, /9903\.05\.94/);
    assert.match(out.reply, /Free/i);
    assert.match(out.reply, /no LLM/i);
    const assess = out.tool_trace.find((t) => t.name === "assess_entry");
    assert.ok(assess);
    const line = (assess.output as { lines: Array<{ totals: { duty: number }; ch99_sequence: string[]; mpf_exempt: boolean }> }).lines[0];
    assert.equal(line.totals.duty, 0);
    assert.equal(line.mpf_exempt, true);
    assert.ok(line.ch99_sequence.includes("9903.05.94"));
  });
});
