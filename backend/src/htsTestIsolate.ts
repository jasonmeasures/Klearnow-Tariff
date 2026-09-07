/**
 * Isolate HTS pack writes during unit tests so the live tariff-rules pack
 * is never clobbered (NODE_TEST_CONTEXT + TARIFF_HTS_*_PATH).
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HTS_RATES_PATH, HTS_REPLACEMENTS_PATH } from "./import_hts.ts";
import { reloadHtsTable } from "./htsLookup.ts";

export type HtsTestIsolate = {
  ratesPath: string;
  replacementsPath: string;
  cleanup: () => void;
};

/** Copy live packs into a temp dir and point env + reload cache at them. */
export function isolateHtsPacks(opts?: { emptyRates?: boolean }): HtsTestIsolate {
  const dir = mkdtempSync(join(tmpdir(), "hts-test-"));
  const ratesPath = join(dir, "hts_rates.json");
  const replacementsPath = join(dir, "hts_replacements.json");

  if (opts?.emptyRates) {
    writeFileSync(
      ratesPath,
      JSON.stringify({
        version: "0",
        as_of: "2026-01-01",
        source: "unit-test-isolate",
        row_count: 0,
        with_specific: 0,
        rates: [],
      }),
    );
  } else if (existsSync(HTS_RATES_PATH)) {
    copyFileSync(HTS_RATES_PATH, ratesPath);
  } else {
    writeFileSync(
      ratesPath,
      JSON.stringify({
        version: "0",
        as_of: "2026-01-01",
        source: "unit-test-isolate",
        row_count: 0,
        with_specific: 0,
        rates: [],
      }),
    );
  }

  if (existsSync(HTS_REPLACEMENTS_PATH)) {
    copyFileSync(HTS_REPLACEMENTS_PATH, replacementsPath);
  } else {
    writeFileSync(
      replacementsPath,
      JSON.stringify({
        version: "0",
        as_of: "2026-01-01",
        source: "unit-test-isolate",
        row_count: 0,
        replacements: [],
      }),
    );
  }

  process.env.TARIFF_HTS_RATES_PATH = ratesPath;
  process.env.TARIFF_HTS_REPLACEMENTS_PATH = replacementsPath;
  reloadHtsTable();

  return {
    ratesPath,
    replacementsPath,
    cleanup: () => {
      delete process.env.TARIFF_HTS_RATES_PATH;
      delete process.env.TARIFF_HTS_REPLACEMENTS_PATH;
      reloadHtsTable();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}
