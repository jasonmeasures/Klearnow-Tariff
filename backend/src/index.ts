import cors from "cors";
import express from "express";
import { adminRouter } from "./admin.ts";
import { assessEntry, auditEntry } from "./assess.ts";
import { authMiddleware, requireScope } from "./auth.ts";
import { assessCh99Entry } from "./ch99Assess.ts";
import { coverRows, parseCoverageInput } from "./coverage.ts";
import { resolveCol1, htsTableMeta } from "./htsLookup.ts";
import { insightsRouter } from "./insights.ts";
import { referenceRouter } from "./reference.ts";
import { rulesRouter } from "./rules.ts";
import { rulepackPublic, STATE } from "./state.ts";

const app = express();
const PORT = Number(process.env.PORT || 8080);

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "klearnow-tariff", rulepack: rulepackPublic() });
});

app.use("/v1", authMiddleware);

app.get("/v1/health", (_req, res) => {
  res.json({
    ok: true,
    jurisdiction: STATE.jurisdiction,
    rulepack: rulepackPublic(),
    engines: STATE.engines,
  });
});

app.get("/v1/me", (req, res) => {
  const p = req.principal!;
  res.json({
    tenant_id: p.tenant_id,
    key_id: p.key_id,
    can: {
      calculate: p.can.calculate,
      read_rules: p.can.read_rules,
      write_rules: p.can.write_rules,
    },
  });
});

app.post("/v1/ch99/assess", requireScope("calculate"), (req, res) => {
  try {
    res.json(assessCh99Entry(req.body || {}));
  } catch (e) {
    res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/v1/entries:assess", requireScope("calculate"), (req, res) => {
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
});

/** @deprecated use /v1/entries:assess-ch99 */
app.post("/v1/entries:assess-inditex", requireScope("calculate"), (req, res) => {
  try {
    res.json(assessCh99Entry(req.body || {}));
  } catch (e) {
    res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/v1/entries:audit", requireScope("calculate"), (req, res) => {
  try {
    res.json(auditEntry(req.body || {}));
  } catch (e) {
    res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/v1/hts/:hts", requireScope("calculate"), (req, res) => {
  const asOf = String(req.query.as_of || new Date().toISOString().slice(0, 10));
  const hit = resolveCol1(String(req.params.hts), asOf);
  if (!hit) {
    res.status(404).json({ detail: `No column-1 rate for ${req.params.hts} on ${asOf}` });
    return;
  }
  res.json({ ...hit, as_of: asOf, table: htsTableMeta() });
});

/** Which rules apply to an HTS list — no entered value required. */
app.post("/v1/hts:coverage", requireScope("calculate"), (req, res) => {
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
        assume_cn_list3: body.assume_cn_list3 !== false,
        rows,
      }),
    );
  } catch (e) {
    res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
  }
});

app.use("/v1", rulesRouter);
app.use("/v1", insightsRouter);
app.use("/v1", referenceRouter);
app.use("/v1", adminRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ detail: err instanceof Error ? err.message : "Internal error" });
});

app.listen(PORT, () => {
  console.log(
    `KlearNow Tariff API on :${PORT} — pack ${STATE.pack.version} ${STATE.pack.content_hash.slice(0, 19)}…`,
  );
});
