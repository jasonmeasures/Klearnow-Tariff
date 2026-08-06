import cors from "cors";
import express from "express";
import { adminRouter } from "./admin.ts";
import { assessEntry, auditEntry } from "./assess.ts";
import { authMiddleware, publicAuthConfig, requireScope } from "./auth.ts";
import { initDb, isDbEnabled } from "./db.ts";
import { assessCh99Entry } from "./ch99Assess.ts";
import { chatRouter } from "./chat.ts";
import { coverRows, parseCoverageInput } from "./coverage.ts";
import { auditEs003, ingestEs003 } from "./es003.ts";
import { htsTableMeta, lookupHts } from "./htsLookup.ts";
import { match232AutoPartsAnnex } from "../../tariff-rules/src/s232Autos.ts";
import { insightsRouter } from "./insights.ts";
import { quotaStatus, requireQuota } from "./quota.ts";
import { referenceRouter } from "./reference.ts";
import { rulesRouter } from "./rules.ts";
import { rulepackPublic, STATE } from "./state.ts";
import { usersRouter } from "./users.ts";

const app = express();
const PORT = Number(process.env.PORT || 8080);
const FRAME_ANCESTORS = String(
  process.env.FRAME_ANCESTORS || "'self' https://*.klearnow.com https://klearnow.com",
);

app.use(
  cors({
    origin: true,
    credentials: true,
    exposedHeaders: ["X-Quota-Remaining"],
  }),
);
app.use(express.json({ limit: "64mb" }));

app.use((_req, res, next) => {
  // Allow WordPress (and other approved parents) to iframe the SPA / API docs pages.
  res.setHeader("Content-Security-Policy", `frame-ancestors ${FRAME_ANCESTORS}`);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "klearnow-tariff", rulepack: rulepackPublic() });
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
      res.json(assessCh99Entry(req.body || {}));
    } catch (e) {
      res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
    }
  },
);

app.post(
  "/v1/entries:assess",
  requireScope("calculate"),
  requireQuota("stack"),
  (req, res) => {
    try {
      const engine = String(req.query.engine || req.body?.engine || "auto");
      if (engine === "ch99" || engine === "inditex") {
        res.json(assessCh99Entry(req.body || {}));
        return;
      }
      res.json(assessEntry(req.body || {}));
    } catch (e) {
      res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
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
      res.json(assessCh99Entry(req.body || {}));
    } catch (e) {
      res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
    }
  },
);

app.post(
  "/v1/entries:audit",
  requireScope("calculate"),
  requireQuota("stack"),
  (req, res) => {
    try {
      res.json(auditEntry(req.body || {}));
    } catch (e) {
      res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
    }
  },
);

app.get("/v1/hts/:hts", requireScope("calculate"), (req, res) => {
  const asOf = String(req.query.as_of || new Date().toISOString().slice(0, 10));
  const raw = String(req.params.hts);
  const look = lookupHts(raw, asOf);
  const annex = match232AutoPartsAnnex(raw);
  const s232_auto_parts = annex
    ? { in_annex: true, matched_stem: annex.matched_stem, ch99: annex.ch99_duty, source: annex.source }
    : { in_annex: false, matched_stem: null, ch99: null, note: "Not on Proclamation 10908 / U.S. note 33 auto-parts list" };
  if (look.window_status === "unknown" && !look.replacement_hts) {
    res.status(404).json({
      detail: `No column-1 rate for ${raw} on ${asOf}`,
      hts: raw,
      as_of: asOf,
      window_status: look.window_status,
      s232_auto_parts,
    });
    return;
  }
  const hit = look.hit;
  res.json({
    ...(hit || { hts: look.hts_key, as_of: asOf }),
    as_of: asOf,
    table: htsTableMeta(),
    s232_auto_parts,
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
  (req, res) => {
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
      if (rows.length > 5000) {
        res.status(400).json({ detail: "Max 5000 HTS rows per request." });
        return;
      }
      res.json(
        coverRows({
          as_of: body.as_of,
          default_coo: body.default_coo,
          assume_cn_list3: body.assume_cn_list3 === true,
          rows,
        }),
      );
    } catch (e) {
      res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
    }
  },
);

app.post(
  ["/v1/es003/ingest", "/v1/es003-ingest"],
  requireScope("calculate"),
  requireQuota("extract"),
  (req, res) => {
    try {
      const body = req.body || {};
      if (!body.xlsx_base64) {
        res.status(400).json({ detail: "Provide xlsx_base64 from an ACE Reports ES-003 export." });
        return;
      }
      res.json(ingestEs003({ xlsx_base64: body.xlsx_base64, filename: body.filename }));
    } catch (e) {
      res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
    }
  },
);

app.post(
  ["/v1/es003/audit", "/v1/es003-audit"],
  requireScope("calculate"),
  requireQuota("extract"),
  (req, res) => {
    try {
      const body = req.body || {};
      if (!body.xlsx_base64 && !Array.isArray(body.lines)) {
        res.status(400).json({
          detail: "Provide xlsx_base64 from an ACE Reports ES-003 export.",
        });
        return;
      }
      res.json(
        auditEs003({
          xlsx_base64: body.xlsx_base64,
          filename: body.filename,
          knowledge_date: body.knowledge_date,
          lines: body.lines,
          meta: body.meta,
        }),
      );
    } catch (e) {
      res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
    }
  },
);

app.use("/v1", rulesRouter);
app.use("/v1", insightsRouter);
app.use("/v1", referenceRouter);
app.use("/v1", adminRouter);
app.use("/v1", usersRouter);
app.use("/v1", chatRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ detail: err instanceof Error ? err.message : "Internal error" });
});

async function main() {
  await initDb();
  app.listen(PORT, () => {
    const cfg = publicAuthConfig();
    console.log(
      `KlearNow Tariff API on :${PORT} — surface=${cfg.surface} guest=${cfg.allow_guest} auth0=${cfg.auth0} users_db=${cfg.users_db} pack ${STATE.pack.version}`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
