import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDescPaths,
  joinDescPath,
} from "./import_hts_desc.ts";

describe("HTS description path import", () => {
  it("builds indent stacks including superior-only rows", () => {
    const rows = [
      { htsno: "0101", indent: "0", description: "Live horses, asses, mules and hinnies:" },
      { htsno: "", indent: "1", description: "Horses:", superior: "true" },
      { htsno: "0101.21.00", indent: "2", description: "Purebred breeding animals" },
      { htsno: "0101.21.00.10", indent: "3", description: "Males" },
      { htsno: "0101.21.00.20", indent: "3", description: "Females" },
      { htsno: "0101.29.00", indent: "2", description: "Other:" },
      { htsno: "0101.29.00.90", indent: "3", description: "Other" },
    ];
    const paths = buildDescPaths(rows);
    const males = paths.find((p) => p.hts === "0101210010");
    assert.ok(males);
    assert.deepEqual(males!.path, [
      "Live horses, asses, mules and hinnies:",
      "Horses:",
      "Purebred breeding animals",
      "Males",
    ]);
    const other = paths.find((p) => p.hts === "0101290090");
    assert.ok(other);
    assert.equal(other!.path[0], "Live horses, asses, mules and hinnies:");
    assert.equal(other!.path.at(-1), "Other");
    assert.ok(joinDescPath(males!.path).includes("Males"));
  });

  it("builds the 9401.20 motor-vehicle seat path", () => {
    const rows = [
      {
        htsno: "9401",
        indent: "0",
        description:
          "Seats (other than those of heading 9402), whether or not convertible into beds, and parts thereof:",
      },
      { htsno: "", indent: "1", description: "Seats of a kind used for aircraft:", superior: "true" },
      { htsno: "9401.10.40.00", indent: "2", description: "Leather upholstered" },
      {
        htsno: "9401.20.00.00",
        indent: "1",
        description: "Seats of a kind used for motor vehicles",
      },
    ];
    const paths = buildDescPaths(rows);
    const seat = paths.find((p) => p.hts === "9401200000");
    assert.ok(seat);
    assert.deepEqual(seat!.path, [
      "Seats (other than those of heading 9402), whether or not convertible into beds, and parts thereof:",
      "Seats of a kind used for motor vehicles",
    ]);
  });
});
