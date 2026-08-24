import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { adminRouter } from "./admin.ts";
import { assessEntry, auditEntry } from "./assess.ts";
import { authMiddleware, publicAuthConfig, requireScope } from "./auth.ts";
import { initDb, isDbEnabled } from "./db.ts";
import { assessCh99Entry } from "./ch99Assess.ts";
import { chatRouter } from "./chat.ts";
import { auditEs003Async, ingestEs003 } from "./es003.ts";
import { htsTableMeta, lookupHts, suggestHtsPrefix } from "./htsLookup.ts";
import { match232AutoPartsAnnex } from "../../tariff-rules/src/s232Autos.ts";
import { previewS232Universe } from "../../tariff-rules/src/s232Resolve.ts";
import { previewS338 } from "../../tariff-rules/src/s338Canada.ts";
import { coverRowsAsync, parseCoverageInput } from "./coverage.ts";
import { csmsRouter } from "./csms.ts";
import { insightsRouter } from "./insights.ts";
import {
  LIMITS,
  assertMaxItems,
  publicLimits,
  runHeavy,
  sendRouteError,
  wantsHeavyJson,
} from "./loadGuard.ts";
import { quotaStatus, requireQuota } from "./quota.ts";
import { referenceRouter } from "./reference.ts";
import { rulesRouter } from "./rules.ts";
import { rulepackPublic, STATE } from "./state.ts";
import { usersRouter } from "./users.ts";

const app = express();
app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 8080);
const FRAME_ANCESTORS = String(
  process.env.FRAME_ANCESTORS || "'self' https://*.klearnow.com https://klearnow.com",
);
const jsonSmall = express.json({ limit: process.env.JSON_LIMIT || "1mb" });
const jsonHeavy = express.json({ limit: process.env.JSON_UPLOAD_LIMIT || "32mb" });
const jsonHtsImport = express.json({ limit: process.env.JSON_HTS_IMPORT_LIMIT || "96mb" });

/**
 * Built SPA. Same origin as the API so the browser's `/v1/...` calls need no
 * CORS and the frame-ancestors CSP below covers the HTML too (WordPress embed).
 * Path resolves to <repo>/frontend/dist locally and /frontend/dist in Docker.
 * DO NOT REMOVE — playground / Elastic Beanstalk serve the UI from this process.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = process.env.STATIC_DIR || join(__dirname, "../../frontend/dist");
const SERVE_STATIC = existsSync(join(STATIC_DIR, "index.html"));

app.use(
  cors({
    origin: true,
    credentials: true,
    exposedHeaders: ["X-Quota-Remaining"],
  }),
);
app.use((req, res, next) => {
  if (req.path === "/v1/admin/hts:import") return jsonHtsImport(req, res, next);
  if (wantsHeavyJson(req)) return jsonHeavy(req, res, next);
  return jsonSmall(req, res, next);
});

app.use((_req, res, next) => {
  // Allow WordPress (and other approved parents) to iframe the SPA / API docs pages.
  res.setHeader("Content-Security-Policy", `frame-ancestors ${FRAME_ANCESTORS}`);
  next();
});

if (SERVE_STATIC) {
  app.use(
    express.static(STATIC_DIR, {
      index: false,
      maxAge: "1h",
      setHeaders(res, path) {
        // The service worker must never be served stale, or clients pin an old shell.
        if (path.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "klearnow-tariff",
    rulepack: rulepackPublic(),
    limits: publicLimits(),
  });
});

/** Public bootstrap — no auth (Auth0 domain, surface, guest policy). */
app.get("/v1/config", (_req, res) => {
  res.json({
    ...publicAuthConfig(),
    jurisdiction: STATE.jurisdiction,
    rulepack: rulepackPublic(),
    engines: STATE.engines,
    quotas: {
      anonymous: {
        stacks: Number(process.env.QUOTA_ANON_STACKS || 5),
        extracts: Number(process.env.QUOTA_ANON_EXTRACTS || 2),
      },
      authenticated: {
        stacks: Number(process.env.QUOTA_USER_STACKS || 50),
        extracts: Number(process.env.QUOTA_USER_EXTRACTS || 10),
      },
    },
    limits: publicLimits(),
  });
});

