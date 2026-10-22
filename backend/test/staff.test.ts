import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/db.js";
import { addProduct, api, loginAs, placeOrder, resetDb, startApp, stopApp } from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);

let admin: Record<string, string>;
beforeEach(async () => {
  await resetDb();
  admin = (await loginAs("admin")).headers;
});

const post = (path: string, body: unknown, headers = admin) => api(path, { method: "POST", body, headers });
const addStaff = (name: string, email: string) =>
  post("/admin/users", { name, email, password: "long-enough-1" }).then((r) => r.json());
const addKiosk = (code: string, name: string) => post("/admin/kiosks", { code, name, location: "Bengaluru" }).then((r) => r.json());
const addShift = (body: Record<string, unknown>) => post("/admin/shifts", { date: "2026-11-02", note: "", ...body });

describe("people", () => {
  it("admin adds staff who can then log in; duplicates and weak passwords are refused", async () => {
    const priya = await addStaff("Priya Sharma", "priya@test.local");
    expect(priya).toMatchObject({ email: "priya@test.local", role: "staff" });
    expect((await post("/auth/login", { email: "priya@test.local", password: "long-enough-1" }, {})).status).toBe(200);

    expect((await post("/admin/users", { name: "X", email: "priya@test.local", password: "long-enough-1" })).status).toBe(409);
    expect((await post("/admin/users", { name: "X", email: "x@test.local", password: "short" })).status).toBe(400);
  });

  it("deactivating someone logs them out at once; admins cannot deactivate themselves", async () => {
    const staff = await loginAs("staff");
    expect((await api(`/admin/users/${staff.user.id}`, { method: "PATCH", body: { active: false }, headers: admin })).status).toBe(200);
    expect((await api("/auth/me", { headers: staff.headers })).status).toBe(401);

    const me = await api("/auth/me", { headers: admin }).then((r) => r.json());
    expect((await api(`/admin/users/${me.id}`, { method: "PATCH", body: { active: false }, headers: admin })).status).toBe(400);
  });

  it("staff cannot manage people, kiosks or shifts", async () => {
    const staff = (await loginAs("staff", "s2@test.local")).headers;
    expect((await api("/admin/users", { headers: staff })).status).toBe(403);
    expect((await post("/admin/kiosks", { code: "K-9", name: "x" }, staff)).status).toBe(403);
    expect((await api("/admin/shifts?from=2026-11-01&to=2026-11-07", { headers: staff })).status).toBe(403);
  });
});

