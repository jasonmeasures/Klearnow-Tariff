#!/usr/bin/env npx tsx
/**
 * KlearNow Tariff MCP — stdio server for Claude Desktop / Cursor.
 * Talks to the running Tariff API (hot-reload rules, no app rebuild).
 *
 * Env:
 *   TARIFF_API_URL  default http://localhost:8080
 *   TARIFF_API_KEY  default dev-internal
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE = (process.env.TARIFF_API_URL || "http://localhost:8080").replace(/\/$/, "");
const KEY = process.env.TARIFF_API_KEY || "dev-internal";

async function api(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": KEY,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const detail =
      data && typeof data === "object" && data !== null && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : `${res.status} ${res.statusText}`;
    throw new Error(detail);
  }
  return data;
}

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new Server(
  { name: "klearnow-tariff", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "health",
      description: "Tariff API health, pack hash, and available engines",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "lookup_hts",
      description: "Baseline Column-1 / MFN rate for an HTS code (from imported HTS table)",
      inputSchema: {
        type: "object",
        properties: {
          hts: { type: "string", description: "HTS code, dotted or digits" },
          as_of: { type: "string", description: "YYYY-MM-DD rate date" },
        },
        required: ["hts"],
      },
    },
    {
      name: "assess_entry",
      description:
        "Run duty allocation. engine=auto (301/301-FL/232 stack) or ch99 (reciprocal pack)",
      inputSchema: {
        type: "object",
        properties: {
          engine: { type: "string", enum: ["auto", "ch99"], default: "auto" },
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                hts: { type: "string" },
                coo: { type: "string" },
                entered_value: { type: "number" },
                col1_rate_pct: { type: "number" },
                entry_date: { type: "string" },
                flags: { type: "object" },
              },
              required: ["hts", "coo", "entered_value"],
            },
          },
        },
        required: ["lines"],
      },
    },
    {
      name: "list_rules",
      description: "Browse materialized rules (filter by program, coo, ch99)",
      inputSchema: {
        type: "object",
        properties: {
          program: { type: "string" },
          coo: { type: "string" },
          ch99: { type: "string" },
          q: { type: "string" },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "list_s301fl",
      description: "List Section 301 Forced Labor economies in the live pack",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "upsert_s301fl_country",
      description:
        "Create or update a 301-FL economy row and hot-reload (no rebuild). Author key required.",
      inputSchema: {
        type: "object",
        properties: {
          iso2: { type: "string", description: "ISO2 or EU" },
          name: { type: "string" },
          mechanic: { type: "string", enum: ["flat", "threshold"] },
          rate_pct: { type: "number", description: "For flat — percent points e.g. 12.5" },
          heading: { type: "string", description: "For flat — Ch.99 heading" },
          cap_pct: { type: "number", description: "For threshold" },
          no_additional_duty_heading: { type: "string" },
          combined_to_cap_heading: { type: "string" },
        },
        required: ["iso2", "mechanic"],
      },
    },
    {
      name: "reload_pack",
      description: "Hot-reload 301-FL + HTS caches after external file edits",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "openapi",
      description: "Return OpenAPI document for integrating other tools with this API",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const a = (req.params.arguments || {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "health":
        return json(await api("/v1/health"));
      case "lookup_hts": {
        const hts = encodeURIComponent(String(a.hts || ""));
        const q = a.as_of ? `?as_of=${encodeURIComponent(String(a.as_of))}` : "";
        return json(await api(`/v1/hts/${hts}${q}`));
      }
      case "assess_entry":
        return json(
          await api("/v1/entries:assess", {
            method: "POST",
            body: JSON.stringify({
              engine: a.engine || "auto",
              formal_entry: true,
              lines: a.lines,
            }),
          }),
        );
      case "list_rules": {
        const p = new URLSearchParams();
        for (const k of ["program", "coo", "ch99", "q"] as const) {
          if (a[k]) p.set(k, String(a[k]));
        }
        p.set("limit", String(a.limit ?? 50));
        return json(await api(`/v1/rules?${p}`));
      }
      case "list_s301fl":
        return json(await api("/v1/admin/s301fl"));
      case "upsert_s301fl_country": {
        const iso = encodeURIComponent(String(a.iso2 || "").toUpperCase());
        return json(
          await api(`/v1/admin/s301fl/countries/${iso}`, {
            method: "PUT",
            body: JSON.stringify(a),
          }),
        );
      }
      case "reload_pack":
        return json(await api("/v1/admin/reload", { method: "POST", body: "{}" }));
      case "openapi":
        return json(await api("/v1/openapi.json"));
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