/** Liveness + pack meta — public (must not require a provisioned user). */
app.get("/v1/health", (_req, res) => {
  res.json({
    ok: true,
    jurisdiction: STATE.jurisdiction,
    rulepack: rulepackPublic(),
    engines: STATE.engines,
    auth: publicAuthConfig(),
    limits: publicLimits(),
  });
});

app.use("/v1", authMiddleware);
app.get("/v1/me", (req, res) => {
  const p = req.principal!;
  res.json({
    tenant_id: p.tenant_id,
    key_id: p.key_id,
    subject: p.subject,
    email: p.email || null,
    role: p.role,
    surface: p.surface,
    auth: p.auth,
    users_db: isDbEnabled(),
    can: {
      calculate: p.can.calculate,
      read_rules: p.can.read_rules,
      write_rules: p.can.write_rules,
      admin: p.can.admin,
    },
    quota: quotaStatus(p),
  });
});

app.get("/v1/quota", (req, res) => {
  res.json(quotaStatus(req.principal!));
});

app.post(
  "/v1/ch99/assess",
  requireScope("calculate"),
  requireQuota("stack"),
  (req, res) => {
    try {
      assertMaxItems((req.body?.lines || []).length, LIMITS.assessLines, "lines");
      res.json(assessCh99Entry(req.body || {}));
    } catch (e) {
      sendRouteError(res, e);
    }
  },
);

app.post(
  "/v1/entries:assess",
  requireScope("calculate"),
  requireQuota("stack"),
  (req, res) => {
    try {
      assertMaxItems((req.body?.lines || []).length, LIMITS.assessLines, "lines");
      const engine = String(req.query.engine || req.body?.engine || "auto");
      if (engine === "ch99" || engine === "inditex") {
        res.json(assessCh99Entry(req.body || {}));
        return;
      }
      res.json(assessEntry(req.body || {}));
    } catch (e) {
      sendRouteError(res, e);
    }
  },
);

/** @deprecated use /v1/entries:assess-ch99 */
app.post(
  "/v1/entries:assess-inditex",
  requireScope("calculate"),
  requireQuota("stack"),
  (req, res) => {
    try {
      assertMaxItems((req.body?.lines || []).length, LIMITS.assessLines, "lines");
      res.json(assessCh99Entry(req.body || {}));
    } catch (e) {
      sendRouteError(res, e);
    }
  },
);

app.post(
  "/v1/entries:audit",
  requireScope("calculate"),
  requireQuota("stack"),
  (req, res) => {
    try {
      assertMaxItems((req.body?.lines || []).length, LIMITS.assessLines, "lines");
      res.json(auditEntry(req.body || {}));
    } catch (e) {
      sendRouteError(res, e);
    }
  },
);

function lookupS232Extras(hts: string, asOf: string, coo: string, col1Pct: number | null | undefined) {
  const col1Rate = (Number(col1Pct) || 0) / 100;
  const s232_universe = previewS232Universe(hts, coo, { rateDay: asOf, col1Rate });
  const annex = match232AutoPartsAnnex(hts);
  const s232_auto_parts = annex
    ? {
        in_annex: true,
        matched_stem: annex.matched_stem,
        ch99: s232_universe.auto_parts?.ch99 || annex.ch99_duty,
        source: annex.source,
      }
    : {
        in_annex: false,
        matched_stem: null,
        ch99: null,
        note: "Not on Proclamation 10908 / U.S. note 33 auto-parts list",
      };
  return { s232_universe, s232_auto_parts };
}

app.get("/v1/hts:suggest", requireScope("calculate"), (req, res) => {
  const q = String(req.query.q || req.query.hts || "");
  const asOf = String(req.query.as_of || new Date().toISOString().slice(0, 10));
  const limit = Number(req.query.limit);
  res.json({
    as_of: asOf,
    q,
    hits: suggestHtsPrefix(q, asOf, Number.isFinite(limit) ? limit : 12),
  });
});

