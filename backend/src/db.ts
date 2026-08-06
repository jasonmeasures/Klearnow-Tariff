/**
 * Optional PostgreSQL for Auth0 user / role management.
 * When DATABASE_URL / PGHOST is unset, auth falls back to JWT claims (existing behavior).
 */
import pg from "pg";

const { Pool } = pg;

export type DbUserRole = "user" | "admin";
export type DbUserStatus = "active" | "disabled";

export type DbUser = {
  id: string;
  email: string;
  auth0_sub: string | null;
  name: string | null;
  role: DbUserRole;
  status: DbUserStatus;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
};

let pool: pg.Pool | null = null;
let enabled = false;
let warnedFallback = false;

export function isDbEnabled(): boolean {
  return enabled && pool !== null;
}

function envConfigured(): boolean {
  if (String(process.env.DATABASE_URL || "").trim()) return true;
  if (String(process.env.PGHOST || "").trim()) return true;
  return false;
}

function buildPool(): pg.Pool {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (url) {
    return new Pool({ connectionString: url, max: 5 });
  }
  return new Pool({
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "postgres",
    max: 5,
  });
}

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  auth0_sub     text UNIQUE,
  name          text,
  role          text NOT NULL DEFAULT 'user',
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS user_audit (
  id            bigserial PRIMARY KEY,
  actor_email   text,
  target_email  text,
  action        text,
  detail        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
`;

function parseBootstrapEmails(): string[] {
  return String(process.env.ADMIN_BOOTSTRAP_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function bootstrapAdmins(client: pg.PoolClient): Promise<void> {
  const emails = parseBootstrapEmails();
  for (const email of emails) {
    await client.query(
      `INSERT INTO users (email, role, status, name)
       VALUES ($1, 'admin', 'active', 'Bootstrap admin')
       ON CONFLICT (email) DO UPDATE SET
         role = 'admin',
         status = 'active',
         updated_at = now()`,
      [email],
    );
  }
  if (emails.length) {
    console.log(
      `[db] Bootstrapped admin(s): ${emails.join(", ")} (ADMIN_BOOTSTRAP_EMAILS)`,
    );
  }
}

/** Call once at boot. No-ops with a warning when DB is not configured. */
export async function initDb(): Promise<void> {
  if (!envConfigured()) {
    if (!warnedFallback) {
      console.warn(
        "[db] DATABASE_URL / PGHOST not set — Auth0 roles stay claim-based (no user table).",
      );
      warnedFallback = true;
    }
    enabled = false;
    pool = null;
    return;
  }

  pool = buildPool();
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    await client.query(SCHEMA_SQL);
    await bootstrapAdmins(client);
    enabled = true;
    console.log("[db] PostgreSQL connected; users schema ready.");
  } catch (e) {
    enabled = false;
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
    pool = null;
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `[db] DATABASE configured but unreachable or schema failed: ${msg}`,
    );
  } finally {
    client.release();
  }
}

export function getPool(): pg.Pool {
  if (!pool || !enabled) {
    throw new Error("Database is not configured");
  }
  return pool;
}

function mapUser(row: Record<string, unknown>): DbUser {
  return {
    id: String(row.id),
    email: String(row.email),
    auth0_sub: row.auth0_sub == null ? null : String(row.auth0_sub),
    name: row.name == null ? null : String(row.name),
    role: row.role === "admin" ? "admin" : "user",
    status: row.status === "disabled" ? "disabled" : "active",
    created_at: new Date(String(row.created_at)),
    updated_at: new Date(String(row.updated_at)),
    last_login_at: row.last_login_at ? new Date(String(row.last_login_at)) : null,
  };
}

export async function findUserByAuth0Sub(sub: string): Promise<DbUser | null> {
  const { rows } = await getPool().query(
    `SELECT * FROM users WHERE auth0_sub = $1 LIMIT 1`,
    [sub],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function findUserByEmail(email: string): Promise<DbUser | null> {
  const { rows } = await getPool().query(
    `SELECT * FROM users WHERE email = $1 LIMIT 1`,
    [email.toLowerCase()],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function backfillAuth0Sub(id: string, sub: string): Promise<void> {
  await getPool().query(
    `UPDATE users SET auth0_sub = $2, updated_at = now() WHERE id = $1 AND auth0_sub IS NULL`,
    [id, sub],
  );
}

export async function touchLastLogin(id: string): Promise<void> {
  await getPool().query(
    `UPDATE users SET last_login_at = now() WHERE id = $1`,
    [id],
  );
}

export async function autoProvisionUser(opts: {
  email: string;
  sub: string;
  name?: string | null;
  role?: DbUserRole;
  status?: DbUserStatus;
  /** When true, flip a previously disabled row to active (playground waitlist reopen). */
  reactivate?: boolean;
}): Promise<DbUser> {
  const email = opts.email.toLowerCase();
  const role = opts.role === "admin" ? "admin" : "user";
  const status = opts.status === "disabled" ? "disabled" : "active";
  const reactivate = Boolean(opts.reactivate);
  const { rows } = await getPool().query(
    `INSERT INTO users (email, auth0_sub, name, role, status)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET
       auth0_sub = COALESCE(users.auth0_sub, EXCLUDED.auth0_sub),
       name = COALESCE(EXCLUDED.name, users.name),
       role = CASE
         WHEN EXCLUDED.role = 'admin' THEN 'admin'
         ELSE users.role
       END,
       status = CASE
         WHEN EXCLUDED.role = 'admin' AND EXCLUDED.status = 'active' THEN 'active'
         WHEN $6::boolean AND EXCLUDED.status = 'active' THEN 'active'
         WHEN users.status = 'disabled' THEN users.status
         ELSE EXCLUDED.status
       END,
       updated_at = now()
     RETURNING *`,
    [email, opts.sub, opts.name || null, role, status, reactivate],
  );
  return mapUser(rows[0]);
}

/** @deprecated Prefer autoProvisionUser — kept for older call sites. */
export async function autoProvisionDisabledUser(opts: {
  email: string;
  sub: string;
  name?: string | null;
}): Promise<DbUser> {
  return autoProvisionUser({ ...opts, role: "user", status: "disabled" });
}

export function isBootstrapAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return parseBootstrapEmails().includes(e);
}

export function autoProvisionEnabled(): boolean {
  const v = String(process.env.USER_AUTO_PROVISION || "").toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  // Default ON for playground so signed-in kn users can use the app without a manual Users row.
  const surface = String(process.env.SURFACE || process.env.APP_SURFACE || "local").toLowerCase();
  return surface === "playground" || surface === "external";
}

export async function writeUserAudit(opts: {
  actor_email: string | null;
  target_email: string | null;
  action: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO user_audit (actor_email, target_email, action, detail)
     VALUES ($1, $2, $3, $4)`,
    [
      opts.actor_email,
      opts.target_email,
      opts.action,
      JSON.stringify(opts.detail || {}),
    ],
  );
}

