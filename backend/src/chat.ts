/**
 * Conversational HTS / rules Q&A via Anthropic Messages API + tools.
 * Answers from core tables (Column-1, Ch.99, 301-FL, stacking).
 * Pack writes (load a new rule) stay admin-only with write_rules / API key —
 * treated as a preview, not the default chat job.
 */
import { Router } from "express";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  getCh99,
  INTERACTION_RULES,
  listCh99,
  PROGRAMS,
} from "../../tariff-rules/src/tariffRules.ts";
import { match232AutoPartsAnnex } from "../../tariff-rules/src/s232Autos.ts";
import { previewS232Universe } from "../../tariff-rules/src/s232Resolve.ts";
import { previewS338, reloadS338Canada, s338Meta } from "../../tariff-rules/src/s338Canada.ts";
import {
  listS301flCountries,
  lookupS301fl,
  reloadS301fl,
  s301flDataPath,
  s301flMeta,
  type FlCountry,
} from "../../tariff-rules/src/s301fl.ts";
import { reloadS301ChinaNote31 } from "../../tariff-rules/src/s301ChinaNote31.ts";
import { assessEntry } from "./assess.ts";
import { LIMITS, assertMaxItems } from "./loadGuard.ts";
import { requireScope } from "./auth.ts";
import { listCsms } from "./csms.ts";
import { answerFromTables, TABLES_HELP } from "./chatLocal.ts";
import { coverOne, coverRows, parseCoverageInput } from "./coverage.ts";
import { htsTableMeta, lookupHts } from "./htsLookup.ts";
import { filingEra, filingEraLabel } from "./programEras.ts";
import { STACKING_CONTRACT } from "./rulesContract.ts";
import { materializeRules } from "./rules.ts";
import { refreshRulepackState, rulepackPublic } from "./state.ts";

export const chatRouter = Router();

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";

type ChatMsg = { role: "user" | "assistant"; content: string };

type PendingAction = {
  id: string;
  kind: "upsert_s301fl";
  summary: string;
  payload: Record<string, unknown>;
  created_at: string;
};

const pendingBySession = new Map<string, PendingAction[]>();

function anthropicKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || null;
}

const WRITE_TOOL_NAMES = new Set(["propose_s301fl_upsert", "reload_pack"]);

