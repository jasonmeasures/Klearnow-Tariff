import { Router } from "express";
import {
  defaultCh99Rules,
  ENGINE_AS_OF,
} from "../../tariff-rules/src/ch99Engine.ts";
import {
  listS301flCountries,
  listS301flExemptions,
  s301flMeta,
} from "../../tariff-rules/src/s301fl.ts";
import { listCh99 } from "../../tariff-rules/src/tariffRules.ts";
import { requireScope } from "./auth.ts";
import { rulepackPublic, STATE } from "./state.ts";

export const rulesRouter = Router();

export function materializeRules() {
  const codes = listCh99().map((c) => ({
    id: `ch99.${c.code}`,
    program: uiProg(c.program),
    program_raw: c.program,
    action: c.kind === "DUTY" ? "DUTY" : c.kind === "SUPPRESSION" ? "SUPPRESSION" : "EXEMPTION",
    ch99: c.code,
    label: c.notes.split("—")[0]?.trim() || c.code,
    when: {} as Record<string, unknown>,
    rate: { kind: "AD_VALOREM", pct: c.rate * 100 },
    basis: "ENTERED_VALUE",
    stack_slot: slotFor(c.program, c.kind),
    effective_start: `${STATE.pack.as_of}T00:00:00Z`,
    effective_end: null as string | null,
    authority: c.program,
    source_ref: c.notes,
    confidence: c.status === "CONFIRMED" ? "VERIFIED" : "DRAFT",
    status: c.status === "CONFIRMED" ? "PUBLISHED" : "DRAFT",
    notes: c.notes,
    mfn_interaction: c.mfn_interaction,
    code_status: c.status,
  }));

  const flMeta = s301flMeta();
  const flCountries = listS301flCountries().map((c) => {
    const isFlat = c.mechanic === "flat";
    const ch99 = isFlat ? c.heading : c.combined_to_cap_heading;
    const pct = isFlat ? c.rate_pct : c.cap_pct;
    return {
      id: `s301fl.${c.iso2}`,
      program: "s301fl",
      program_raw: "SEC_301_FL",
      action: isFlat ? "DUTY" : "THRESHOLD",
      ch99,
      label: `301-FL ${c.name} (${c.iso2}) — ${c.mechanic}`,
      when: { coo_in: c.iso2 === "EU" ? ["EU", "...EU members"] : [c.iso2] },
      rate: isFlat
        ? { kind: "AD_VALOREM", pct }
        : {
            kind: "COMBINED_TO_CAP",
            cap_pct: c.cap_pct,
            no_additional_duty_heading: c.no_additional_duty_heading,
            combined_to_cap_heading: c.combined_to_cap_heading,
          },
      basis: "ENTERED_VALUE",
      stack_slot: "3.2",
      effective_start: String(flMeta.effective || `${STATE.pack.as_of}T00:00:00Z`),
      effective_end: null as string | null,
      authority: "Section 301 Forced Labor",
      source_ref: `CSMS #${flMeta.source_csms}`,
      confidence: "VERIFIED",
      status: "PUBLISHED",
      notes: isFlat
        ? `Flat ${c.rate_pct}% via ${c.heading}`
        : `Combined to ${c.cap_pct}% via ${c.combined_to_cap_heading} (no-add ${c.no_additional_duty_heading})`,
      mfn_interaction: "NORMAL",
      code_status: "CONFIRMED",
    };
  });

  const ex = listS301flExemptions();
  const flExemptions = [
    ...ex.general.map((e) => ({
      id: `s301fl.ex.${e.heading}`,
      program: "s301fl",
      program_raw: "SEC_301_FL",
      action: "EXEMPTION",
      ch99: String(e.heading),
      label: String(e.basis || e.heading),
      when: { applies_to: e.applies_to },
      rate: { kind: "NONE" },
      basis: "ENTERED_VALUE",
      stack_slot: "3.2",
      effective_start: String(flMeta.effective || `${STATE.pack.as_of}T00:00:00Z`),
      effective_end: null as string | null,
      authority: "US Note 52",
      source_ref: `CSMS #${flMeta.source_csms}`,
      confidence: "VERIFIED",
      status: "PUBLISHED",
      notes: String(e.rule || e.basis || ""),
      mfn_interaction: "NORMAL",
      code_status: "CONFIRMED",
    })),
    ...ex.economy_specific.map((e) => ({
      id: `s301fl.ex.${e.heading}`,
      program: "s301fl",
      program_raw: "SEC_301_FL",
      action: "EXEMPTION",
      ch99: e.heading,
      label: e.basis,
      when: { coo_in: e.origins },
      rate: { kind: "NONE" },
      basis: "ENTERED_VALUE",
      stack_slot: "3.2",
      effective_start: String(flMeta.effective || `${STATE.pack.as_of}T00:00:00Z`),
      effective_end: null as string | null,
      authority: "US Note 52",
      source_ref: `CSMS #${flMeta.source_csms}`,
      confidence: "VERIFIED",
      status: "PUBLISHED",
      notes: e.basis,
      mfn_interaction: "NORMAL",
      code_status: "CONFIRMED",
    })),
  ];

  const interactions = STATE.pack.interactions.map((r) => ({
    id: String(r.id),
    program: "stacking",
    action: "SUPPRESSION",
    ch99: null as string | null,
    label: String(r.rule).slice(0, 120),
    when: {} as Record<string, unknown>,
    rate: { kind: "NONE" },
    basis: "ENTERED_VALUE",
    stack_slot: "—",
    effective_start: `${STATE.pack.as_of}T00:00:00Z`,
    effective_end: null as string | null,
    authority: "interaction_rules",
    source_ref: String(r.id),
    confidence: r.status === "CONFIRMED" ? "VERIFIED" : "DRAFT",
    status: r.status === "CONFIRMED" ? "PUBLISHED" : "DRAFT",
    notes: String(r.rule),
    code_status: String(r.status),
  }));

  let ch99Rules: ReturnType<typeof materializeCh99Rules> = [];
  try {
    ch99Rules = materializeCh99Rules();
  } catch {
    ch99Rules = [];
  }

  return [...flCountries, ...flExemptions, ...ch99Rules, ...codes, ...interactions];
}

