import type { Request, RequestHandler } from "express";
import { HttpError } from "./errors.js";
import { userForToken, type Role, type User } from "./modules/auth/service.js";

export const SESSION_COOKIE = "sid";

// Lets route handlers read req.user after requireRole has run.
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// Reads one cookie from the Cookie header ("a=1; sid=abc"). Small enough not to need cookie-parser.
export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

// Guard for staff/admin routes. "staff" lets both roles in (admin can do everything staff can);
// "admin" lets only admins in. Not logged in -> 401, wrong role -> 403.
export function requireRole(role: Role): RequestHandler {
  return async (req, _res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    const user = token ? await userForToken(token) : null;
    if (!user) throw new HttpError(401, "NOT_LOGGED_IN", "Please log in");
    if (role === "admin" && user.role !== "admin") throw new HttpError(403, "FORBIDDEN", "Admins only");
    req.user = user;
    next();
  };
}
