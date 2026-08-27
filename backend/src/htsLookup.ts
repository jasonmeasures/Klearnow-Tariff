import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lookupChina301List } from "../../tariff-rules/src/s301China.ts";
import { lookupChina301Note31 } from "../../tariff-rules/src/s301ChinaNote31.ts";
import { classify232Metals } from "../../tariff-rules/src/s232Metals.ts";
import { resolvedHtsRatesPath, resolvedHtsReplacementsPath } from "./import_hts.ts";

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

export type HtsReplacement = {
  from: string;
  to: string;
  effective?: string;
  note?: string;
};

type Pack = {
  version: string;
  as_of: string;
  source: string;
  row_count: number;
  rates: HtsRate[];
};

type ReplacementPack = {
  version: string;
  as_of: string;
  source: string;
  row_count: number;
  replacements: HtsReplacement[];
};

/** Live pack path (tests redirect via TARIFF_HTS_REPLACEMENTS_PATH). */
export const HTS_REPLACEMENTS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../tariff-rules/data/hts_replacements.json",
);

let pack: Pack | null = null;
let byHts: Map<string, HtsRate[]> | null = null;
/** 8-digit legal-line index → 10-digit HTS keys (for sibling suggestions). */
let byStem8: Map<string, string[]> | null = null;
/** Sorted 10-digit keys for prefix typeahead. */
let sortedHtsKeys: string[] | null = null;
let replPack: ReplacementPack | null = null;
let byFrom: Map<string, HtsReplacement> | null = null;

function load(): Pack {
  if (pack) return pack;
  const ratesPath = resolvedHtsRatesPath();
  if (!existsSync(ratesPath)) {
    pack = { version: "0", as_of: "", source: "", row_count: 0, rates: [] };
    byHts = new Map();
    byStem8 = new Map();
    sortedHtsKeys = [];
    return pack;
  }
  pack = JSON.parse(readFileSync(ratesPath, "utf8")) as Pack;
  byHts = new Map();
  byStem8 = new Map();
  for (const r of pack.rates) {
    const list = byHts.get(r.hts) || [];
    list.push(r);
    byHts.set(r.hts, list);
  }
  for (const hts of byHts.keys()) {
    const stem = hts.slice(0, 8);
    const sibs = byStem8.get(stem) || [];
    sibs.push(hts);
    byStem8.set(stem, sibs);
  }
  sortedHtsKeys = [...byHts.keys()].sort();
  return pack;
}

function loadReplacements(): ReplacementPack {
  if (replPack) return replPack;
  const path = resolvedHtsReplacementsPath();
  if (!existsSync(path)) {
    replPack = { version: "0", as_of: "", source: "", row_count: 0, replacements: [] };
    byFrom = new Map();
    return replPack;
  }
  replPack = JSON.parse(readFileSync(path, "utf8")) as ReplacementPack;
  byFrom = new Map();
  for (const r of replPack.replacements || []) {
    const from = normalizeHtsDigits(r.from);
    const to = normalizeHtsDigits(r.to);
    if (!from || !to || from === to) continue;
    byFrom.set(from, { ...r, from, to });
  }
  return replPack;
}

/** Drop cache after re-import or external HTS table update. */
export function reloadHtsTable(): ReturnType<typeof htsTableMeta> {
  pack = null;
  byHts = null;
  byStem8 = null;
  sortedHtsKeys = null;
  replPack = null;
  byFrom = null;
  load();
  loadReplacements();
  return htsTableMeta();
}

/** Normalize dotted or undotted HTS to 10-digit key. */
export function normalizeHtsDigits(hts: string): string {
  const d = String(hts || "").replace(/\D/g, "");
  if (!d) return "";
  return d.padEnd(10, "0").slice(0, 10);
}

/** Display form XXXX.XX.XXXX */
export function formatHtsDisplay(hts: string): string {
  const ten = normalizeHtsDigits(hts);
  if (!ten) return String(hts || "");
  return `${ten.slice(0, 4)}.${ten.slice(4, 6)}.${ten.slice(6)}`;
}