app.get("/v1/hts/:hts", requireScope("calculate"), (req, res) => {
  const asOf = String(req.query.as_of || new Date().toISOString().slice(0, 10));
  const coo = String(req.query.coo || "").trim().toUpperCase();
  const raw = String(req.params.hts);
  const look = lookupHts(raw, asOf);
  const { s232_universe, s232_auto_parts } = lookupS232Extras(raw, asOf, coo, look.hit?.col1_pct);
  const section_338 = previewS338(raw);
  if (look.window_status === "unknown" && !look.replacement_hts) {
    res.status(404).json({
      detail: `No column-1 rate for ${raw} on ${asOf}`,
      hts: raw,
      as_of: asOf,
      window_status: look.window_status,
      s232_auto_parts,
      s232_universe,
      section_338,
    });
    return;
  }
  const hit = look.hit;
  res.json({
    ...(hit || { hts: look.hts_key, as_of: asOf }),
    as_of: asOf,
    table: htsTableMeta(),
    s232_auto_parts,
    s232_universe,
    section_338,
    window_status: look.window_status,
    ended_on: look.ended_on,
    replacement_hts: look.replacement_hts,
    replacement_hts_display: look.replacement_hts_display,
    replacement_note: look.replacement_note,
    replacement_effective: look.replacement_effective,
    replacement: look.replacement,
  });
});

/** Which rules apply to an HTS list — counts as an extract. */
app.post(
  "/v1/hts:coverage",
  requireScope("calculate"),
  requireQuota("extract"),
  async (req, res) => {
    try {
      const body = req.body || {};
      let rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) {
        rows = parseCoverageInput(body);
      }
      if (!rows.length) {
        res.status(400).json({
          detail:
            "Provide rows[], or text (CSV/TSV/JSON), or xlsx_base64. Columns: hts (required), coo/origin (recommended).",
        });
        return;
      }
      const result = await runHeavy(() =>
        coverRowsAsync({
          as_of: body.as_of,
          default_coo: body.default_coo,
          assume_cn_list3: body.assume_cn_list3 === true,
          rows,
        }),
      );
      res.json(result);
    } catch (e) {
      sendRouteError(res, e);
    }
  },
);

app.post(
  ["/v1/es003/ingest", "/v1/es003-ingest"],
  requireScope("calculate"),
  requireQuota("extract"),
  async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.xlsx_base64) {
        res.status(400).json({ detail: "Provide xlsx_base64 from an ACE Reports ES-003 export." });
        return;
      }
      res.json(await runHeavy(() => ingestEs003({ xlsx_base64: body.xlsx_base64, filename: body.filename })));
    } catch (e) {
      sendRouteError(res, e);
    }
  },
);

app.post(
  ["/v1/es003/audit", "/v1/es003-audit"],
  requireScope("calculate"),
  requireQuota("extract"),
  async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.xlsx_base64 && !Array.isArray(body.lines)) {
        res.status(400).json({
          detail: "Provide xlsx_base64 from an ACE Reports ES-003 export.",
        });
        return;
      }
      res.json(
        await runHeavy(() =>
          auditEs003Async({
            xlsx_base64: body.xlsx_base64,
            filename: body.filename,
            knowledge_date: body.knowledge_date,
            lines: body.lines,
            meta: body.meta,
          }),
        ),
      );
    } catch (e) {
      sendRouteError(res, e);
    }
  },
);

app.use("/v1", rulesRouter);
app.use("/v1", insightsRouter);
app.use("/v1", referenceRouter);
app.use("/v1", adminRouter);
app.use("/v1", usersRouter);
app.use("/v1", chatRouter);
app.use("/v1", csmsRouter);

// SPA fallback — anything that is not an API path returns the app shell.
if (SERVE_STATIC) {
  app.use((req, res, next) => {
    const readOnly = req.method === "GET" || req.method === "HEAD";
    if (!readOnly || req.path.startsWith("/v1") || req.path === "/health") {
      next();
      return;
    }
    res.sendFile(join(STATIC_DIR, "index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status =
    (err as { status?: number }).status || (err as { statusCode?: number }).statusCode;
  if (status === 413) {
    res.status(413).json({ detail: "Request body too large for this endpoint." });
    return;
  }
  console.error(err);
  res.status(500).json({ detail: err instanceof Error ? err.message : "Internal error" });
});

async function main() {
  await initDb();
  const server = app.listen(PORT, () => {
    const cfg = publicAuthConfig();
    console.log(
      `KlearNow Tariff API on :${PORT} — surface=${cfg.surface} guest=${cfg.allow_guest} auth0=${cfg.auth0} users_db=${cfg.users_db} pack ${STATE.pack.version}`,
    );
  });
  // Stay above typical ALB idle timeout (60s) so keep-alive connections are closed by us first.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = envIntRequestTimeout();
}

function envIntRequestTimeout(): number {
  const n = Number(process.env.REQUEST_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 180_000;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