export async function countActiveAdmins(): Promise<number> {
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active'`,
  );
  return Number(rows[0]?.n || 0);
}

export async function listUsers(opts: {
  q?: string;
  status?: string;
}): Promise<DbUser[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.q) {
    params.push(`%${opts.q.toLowerCase()}%`);
    clauses.push(`(email ILIKE $${params.length} OR coalesce(name,'') ILIKE $${params.length})`);
  }
  if (opts.status === "active" || opts.status === "disabled") {
    params.push(opts.status);
    clauses.push(`status = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await getPool().query(
    `SELECT * FROM users ${where} ORDER BY email ASC`,
    params,
  );
  return rows.map(mapUser);
}

export async function createUser(opts: {
  email: string;
  name?: string | null;
  role?: DbUserRole;
  status?: DbUserStatus;
}): Promise<DbUser> {
  const email = opts.email.toLowerCase().trim();
  const role = opts.role === "admin" ? "admin" : "user";
  const status = opts.status === "disabled" ? "disabled" : "active";
  const { rows } = await getPool().query(
    `INSERT INTO users (email, name, role, status)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email, opts.name || null, role, status],
  );
  return mapUser(rows[0]);
}

export async function getUserById(id: string): Promise<DbUser | null> {
  const { rows } = await getPool().query(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function updateUser(
  id: string,
  patch: { role?: DbUserRole; status?: DbUserStatus; name?: string | null },
): Promise<DbUser> {
  const cur = await getUserById(id);
  if (!cur) throw Object.assign(new Error("User not found"), { status: 404 });
  const role = patch.role ?? cur.role;
  const status = patch.status ?? cur.status;
  const name = patch.name !== undefined ? patch.name : cur.name;
  const { rows } = await getPool().query(
    `UPDATE users SET role = $2, status = $3, name = $4, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, role, status, name],
  );
  return mapUser(rows[0]);
}

export async function deleteUser(id: string): Promise<DbUser> {
  const { rows } = await getPool().query(
    `DELETE FROM users WHERE id = $1 RETURNING *`,
    [id],
  );
  if (!rows[0]) throw Object.assign(new Error("User not found"), { status: 404 });
  return mapUser(rows[0]);
}
