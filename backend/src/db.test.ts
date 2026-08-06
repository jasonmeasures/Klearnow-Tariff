import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDbEnabled } from "./db.ts";

describe("db optional", () => {
  it("is disabled when DATABASE_URL / PGHOST are unset", () => {
    assert.equal(isDbEnabled(), false);
  });
});
