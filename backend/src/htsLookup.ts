import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lookupChina301List } from "../../tariff-rules/src/s301China.ts";
import { classify232Metals } from "../../tariff-rules/src/s232Metals.ts";

export type HtsRate = {
  hts: string;
  start: string;
  end: string;
  col1_pct: number;
  col1_specific_usd?: number;
  col1_specific_cents?: number;
  uom1?: string;
  uom2?: string;
  duty_code?: string;
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

export function formatCol1Rate(hit: HtsRate): string {
  const parts: string[] = [];
  if (hit.col1_pct > 0) parts.push(`${trimNum(hit.col1_pct)}% ad valorem`);
  if (hit.col1_specific_usd && hit.col1_specific_usd > 0) {
    const cents =
      hit.col1_specific_cents ??
      Math.round(hit.col1_specific_usd * 10000) / 100;
    const uom = hit.uom1 || "unit";
    parts.push(`${trimNum(cents)}¢/${uom}`);
  }
  if (!parts.length) parts.push("Free (0%)");
  return parts.join(" + ");
}

function trimNum(n: number): string {
  return String(Number(n.toFixed(4))).replace(/0+$/, "").replace(/\.$/, "");
}

export function usitcSearchUrl(hts: string): string {
  const q = String(hts || "").replace(/\D/g, "") || String(hts || "");
  return `https://hts.usitc.gov/search?query=${encodeURIComponent(q)}`;
}

export type ResolvedCol1 = HtsRate & {
  as_of: string;
  rate_label: string;
  needs_quantity: boolean;
  china_301: ReturnType<typeof lookupChina301List>;
  metals: ReturnType<typeof classify232Metals>;
  needs_metal_content: boolean;
  usitc_url: string;
};

/**
 * Resolve column-1 rate(s) for an HTS on a rate-determination date (ISO yyyy-mm-dd).
 */
export function resolveCol1(hts: string, asOf: string): ResolvedCol1 | null {
  load();
  const key = normalizeHtsDigits(hts);
  if (!key || !byHts) return null;
  const list = byHts.get(key);
  if (!list?.length) return null;
  const day = (asOf || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const inWindow = list.filter((r) => r.start <= day && day <= r.end);
  const pick = (inWindow.length ? inWindow : list)
    .slice()
    .sort((a, b) => b.start.localeCompare(a.start) || b.end.localeCompare(a.end))[0];
  if (!pick) return null;
  const needs_quantity = Boolean(pick.col1_specific_usd && pick.col1_specific_usd > 0);
  const metals = classify232Metals(key);
  return {
    ...pick,
    as_of: day,
    rate_label: formatCol1Rate(pick),
    needs_quantity,
    china_301: lookupChina301List(key),
    metals,
    needs_metal_content: Boolean(metals),
    usitc_url: usitcSearchUrl(key),
  };
}