describe("duty roster", () => {
  it("schedules a shift in India time and shows it in the roster and to the staff member", async () => {
    const kiosk = await addKiosk("ksk-blr-01", "MG Road Metro");
    expect(kiosk.code).toBe("KSK-BLR-01"); // codes are upper-cased

    const priya = await loginAs("staff", "priya@test.local");
    const res = await addShift({ kioskId: kiosk.id, userId: priya.user.id, startTime: "09:00", endTime: "17:30" });
    expect(res.status).toBe(201);

    const [shift] = await api("/admin/shifts?from=2026-11-02&to=2026-11-02", { headers: admin }).then((r) => r.json());
    expect(shift).toMatchObject({ kioskCode: "KSK-BLR-01", userName: "priya@test.local", date: "2026-11-02", startTime: "09:00", endTime: "17:30" });
    expect(new Date(shift.startsAt).toISOString()).toBe("2026-11-02T03:30:00.000Z"); // 09:00 IST = 03:30 UTC
  });

  it("a shift ending before it starts runs past midnight", async () => {
    const kiosk = await addKiosk("K-NIGHT", "Night counter");
    const staff = await loginAs("staff");
    await addShift({ kioskId: kiosk.id, userId: staff.user.id, startTime: "22:00", endTime: "06:00" });
    const [shift] = await api("/admin/shifts?from=2026-11-02&to=2026-11-03", { headers: admin }).then((r) => r.json());
    expect((new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime()) / 3600_000).toBe(8);
  });

  it("refuses two people at one kiosk, or one person at two kiosks, at the same time", async () => {
    const [k1, k2] = [await addKiosk("K-1", "One"), await addKiosk("K-2", "Two")];
    const anna = await loginAs("staff", "anna@test.local");
    const ben = await loginAs("staff", "ben@test.local");
    expect((await addShift({ kioskId: k1.id, userId: anna.user.id, startTime: "09:00", endTime: "13:00" })).status).toBe(201);

    const sameKiosk = await addShift({ kioskId: k1.id, userId: ben.user.id, startTime: "12:00", endTime: "15:00" });
    expect(sameKiosk.status).toBe(409);
    expect((await sameKiosk.json()).error).toBe("KIOSK_ALREADY_STAFFED");

    const samePerson = await addShift({ kioskId: k2.id, userId: anna.user.id, startTime: "10:00", endTime: "11:00" });
    expect(samePerson.status).toBe(409);
    expect((await samePerson.json()).error).toBe("STAFF_ALREADY_BUSY");

    // Back to back is fine: 13:00 end and 13:00 start do not overlap.
    expect((await addShift({ kioskId: k1.id, userId: ben.user.id, startTime: "13:00", endTime: "17:00" })).status).toBe(201);
  });

  it("two admins booking overlapping shifts at the same moment: exactly one is saved", async () => {
    const kiosk = await addKiosk("K-RACE", "Race");
    const people = await Promise.all(["a", "b", "c", "d", "e"].map((n) => loginAs("staff", `${n}@test.local`)));
    const results = await Promise.all(
      people.map((p) => addShift({ kioskId: kiosk.id, userId: p.user.id, startTime: "09:00", endTime: "18:00" })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM kiosk_shifts");
    expect(rows[0].n).toBe(1);
  });

  it("an order is stamped with its kiosk and whoever is on duty there right now", async () => {
    const kiosk = await addKiosk("K-NOW", "Now");
    const priya = await loginAs("staff", "priya@test.local");
    await pool.query(
      "INSERT INTO kiosk_shifts (kiosk_id, user_id, starts_at, ends_at) VALUES ($1, $2, now() - interval '1 hour', now() + interval '1 hour')",
      [kiosk.id, priya.user.id],
    );
    const productId = await addProduct(5);
    const res = await api("/orders", { method: "POST", body: { items: [{ productId, quantity: 1 }], kioskCode: "K-NOW" } });
    expect(res.status).toBe(201);
    const { rows } = await pool.query("SELECT kiosk_id, agent_user_id, bill_no FROM orders");
    expect(rows[0]).toMatchObject({ kiosk_id: kiosk.id, agent_user_id: priya.user.id });
    expect(Number(rows[0].bill_no)).toBe(1);

    expect((await api("/orders", { method: "POST", body: { items: [{ productId, quantity: 1 }], kioskCode: "NOPE" } })).status).toBe(400);
    expect((await placeOrder(productId, 1)).status).toBe(201); // no code: first kiosk
  });

  it("staff see their own upcoming shifts; deleting a shift removes it", async () => {
    const kiosk = await addKiosk("K-ME", "Mine");
    const staff = await loginAs("staff");
    const { rows } = await pool.query(
      "INSERT INTO kiosk_shifts (kiosk_id, user_id, starts_at, ends_at) VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day 8 hours') RETURNING id",
      [kiosk.id, staff.user.id],
    );
    const mine = await api("/staff/my-shifts", { headers: staff.headers }).then((r) => r.json());
    expect(mine.map((s: { kioskCode: string }) => s.kioskCode)).toEqual(["K-ME"]);

    expect((await api(`/admin/shifts/${rows[0].id}`, { method: "DELETE", headers: admin })).status).toBe(204);
    expect(await api("/staff/my-shifts", { headers: staff.headers }).then((r) => r.json())).toEqual([]);
  });
});
