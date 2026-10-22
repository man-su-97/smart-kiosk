import { timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { HttpError } from "../../errors.js";
import { approveCash, listCashRequests, rejectCash } from "./service.js";

export const adminRouter = Router();

// Only the operator may approve cash, so every /admin route needs the admin token.
// Constant-time compare, same idea as the webhook signature check.
const requireAdmin: RequestHandler = (req, _res, next) => {
  const given = Buffer.from(req.header("X-Admin-Token") ?? "");
  const expected = Buffer.from(config.adminToken);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new HttpError(401, "UNAUTHORIZED", "Wrong or missing admin token");
  }
  next();
};

const idSchema = z.string().uuid();

adminRouter.get("/admin/cash-requests", requireAdmin, async (_req, res) => {
  res.json(await listCashRequests());
});

adminRouter.post("/admin/orders/:id/approve-cash", requireAdmin, async (req, res) => {
  res.json(await approveCash(idSchema.parse(req.params.id)));
});

adminRouter.post("/admin/orders/:id/reject-cash", requireAdmin, async (req, res) => {
  res.json(await rejectCash(idSchema.parse(req.params.id)));
});
