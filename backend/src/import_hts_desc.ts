/**
 * Build hierarchical HTS description paths from a USITC schedule JSON export
 * (htsno + indent + description) → tariff-rules/data/hts_desc_path.json
 *
 * CLI:
 *   npx tsx src/import_hts_desc.ts [path-to-usitc.json]
 *   npx tsx src/import_hts_desc.ts --url
 *
 * Default URL: USITC public revision JSON (revision number may change).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
export const HTS_DESC_PATH = join(ROOT, "tariff-rules/data/hts_desc_path.json");

/** Published USITC schedule JSON — update when a newer revision is posted. */
export const DEFAULT_USITC_JSON_URL =
  "https://www.usitc.gov/sites/default/files/tata/hts/hts_2026_revision_10_json.json";

export type UsitcHtsRow = {
  htsno?: string | null;
  indent?: string | number | null;
  description?: string | null;
  superior?: string | boolean | null;
};

export type DescPathEntry = {
  /** 10-digit HTS key */
  hts: string;
  /** Indent stack from heading → leaf (chapter titles usually absent in USITC export). */
  path: string[];
};

export type DescPathPack = {
  version: string;
  as_of: string;
  source: string;
  row_count: number;
  paths: DescPathEntry[];
};

export function resolvedHtsDescPath(): string {
  return process.env.TARIFF_HTS_DESC_PATH || HTS_DESC_PATH;
}

function normalizeDigits(htsno: string): string {
  return String(htsno || "").replace(/\D/g, "");
}

/**
 * Walk USITC rows in order; maintain an indent stack (including superior-only
 * rows with empty htsno). Emit a path for every row with ≥8 digits.
 */
export function buildDescPaths(rows: UsitcHtsRow[]): DescPathEntry[] {
  const stack: { indent: number; desc: string }[] = [];
  const byHts = new Map<string, string[]>();

  for (const row of rows) {
    const indent = Number(row.indent ?? 0);
    const desc = String(row.description ?? "").trim();
    if (!Number.isFinite(indent)) continue;

    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (desc) stack.push({ indent, desc });

    const digits = normalizeDigits(row.htsno || "");
    if (digits.length < 8) continue;
    const key = digits.padEnd(10, "0").slice(0, 10);
    const path = stack.map((s) => s.desc);
    if (!path.length) continue;
    // Prefer the longest path if a code appears more than once.
    const prev = byHts.get(key);
    if (!prev || path.length >= prev.length) byHts.set(key, path);
  }

  return [...byHts.entries()]
    .map(([hts, path]) => ({ hts, path }))
    .sort((a, b) => a.hts.localeCompare(b.hts));
}

export function joinDescPath(path: string[]): string {
  return path
    .map((p) => p.replace(/\s+/g, " ").replace(/:\s*$/, "").trim())
    .filter(Boolean)
    .join(": ");
}

export function writeDescPathPack(opts: {
  paths: DescPathEntry[];
  source: string;
  as_of?: string;
  version?: string;
}): { path: string; row_count: number; bytes: number; hash: string; as_of: string } {
  const outPath = resolvedHtsDescPath();
  if (process.env.NODE_TEST_CONTEXT && outPath === HTS_DESC_PATH) {
    throw new Error(
      "Refusing to write live hts_desc_path.json during tests. Set TARIFF_HTS_DESC_PATH.",
    );
  }
  const as_of = (opts.as_of || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const payload: DescPathPack = {
    version: opts.version || "1.0.0",
    as_of,
    source: opts.source,
    row_count: opts.paths.length,
    paths: opts.paths,
  };
  const json = JSON.stringify(payload);
  writeFileSync(outPath, json);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 16);
  return {
    path: outPath,
    row_count: payload.row_count,
    bytes: json.length,
    hash,
    as_of,
  };
}

export function importDescPathsFromUsitcJson(
  raw: unknown,
  source: string,
  asOf?: string,
): ReturnType<typeof writeDescPathPack> {
  if (!Array.isArray(raw)) {
    throw new Error("USITC HTS JSON must be an array of { htsno, indent, description } rows");
  }
  const paths = buildDescPaths(raw as UsitcHtsRow[]);
  if (!paths.length) {
    throw new Error("No description paths built — check USITC JSON shape");
  }
  return writeDescPathPack({ paths, source, as_of: asOf });
}

async function main() {
  const arg = process.argv[2];
  let raw: unknown;
  let source: string;

  if (!arg || arg === "--url") {
    const url = process.argv[3] || DEFAULT_USITC_JSON_URL;
    console.log(`Fetching ${url}…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    raw = await res.json();
    source = url;
  } else {
    const src = resolve(arg);
    if (!existsSync(src)) {
      console.error(`File not found: ${src}`);
      process.exit(1);
    }
    console.log(`Reading ${src}…`);
    raw = JSON.parse(readFileSync(src, "utf8"));
    source = src.split(/[/\\]/).pop() || src;
  }

  const result = importDescPathsFromUsitcJson(raw, source);
  console.log(
    `Wrote ${result.row_count} paths → ${result.path} (${(result.bytes / 1e6).toFixed(1)} MB, hash ${result.hash})`,
  );
}

const isCli =
  process.argv[1] &&
  (process.argv[1].endsWith("import_hts_desc.ts") ||
    process.argv[1].endsWith("import_hts_desc.js"));
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