function materializeCh99Rules() {
  return defaultCh99Rules().map((r, i) => ({
    id: `ch99pack.${r.coo}.${r.ch99}.${i}`,
    program: "ch99",
    program_raw: "CH99_RECIPROCAL",
    action: "DUTY" as const,
    ch99: r.ch99,
    label: `${r.category} — ${r.coo}`,
    when: { coo_in: [r.coo] },
    rate: { kind: "AD_VALOREM", pct: r.rate },
    basis: r.basis || "ENTERED_VALUE",
    stack_slot: "3.1",
    effective_start:
      r.effective_from || r.effective || `${STATE.pack.as_of}T00:00:00Z`,
    effective_end: (r.effective_to || null) as string | null,
    authority: r.authority || "Ch99 reciprocal pack",
    source_ref: r.notes || "ch99_rules.json",
    confidence: "VERIFIED",
    status: "PUBLISHED",
    notes: r.notes || `as_of ${ENGINE_AS_OF}`,
    mfn_interaction: "NORMAL",
    code_status: "CONFIRMED",
  }));
}

function uiProg(p: string): string {
  if (p.includes("338")) return "s338";
  if (p.includes("301_FL")) return "s301fl";
  if (p.includes("301")) return "s301";
  if (p.includes("232") || p.includes("TRADE")) return "s232";
  if (p.includes("122")) return "s122";
  if (p.includes("IEEPA")) return "ieepa";
  return p.toLowerCase();
}

function slotFor(program: string, kind: string): string {
  if (program.includes("338")) return "2";
  if (program.includes("301_FL") || kind === "SUPPRESSION") return "3.2";
  if (program.includes("301")) return "3.1";
  if (program.includes("232") || program.includes("TRADE")) return "3.3";
  return "6.0";
}

rulesRouter.get("/rules", requireScope("read_rules"), (req, res) => {
  let rules = materializeRules();
  const q = req.query;
  if (q.program) rules = rules.filter((r) => r.program === String(q.program));
  if (q.action) rules = rules.filter((r) => r.action === String(q.action));
  if (q.status) rules = rules.filter((r) => r.status === String(q.status));
  if (q.coo) {
    const coo = String(q.coo).toUpperCase();
    rules = rules.filter((r) => {
      const w = r.when as { coo_in?: string[] };
      return Array.isArray(w.coo_in) && w.coo_in.includes(coo);
    });
  }
  if (q.ch99) {
    const needle = String(q.ch99).replace(/\D/g, "");
    rules = rules.filter((r) => (r.ch99 || "").replace(/\D/g, "").includes(needle));
  }
  if (q.q) {
    const needle = String(q.q).toLowerCase();
    rules = rules.filter((r) => JSON.stringify(r).toLowerCase().includes(needle));
  }
  const limit = Math.min(Number(q.limit) || 400, 1000);
  res.json({
    count: rules.length,
    rules: rules.slice(0, limit),
    rulepack: rulepackPublic(),
    s301fl: s301flMeta(),
  });
});

