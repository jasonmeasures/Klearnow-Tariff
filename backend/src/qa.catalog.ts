import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Flags = Record<string, boolean>;
export type Example = {
  id: string;
  name: string;
  meta: string;
  hts: string;
  coo: string;
  value: string;
  date: string;
  flags?: Flags;
};
export type CopyCheck = { where: string; includes: string[] };
export type Expect = {
  effective_duty_rate_pct?: number;
  duty?: number;
  col1_rate_pct?: number;
  ch99_includes?: string[];
  ch99_excludes?: string[];
  codes?: string[];
  mpf_exempt?: boolean;
  pharma_compare?: {
    additional_pct?: number;
    additional_duty?: number;
    cap_pct?: number;
  };
  copy?: CopyCheck[];
};
export type Scenario = {
  id: string;
  title?: string;
  example?: string;
  line?: Record<string, unknown>;
  expect: Expect;
};

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const GOLDENS_PATH = join(root, "tariff-rules/data/qa_goldens.json");
export const REPO_ROOT = root;

export function loadGoldens(): { examples: Example[]; scenarios: Scenario[] } {
  return JSON.parse(readFileSync(GOLDENS_PATH, "utf8"));
}

export function lineForScenario(
  sc: Scenario,
  examples: Example[],
): Record<string, unknown> {
  if (sc.example) {
    const ex = examples.find((e) => e.id === sc.example);
    if (!ex) throw new Error(`Unknown example '${sc.example}' on scenario ${sc.id}`);
    return {
      hts: ex.hts,
      coo: ex.coo,
      entered_value: Number(ex.value),
      entry_date: ex.date,
      flags: ex.flags || {},
    };
  }
  return sc.line || {};
}
