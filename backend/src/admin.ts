/**
 * Admin / MCP write path — mutate pack files and hot-reload caches (no rebuild).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Router } from "express";
import {
  listS301flCountries,
  reloadS301fl,
  s301flDataPath,
  s301flMeta,
  type FlCountry,
} from "../../tariff-rules/src/s301fl.ts";
import { reloadS301ChinaNote31 } from "../../tariff-rules/src/s301ChinaNote31.ts";
import { reloadS338Canada, s338Meta } from "../../tariff-rules/src/s338Canada.ts";
import { reloadS201Qsp, s201QspMeta } from "../../tariff-rules/src/s201Qsp.ts";
import { reloadS232Uas, s232UasMeta } from "../../tariff-rules/src/s232Uas.ts";
import { requireAdmin, requireScope } from "./auth.ts";
import { htsTableMeta, reloadHtsTable } from "./htsLookup.ts";
import { importHtsFromBuffer } from "./import_hts.ts";
import { LimitError, runHeavy } from "./loadGuard.ts";
import { refreshRulepackState, rulepackPublic } from "./state.ts";

export const adminRouter = Router();

adminRouter.post("/admin/reload", requireScope("write_rules"), requireAdmin, (_req, res) => {
  reloadS301fl();
  reloadS301ChinaNote31();
  reloadS338Canada();
  reloadS201Qsp();
  reloadS232Uas();
  reloadHtsTable();
  refreshRulepackState();
  res.json({
    ok: true,
    rulepack: rulepackPublic(),
    s301fl: s301flMeta(),
    s338: s338Meta(),
    s201: s201QspMeta(),
    s232_uas: s232UasMeta(),
    hts: htsTableMeta(),
    note: "Ch99 reciprocal engine constants are loaded at process start — restart backend after editing ch99_rules.json.",
  });
});

/** Full HTS classification workbook import (xlsx / xls) — replaces hts_rates.json. */
adminRouter.post("/admin/hts:import", requireScope("write_rules"), requireAdmin, async (req, res) => {
  try {
    const b64 = String(req.body?.xlsx_base64 || req.body?.file_base64 || "").replace(
      /^data:.*base64,/,
      "",
    );
    if (!b64) {
      res.status(400).json({
        detail: "xlsx_base64 required (classification workbook or HTS rate export).",
      });
      return;
    }
    const filename = String(req.body?.filename || "hts-upload.xlsx").slice(0, 200);
    const asOf = req.body?.as_of ? String(req.body.as_of).slice(0, 10) : undefined;
    const buf = Buffer.from(b64, "base64");
    if (buf.length < 64) {
      res.status(400).json({ detail: "File too small to be a workbook." });
      return;
    }
    if (buf.length > 80 * 1024 * 1024) {
      res.status(413).json({ detail: "Workbook exceeds 80 MB limit." });
      return;
    }
    const result = await runHeavy(() => importHtsFromBuffer(buf, filename, asOf));
    const hts = reloadHtsTable();
    refreshRulepackState();
    res.json({
      ok: true,
      ...result,
      hts,
      rulepack: rulepackPublic(),
      note: "Baseline Column-1 table replaced and reloaded in-process — no server restart needed.",
    });
  } catch (e) {
    if (e instanceof LimitError) {
      if (e.status === 503) res.setHeader("Retry-After", "3");
      res.status(e.status).json({ detail: e.message });
      return;
    }
    res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
  }
});

adminRouter.get("/admin/s301fl", requireScope("read_rules"), (_req, res) => {
  res.json({
    meta: s301flMeta(),
    countries: listS301flCountries(),
  });
});

adminRouter.put("/admin/s301fl/countries/:iso2", requireScope("write_rules"), requireAdmin, (req, res) => {
  try {
    const iso2 = String(req.params.iso2 || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso2) && iso2 !== "EU") {
      res.status(400).json({ detail: "iso2 must be a 2-letter code or EU" });
      return;
    }
    const body = req.body || {};
    const path = s301flDataPath();
    if (!existsSync(path)) {
      res.status(500).json({ detail: "s301fl_pack.json missing" });
      return;
    }
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
      if (!Number.isFinite(row.cap_pct)) {
        res.status(400).json({ detail: "cap_pct required for threshold mechanic" });
        return;
      }
    } else {
      row = {
        iso2,
        name: String(body.name || iso2),
        mechanic: "flat",
        rate_pct: Number(body.rate_pct ?? body.rate),
        heading: String(body.heading || ""),
      };
      if (!Number.isFinite(row.rate_pct) || !row.heading) {
        res.status(400).json({ detail: "flat mechanic needs rate_pct and heading" });
        return;
      }
    }

    const idx = pack.countries.findIndex((c) => c.iso2.toUpperCase() === iso2);
    if (idx >= 0) pack.countries[idx] = row;
    else pack.countries.push(row);

    writeFileSync(path, JSON.stringify(pack, null, 2) + "\n", "utf8");
    reloadS301fl();
    refreshRulepackState();
    res.json({
      ok: true,
      upserted: row,
      economies: s301flMeta().economies,
      rulepack: rulepackPublic(),
    });
  } catch (e) {
    res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
  }
});

