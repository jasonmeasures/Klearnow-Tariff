/**
 * Conversational rule authoring via Anthropic Messages API + tools.
 * Reads/assess freely; pack writes require apply=true (or /v1/chat/apply).
 */
import { Router } from "express";
import {
  listS301flCountries,
  reloadS301fl,
  s301flDataPath,
  s301flMeta,
  type FlCountry,
} from "../../tariff-rules/src/s301fl.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { assessEntry } from "./assess.ts";
import { requireScope } from "./auth.ts";
import { coverRows, parseCoverageInput } from "./coverage.ts";
import { htsTableMeta, resolveCol1 } from "./htsLookup.ts";
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

function tools() {
  return [
    {
      name: "health",
      description: "Pack version, hash, engines, HTS table meta",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "lookup_hts",
      description: "Baseline Column-1 rate for an HTS on a date",
      input_schema: {
        type: "object",
        properties: {
          hts: { type: "string" },
          as_of: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["hts"],
      },
    },
    {
      name: "assess_entry",
      description: "Duty stack for lines (engine auto or ch99)",
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
      name: "list_s301fl",
      description: "List live 301-FL economies in the pack",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "propose_s301fl_upsert",
      description:
        "Draft a 301-FL country upsert (flat or threshold) for review. Does NOT write until apply_pending is used or apply=true.",
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
      description: "Hot-reload 301-FL + HTS caches after file edits",
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
  refreshRulepackState();
  return { ok: true, upserted: row, economies: s301flMeta().economies, rulepack: rulepackPublic() };
}

async function runTool(
  name: string,
  input: Record<string, unknown>,
  sessionId: string,
  canWrite: boolean,
) {
  switch (name) {
    case "health":
      return {
        rulepack: rulepackPublic(),
        s301fl: s301flMeta(),
        hts: htsTableMeta(),
      };
    case "lookup_hts": {
      const asOf = String(input.as_of || new Date().toISOString().slice(0, 10));
      const hit = resolveCol1(String(input.hts), asOf);
      if (!hit) return { error: `No Column-1 for ${input.hts} on ${asOf}` };
      return { ...hit, as_of: asOf };
    }
    case "assess_entry": {
      const engine = String(input.engine || "auto");
      if (engine === "ch99") {
        const { assessCh99Entry } = await import("./ch99Assess.ts");
        return assessCh99Entry({
          lines: (input.lines as never[]) || [],
        });
      }
      return assessEntry({
        formal_entry: true,
        lines: (input.lines as never[]) || [],
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
    case "list_s301fl":
      return { meta: s301flMeta(), countries: listS301flCountries() };
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
      refreshRulepackState();
      return { ok: true, rulepack: rulepackPublic(), s301fl: s301flMeta() };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

const SYSTEM = `You are KlearNow Tariff — an expert US Chapter 99 / CSMS rule assistant embedded in the Tariff product.

Goals:
- Help brokers and authors understand which duties/rules apply.
- When a new CSMS, Federal Register notice, or tariff change takes effect, draft precise pack updates.
- Prefer tools over guessing. For 301-FL country changes use propose_s301fl_upsert.
- NEVER set apply=true on propose_s301fl_upsert until the user clearly confirms (e.g. "apply", "confirm", "ship it").
- Explain stacking (301, 301-FL, 232), suppressions, and claim flags briefly.
- If ANTHROPIC is configuring rates, cite the CSMS / heading / mechanic (flat vs threshold).
- Keep answers concise. Use short bullets for proposed changes.
- Jurisdiction is US only.`;

chatRouter.get("/chat/status", requireScope("calculate"), (_req, res) => {
  res.json({
    provider: "anthropic",
    configured: Boolean(anthropicKey()),
    model: MODEL,
    hint: anthropicKey()
      ? "Rule chat ready"
      : "Set ANTHROPIC_API_KEY in backend/.env and restart",
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
  const key = anthropicKey();
  if (!key) {
    res.status(503).json({
      detail:
        "ANTHROPIC_API_KEY is not set. Add it to backend/.env and restart the API to enable rule chat.",
    });
    return;
  }

  const sessionId = String(req.body?.session_id || "default");
  const incoming = Array.isArray(req.body?.messages) ? (req.body.messages as ChatMsg[]) : [];
  if (!incoming.length) {
    res.status(400).json({ detail: "messages[] required" });
    return;
  }

  const canWrite = Boolean(req.principal?.can.write_rules);
  const apiMessages: Array<{ role: "user" | "assistant"; content: unknown }> = incoming.map(
    (m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    }),
  );

  const toolTrace: Array<{ name: string; input: unknown; output: unknown }> = [];
  let pending: PendingAction[] = pendingBySession.get(sessionId) || [];

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
          system: SYSTEM + (canWrite ? "" : "\nUser cannot write rules — propose only, do not apply."),
          tools: tools(),
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
