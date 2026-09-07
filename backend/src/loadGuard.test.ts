import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LIMITS,
  LimitError,
  decodeXlsxBase64,
  es003Caps,
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

  it("es003Caps raises the ceiling for signed-in users", () => {
    const guest = es003Caps(false);
    const signed = es003Caps(true);
    assert.equal(guest.lines, LIMITS.es003Lines);
    assert.equal(guest.tariffRows, LIMITS.es003TariffRows);
    assert.equal(guest.signedIn, false);
    assert.equal(signed.lines, LIMITS.es003LinesSignedIn);
    assert.equal(signed.tariffRows, LIMITS.es003TariffRowsSignedIn);
    assert.equal(signed.signedIn, true);
    assert.ok(signed.lines >= 25000);
    assert.ok(signed.lines > guest.lines);
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
