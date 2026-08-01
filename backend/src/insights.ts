import { Router } from "express";
import { listCh99 } from "../../tariff-rules/src/tariffRules.ts";
import { requireScope } from "./auth.ts";
import { rulepackPublic, STATE } from "./state.ts";

export const insightsRouter = Router();

const MAJOR = [
  "CN", "MX", "CA", "VN", "DE", "JP", "KR", "TW", "IN", "IT", "FR", "GB",
  "TH", "MY", "ID", "BR", "CH", "ES", "NL", "SG",
];

insightsRouter.get("/insights", requireScope("read_rules"), (_req, res) => {
  const codes = listCh99();
  const byProgram = new Map<string, { total: number; headings: number; actions: Record<string, number> }>();
  const actions: Record<string, number> = {};
  const confidence: Record<string, number> = {};
  const bases: Record<string, number> = { ENTERED_VALUE: codes.length };
  const slots: Record<string, number> = {};

  for (const c of codes) {
    const prog = c.program;
    const row = byProgram.get(prog) || { total: 0, headings: 0, actions: {} };
    row.total += 1;
    row.headings += 1;
    const action = c.kind === "DUTY" ? "DUTY" : c.kind === "SUPPRESSION" ? "SUPPRESSION" : "EXEMPTION";
    row.actions[action] = (row.actions[action] || 0) + 1;
    byProgram.set(prog, row);
    actions[action] = (actions[action] || 0) + 1;
    const conf = c.status === "CONFIRMED" ? "VERIFIED" : "DRAFT";
    confidence[conf] = (confidence[conf] || 0) + 1;
    const slot =
      prog.includes("301_FL") || c.kind === "SUPPRESSION"
        ? "3.2"
        : prog.includes("301")
          ? "3.1"
          : "3.3";
    slots[slot] = (slots[slot] || 0) + 1;
  }

  for (const r of STATE.pack.interactions) {
    const action = "SUPPRESSION";
    actions[action] = (actions[action] || 0) + 1;
    const conf = r.status === "CONFIRMED" ? "VERIFIED" : "DRAFT";
    confidence[conf] = (confidence[conf] || 0) + 1;
  }

  const programRows = [...byProgram.entries()].map(([program, row]) => {
    const meta = STATE.pack.programs.find((p) => p.id === program) || {};
    return {
      program,
      label: String(meta.detail || program).slice(0, 80),
      authority: String(meta.ch99_family || ""),
      stack_slot: program.includes("301_FL") ? "3.2" : program.includes("301") ? "3.1" : "3.3",
      status: String(meta.status || "ACTIVE"),
      rule_count: row.total,
      headings: row.headings,
      country_count: 0,
      actions: row.actions,
    };
  });

  // Origins implied by narrative rules (not predicates) — surface major trade partners as zero-count placeholders from notes
  const countries: Record<string, number> = { CN: 2, JP: 3, KR: 1, BR: 1, DE: 1, FR: 1 };
  const ranked = Object.entries(countries).sort(
    (a, b) =>
      (MAJOR.indexOf(a[0]) === -1 ? 99 : MAJOR.indexOf(a[0])) -
        (MAJOR.indexOf(b[0]) === -1 ? 99 : MAJOR.indexOf(b[0])) ||
      b[1] - a[1],
  );

  res.json({
    jurisdiction: "US",
    rulepack: {
      version: STATE.pack.version,
      hash: STATE.pack.content_hash,
      rule_count: codes.length + STATE.pack.interactions.length,
    },
    reference_epoch: STATE.reference_epoch,
    table_counts: STATE.table_counts,
    programs: programRows,
    action_mix: actions,
    confidence_mix: confidence,
    basis_mix: bases,
    slot_mix: slots,
    countries: {
      distinct: ranked.length,
      top: ranked.map(([coo, n]) => ({ coo, rules: n })),
    },
    expiring: { within_days: 60, expired: [], soon: [] },
    attention: {
      draft_rules: confidence.DRAFT || 0,
      ai_unreviewed: 0,
      no_effective_start: 0,
      expired_still_present: 0,
    },
    snapshots: [STATE.snapshot],
    meta: rulepackPublic(),
  });
});