rulesRouter.get("/programs", requireScope("calculate"), (_req, res) => {
  const evaluation_order = [
    "s232",
    "s338",
    "s301",
    "s301fl",
    "ch99",
    "s122",
    "ieepa",
  ];
  const programs: Record<string, { label: string; status: string; authority: string; stack_slot: string }> = {
    s232: {
      label: "Section 232",
      status: "ACTIVE",
      authority: "Trade Expansion Act / Proclamation 10908",
      stack_slot: "3.3",
    },
    s338: {
      label: "Section 338 Canada",
      status: "ACTIVE",
      authority: "19 U.S.C. §1338 / CSMS #69606660",
      stack_slot: "2",
    },
    s301: {
      label: "Section 301 (incl. China legacy)",
      status: "ACTIVE",
      authority: "Trade Act of 1974",
      stack_slot: "3.1",
    },
    s301fl: {
      label: "Section 301 Forced Labor",
      status: "ACTIVE",
      authority: "CSMS #69326983",
      stack_slot: "3.2",
    },
    ch99: {
      label: "Ch99 reciprocal / IEEPA / Annex I",
      status: "ACTIVE",
      authority: "ch99_rules.json",
      stack_slot: "3.1",
    },
    s122: {
      label: "Section 122",
      status: "SUNSET",
      authority: "Sunset 2026-07-24",
      stack_slot: "3.2",
    },
    ieepa: {
      label: "IEEPA",
      status: "STRUCK_DOWN",
      authority: "SCOTUS 2026-02-20",
      stack_slot: "—",
    },
  };
  res.json({ evaluation_order, programs, engines: STATE.engines });
});

rulesRouter.post("/rules:validate", requireScope("read_rules"), (_req, res) => {
  const rules = materializeRules();
  const failures: Array<{ check: string; rule_id?: string; message: string }> = [];
  const warnings: Array<{ check: string; rule_id?: string; message: string }> = [];
  for (const r of rules) {
    if (r.code_status && r.code_status !== "CONFIRMED" && r.ch99) {
      warnings.push({
        check: "CODE_STATUS",
        rule_id: r.id,
        message: `${r.ch99} is ${r.code_status} — not cleared for silent duty math.`,
      });
    }
  }
  const blocking = STATE.pack.interactions.find(
    (r) => r.id === "R6_MFN_CAP_RULE" && r.status === "TBC_BLOCKING",
  );
  if (blocking) {
    warnings.push({
      check: "R6_MFN_CAP_RULE",
      message: "Trade-deal MFN cap mechanic unresolved — computeTradeDealTotal remains blocked.",
    });
  }
  res.json({
    result: failures.length ? "FAIL" : "PASS",
    failures,
    warnings,
    rule_count: rules.length,
    would_hash: STATE.pack.content_hash,
  });
});

rulesRouter.post("/rules:bulk", requireScope("write_rules"), (_req, res) => {
  res.status(403).json({
    detail:
      "Pack is file-authored. Edit tariff-rules/data/ and restart the server. Upload/publish lands in a later release.",
  });
});

rulesRouter.get("/snapshots", requireScope("read_rules"), (_req, res) => {
  res.json({ snapshots: [STATE.snapshot] });
});

rulesRouter.post("/snapshots", requireScope("write_rules"), (_req, res) => {
  res.status(403).json({
    detail:
      "Publishing is disabled in v1 — the active snapshot is the immutable tariff-rules pack on disk.",
  });
});

rulesRouter.post(
  /^\/snapshots\/(.+):activate\/?$/,
  requireScope("write_rules"),
  (_req, res) => {
    res.status(403).json({
      detail: "Only the seeded pack snapshot is active. Activate is a no-op in v1.",
    });
  },
);

rulesRouter.get("/snapshots:diff", requireScope("read_rules"), (req, res) => {
  const from = String(req.query.from_version || "");
  const to = String(req.query.to_version || "");
  res.json({
    summary: from === to
      ? "Same snapshot — no differences."
      : "Only one seeded snapshot exists in v1; diff is empty.",
    added: [],
    removed: [],
    changed: [],
  });
});
