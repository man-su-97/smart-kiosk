import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../../auth.js";
import { approveCash, listCashRequests, rejectCash } from "./service.js";

// Cash queue: staff (and admins) only.
export const adminRouter = Router();

const idSchema = z.string().uuid();

adminRouter.get("/admin/cash-requests", requireRole("staff"), async (_req, res) => {
  res.json(await listCashRequests());
});

adminRouter.post("/admin/orders/:id/approve-cash", requireRole("staff"), async (req, res) => {
  res.json(await approveCash(idSchema.parse(req.params.id), req.user!.id));
});

adminRouter.post("/admin/orders/:id/reject-cash", requireRole("staff"), async (req, res) => {
  res.json(await rejectCash(idSchema.parse(req.params.id)));
});
