/**
 * Caps and concurrency for a single Node process serving Duty stack + bulk tools.
 *
 * Assess of a few lines is cheap; HTS coverage and ES-003 parse/audit are sync
 * CPU on the event loop. Gate those so 50–100 concurrent Duty-stack users stay
 * responsive. Override via env on Elastic Beanstalk.
 */
import type { Request, Response } from "express";

export function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const LIMITS = {
  assessLines: envInt("MAX_ASSESS_LINES", 500),
  coverageRows: envInt("MAX_COVERAGE_ROWS", 5000),
  /** Guest / anonymous ES-003 entry-line cap. */
  es003Lines: envInt("MAX_ES003_LINES", 8000),
  /** Signed-in (Auth0 / API key) ES-003 entry-line cap. */
  es003LinesSignedIn: envInt("MAX_ES003_LINES_SIGNED_IN", 25000),
  es003TariffRows: envInt("MAX_ES003_TARIFF_ROWS", 20000),
  /** ~2.5× lines — same ratio as guest defaults (20k / 8k). */
  es003TariffRowsSignedIn: envInt("MAX_ES003_TARIFF_ROWS_SIGNED_IN", 62500),
  xlsxDecodedBytes: envInt("MAX_XLSX_BYTES", 20 * 1024 * 1024),
  heavyJobs: envInt("MAX_HEAVY_JOBS", 2),
};

export type Es003Caps = {
  lines: number;
  tariffRows: number;
  signedIn: boolean;
};

/** Per-request ES-003 size caps — signed-in users get the higher ceiling. */
export function es003Caps(signedIn: boolean): Es003Caps {
  if (signedIn) {
    return {
      lines: LIMITS.es003LinesSignedIn,
      tariffRows: LIMITS.es003TariffRowsSignedIn,
      signedIn: true,
    };
  }
  return {
    lines: LIMITS.es003Lines,
    tariffRows: LIMITS.es003TariffRows,
    signedIn: false,
  };
}

export class LimitError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "LimitError";
    this.status = status;
  }
}

let inFlightHeavy = 0;

export function heavyInFlight(): number {
  return inFlightHeavy;
}

export function resetHeavyForTests(): void {
  inFlightHeavy = 0;
}

export function tryAcquireHeavy(): boolean {
  if (inFlightHeavy >= LIMITS.heavyJobs) return false;
  inFlightHeavy += 1;
  return true;
}

export function releaseHeavy(): void {
  inFlightHeavy = Math.max(0, inFlightHeavy - 1);
}

export async function runHeavy<T>(fn: () => T | Promise<T>): Promise<T> {
  if (!tryAcquireHeavy()) {
    throw new LimitError(
      "A coverage, ES-003, or HTS-import job is already running. Retry in a few seconds so Duty-stack traffic stays responsive.",
      503,
    );
  }
  try {
    return await fn();
  } finally {
    releaseHeavy();
  }
}

export function assertMaxItems(n: number, cap: number, label: string): void {
  if (n > cap) throw new LimitError(`Max ${cap} ${label} per request.`);
}

export function decodeXlsxBase64(b64: string): Buffer {
  const raw = String(b64 || "").replace(/^data:.*base64,/, "");
  if (!raw) throw new LimitError("Provide xlsx_base64 from an Excel / ACE export.");
  const approx = Math.floor((raw.length * 3) / 4);
  if (approx > LIMITS.xlsxDecodedBytes) {
    const mb = Math.round(LIMITS.xlsxDecodedBytes / 1024 / 1024);
    throw new LimitError(`Workbook too large (max ${mb} MB). Split the export and retry.`);
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length > LIMITS.xlsxDecodedBytes) {
    const mb = Math.round(LIMITS.xlsxDecodedBytes / 1024 / 1024);
    throw new LimitError(`Workbook too large (max ${mb} MB). Split the export and retry.`);
  }
  return buf;
}

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function publicLimits() {
  return {
    assess_lines: LIMITS.assessLines,
    coverage_rows: LIMITS.coverageRows,
    es003_lines: LIMITS.es003Lines,
    es003_tariff_rows: LIMITS.es003TariffRows,
    es003_lines_signed_in: LIMITS.es003LinesSignedIn,
    es003_tariff_rows_signed_in: LIMITS.es003TariffRowsSignedIn,
    xlsx_mb: Math.round(LIMITS.xlsxDecodedBytes / 1024 / 1024),
    heavy_jobs: LIMITS.heavyJobs,
    json_limit: process.env.JSON_LIMIT || "1mb",
    json_upload_limit: process.env.JSON_UPLOAD_LIMIT || "32mb",
  };
}

export function sendRouteError(res: Response, e: unknown): void {
  if (e instanceof LimitError) {
    if (e.status === 503) res.setHeader("Retry-After", "3");
    res.status(e.status).json({ detail: e.message, retry_after_seconds: e.status === 503 ? 3 : undefined });
    return;
  }
  res.status(400).json({ detail: e instanceof Error ? e.message : String(e) });
}

const HEAVY_JSON = new Set([
  "/v1/hts:coverage",
  "/v1/es003/ingest",
  "/v1/es003-ingest",
  "/v1/es003/audit",
  "/v1/es003-audit",
]);

export function wantsHeavyJson(req: Request): boolean {
  const p = req.path || "";
  return HEAVY_JSON.has(p) || p === "/v1/admin/hts:import";
}
