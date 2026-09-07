/**
 * Watch register is the gap detector: LIVE rows need engines; ACTIVE+compute
 * program_status rows must appear as LIVE on the watch list.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

type WatchRow = {
  id: string;
  status: string;
  engine_module: string | null;
  do_not_compute?: boolean;
};

type StatusRow = {
  id: string;
  status: string;
  compute: boolean;
};

describe("program watch", () => {
  const watch = JSON.parse(
    readFileSync(join(ROOT, "tariff-rules/data/program_watch.json"), "utf8"),
  ) as { programs: WatchRow[] };
  const status = JSON.parse(
    readFileSync(join(ROOT, "tariff-rules/data/program_status.json"), "utf8"),
  ) as { programs: StatusRow[] };

  it("every LIVE program has an engine module file", () => {
    const live = watch.programs.filter((p) => p.status === "LIVE");
    assert.ok(live.length >= 8, "expected the full live inventory, not just new packs");
    const missing = live.filter(
      (p) => !p.engine_module || !existsSync(join(ROOT, p.engine_module)),
    );
    assert.deepEqual(
      missing.map((p) => p.id),
      [],
      `LIVE without engine: ${missing.map((p) => p.id).join(", ")}`,
    );
  });

  it("every ACTIVE computing program_status row is LIVE on the watch list with an engine", () => {
    const computing = status.programs.filter(
      (p) => p.compute === true && p.status === "ACTIVE",
    );
    const watchById = new Map(watch.programs.map((p) => [p.id, p]));
    const gaps = computing.filter((p) => {
      const w = watchById.get(p.id);
      return !w || w.status !== "LIVE" || !w.engine_module;
    });
    assert.deepEqual(
      gaps.map((p) => p.id),
      [],
      `ACTIVE+compute missing from watch LIVE: ${gaps.map((p) => p.id).join(", ")}`,
    );
  });

  it("PENDING / SCHEDULED rows do not pretend to compute", () => {
    const bad = watch.programs.filter(
      (p) =>
        (p.status === "PENDING" || p.status === "SCHEDULED") &&
        p.engine_module != null,
    );
    assert.deepEqual(
      bad.map((p) => p.id),
      [],
      "PENDING/SCHEDULED must keep engine_module null until headings exist",
    );
  });

  it("expired solar 201 and washers are marked do_not_compute", () => {
    for (const id of ["SEC_201_SOLAR", "SEC_201_WASHERS"]) {
      const row = watch.programs.find((p) => p.id === id);
      assert.equal(row?.status, "EXPIRED");
      assert.equal(row?.do_not_compute, true);
    }
  });

  it("polysilicon is scheduled, not silently omitted", () => {
    const row = watch.programs.find((p) => p.id === "SEC_232_POLYSILICON");
    assert.equal(row?.status, "SCHEDULED");
    assert.equal(row?.engine_module, null);
  });

  it("every Ch.99 program family is on the watch list", () => {
    const ch99 = JSON.parse(
      readFileSync(join(ROOT, "tariff-rules/data/ch99_codes.json"), "utf8"),
    ) as { codes: Array<{ program: string }> };
    const alias: Record<string, string> = {
      TRADE_DEAL_EU: "TRADE_DEALS",
      TRADE_DEAL_JP: "TRADE_DEALS",
      TBC_LABELING: "TRADE_DEALS",
    };
    const watchIds = new Set(watch.programs.map((p) => p.id));
    const missing = [
      ...new Set(ch99.codes.map((c) => alias[c.program] ?? c.program)),
    ].filter((id) => !watchIds.has(id));
    assert.deepEqual(
      missing,
      [],
      `ch99 program(s) not on watch: ${missing.join(", ")}`,
    );
  });

  it("watch ids are unique", () => {
    const ids = watch.programs.map((p) => p.id);
    assert.equal(ids.length, new Set(ids).size);
  });
});
