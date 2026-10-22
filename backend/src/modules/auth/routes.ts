import { Router } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { HttpError } from "../../errors.js";
import { readCookie, requireRole, SESSION_COOKIE } from "../../auth.js";
import { login, logout, SESSION_MAX_AGE_MS } from "./service.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
});

// Slow down password guessing: at most 10 failed logins per IP per 15 minutes.
// In memory, so it resets on restart and is per instance; fine for one small server.
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; since: number }>();

function tooManyFailures(ip: string) {
  const entry = failures.get(ip);
  if (entry && Date.now() - entry.since > WINDOW_MS) failures.delete(ip);
  return (failures.get(ip)?.count ?? 0) >= MAX_FAILURES;
}
function recordFailure(ip: string) {
  const entry = failures.get(ip) ?? { count: 0, since: Date.now() };
  entry.count += 1;
  failures.set(ip, entry);
}
export function resetLoginLimits() {
  failures.clear(); // tests only
}

authRouter.post("/auth/login", async (req, res) => {
  const ip = req.ip ?? "unknown";
  if (tooManyFailures(ip)) throw new HttpError(429, "TOO_MANY_ATTEMPTS", "Too many failed logins, try again later");

  const { email, password } = loginSchema.parse(req.body);
  try {
    const { token, user } = await login(email, password);
    failures.delete(ip);
    // HttpOnly: page scripts cannot read it. SameSite=Strict: other websites cannot send it
    // (no CSRF). Secure: HTTPS only in production.
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: config.isProduction,
      path: "/",
      maxAge: SESSION_MAX_AGE_MS,
    });
    res.json(user);
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) recordFailure(ip);
    throw err;
  }
});

authRouter.post("/auth/logout", async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await logout(token);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

authRouter.get("/auth/me", requireRole("staff"), (req, res) => {
  res.json(req.user);
});
