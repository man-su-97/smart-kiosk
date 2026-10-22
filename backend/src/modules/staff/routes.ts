import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../../auth.js";
import {
  addKiosk, addShift, addUser, deleteShift, listKiosks, listShifts, listUsers, myUpcomingShifts, updateKiosk, updateUser,
} from "./service.js";

// People, kiosks and the duty roster. Managing them is admin-only; staff can read their own shifts.
export const staffRouter = Router();

const id = z.coerce.number().int().positive();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM (24 h)");

const userSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    email: z.string().trim().email().max(200),
    password: z.string().min(8, "at least 8 characters").max(200),
    role: z.enum(["staff", "admin"]).default("staff"),
  })
  .strict();
const userUpdateSchema = z.object({ name: z.string().trim().min(1).max(60), active: z.boolean() }).partial().strict();

const kioskSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, "letters, numbers and dashes, 2 to 20"),
    name: z.string().trim().min(1).max(60),
    location: z.string().trim().max(100).default(""),
  })
  .strict();
const kioskUpdateSchema = z
  .object({ name: z.string().trim().min(1).max(60), location: z.string().trim().max(100), active: z.boolean() })
  .partial()
  .strict();

const shiftSchema = z
  .object({
    kioskId: id,
    userId: id,
    date: isoDate,
    startTime: time,
    endTime: time,
    note: z.string().trim().max(100).default(""),
  })
  .strict()
  .refine((s) => s.startTime !== s.endTime, { message: "start and end cannot be the same", path: ["endTime"] });

const rangeSchema = z.object({ from: isoDate, to: isoDate }).refine((r) => r.from <= r.to, "from must not be after to");

staffRouter.get("/admin/users", requireRole("admin"), async (_req, res) => res.json(await listUsers()));
staffRouter.post("/admin/users", requireRole("admin"), async (req, res) => {
  res.status(201).json(await addUser(userSchema.parse(req.body)));
});
staffRouter.patch("/admin/users/:id", requireRole("admin"), async (req, res) => {
  res.json(await updateUser(id.parse(req.params.id), userUpdateSchema.parse(req.body), req.user!.id));
});

staffRouter.get("/admin/kiosks", requireRole("admin"), async (_req, res) => res.json(await listKiosks()));
staffRouter.post("/admin/kiosks", requireRole("admin"), async (req, res) => {
  res.status(201).json(await addKiosk(kioskSchema.parse(req.body)));
});
staffRouter.patch("/admin/kiosks/:id", requireRole("admin"), async (req, res) => {
  res.json(await updateKiosk(id.parse(req.params.id), kioskUpdateSchema.parse(req.body)));
});

staffRouter.get("/admin/shifts", requireRole("admin"), async (req, res) => {
  res.json(await listShifts(rangeSchema.parse(req.query)));
});
staffRouter.post("/admin/shifts", requireRole("admin"), async (req, res) => {
  res.status(201).json(await addShift(shiftSchema.parse(req.body)));
});
staffRouter.delete("/admin/shifts/:id", requireRole("admin"), async (req, res) => {
  await deleteShift(id.parse(req.params.id));
  res.status(204).end();
});

// Any logged-in staff member (or admin): their own upcoming duty.
staffRouter.get("/staff/my-shifts", requireRole("staff"), async (req, res) => {
  res.json(await myUpcomingShifts(req.user!.id));
});
