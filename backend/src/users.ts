/**
 * Admin user / role management (PostgreSQL).
 * Mounted under /v1 — all routes require admin scope.
 */
import { Router } from "express";
import { requireAdmin, requireScope } from "./auth.ts";
import {
  countActiveAdmins,
  createUser,
  deleteUser,
  getUserById,
  isDbEnabled,
  listUsers,
  updateUser,
  writeUserAudit,
  type DbUserRole,
  type DbUserStatus,
} from "./db.ts";

export const usersRouter = Router();

function requireDb(_req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  if (!isDbEnabled()) {
    res.status(503).json({
      detail:
        "User management requires PostgreSQL. Set DATABASE_URL (or PGHOST) and restart the API.",
    });
    return;
  }
  next();
}

function actorEmail(req: import("express").Request): string | null {
  return req.principal?.email || req.principal?.subject || null;
}

function serialize(u: Awaited<ReturnType<typeof getUserById>>) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    auth0_sub: u.auth0_sub,
    name: u.name,
    role: u.role,
    status: u.status,
    created_at: u.created_at.toISOString(),
    updated_at: u.updated_at.toISOString(),
    last_login_at: u.last_login_at ? u.last_login_at.toISOString() : null,
  };
}

usersRouter.get(
  "/admin/users",
  requireScope("admin"),
  requireAdmin,
  requireDb,
  async (req, res) => {
    try {
      const q = String(req.query.q || "").trim() || undefined;
      const status = String(req.query.status || "").trim() || undefined;
      const users = await listUsers({ q, status });
      res.json({ users: users.map(serialize), db: true });
    } catch (e) {
      res.status(500).json({ detail: e instanceof Error ? e.message : String(e) });
    }
  },
);

usersRouter.post(
  "/admin/users",
  requireScope("admin"),
  requireAdmin,
  requireDb,
  async (req, res) => {
    try {
      const body = req.body || {};
      const email = String(body.email || "").trim().toLowerCase();
      if (!email || !email.includes("@")) {
        res.status(400).json({ detail: "Valid email is required" });
        return;
      }
      const role: DbUserRole = body.role === "admin" ? "admin" : "user";
      const status: DbUserStatus =
        body.status === "disabled" ? "disabled" : "active";
      const name = body.name != null ? String(body.name) : null;
      const user = await createUser({ email, name, role, status });
      await writeUserAudit({
        actor_email: actorEmail(req),
        target_email: user.email,
        action: "create",
        detail: { role: user.role, status: user.status },
      });
      res.status(201).json(serialize(user));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|duplicate/i.test(msg)) {
        res.status(409).json({ detail: "A user with that email already exists" });
        return;
      }
      res.status(500).json({ detail: msg });
    }
  },
);

usersRouter.patch(
  "/admin/users/:id",
  requireScope("admin"),
  requireAdmin,
  requireDb,
  async (req, res) => {
    try {
      const id = String(req.params.id || "");
      const cur = await getUserById(id);
      if (!cur) {
        res.status(404).json({ detail: "User not found" });
        return;
      }
      const body = req.body || {};
      const patch: {
        role?: DbUserRole;
        status?: DbUserStatus;
        name?: string | null;
      } = {};
      if (body.role !== undefined) {
        if (body.role !== "admin" && body.role !== "user") {
          res.status(400).json({ detail: "role must be user or admin" });
          return;
        }
        patch.role = body.role;
      }
      if (body.status !== undefined) {
        if (body.status !== "active" && body.status !== "disabled") {
          res.status(400).json({ detail: "status must be active or disabled" });
          return;
        }
        patch.status = body.status;
      }
      if (body.name !== undefined) {
        patch.name = body.name == null ? null : String(body.name);
      }

      const selfEmail = (req.principal?.email || "").toLowerCase();
      const isSelf = selfEmail && selfEmail === cur.email.toLowerCase();
      if (isSelf) {
        if (patch.status === "disabled") {
          res.status(409).json({ detail: "You cannot disable your own account" });
          return;
        }
        if (patch.role === "user" && cur.role === "admin") {
          res.status(409).json({ detail: "You cannot demote your own account" });
          return;
        }
      }

      const nextRole = patch.role ?? cur.role;
      const nextStatus = patch.status ?? cur.status;
      if (
        cur.role === "admin" &&
        cur.status === "active" &&
        (nextRole !== "admin" || nextStatus !== "active")
      ) {
        const n = await countActiveAdmins();
        if (n <= 1) {
          res.status(409).json({
            detail: "Cannot remove the last active admin",
          });
          return;
        }
      }

      const user = await updateUser(id, patch);
      await writeUserAudit({
        actor_email: actorEmail(req),
        target_email: user.email,
        action: "update",
        detail: patch,
      });
      res.json(serialize(user));
    } catch (e) {
      const status = (e as { status?: number }).status || 500;
      res.status(status).json({
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  },
);

usersRouter.delete(
  "/admin/users/:id",
  requireScope("admin"),
  requireAdmin,
  requireDb,
  async (req, res) => {
    try {
      const id = String(req.params.id || "");
      const cur = await getUserById(id);
      if (!cur) {
        res.status(404).json({ detail: "User not found" });
        return;
      }
      const selfEmail = (req.principal?.email || "").toLowerCase();
      if (selfEmail && selfEmail === cur.email.toLowerCase()) {
        res.status(409).json({ detail: "You cannot delete your own account" });
        return;
      }
      if (cur.role === "admin" && cur.status === "active") {
        const n = await countActiveAdmins();
        if (n <= 1) {
          res.status(409).json({ detail: "Cannot delete the last active admin" });
          return;
        }
      }
      const user = await deleteUser(id);
      await writeUserAudit({
        actor_email: actorEmail(req),
        target_email: user.email,
        action: "delete",
        detail: { id: user.id },
      });
      res.json({ ok: true, deleted: serialize(user) });
    } catch (e) {
      const status = (e as { status?: number }).status || 500;
      res.status(status).json({
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  },
);