adminRouter.delete("/admin/s301fl/countries/:iso2", requireScope("write_rules"), requireAdmin, (req, res) => {
  const iso2 = String(req.params.iso2 || "").trim().toUpperCase();
  const path = s301flDataPath();
  const pack = JSON.parse(readFileSync(path, "utf8")) as { countries: FlCountry[] };
  const before = pack.countries.length;
  pack.countries = pack.countries.filter((c) => c.iso2.toUpperCase() !== iso2);
  if (pack.countries.length === before) {
    res.status(404).json({ detail: `No 301-FL row for ${iso2}` });
    return;
  }
  writeFileSync(path, JSON.stringify(pack, null, 2) + "\n", "utf8");
  reloadS301fl();
  refreshRulepackState();
  res.json({ ok: true, removed: iso2, economies: s301flMeta().economies, rulepack: rulepackPublic() });
});

adminRouter.get("/openapi.json", (req, res) => {
  const base = `${reqProtocol(req)}://${req.get("host") || "localhost:8080"}`;
  res.json(openApiDoc(base));
});

function reqProtocol(req: { protocol?: string; get?: (h: string) => string | undefined }) {
  const xf = req.get?.("x-forwarded-proto");
  return xf || req.protocol || "http";
}

function openApiDoc(serverUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "KlearNow Tariff API",
      version: "1.1.0",
      description:
        "US Chapter 99 duty allocation, HTS column-1 baseline rates, and hot-reload rule admin. Auth: X-API-Key header.",
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        ApiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
    },
    security: [{ ApiKey: [] }],
    paths: {
      "/health": {
        get: { summary: "Liveness (no auth)", security: [], responses: { "200": { description: "OK" } } },
      },
      "/v1/health": {
        get: { summary: "Pack + engines", responses: { "200": { description: "OK" } } },
      },
      "/v1/entries:assess": {
        post: {
          summary: "Assess entry (engine=auto|ch99)",
          responses: { "200": { description: "Allocation" } },
        },
      },
      "/v1/entries:audit": {
        post: { summary: "Audit filed vs required", responses: { "200": { description: "Findings" } } },
      },
      "/v1/ch99/assess": {
        post: { summary: "Ch99 reciprocal engine", responses: { "200": { description: "Allocation" } } },
      },
      "/v1/reference/hts/{hts}": {
        get: {
          summary: "Baseline Column-1 rate for an HTS",
          parameters: [
            { name: "hts", in: "path", required: true, schema: { type: "string" } },
            { name: "as_of", in: "query", schema: { type: "string", format: "date" } },
          ],
          responses: { "200": { description: "Rate window" }, "404": { description: "Not found" } },
        },
      },
      "/v1/hts/{hts}": {
        get: {
          summary: "Alias — baseline HTS rate",
          parameters: [
            { name: "hts", in: "path", required: true, schema: { type: "string" } },
            { name: "as_of", in: "query", schema: { type: "string", format: "date" } },
            { name: "coo", in: "query", schema: { type: "string" }, description: "ISO-2 origin for 232 heading preview" },
          ],
          responses: { "200": { description: "Rate window" }, "404": { description: "Not found" } },
        },
      },
      "/v1/hts:suggest": {
        get: {
          summary: "Typeahead — active 10-digit HTS lines matching typed digits",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "as_of", in: "query", schema: { type: "string", format: "date" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: { "200": { description: "Matching statistical lines" } },
        },
      },
      "/v1/hts:coverage": {
        post: {
          summary: "Which rules apply to an HTS list (no entered value)",
          description:
            "Paste CSV/TSV/JSON text, send rows[], or xlsx_base64. Returns Column-1 + 301-FL / stack rules per code.",
          responses: { "200": { description: "Coverage rows" } },
        },
      },
      "/v1/es003/ingest": {
        post: {
          summary: "Stage A — parse ACE ES-003 only",
          description: "Returns row/entry counts and format. Does not run duty analysis.",
          responses: { "200": { description: "Ingest meta" } },
        },
      },
      "/v1/es003/audit": {
        post: {
          summary: "Stage B — audit ACE ES-003 by Entry Date",
          description:
            "Groups tariff ordinals per entry, returns CAPE-style entry reviews (status, observations, lines) plus live-stack findings.",
          responses: { "200": { description: "Entry reviews + findings" } },
        },
      },
      "/v1/rules": {
        get: { summary: "Browse materialized rules", responses: { "200": { description: "Rules" } } },
      },
      "/v1/programs": {
        get: { summary: "Programs + engines", responses: { "200": { description: "Programs" } } },
      },
      "/v1/chat": {
        post: {
          summary: "Ask about an HTS or live-pack rule (Anthropic + table tools)",
          responses: { "200": { description: "Reply + optional pending admin actions" } },
        },
      },
      "/v1/csms": {
        get: {
          summary: "Recent CBP CSMS bulletins (GovDelivery RSS)",
          responses: { "200": { description: "Messages" } },
        },
      },
      "/v1/chat/apply": {
        post: { summary: "Apply a pending pack write from chat", responses: { "200": { description: "Applied" } } },
      },
      "/v1/admin/reload": {
        post: { summary: "Hot-reload pack caches (no rebuild)", responses: { "200": { description: "Reloaded" } } },
      },
      "/v1/admin/hts:import": {
        post: {
          summary: "Replace baseline HTS Column-1 table from classification workbook (xlsx)",
          responses: { "200": { description: "Imported" }, "400": { description: "Bad workbook" } },
        },
      },
      "/v1/reference/hts": {
        post: {
          summary: "Merge CSV-style HTS rate rows into the baseline table (admin)",
          responses: { "200": { description: "Merged" } },
        },
      },
      "/v1/admin/s301fl/countries/{iso2}": {
        put: {
          summary: "Upsert 301-FL economy row (live, no rebuild)",
          responses: { "200": { description: "Upserted" } },
        },
        delete: { summary: "Remove 301-FL economy", responses: { "200": { description: "Removed" } } },
      },
    },
  };
}
