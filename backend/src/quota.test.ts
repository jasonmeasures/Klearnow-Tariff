/**
 * Quota + role gating tests.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { _resetQuotaStore, consumeQuota, quotaStatus } from "./quota.ts";

function principal(over = {}) {
  return {
    tenant_id: "t",
    key_id: "k",
    subject: over.subject || "u1",
    role: over.role || "guest",
    surface: "external",
    can: { calculate: true, read_rules: false, write_rules: false, admin: false },
    quota_tier: over.quota_tier || "anonymous",
    auth: "guest",
    ...over,
  };
}

describe("usage quotas", () => {
  beforeEach(() => _resetQuotaStore());

  it("anonymous: 5 stacks then 429-equivalent deny", () => {
    const p = principal({ subject: "anon-a" });
    for (let i = 0; i < 5; i++) {
      assert.equal(consumeQuota(p, "stack").ok, true);
    }
    const denied = consumeQuota(p, "stack");
    assert.equal(denied.ok, false);
    assert.match(denied.detail, /limit reached/i);
    const st = quotaStatus(p);
    assert.equal(st.stacks_used, 5);
    assert.equal(st.stacks_remaining, 0);
  });

  it("anonymous: 2 extracts then deny", () => {
    const p = principal({ subject: "anon-b" });
    assert.equal(consumeQuota(p, "extract").ok, true);
    assert.equal(consumeQuota(p, "extract").ok, true);
    assert.equal(consumeQuota(p, "extract").ok, false);
  });

  it("signed-in / authenticated is unlimited", () => {
    const p = principal({
      subject: "auth-user",
      quota_tier: "unlimited",
      role: "user",
    });
    for (let i = 0; i < 60; i++) assert.equal(consumeQuota(p, "stack").ok, true);
    assert.equal(quotaStatus(p).unlimited, true);
  });

  it("unlimited never meters", () => {
    const p = principal({
      subject: "admin",
      quota_tier: "unlimited",
      role: "admin",
    });
    for (let i = 0; i < 100; i++) assert.equal(consumeQuota(p, "stack").ok, true);
    assert.equal(quotaStatus(p).unlimited, true);
  });

  it("separate subjects have independent buckets", () => {
    const a = principal({ subject: "a" });
    const b = principal({ subject: "b" });
    for (let i = 0; i < 5; i++) assert.equal(consumeQuota(a, "stack").ok, true);
    assert.equal(consumeQuota(a, "stack").ok, false);
    assert.equal(consumeQuota(b, "stack").ok, true);
  });
});
