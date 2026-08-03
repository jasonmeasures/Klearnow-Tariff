/**
 * Auth for KlearNow Tariff.
 *
 * Principals (priority):
 *  1. Bearer Auth0 JWT (when AUTH0_DOMAIN set)
 *  2. X-API-Key (dev / service keys)
 *  3. Guest (when ALLOW_GUEST=true) — Duty stack / extracts only, quota-gated
 *
 * Roles: guest | user | admin
 * Surfaces: local | playground | external | engine
 */
import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type Role = "guest" | "user" | "admin";
export type Surface = "local" | "playground" | "external" | "engine";

export type Scopes = {
  calculate: boolean;
  read_rules: boolean;
  write_rules: boolean;
  admin: boolean;
};

export type Principal = {
  tenant_id: string;
  key_id: string;
  subject: string;
  role: Role;
  surface: Surface;
  can: Scopes;
  /** Quota bucket — admins / unlimited keys skip metering. */
  quota_tier: "anonymous" | "authenticated" | "unlimited";
  auth: "api_key" | "auth0" | "guest";
};

declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

const SURFACE = (process.env.APP_SURFACE || "local") as Surface;
const ALLOW_GUEST =
  String(process.env.ALLOW_GUEST || "").toLowerCase() === "true" ||
  SURFACE === "external" ||
  SURFACE === "local";

const AUTH0_DOMAIN = String(process.env.AUTH0_DOMAIN || "").replace(/\/$/, "");
const AUTH0_AUDIENCE = String(process.env.AUTH0_AUDIENCE || "");
const AUTH0_ADMIN_CLAIM =
  process.env.AUTH0_ADMIN_CLAIM || "https://klearnow.com/roles";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!AUTH0_DOMAIN) return null;
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`),
    );
  }
  return jwks;
}

function scopesForRole(role: Role): Scopes {
  if (role === "admin") {
    return { calculate: true, read_rules: true, write_rules: true, admin: true };
  }
  if (role === "user") {
    return { calculate: true, read_rules: true, write_rules: false, admin: false };
  }
  return { calculate: true, read_rules: false, write_rules: false, admin: false };
}

const KEYS: Record<
  string,
  Omit<Principal, "surface" | "subject"> & { subject?: string }
> = {
  "dev-internal": {
    tenant_id: "klearnow",
    key_id: "dev-internal",
    role: "admin",
    can: scopesForRole("admin"),
    quota_tier: "unlimited",
    auth: "api_key",
  },
  "dev-calculate": {
    tenant_id: "customer",
    key_id: "dev-calculate",
    role: "user",
    can: scopesForRole("user"),
    quota_tier: "authenticated",
    auth: "api_key",
  },
  "dev-external": {
    tenant_id: "external",
    key_id: "dev-external",
    role: "guest",
    can: scopesForRole("guest"),
    quota_tier: "anonymous",
    auth: "api_key",
  },
};

function roleFromClaims(payload: Record<string, unknown>): Role {
  const claim = payload[AUTH0_ADMIN_CLAIM];
  const roles = Array.isArray(claim)
    ? claim.map(String)
    : typeof claim === "string"
      ? [claim]
      : [];
  const perms = Array.isArray(payload.permissions)
    ? payload.permissions.map(String)
    : [];
  const all = [...roles, ...perms].map((r) => r.toLowerCase());
  if (all.includes("admin") || all.includes("tariff:admin")) return "admin";
  return "user";
}

async function principalFromBearer(token: string): Promise<Principal | null> {
  const set = getJwks();
  if (!set || !AUTH0_DOMAIN) return null;
  try {
    const { payload } = await jwtVerify(token, set, {
      issuer: `https://${AUTH0_DOMAIN}/`,
      audience: AUTH0_AUDIENCE || undefined,
    });
    const role = roleFromClaims(payload as Record<string, unknown>);
    const sub = String(payload.sub || "auth0");
    return {
      tenant_id: "auth0",
      key_id: `auth0:${sub}`,
      subject: sub,
      role,
      surface: SURFACE,
      can: scopesForRole(role),
      quota_tier: role === "admin" ? "unlimited" : "authenticated",
      auth: "auth0",
    };
  } catch {
    return null;
  }
}

function guestPrincipal(clientId: string): Principal {
  return {
    tenant_id: "public",
    key_id: "guest",
    subject: clientId || "anonymous",
    role: "guest",
    surface: SURFACE,
    can: scopesForRole("guest"),
    quota_tier: "anonymous",
    auth: "guest",
  };
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  void (async () => {
    const authHeader = String(req.header("Authorization") || "");
    const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (bearer) {
      const p = await principalFromBearer(bearer);
      if (!p) {
        res.status(401).json({ detail: "Invalid or expired Auth0 token" });
        return;
      }
      req.principal = p;
      next();
      return;
    }

    const key = String(req.header("X-API-Key") || "").trim();
    if (key) {
      const mapped = KEYS[key];
      if (!mapped) {
        res.status(401).json({ detail: "Unknown API key" });
        return;
      }
      req.principal = {
        ...mapped,
        subject: mapped.subject || mapped.key_id,
        surface: SURFACE,
      };
      next();
      return;
    }

    // Local convenience: default internal key when not external
    if (SURFACE === "local" && !ALLOW_GUEST) {
      const mapped = KEYS["dev-internal"];
      req.principal = {
        ...mapped,
        subject: mapped.key_id,
        surface: SURFACE,
      };
      next();
      return;
    }

    if (ALLOW_GUEST) {
      const clientId = String(
        req.header("X-Client-Id") || req.ip || "anonymous",
      ).slice(0, 128);
      req.principal = guestPrincipal(clientId);
      next();
      return;
    }

    res.status(401).json({
      detail: "Authentication required (Auth0 Bearer or X-API-Key)",
    });
  })().catch((e) => {
    console.error(e);
    res.status(500).json({ detail: "Auth failure" });
  });
}

export function requireScope(...need: (keyof Scopes)[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const can = req.principal?.can;
    if (!can || need.some((n) => !can[n])) {
      res.status(403).json({
        detail: `Missing scope: ${need.filter((n) => !can?.[n]).join(", ")}. Admin / author access is restricted.`,
      });
      return;
    }
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.principal?.role !== "admin" && !req.principal?.can.admin) {
    res.status(403).json({ detail: "Admin role required" });
    return;
  }
  next();
}

export function publicAuthConfig() {
  return {
    surface: SURFACE,
    allow_guest: ALLOW_GUEST,
    auth0: Boolean(AUTH0_DOMAIN),
    auth0_domain: AUTH0_DOMAIN || null,
    auth0_audience: AUTH0_AUDIENCE || null,
  };
}