function tools(canWrite: boolean) {
  const read = [
    {
      name: "health",
      description: "Pack version, hash, engines, HTS table meta",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "lookup_hts",
      description:
        "Column-1 table lookup for an HTS on a date (window, replacement, 232 auto-parts annex)",
      input_schema: {
        type: "object",
        properties: {
          hts: { type: "string" },
          as_of: { type: "string", description: "YYYY-MM-DD" },
          coo: { type: "string", description: "ISO-2 origin for 232 heading preview" },
        },
        required: ["hts"],
      },
    },
    {
      name: "explain_hts",
      description:
        "Which live-pack rules apply to one HTS + origin + date (Column-1 + Chapter 99). Prefer this for 'what applies to …' questions.",
      input_schema: {
        type: "object",
        properties: {
          hts: { type: "string" },
          coo: { type: "string", description: "ISO2 country of origin" },
          as_of: { type: "string", description: "YYYY-MM-DD rate date" },
        },
        required: ["hts"],
      },
    },
    {
      name: "assess_entry",
      description: "Duty stack for lines with entered value (engine auto or ch99)",
      input_schema: {
        type: "object",
        properties: {
          engine: { type: "string", enum: ["auto", "ch99"] },
          lines: { type: "array", items: { type: "object" } },
        },
        required: ["lines"],
      },
    },
    {
      name: "hts_coverage",
      description: "Which rules apply to an HTS list (no entered value)",
      input_schema: {
        type: "object",
        properties: {
          text: { type: "string" },
          as_of: { type: "string" },
          default_coo: { type: "string" },
        },
      },
    },
    {
      name: "search_rules",
      description:
        "Search materialized pack rules (program, Ch.99 heading, COO, free text)",
      input_schema: {
        type: "object",
        properties: {
          q: { type: "string" },
          program: { type: "string" },
          ch99: { type: "string" },
          coo: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "lookup_ch99",
      description: "Look up a Chapter 99 code or list codes for a program",
      input_schema: {
        type: "object",
        properties: {
          code: { type: "string" },
          program: { type: "string" },
          q: { type: "string" },
        },
      },
    },
    {
      name: "lookup_program",
      description:
        "Program status, filing era for a date, and confirmed stacking rules from the core tables",
      input_schema: {
        type: "object",
        properties: {
          as_of: { type: "string" },
          q: { type: "string", description: "Filter program id or stacking rule text" },
        },
      },
    },
    {
      name: "lookup_s301fl",
      description: "301-FL pack: one economy by ISO2, or list live economies",
      input_schema: {
        type: "object",
        properties: { iso2: { type: "string" } },
      },
    },
    {
      name: "search_csms",
      description: "Recent CBP CSMS bulletins pulled from GovDelivery (not the full archive)",
      input_schema: {
        type: "object",
        properties: {
          q: { type: "string" },
          include_cams: { type: "boolean" },
          limit: { type: "number" },
        },
      },
    },
  ];
  if (!canWrite) return read;
  return [
    ...read,
    {
      name: "propose_s301fl_upsert",
      description:
        "ADMIN PREVIEW only — draft a 301-FL country upsert. Does NOT write until Apply. Do not use unless the user explicitly asks to load/update a pack rule.",
      input_schema: {
        type: "object",
        properties: {
          iso2: { type: "string" },
          name: { type: "string" },
          mechanic: { type: "string", enum: ["flat", "threshold"] },
          rate_pct: { type: "number" },
          heading: { type: "string" },
          cap_pct: { type: "number" },
          no_additional_duty_heading: { type: "string" },
          combined_to_cap_heading: { type: "string" },
          source_csms: { type: "string" },
          apply: {
            type: "boolean",
            description: "Only true when user explicitly confirmed the change",
          },
        },
        required: ["iso2", "mechanic"],
      },
    },
    {
      name: "reload_pack",
      description: "Admin — hot-reload 301-FL + HTS caches after file edits",
      input_schema: { type: "object", properties: {} },
    },
  ];
}

function upsertS301fl(body: Record<string, unknown>) {
  const iso2 = String(body.iso2 || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso2) && iso2 !== "EU") {
    throw new Error("iso2 must be a 2-letter code or EU");
  }
  const path = s301flDataPath();
  if (!existsSync(path)) throw new Error("s301fl_pack.json missing");
  const pack = JSON.parse(readFileSync(path, "utf8")) as {
    countries: FlCountry[];
    [k: string]: unknown;
  };

  let row: FlCountry;
  if (body.mechanic === "threshold") {
    row = {
      iso2,
      name: String(body.name || iso2),
      mechanic: "threshold",
      cap_pct: Number(body.cap_pct),
      no_additional_duty_heading: String(body.no_additional_duty_heading || ""),
      combined_to_cap_heading: String(body.combined_to_cap_heading || ""),
    };
    if (!Number.isFinite(row.cap_pct)) throw new Error("cap_pct required");
  } else {
    row = {
      iso2,
      name: String(body.name || iso2),
      mechanic: "flat",
      rate_pct: Number(body.rate_pct ?? body.rate),
      heading: String(body.heading || ""),
    };
    if (!Number.isFinite(row.rate_pct) || !row.heading) {
      throw new Error("flat needs rate_pct and heading");
    }
  }

  const idx = pack.countries.findIndex((c) => c.iso2.toUpperCase() === iso2);
  if (idx >= 0) pack.countries[idx] = row;
  else pack.countries.push(row);
  writeFileSync(path, JSON.stringify(pack, null, 2) + "\n", "utf8");
  reloadS301fl();
  reloadS301ChinaNote31();
  reloadS338Canada();
  refreshRulepackState();
  return { ok: true, upserted: row, economies: s301flMeta().economies, rulepack: rulepackPublic() };
}

async function runTool(
  name: string,
  input: Record<string, unknown>,
  sessionId: string,
  canWrite: boolean,
) {
  if (WRITE_TOOL_NAMES.has(name) && !canWrite) {
    return { error: "write_rules scope required — pack writes are an admin preview" };
  }
  switch (name) {
    case "health":
      return {
        rulepack: rulepackPublic(),
        s301fl: s301flMeta(),
        hts: htsTableMeta(),
      };
    case "lookup_hts": {
      const asOf = String(input.as_of || new Date().toISOString().slice(0, 10));
      const hts = String(input.hts || "");
      const coo = String(input.coo || "").trim().toUpperCase();
      const look = lookupHts(hts, asOf);
      const annex = match232AutoPartsAnnex(hts);
      const s232_universe = previewS232Universe(hts, coo, {
        rateDay: asOf,
        col1Rate: (Number(look.hit?.col1_pct) || 0) / 100,
      });
      return {
        ...look,
        table: htsTableMeta(),
        s232_auto_parts: annex
          ? {
              in_annex: true,
              matched_stem: annex.matched_stem,
              ch99: s232_universe.auto_parts?.ch99 || annex.ch99_duty,
            }
          : { in_annex: false },
        s232_universe,
        section_338: previewS338(hts),
      };
    }
    case "explain_hts": {
      const asOf = String(input.as_of || new Date().toISOString().slice(0, 10));
      const hts = String(input.hts || "");
      const coo = String(input.coo || "").trim().toUpperCase() || null;
      const row = coverOne(
        { hts, coo: coo || undefined, as_of: asOf },
        { as_of: asOf, default_coo: coo },
      );
      return { row, rulepack: rulepackPublic(), table: htsTableMeta() };
    }
    case "assess_entry": {
      const engine = String(input.engine || "auto");
      const lines = (input.lines as never[]) || [];
      assertMaxItems(lines.length, LIMITS.assessLines, "lines");
      if (engine === "ch99") {
        const { assessCh99Entry } = await import("./ch99Assess.ts");
        return assessCh99Entry({
          lines,
        });
      }
      return assessEntry({
        formal_entry: true,
        lines,
      });
    }
    case "hts_coverage": {
      const rows = parseCoverageInput({ text: String(input.text || "") });
      return coverRows({
        as_of: input.as_of as string | undefined,
        default_coo: input.default_coo as string | undefined,
        rows,
      });
    }
    case "lookup_s301fl": {
      const iso2 = String(input.iso2 || "").trim().toUpperCase();
      if (iso2) {
        const row = lookupS301fl(iso2);
        return { meta: s301flMeta(), iso2, hit: row };
      }
      return { meta: s301flMeta(), countries: listS301flCountries() };
    }
    case "search_rules": {
      let rules = materializeRules();
      const program = String(input.program || "").trim();
      const ch99 = String(input.ch99 || "").replace(/\D/g, "");
      const coo = String(input.coo || "").trim().toUpperCase();
      const q = String(input.q || "").trim().toLowerCase();
      if (program) rules = rules.filter((r) => r.program === program || r.program_raw === program);
      if (ch99) rules = rules.filter((r) => (r.ch99 || "").replace(/\D/g, "").includes(ch99));
      if (coo) {
        rules = rules.filter((r) => {
          const w = r.when as { coo_in?: string[] };
          return Array.isArray(w.coo_in) && w.coo_in.includes(coo);
        });
      }
      if (q) rules = rules.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
      const limit = Math.min(Number(input.limit) || 25, 80);
      return {
        count: rules.length,
        rules: rules.slice(0, limit).map((r) => ({
          id: r.id,
          program: r.program,
          action: r.action,
          ch99: r.ch99,
          label: r.label,
          rate: r.rate,
          notes: r.notes,
          source_ref: r.source_ref,
          status: r.status,
        })),
      };
    }
    case "lookup_ch99": {
      const code = String(input.code || "").trim();
      if (code) {
        const hit = getCh99(code);
        return hit ? { hit } : { error: `Unknown Ch.99 ${code}` };
      }
      const program = String(input.program || "").trim().toLowerCase();
      const q = String(input.q || "").trim().toLowerCase();
      let codes = listCh99();
      if (program) codes = codes.filter((c) => c.program.toLowerCase().includes(program));
      if (q) {
        codes = codes.filter(
          (c) =>
            c.code.toLowerCase().includes(q) ||
            c.notes.toLowerCase().includes(q) ||
            c.program.toLowerCase().includes(q),
        );
      }
      return { count: codes.length, codes: codes.slice(0, 40) };
    }
    case "lookup_program": {
      const asOf = String(input.as_of || new Date().toISOString().slice(0, 10));
      const q = String(input.q || "").trim().toLowerCase();
      const programs = q
        ? (PROGRAMS as Array<Record<string, unknown>>).filter((p) =>
            JSON.stringify(p).toLowerCase().includes(q),
          )
        : PROGRAMS;
      const stacking = q
        ? (INTERACTION_RULES as Array<Record<string, unknown>>).filter((r) =>
            JSON.stringify(r).toLowerCase().includes(q),
          )
        : INTERACTION_RULES;
      return {
        as_of: asOf,
        era: filingEra(asOf),
        era_label: filingEraLabel(filingEra(asOf)),
        programs,
        stacking,
        contract: STACKING_CONTRACT,
      };
    }
    case "search_csms": {
      try {
        return await listCsms({
          q: String(input.q || ""),
          include_cams: Boolean(input.include_cams),
          limit: Number(input.limit) || 12,
        });
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }
    case "propose_s301fl_upsert": {
      if (!canWrite) return { error: "write_rules scope required" };
      const apply = Boolean(input.apply);
      const summary =
        input.mechanic === "threshold"
          ? `301-FL ${input.iso2} threshold cap ${input.cap_pct}%` +
            (input.source_csms ? ` (${input.source_csms})` : "")
          : `301-FL ${input.iso2} flat ${input.rate_pct}% @ ${input.heading}` +
            (input.source_csms ? ` (${input.source_csms})` : "");
      if (apply) {
        return { applied: true, ...(upsertS301fl(input)), summary };
      }
      const id = `p_${Date.now().toString(36)}`;
      const action: PendingAction = {
        id,
        kind: "upsert_s301fl",
        summary,
        payload: input,
        created_at: new Date().toISOString(),
      };
      const list = pendingBySession.get(sessionId) || [];
      list.push(action);
      pendingBySession.set(sessionId, list);
      return {
        proposed: true,
        pending_id: id,
        summary,
        payload: input,
        note: "Awaiting user confirmation in the UI (Apply) — pack not changed yet.",
      };
    }
    case "reload_pack": {
      if (!canWrite) return { error: "write_rules scope required" };
      reloadS301fl();
      reloadS301ChinaNote31();
      reloadS338Canada();
      refreshRulepackState();
      return { ok: true, rulepack: rulepackPublic(), s301fl: s301flMeta(), s338: s338Meta() };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

const SYSTEM = `You are KlearNow Tariff — a US Chapter 99 / HTS assistant embedded in the product.

Primary job:
- Answer questions about an HTS or a live-pack rule using tools (core tables), not memory.
- Prefer explain_hts for "what applies to this code / origin / date".
- Use lookup_hts for Column-1 / replacements; search_rules / lookup_ch99 / lookup_s301fl / lookup_program for pack tables.
- Cite heading, program, rate, and source (CSMS # / note) from tool output.
- Explain stacking (301, 301-FL, 232), suppressions, and claim flags briefly.
- If a code is unknown or ended, say so and surface replacements / related statistical lines from the tool — never invent Column-1.

CSMS:
- search_csms is recent GovDelivery items only. Point users to the official CSMS page for the full archive.
- Do not treat a CSMS title as a pack change unless it is already in the tables.

Pack writes (future / admin):
- Loading a new rule into the pack is an admin preview (write_rules / API key). Do not offer it unless the user is an admin and explicitly asks to draft or load a pack update.
- NEVER set apply=true on propose_s301fl_upsert until the user clearly confirms.

Keep answers concise. Short bullets. Jurisdiction is US only.`;

chatRouter.get("/chat/status", requireScope("calculate"), (_req, res) => {
  const key = Boolean(anthropicKey());
  res.json({
    provider: key ? "anthropic+tables" : "tables",
    configured: true,
    tables: true,
    anthropic: key,
    model: key ? MODEL : "live-pack",
    hint: key
      ? "Live pack + Claude"
      : "Live pack tables — stacks and HTS lookups need no API key",
  });
});

chatRouter.get("/chat/pending", requireScope("write_rules"), (req, res) => {
  const sid = String(req.query.session_id || "default");
  res.json({ pending: pendingBySession.get(sid) || [] });
});

chatRouter.post("/chat/apply", requireScope("write_rules"), (req, res) => {
  try {
    const sid = String(req.body?.session_id || "default");
    const id = String(req.body?.pending_id || "");
    const list = pendingBySession.get(sid) || [];
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0) {
      res.status(404).json({ detail: "Pending action not found — ask chat to propose again." });
      return;
    }
    const action = list[idx];
    list.splice(idx, 1);
    pendingBySession.set(sid, list);
    if (action.kind === "upsert_s301fl") {
      const result = upsertS301fl(action.payload);
      res.json({ ok: true, applied: action, result });
      return;
    }
    res.status(400).json({ detail: `Unsupported action ${action.kind}` });
  } catch (e) {
    res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
  }
});

chatRouter.post("/chat/discard", requireScope("write_rules"), (req, res) => {
  const sid = String(req.body?.session_id || "default");
  const id = String(req.body?.pending_id || "");
  const list = pendingBySession.get(sid) || [];
  pendingBySession.set(
    sid,
    list.filter((p) => p.id !== id),
  );
  res.json({ ok: true });
});

chatRouter.post("/chat", requireScope("calculate"), async (req, res) => {
  const sessionId = String(req.body?.session_id || "default");
  const incoming = Array.isArray(req.body?.messages) ? (req.body.messages as ChatMsg[]) : [];
  if (!incoming.length) {
    res.status(400).json({ detail: "messages[] required" });
    return;
  }

  const lastUser = [...incoming].reverse().find((m) => m.role === "user");
  const canWrite = Boolean(req.principal?.can.write_rules);
  let pending: PendingAction[] = pendingBySession.get(sessionId) || [];

  if (lastUser?.content) {
    try {
      const local = await answerFromTables(String(lastUser.content));
      if (local) {
        res.json({
          ok: true,
          reply: local.reply,
          model: "live-pack",
          provider: "tables",
          session_id: sessionId,
          tool_trace: local.tool_trace,
          pending,
          can_write: canWrite,
        });
        return;
      }
    } catch (e) {
      res.status(500).json({ detail: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  const key = anthropicKey();
  if (!key) {
    res.json({
      ok: true,
      reply: TABLES_HELP,
      model: "live-pack",
      provider: "tables",
      session_id: sessionId,
      tool_trace: [],
      pending,
      can_write: canWrite,
    });
    return;
  }

  const apiMessages: Array<{ role: "user" | "assistant"; content: unknown }> = incoming.map(
    (m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    }),
  );

  const toolTrace: Array<{ name: string; input: unknown; output: unknown }> = [];

  try {
    for (let round = 0; round < 8; round++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          system:
            SYSTEM +
            (canWrite
              ? "\nThis user is admin (write_rules). Pack upserts are a preview — only draft when they explicitly ask to load/update a rule."
              : "\nThis user cannot write rules. Answer from tables only. Do not propose pack writes."),
          tools: tools(canWrite),
          messages: apiMessages,
        }),
      });

      const data = (await r.json()) as {
        content?: Array<{
          type: string;
          text?: string;
          id?: string;
          name?: string;
          input?: Record<string, unknown>;
        }>;
        stop_reason?: string;
        error?: { message?: string };
      };

      if (!r.ok) {
        res.status(502).json({
          detail: data.error?.message || `Anthropic HTTP ${r.status}`,
        });
        return;
      }

      const blocks = data.content || [];
      const toolUses = blocks.filter((b) => b.type === "tool_use");
      const texts = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");

      if (!toolUses.length) {
        pending = pendingBySession.get(sessionId) || [];
        res.json({
          ok: true,
          reply: texts || "(no reply)",
          model: MODEL,
          session_id: sessionId,
          tool_trace: toolTrace,
          pending,
          can_write: canWrite,
        });
        return;
      }

      apiMessages.push({ role: "assistant", content: blocks });

      const toolResults = [];
      for (const tu of toolUses) {
        const out = await runTool(tu.name || "", tu.input || {}, sessionId, canWrite);
        toolTrace.push({ name: tu.name || "", input: tu.input, output: out });
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(out).slice(0, 80000),
        });
      }
      apiMessages.push({ role: "user", content: toolResults });
      pending = pendingBySession.get(sessionId) || [];
    }

    res.json({
      ok: true,
      reply: "I hit the tool-round limit — ask me to continue.",
      model: MODEL,
      session_id: sessionId,
      tool_trace: toolTrace,
      pending,
      can_write: canWrite,
    });
  } catch (e) {
    res.status(500).json({ detail: e instanceof Error ? e.message : String(e) });
  }
});
