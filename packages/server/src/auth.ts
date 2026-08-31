import {
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { sql } from './db.ts';
import { PAYWALL_ENABLED, SESSION_TTL_DAYS } from './env.ts';

export interface AuthUser {
  id: string;
  email: string;
  entitled: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const TOKEN_LENGTH = 32;

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;
const MAX_EMAIL_LENGTH = 254;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !key) return false;

  const expected = Buffer.from(key, 'base64');
  const actual = await new Promise<Buffer | null>((resolve) => {
    scrypt(
      password,
      Buffer.from(salt, 'base64'),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p) },
      (err, derived) => resolve(err ? null : derived),
    );
  });

  if (!actual || actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Deliberately permissive: anything with a local part, an @, and a dotted
// domain. "a@b.co" passes, "a@b" and "a b@c.com" do not. Stricter patterns
// reject addresses that are legal and deliverable, and the only real proof an
// address works is sending to it.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return email.length <= MAX_EMAIL_LENGTH && EMAIL.test(email);
}

export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<IssuedSession> {
  const token = randomBytes(TOKEN_LENGTH).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${hashToken(token)}, ${userId}, ${expiresAt})
  `;

  return { token, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
}

// An entitlement is any subscription row still in force. `current_period_end`
// is NULL for a comped or lifetime grant, which never lapses.
function entitled() {
  return sql`
    EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.user_id = u.id
        AND s.status = 'active'
        AND (s.current_period_end IS NULL OR s.current_period_end > now())
    )
  `;
}

interface UserRow {
  id: string;
  email: string;
  entitled: boolean;
}

export async function findUserBySession(token: string): Promise<AuthUser | null> {
  const [row] = await sql<UserRow[]>`
    SELECT u.id::text AS id, u.email, ${entitled()} AS entitled
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)}
      AND s.expires_at > now()
  `;
  if (!row) return null;

  // Touched on read so an idle session can be aged out later without the
  // client having to announce that it is still alive.
  await sql`
    UPDATE sessions SET last_seen_at = now() WHERE token_hash = ${hashToken(token)}
  `;

  return { id: row.id, email: row.email, entitled: row.entitled };
}

export async function findUserById(userId: string): Promise<AuthUser | null> {
  const [row] = await sql<UserRow[]>`
    SELECT u.id::text AS id, u.email, ${entitled()} AS entitled
    FROM users u
    WHERE u.id = ${userId}
  `;
  return row ?? null;
}

export function bearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.user) {
    next();
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Sign in to continue' });
    return;
  }

  findUserBySession(token)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: 'Session expired' });
        return;
      }
      req.user = user;
      next();
    })
    .catch(next);
}

export function requireEntitlement(req: Request, res: Response, next: NextFunction): void {
  if (!PAYWALL_ENABLED || req.user?.entitled) {
    next();
    return;
  }

  res.status(402).json({ error: 'Lineup building requires a subscription' });
}

export async function deleteExpiredSessions(): Promise<number> {
  const rows = await sql`DELETE FROM sessions WHERE expires_at < now()`;
  return rows.count ?? 0;
}
