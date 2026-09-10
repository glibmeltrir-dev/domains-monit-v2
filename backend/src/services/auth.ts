import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import { query, withTransaction } from "../db/pool.ts";
import { config } from "../config.ts";

const scrypt = promisify(scryptCb);

const COOKIE = "sid";
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const EMAIL_RE = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export interface AuthUser {
  id: number;
  username: string;
  role: string;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function cookieMaxAgeSec(): number {
  return Math.floor(config.session.ttlMs / 1000);
}

function signSid(id: string): string {
  const mac = createHmac("sha256", config.session.secret).update(id).digest("hex").slice(0, 32);
  return `${id}.${mac}`;
}

function verifySid(raw: string | undefined): string | null {
  if (!raw) return null;
  const i = raw.lastIndexOf(".");
  if (i <= 0) return null;
  const id = raw.slice(0, i);
  const mac = raw.slice(i + 1);
  const expected = createHmac("sha256", config.session.secret).update(id).digest("hex").slice(0, 32);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!/^[a-f0-9]{64}$/i.test(id)) return null;
  return id;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    try {
      out[k] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[k] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "";
}

export function setSessionCookie(res: Response, sid: string): void {
  const parts = [
    `${COOKIE}=${encodeURIComponent(signSid(sid))}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${cookieMaxAgeSec()}`,
  ];
  if (config.session.cookieSecure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: Response): void {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (config.session.cookieSecure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split(":");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const hash = Buffer.from(hashHex, "hex");
  const test = (await scrypt(password, salt, 64)) as Buffer;
  if (test.length !== hash.length) return false;
  return timingSafeEqual(hash, test);
}

export function validateUsername(raw: string): string {
  const username = String(raw || "").trim();
  if (USERNAME_RE.test(username)) return username;
  if (username.length <= 64 && EMAIL_RE.test(username)) return username.toLowerCase();
  throw new AuthError("Логин: 3–32 символа (латиница, цифры, . _ -) или email");
}

export function validatePassword(raw: string): string {
  const password = String(raw || "");
  if (password.length < 12) throw new AuthError("Пароль должен быть не короче 12 символов");
  if (password.length > 200) throw new AuthError("Пароль слишком длинный");
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new AuthError("Пароль должен содержать буквы и цифры");
  }
  return password;
}

export async function userCount(): Promise<number> {
  const { rows } = await query<{ n: number }>("SELECT count(*)::int AS n FROM users");
  return rows[0]?.n ?? 0;
}

export async function createFirstAdmin(usernameRaw: string, passwordRaw: string): Promise<AuthUser> {
  const username = validateUsername(usernameRaw);
  const password = validatePassword(passwordRaw);
  const passwordHash = await hashPassword(password);

  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(87236401)");
    const existing = await client.query("SELECT 1 FROM users LIMIT 1");
    if (existing.rows[0]) throw new AuthError("Регистрация закрыта — супер-админ уже создан", 409);
    const { rows } = await client.query<{ id: number; username: string; role: string }>(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, 'super_admin')
       RETURNING id, username, role`,
      [username, passwordHash]
    );
    return rows[0];
  });
}

export async function authenticate(usernameRaw: string, passwordRaw: string): Promise<AuthUser> {
  const username = String(usernameRaw || "").trim();
  const password = String(passwordRaw || "");
  const { rows } = await query<{ id: number; username: string; role: string; password_hash: string }>(
    "SELECT id, username, role, password_hash FROM users WHERE lower(username) = lower($1) LIMIT 1",
    [username]
  );
  const dummy =
    "scrypt:00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
  const row = rows[0];
  const ok = await verifyPassword(password, row?.password_hash ?? dummy);
  if (!row || !ok) throw new AuthError("Неверный логин или пароль", 401);
  return { id: row.id, username: row.username, role: row.role };
}

export async function createSession(userId: number, req: Request): Promise<string> {
  await query("DELETE FROM sessions WHERE expires_at < now()");
  const id = randomBytes(32).toString("hex");
  await query(
    `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5)`,
    [id, userId, cookieMaxAgeSec(), clientIp(req), String(req.headers["user-agent"] || "").slice(0, 300)]
  );
  await query("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
  return id;
}

export async function destroySession(req: Request): Promise<void> {
  const id = verifySid(parseCookies(req.headers.cookie)[COOKIE]);
  if (id) await query("DELETE FROM sessions WHERE id = $1", [id]);
}

export async function loadUserFromRequest(req: Request): Promise<AuthUser | null> {
  const id = verifySid(parseCookies(req.headers.cookie)[COOKIE]);
  if (!id) return null;
  const { rows } = await query<{
    id: number;
    username: string;
    role: string;
    expires_at: Date;
  }>(
    `SELECT u.id, u.username, u.role, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1
     LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await query("DELETE FROM sessions WHERE id = $1", [id]);
    return null;
  }
  // Sliding expiry: refresh if more than a day has elapsed.
  await query(
    `UPDATE sessions SET expires_at = now() + make_interval(secs => $2)
     WHERE id = $1 AND expires_at < now() + make_interval(days => 6)`,
    [id, cookieMaxAgeSec()]
  );
  return { id: row.id, username: row.username, role: row.role };
}
