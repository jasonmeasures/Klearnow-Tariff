/**
 * Legacy China Section 301 list membership by 8-digit HTS.
 * Source: tariff-rules/data/s301_china_lists.json (List 2 seeded from USTR note 20(d)).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type ChinaListId = "list_1" | "list_2" | "list_3" | "list_4a";

export type ChinaListHit = {
  list: ChinaListId;
  ch99: string;
  rate_pct: number;
  hts8: string;
  source: string;
};

type Pack = {
  version: string;
  as_of: string;
  source: string;
  lists: Record<
    ChinaListId,
    { ch99: string; rate_pct: number; hts8: string[] }
  >;
};

const DATA = join(
  dirname(fileURLToPath(import.meta.url)),
  "../data/s301_china_lists.json",
);

let pack: Pack | null = null;
let byHts8: Map<string, ChinaListHit> | null = null;

function load(): Pack {
  if (pack) return pack;
  if (!existsSync(DATA)) {
    pack = {
      version: "0",
      as_of: "",
      source: "",
      lists: {
        list_1: { ch99: "9903.88.01", rate_pct: 25, hts8: [] },
        list_2: { ch99: "9903.88.02", rate_pct: 25, hts8: [] },
        list_3: { ch99: "9903.88.03", rate_pct: 25, hts8: [] },
        list_4a: { ch99: "9903.88.15", rate_pct: 7.5, hts8: [] },
      },
    };
    byHts8 = new Map();
    return pack;
  }
  pack = JSON.parse(readFileSync(DATA, "utf8")) as Pack;
  byHts8 = new Map();
  for (const list of Object.keys(pack.lists) as ChinaListId[]) {
    const row = pack.lists[list];
    for (const h of row.hts8 || []) {
      const key = String(h).replace(/\D/g, "").slice(0, 8);
      if (key.length < 8) continue;
      byHts8.set(key, {
        list,
        ch99: row.ch99,
        rate_pct: row.rate_pct,
        hts8: `${key.slice(0, 4)}.${key.slice(4, 6)}.${key.slice(6, 8)}`,
        source: pack.source,
      });
    }
  }
  return pack;
}

export function reloadS301ChinaLists() {
  pack = null;
  byHts8 = null;
  return load();
}

export function s301ChinaListsMeta() {
  const p = load();
  return {
    version: p.version,
    as_of: p.as_of,
    source: p.source,
    counts: Object.fromEntries(
      (Object.keys(p.lists) as ChinaListId[]).map((k) => [
        k,
        (p.lists[k].hts8 || []).length,
      ]),
    ),
  };
}

/** Normalize any HTS to 8-digit key used by USTR list notes. */
export function hts8Key(hts: string): string {
  const d = String(hts || "").replace(/\D/g, "");
  if (d.length < 8) return d.padEnd(8, "0").slice(0, 8);
  return d.slice(0, 8);
}

export function lookupChina301List(hts: string): ChinaListHit | null {
  load();
  const key = hts8Key(hts);
  if (!key || !byHts8) return null;
  return byHts8.get(key) || null;
}

export function chinaListIdFromFlags(
  flags: Record<string, boolean>,
): ChinaListId | null {
  if (flags.s301_list_1 || flags.s301_list1) return "list_1";
  if (flags.s301_list_2 || flags.s301_list2) return "list_2";
  if (flags.s301_list_3 || flags.s301_list3) return "list_3";
  if (flags.s301_list_4a || flags.s301_list4a) return "list_4a";
  return null;
}

export function ch99ForChinaList(list: ChinaListId): string {
  load();
  return pack!.lists[list].ch99;
}
