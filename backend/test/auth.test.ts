import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/db.js";
import { createUser } from "../src/modules/auth/service.js";
import { resetLoginLimits } from "../src/modules/auth/routes.js";
import { api, loginAs, PASSWORD, resetDb, startApp, stopApp } from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);
beforeEach(async () => {
  await resetDb();
  resetLoginLimits();
});

const login = (email: string, password: string) => api("/auth/login", { method: "POST", body: { email, password } });

describe("login and sessions", () => {
  it("logs in with a session cookie that scripts and other sites cannot use", async () => {
    await createUser("Admin@Test.local", PASSWORD, "admin");
    const res = await login("admin@test.local", PASSWORD); // emails are case-insensitive
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "admin@test.local", role: "admin" });

    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^sid=[0-9a-f]{64};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    await createUser("staff@test.local", PASSWORD, "staff");
    const wrongPassword = await login("staff@test.local", "nope-nope");
    const unknownEmail = await login("ghost@test.local", PASSWORD);
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
  });

  it("stores only hashes: bcrypt for passwords, sha-256 for session tokens", async () => {
    const { headers } = await loginAs("staff");
    const token = headers.Cookie.slice("sid=".length);
    const { rows: users } = await pool.query("SELECT password_hash FROM users");
    expect(users[0].password_hash).toMatch(/^\$2[aby]\$10\$/);
    expect(users[0].password_hash).not.toContain(PASSWORD);
    const { rows: sessions } = await pool.query("SELECT token_hash FROM sessions");
    expect(sessions[0].token_hash).not.toBe(token);
    expect(sessions[0].token_hash).toHaveLength(64);
  });

  it("/auth/me works with the cookie and logout ends the session", async () => {
    const { headers } = await loginAs("staff");
    expect((await api("/auth/me", { headers }).then((r) => r.json())).role).toBe("staff");

    expect((await api("/auth/logout", { method: "POST", headers })).status).toBe(204);
    expect((await api("/auth/me", { headers })).status).toBe(401); // old cookie no longer works
    expect((await api("/auth/me")).status).toBe(401);
  });

  it("an expired session or a deactivated account is logged out", async () => {
    const { headers, user } = await loginAs("staff");
    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second'");
    expect((await api("/auth/me", { headers })).status).toBe(401);

    const second = await loginAs("staff", "other@test.local");
    await pool.query("UPDATE users SET active = false WHERE id = $1", [second.user.id]);
    expect((await api("/auth/me", { headers: second.headers })).status).toBe(401);
    expect(user.role).toBe("staff");
  });

  it("blocks an IP after 10 failed logins, even with the right password", async () => {
    await createUser("staff@test.local", PASSWORD, "staff");
    for (let i = 0; i < 10; i++) expect((await login("staff@test.local", "wrong")).status).toBe(401);
    expect((await login("staff@test.local", PASSWORD)).status).toBe(429);
  });
});

describe("roles", () => {
  it("staff can use the cash queue but not admin pages", async () => {
    const { headers } = await loginAs("staff");
    expect((await api("/admin/cash-requests", { headers })).status).toBe(200);
    expect((await api("/admin/products", { headers })).status).toBe(403);
    expect((await api("/admin/analytics/summary?from=2026-10-01&to=2026-10-02", { headers })).status).toBe(403);
    expect((await api("/admin/reports/daily-pdf?date=2026-10-01", { headers })).status).toBe(403);
  });

  it("admin can do everything staff can, and more", async () => {
    const { headers } = await loginAs("admin");
    expect((await api("/admin/cash-requests", { headers })).status).toBe(200);
    expect((await api("/admin/products", { headers })).status).toBe(200);
  });

  it("no login: 401 everywhere in the portal", async () => {
    for (const path of ["/admin/cash-requests", "/admin/products", "/admin/analytics/daily?from=2026-10-01&to=2026-10-01"]) {
      expect((await api(path)).status).toBe(401);
    }
  });
});