export function htsTableMeta() {
  const p = load();
  const rp = loadReplacements();
  return {
    loaded: p.row_count > 0,
    version: p.version,
    as_of: p.as_of,
    source: p.source,
    row_count: p.row_count,
    replacements: rp.row_count,
    replacements_source: rp.source || null,
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
  china_301_fy: ReturnType<typeof lookupChina301Note31>["hit"];
  metals: ReturnType<typeof classify232Metals>;
  needs_metal_content: boolean;
  usitc_url: string;
};

export type WindowStatus = "active" | "ended" | "unknown";

export type HtsLookupResult = {
  hts: string;
  hts_key: string;
  hts_display: string;
  as_of: string;
  window_status: WindowStatus;
  /** Present when status is active (in-window) or ended (last known window). */
  hit: ResolvedCol1 | null;
  ended_on: string | null;
  replacement_hts: string | null;
  replacement_hts_display: string | null;
  replacement_note: string | null;
  replacement_effective: string | null;
  /** Col-1 resolution for the replacement on the same as-of date, when known. */
  replacement: ResolvedCol1 | null;
};

function enrich(pick: HtsRate, day: string): ResolvedCol1 {
  const needs_quantity = Boolean(pick.col1_specific_usd && pick.col1_specific_usd > 0);
  const metals = classify232Metals(pick.hts);
  return {
    ...pick,
    as_of: day,
    rate_label: formatCol1Rate(pick),
    needs_quantity,
    china_301: lookupChina301List(pick.hts),
    china_301_fy: lookupChina301Note31({ hts: pick.hts, date: day }).hit,
    metals,
    needs_metal_content: Boolean(metals),
    usitc_url: usitcSearchUrl(pick.hts),
  };
}

function sortWindowsNewestFirst(list: HtsRate[]): HtsRate[] {
  return list
    .slice()
    .sort((a, b) => b.start.localeCompare(a.start) || b.end.localeCompare(a.end));
}

/** Lookup a mapped successor for an ended / retired HTS. */
export function findReplacement(hts: string): HtsReplacement | null {
  loadReplacements();
  const key = normalizeHtsDigits(hts);
  if (!key || !byFrom) return null;
  return byFrom.get(key) || null;
}

export type RelatedHts = {
  hts: string;
  hts_display: string;
  desc: string | null;
  col1_pct: number;
  rate_label: string;
};

/**
 * Active statistical lines under the same 8-digit legal tariff line.
 * Used when a padded/invalid 10-digit code is not in the table (e.g. 1805.00.0000 → .0010 / .0090).
 */
export function suggestRelatedHts(hts: string, asOf: string, limit = 8): RelatedHts[] {
  load();
  const key = normalizeHtsDigits(hts);
  if (!key || !byHts || !byStem8) return [];
  const day = (asOf || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const stem8 = key.slice(0, 8);
  const candidates = byStem8.get(stem8) || [];
  const out: RelatedHts[] = [];
  for (const code of candidates) {
    if (code === key) continue;
    const list = byHts.get(code);
    if (!list?.length) continue;
    const inWindow = list.filter((r) => r.start <= day && day <= r.end);
    if (!inWindow.length) continue;
    const pick = sortWindowsNewestFirst(inWindow)[0];
    out.push({
      hts: code,
      hts_display: formatHtsDisplay(code),
      desc: pick.desc || null,
      col1_pct: pick.col1_pct,
      rate_label: formatCol1Rate(pick),
    });
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.hts.localeCompare(b.hts));
}

function firstKeyIndex(keys: string[], prefix: string): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Active 10-digit statistical lines whose HTS starts with the typed digits.
 * Used by Duty stack typeahead once the user has entered 4+ digits.
 */
export function suggestHtsPrefix(q: string, asOf: string, limit = 12): RelatedHts[] {
  load();
  const digits = String(q || "").replace(/\D/g, "");
  if (digits.length < 4 || !byHts || !sortedHtsKeys?.length) return [];
  const prefix = digits.slice(0, 10);
  const day = (asOf || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const cap = Math.min(40, Math.max(1, Number(limit) || 12));
  const out: RelatedHts[] = [];
  for (let i = firstKeyIndex(sortedHtsKeys, prefix); i < sortedHtsKeys.length; i++) {
    const code = sortedHtsKeys[i];
    if (!code.startsWith(prefix)) break;
    const list = byHts.get(code);
    if (!list?.length) continue;
    const inWindow = list.filter((r) => r.start <= day && day <= r.end);
    if (!inWindow.length) continue;
    const pick = sortWindowsNewestFirst(inWindow)[0];
    out.push({
      hts: code,
      hts_display: formatHtsDisplay(code),
      desc: pick.desc || null,
      col1_pct: pick.col1_pct,
      rate_label: formatCol1Rate(pick),
    });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Resolve column-1 rate(s) for an HTS on a rate-determination date (ISO yyyy-mm-dd).
 * Prefers an in-window row; if none match, falls back to the newest window (legacy behaviour
 * for assess). Prefer {@link lookupHts} when you need ended / replacement semantics.
 */
export function resolveCol1(hts: string, asOf: string): ResolvedCol1 | null {
  load();
  const key = normalizeHtsDigits(hts);
  if (!key || !byHts) return null;
  const list = byHts.get(key);
  if (!list?.length) return null;
  const day = (asOf || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const inWindow = list.filter((r) => r.start <= day && day <= r.end);
  const pick = sortWindowsNewestFirst(inWindow.length ? inWindow : list)[0];
  if (!pick) return null;
  return enrich(pick, day);
}

/**
 * Full HTS preview: active vs ended window + optional mapped replacement.
 */
export function lookupHts(hts: string, asOf: string): HtsLookupResult {
  load();
  loadReplacements();
  const key = normalizeHtsDigits(hts);
  const day = (asOf || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const repl = key ? findReplacement(key) : null;
  const replacementHit = repl ? resolveCol1(repl.to, day) : null;

  const base = {
    hts: String(hts || ""),
    hts_key: key,
    hts_display: key ? formatHtsDisplay(key) : String(hts || ""),
    as_of: day,
    replacement_hts: repl?.to || null,
    replacement_hts_display: repl?.to ? formatHtsDisplay(repl.to) : null,
    replacement_note: repl?.note || null,
    replacement_effective: repl?.effective || null,
    replacement: replacementHit,
  };

  if (!key || !byHts) {
    return { ...base, window_status: "unknown", hit: null, ended_on: null };
  }

  const list = byHts.get(key);
  if (!list?.length) {
    return { ...base, window_status: "unknown", hit: null, ended_on: null };
  }

  const inWindow = list.filter((r) => r.start <= day && day <= r.end);
  if (inWindow.length) {
    const pick = sortWindowsNewestFirst(inWindow)[0];
    return {
      ...base,
      window_status: "active",
      hit: enrich(pick, day),
      ended_on: null,
    };
  }

  const last = sortWindowsNewestFirst(list)[0];
  return {
    ...base,
    window_status: "ended",
    hit: last ? enrich(last, day) : null,
    ended_on: last?.end || null,
  };
}
