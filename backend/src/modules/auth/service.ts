import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../../db/db.js";
import { config } from "../../config.js";
import { HttpError } from "../../errors.js";

export type Role = "admin" | "staff";
export type User = { id: number; email: string; role: Role };

const SESSION_HOURS = 8;
const BCRYPT_COST = 10;

// Only the hash of a session token is stored, so the sessions table alone cannot be used to log in.
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

// Compared against when the email does not exist, so a wrong email takes as long as a wrong
// password and the login form cannot be used to find out which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync("no-such-user", BCRYPT_COST);

export async function createUser(email: string, password: string, role: Role, name?: string): Promise<User> {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  const { rows } = await pool.query(
    "INSERT INTO users (email, password_hash, role, name) VALUES (lower($1), $2, $3, $4) RETURNING id, email, role",
    [email, hash, role, name ?? null],
  );
  return rows[0];
}

// First admin (when there are no users yet) and the optional demo staff account.
export async function seedUsers() {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM users");
  if (rows[0].n === 0) await createUser(config.adminEmail, config.adminPassword, "admin", "Admin");
  if (config.staffEmail && config.staffPassword) {
    const { rows: staff } = await pool.query("SELECT 1 FROM users WHERE email = lower($1)", [config.staffEmail]);
    if (staff.length === 0) await createUser(config.staffEmail, config.staffPassword, "staff", "Counter staff");
  }
}

// Check the password and open a session. Returns the raw token for the cookie.
export async function login(email: string, password: string): Promise<{ token: string; user: User }> {
  const { rows } = await pool.query(
    "SELECT id, email, role, password_hash FROM users WHERE email = lower($1) AND active",
    [email],
  );
  const matches = await bcrypt.compare(password, rows[0]?.password_hash ?? DUMMY_HASH);
  if (rows.length === 0 || !matches) {
    // Same answer for "no such user" and "wrong password".
    throw new HttpError(401, "BAD_CREDENTIALS", "Wrong email or password");
  }

  const token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))",
    [sha256(token), rows[0].id, SESSION_HOURS],
  );
  const { id, role } = rows[0];
  return { token, user: { id, email: rows[0].email, role } };
}

// The logged-in user for a cookie value, or null if the session is unknown, expired, or the
// account was deactivated (so removing a staff member takes effect immediately).
export async function userForToken(token: string): Promise<User | null> {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export async function logout(token: string) {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]);
}

export const SESSION_MAX_AGE_MS = SESSION_HOURS * 60 * 60 * 1000;
