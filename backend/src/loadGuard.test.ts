import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIMITS,
  LimitError,
  decodeXlsxBase64,
  releaseHeavy,
  resetHeavyForTests,
  runHeavy,
  tryAcquireHeavy,
} from "./loadGuard.ts";

describe("loadGuard", () => {
  it("rejects oversized base64 before allocating the workbook", () => {
    const tooBig = "A".repeat(Math.floor((LIMITS.xlsxDecodedBytes * 4) / 3) + 16);
    assert.throws(() => decodeXlsxBase64(tooBig), LimitError);
  });

  it("tryAcquireHeavy respects the in-process cap", () => {
    resetHeavyForTests();
    let acquired = 0;
    while (tryAcquireHeavy()) acquired += 1;
    assert.equal(acquired, LIMITS.heavyJobs);
    assert.equal(tryAcquireHeavy(), false);
    releaseHeavy();
    assert.equal(tryAcquireHeavy(), true);
    resetHeavyForTests();
  });

  it("runHeavy returns 503 when every slot is taken", async () => {
    resetHeavyForTests();
    for (let i = 0; i < LIMITS.heavyJobs; i++) tryAcquireHeavy();
    await assert.rejects(runHeavy(() => 1), (e: unknown) => {
      assert.ok(e instanceof LimitError);
      assert.equal((e as LimitError).status, 503);
      return true;
    });
    resetHeavyForTests();
  });
});
