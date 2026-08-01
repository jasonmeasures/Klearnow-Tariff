import type { NextFunction, Request, Response } from "express";

export type Scopes = {
  calculate: boolean;
  read_rules: boolean;
  write_rules: boolean;
};

export type Principal = {
  tenant_id: string;
  key_id: string;
  can: Scopes;
};

declare global {
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

const KEYS: Record<string, Principal> = {
  "dev-internal": {
    tenant_id: "klearnow",
    key_id: "dev-internal",
    can: { calculate: true, read_rules: true, write_rules: true },
  },
  "dev-calculate": {
    tenant_id: "customer",
    key_id: "dev-calculate",
    can: { calculate: true, read_rules: false, write_rules: false },
  },
};

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const key = String(req.header("X-API-Key") || process.env.API_KEY_INTERNAL || "dev-internal");
  const p = KEYS[key];
  if (!p) {
    res.status(401).json({ detail: "Unknown API key" });
    return;
  }
  req.principal = p;
  next();
}

export function requireScope(...need: (keyof Scopes)[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const can = req.principal?.can;
    if (!can || need.some((n) => !can[n])) {
      res.status(403).json({
        detail: `Missing scope: ${need.filter((n) => !can?.[n]).join(", ")}`,
      });
      return;
    }
    next();
  };
}
