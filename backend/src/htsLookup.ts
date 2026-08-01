import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type HtsRate = {
  hts: string;
  start: string;
  end: string;
  col1_pct: number;
  desc?: string;
};

type Pack = {
  version: string;
  as_of: string;
  source: string;
  row_count: number;
  rates: HtsRate[];
};

const DATA = join(dirname(fileURLToPath(import.meta.url)), "../../tariff-rules/data/hts_rates.json");

let pack: Pack | null = null;
let byHts: Map<string, HtsRate[]> | null = null;

function load(): Pack {
  if (pack) return pack;
  if (!existsSync(DATA)) {
    pack = { version: "0", as_of: "", source: "", row_count: 0, rates: [] };
    byHts = new Map();
    return pack;
  }
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  byHts = new Map();
  for (const r of pack.rates) {
    const list = byHts.get(r.hts) || [];
    list.push(r);
    byHts.set(r.hts, list);
  }
  return pack;
}

/** Drop cache after re-import or external HTS table update. */
export function reloadHtsTable(): ReturnType<typeof htsTableMeta> {
  pack = null;
  byHts = null;
  load();
  return htsTableMeta();
}

/** Normalize dotted or undotted HTS to 10-digit key. */
export function normalizeHtsDigits(hts: string): string {
  const d = String(hts || "").replace(/\D/g, "");
  if (!d) return "";
  return d.padEnd(10, "0").slice(0, 10);
}

export function htsTableMeta() {
  const p = load();
  return {
    loaded: p.row_count > 0,
    version: p.version,
    as_of: p.as_of,
    source: p.source,
    row_count: p.row_count,
  };
}

/**
 * Resolve column-1 ad valorem % for an HTS on a rate-determination date (ISO yyyy-mm-dd).
 * Prefers the window containing `asOf`, then the latest-starting open window.
 */
export function resolveCol1(
  hts: string,
  asOf: string,
): { col1_pct: number; hts: string; start: string; end: string; desc?: string } | null {
  load();
  const key = normalizeHtsDigits(hts);
  if (!key || !byHts) return null;
  const list = byHts.get(key);
  if (!list?.length) {
    // try 8-digit heading match (pad) already done; try shorter prefixes only if exact missing
    return null;
  }
  const day = (asOf || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const inWindow = list.filter((r) => r.start <= day && day <= r.end);
  const pick = (inWindow.length ? inWindow : list)
    .slice()
    .sort((a, b) => b.start.localeCompare(a.start) || b.end.localeCompare(a.end))[0];
  if (!pick) return null;
  return {
    col1_pct: pick.col1_pct,
    hts: pick.hts,
    start: pick.start,
    end: pick.end,
    desc: pick.desc,
  };
}
