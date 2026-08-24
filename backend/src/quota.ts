/**
 * External / authenticated usage quotas (Duty stacks + extracts).
 *
 * Defaults (overridable via env):
 *   anonymous:      5 stacks / day, 2 extracts / day
 *   authenticated: 50 stacks / day, 10 extracts / day
 *   unlimited:      no metering (admin / internal keys)
 *
 * In-memory daily buckets — not shared across Elastic Beanstalk instances.
 * Set QUOTA_USER_STACKS / QUOTA_USER_EXTRACTS in env when 50–100 daily users
 * share a playground (defaults are conservative). Swap for Redis/DB when multi-instance.
 */
import type { NextFunction, Request, Response } from "express";
import type { Principal } from "./auth.ts";

export type QuotaKind = "stack" | "extract";

type Bucket = {
  day: string;
  stacks: number;
  extracts: number;
};

const store = new Map<string, Bucket>();

const LIMITS = {
  anonymous: {
    stacks: Number(process.env.QUOTA_ANON_STACKS || 5),
    extracts: Number(process.env.QUOTA_ANON_EXTRACTS || 2),
  },
  authenticated: {
    stacks: Number(process.env.QUOTA_USER_STACKS || 50),
    extracts: Number(process.env.QUOTA_USER_EXTRACTS || 10),
  },
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function limitsFor(p: Principal) {
  if (p.quota_tier === "unlimited") return null;
  return LIMITS[p.quota_tier === "authenticated" ? "authenticated" : "anonymous"];
}

function bucketKey(p: Principal): string {
  return `${p.quota_tier}:${p.subject}`;
}

function getBucket(p: Principal): Bucket {
  const key = bucketKey(p);
  const day = today();
  let b = store.get(key);
  if (!b || b.day !== day) {
    b = { day, stacks: 0, extracts: 0 };
    store.set(key, b);
  }
  return b;
}

export function quotaStatus(p: Principal) {
  const limits = limitsFor(p);
  if (!limits) {
    return {
      tier: p.quota_tier,
      unlimited: true,
      stacks_used: 0,
      stacks_limit: null as number | null,
      extracts_used: 0,
      extracts_limit: null as number | null,
      day: today(),
    };
  }
  const b = getBucket(p);
  return {
    tier: p.quota_tier,
    unlimited: false,
    stacks_used: b.stacks,
    stacks_limit: limits.stacks,
    stacks_remaining: Math.max(0, limits.stacks - b.stacks),
    extracts_used: b.extracts,
    extracts_limit: limits.extracts,
    extracts_remaining: Math.max(0, limits.extracts - b.extracts),
    day: b.day,
  };
}

export function consumeQuota(
  p: Principal,
  kind: QuotaKind,
): { ok: true } | { ok: false; detail: string; status: ReturnType<typeof quotaStatus> } {
  const limits = limitsFor(p);
  if (!limits) return { ok: true };
  const b = getBucket(p);
  if (kind === "stack") {
    if (b.stacks >= limits.stacks) {
      return {
        ok: false,
        detail: `Daily duty-stack limit reached (${limits.stacks}). Sign in with Auth0 for a higher allowance, or try again tomorrow.`,
        status: quotaStatus(p),
      };
    }
    b.stacks += 1;
    return { ok: true };
  }
  if (b.extracts >= limits.extracts) {
    return {
      ok: false,
      detail: `Daily extract limit reached (${limits.extracts}). Sign in with Auth0 for a higher allowance, or try again tomorrow.`,
      status: quotaStatus(p),
    };
  }
  b.extracts += 1;
  return { ok: true };
}

/** Express middleware factory — call after authMiddleware. */
export function requireQuota(kind: QuotaKind) {
  return (req: Request, res: Response, next: NextFunction) => {
    const p = req.principal;
    if (!p) {
      res.status(401).json({ detail: "Not authenticated" });
      return;
    }
    const result = consumeQuota(p, kind);
    if (!result.ok) {
      res.status(429).json({
        detail: result.detail,
        quota: result.status,
        code: "QUOTA_EXCEEDED",
      });
      return;
    }
    next();
  };
}

/** Test helper */
export function _resetQuotaStore() {
  store.clear();
}
