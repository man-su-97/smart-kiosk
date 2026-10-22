import { pool } from "../../db/db.js";
import { config } from "../../config.js";
import { HttpError } from "../../errors.js";
import { createUser, type Role } from "../auth/service.js";

// ---- People ---------------------------------------------------------------

export async function listUsers() {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, active FROM users ORDER BY active DESC, role, COALESCE(name, email)`,
  );
  return rows;
}

export async function addUser(input: { name: string; email: string; password: string; role: Role }) {
  const { rows } = await pool.query("SELECT 1 FROM users WHERE email = lower($1)", [input.email]);
  if (rows.length > 0) throw new HttpError(409, "EMAIL_TAKEN", "Someone already uses that email");
  return createUser(input.email, input.password, input.role, input.name);
}

// Deactivating logs the person out at once (sessions check users.active) and keeps their history.
export async function updateUser(id: number, changes: { name?: string; active?: boolean }, actingUserId: number) {
  if (id === actingUserId && changes.active === false) {
    throw new HttpError(400, "CANNOT_DEACTIVATE_SELF", "You cannot deactivate your own account");
  }
  const { rows } = await pool.query(
    `UPDATE users SET name = COALESCE($2, name), active = COALESCE($3, active)
      WHERE id = $1 RETURNING id, name, email, role, active`,
    [id, changes.name ?? null, changes.active ?? null],
  );
  if (rows.length === 0) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  return rows[0];
}

// ---- Kiosks ---------------------------------------------------------------

// Each kiosk with whoever is on duty there right now.
export async function listKiosks() {
  const { rows } = await pool.query(
    `SELECT k.id, k.code, k.name, k.location, k.active,
            u.id AS "onDutyUserId", COALESCE(u.name, u.email) AS "onDutyName"
       FROM kiosks k
       LEFT JOIN kiosk_shifts s ON s.kiosk_id = k.id AND tstzrange(s.starts_at, s.ends_at) @> now()
       LEFT JOIN users u ON u.id = s.user_id
      ORDER BY k.code`,
  );
  return rows;
}

export async function addKiosk(input: { code: string; name: string; location: string }) {
  const { rows } = await pool.query("SELECT 1 FROM kiosks WHERE code = $1", [input.code]);
  if (rows.length > 0) throw new HttpError(409, "CODE_TAKEN", "Another kiosk already has that code");
  const { rows: created } = await pool.query(
    "INSERT INTO kiosks (code, name, location) VALUES ($1, $2, $3) RETURNING id, code, name, location, active",
    [input.code, input.name, input.location],
  );
  return created[0];
}

export async function updateKiosk(id: number, changes: { name?: string; location?: string; active?: boolean }) {
  const { rows } = await pool.query(
    `UPDATE kiosks SET name = COALESCE($2, name), location = COALESCE($3, location), active = COALESCE($4, active)
      WHERE id = $1 RETURNING id, code, name, location, active`,
    [id, changes.name ?? null, changes.location ?? null, changes.active ?? null],
  );
  if (rows.length === 0) throw new HttpError(404, "KIOSK_NOT_FOUND", "Kiosk not found");
  return rows[0];
}

// ---- Duty roster ----------------------------------------------------------

const SHIFT_COLUMNS = `
  s.id, s.kiosk_id AS "kioskId", k.code AS "kioskCode", k.name AS "kioskName",
  s.user_id AS "userId", COALESCE(u.name, u.email) AS "userName", s.note,
  to_char(s.starts_at AT TIME ZONE $1, 'YYYY-MM-DD') AS date,
  to_char(s.starts_at AT TIME ZONE $1, 'HH24:MI') AS "startTime",
  to_char(s.ends_at AT TIME ZONE $1, 'HH24:MI') AS "endTime",
  s.starts_at AS "startsAt", s.ends_at AS "endsAt"`;

// Shifts that touch the given India-time days, earliest first.
export async function listShifts(range: { from: string; to: string }) {
  const { rows } = await pool.query(
    `SELECT ${SHIFT_COLUMNS}
       FROM kiosk_shifts s JOIN kiosks k ON k.id = s.kiosk_id JOIN users u ON u.id = s.user_id
      WHERE s.ends_at > ($2::date::timestamp AT TIME ZONE $1)
        AND s.starts_at < (($3::date + 1)::timestamp AT TIME ZONE $1)
      ORDER BY s.starts_at, k.code`,
    [config.reportTimeZone, range.from, range.to],
  );
  return rows;
}

// A staff member's own shifts that have not ended yet (for "My duty").
export async function myUpcomingShifts(userId: number) {
  const { rows } = await pool.query(
    `SELECT ${SHIFT_COLUMNS}
       FROM kiosk_shifts s JOIN kiosks k ON k.id = s.kiosk_id JOIN users u ON u.id = s.user_id
      WHERE s.user_id = $2 AND s.ends_at > now()
      ORDER BY s.starts_at
      LIMIT 20`,
    [config.reportTimeZone, userId],
  );
  return rows;
}

export type ShiftInput = { kioskId: number; userId: number; date: string; startTime: string; endTime: string; note: string };

// Times are entered in India time. If the end is not after the start, the shift runs past
// midnight (e.g. 22:00 to 06:00). Overlaps are refused by the database constraints.
export async function addShift(input: ShiftInput) {
  const { rows: people } = await pool.query("SELECT active FROM users WHERE id = $1", [input.userId]);
  if (people.length === 0 || !people[0].active) throw new HttpError(400, "BAD_STAFF", "Pick an active staff member");
  const { rows: kiosks } = await pool.query("SELECT active FROM kiosks WHERE id = $1", [input.kioskId]);
  if (kiosks.length === 0 || !kiosks[0].active) throw new HttpError(400, "BAD_KIOSK", "Pick an active kiosk");

  try {
    const { rows } = await pool.query(
      `INSERT INTO kiosk_shifts (kiosk_id, user_id, starts_at, ends_at, note)
       SELECT $1, $2, start_at, CASE WHEN end_at > start_at THEN end_at ELSE end_at + interval '1 day' END, $7
         FROM (SELECT ($3::date + $4::time) AT TIME ZONE $6 AS start_at,
                      ($3::date + $5::time) AT TIME ZONE $6 AS end_at) t
       RETURNING id`,
      [input.kioskId, input.userId, input.date, input.startTime, input.endTime, config.reportTimeZone, input.note],
    );
    return rows[0];
  } catch (err) {
    // 23P01 = exclusion constraint violated: the new shift overlaps an existing one.
    const constraint = (err as { code?: string; constraint?: string }).code === "23P01" ? (err as { constraint: string }).constraint : null;
    if (constraint === "one_staff_per_kiosk_at_a_time") {
      throw new HttpError(409, "KIOSK_ALREADY_STAFFED", "Someone is already on duty at this kiosk during those hours");
    }
    if (constraint === "one_kiosk_per_staff_at_a_time") {
      throw new HttpError(409, "STAFF_ALREADY_BUSY", "This person already has a shift at another kiosk during those hours");
    }
    throw err;
  }
}

export async function deleteShift(id: number) {
  const { rowCount } = await pool.query("DELETE FROM kiosk_shifts WHERE id = $1", [id]);
  if (rowCount === 0) throw new HttpError(404, "SHIFT_NOT_FOUND", "Shift not found");
}
