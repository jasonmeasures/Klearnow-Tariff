import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { s301flMeta } from "../../tariff-rules/src/s301fl.ts";
import {
  INTERACTION_RULES,
  listCh99,
  PACK_META,
  PROGRAMS,
} from "../../tariff-rules/src/tariffRules.ts";
import { htsTableMeta } from "./htsLookup.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "../../tariff-rules/data");

function ch99PackMeta() {
  try {
    const p = JSON.parse(
      readFileSync(join(DATA, "ch99_rules.json"), "utf8"),
    ) as { version: string; as_of: string; rules: unknown[] };
    return {
      version: p.version,
      as_of: p.as_of,
      rule_count: Array.isArray(p.rules) ? p.rules.length : 0,
    };
  } catch {
    return { version: "0", as_of: "", rule_count: 0 };
  }
}

function fileHash(): string {
  const files = [
    "ch99_codes.json",
    "program_status.json",
    "interaction_rules.json",
    "hts_rates.json",
    "s301fl_pack.json",
    "s301fl_pharma_hts.json",
    "s232_pharma.json",
    "s232_auto_parts_annex.json",
    "s232_autos_vehicles.json",
    "s232_mhdv.json",
    "s232_wood.json",
    "s232_semiconductors.json",
    "ch99_rules.json",
    "s301_china_lists.json",
  ];
  const parts = files
    .filter((f) => existsSync(join(DATA, f)))
    .map((f) => readFileSync(join(DATA, f), "utf8"));
  return "sha256:" + createHash("sha256").update(parts.join("\n")).digest("hex");
}

const hash = fileHash();
const codes = listCh99();
const programs = PROGRAMS as Array<Record<string, unknown>>;
const interactions = INTERACTION_RULES as Array<Record<string, unknown>>;
const htsMeta = htsTableMeta();
const flMeta = s301flMeta();
const ixMeta = ch99PackMeta();

export const STATE = {
  jurisdiction: "US",
  pack: {
    version: PACK_META.version,
    as_of: PACK_META.as_of,
    content_hash: hash,
    rules:
      codes.length + interactions.length + flMeta.economies + ixMeta.rule_count,
    codes,
    programs,
    interactions,
  },
  snapshot: {
    version: PACK_META.version,
    hash,
    rule_count:
      codes.length + interactions.length + flMeta.economies + ixMeta.rule_count,
    created_at: `${PACK_META.as_of}T00:00:00Z`,
    created_by: "tariff-rules seed",
    notes: "Immutable file-authored pack. Edit tariff-rules/data/ to change.",
    active: true,
  },
  reference_epoch: htsMeta.as_of || PACK_META.as_of,
  table_counts: {
    ch99_codes: codes.length,
    programs: programs.length,
    interaction_rules: interactions.length,
    hts_rate: htsMeta.row_count,
    s301fl_economies: flMeta.economies,
    ch99_rules: ixMeta.rule_count,
    program_scope: 0,
  },
  engines: {
    auto: "Auto-parts stacking + 301-FL by COO",
    ch99: `Ch99 reciprocal pack ${ixMeta.version} (${ixMeta.as_of})`,
  },
};

export function rulepackPublic() {
  return {
    version: STATE.pack.version,
    hash: STATE.pack.content_hash,
    rules: STATE.pack.rules,
    rulepack_version: STATE.pack.version,
    rulepack_hash: STATE.pack.content_hash,
  };
}

/** Recompute pack hash / counts after admin hot-reload (no process restart). */
export function refreshRulepackState() {
  const fl = s301flMeta();
  const ix = ch99PackMeta();
  const h = fileHash();
  const codes = listCh99();
  STATE.pack.content_hash = h;
  STATE.pack.rules =
    codes.length + STATE.pack.interactions.length + fl.economies + ix.rule_count;
  STATE.snapshot.hash = h;
  STATE.snapshot.rule_count = STATE.pack.rules;
  STATE.table_counts.s301fl_economies = fl.economies;
  STATE.table_counts.hts_rate = htsTableMeta().row_count;
  STATE.table_counts.ch99_rules = ix.rule_count;
  STATE.engines.ch99 = `Ch99 reciprocal pack ${ix.version} (${ix.as_of})`;
}
