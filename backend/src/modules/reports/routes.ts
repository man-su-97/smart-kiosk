import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../../auth.js";
import { byCategory, daily, needsAttention, summary, topProducts } from "./service.js";
import { writeDailyReport } from "./pdf.js";

// Analytics and reports: admins only.
export const reportsRouter = Router();

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "not a real date");

const DAY_MS = 24 * 60 * 60 * 1000;
const rangeSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.from <= r.to, "from must not be after to")
  .refine((r) => Date.parse(r.to) - Date.parse(r.from) <= 366 * DAY_MS, "at most 366 days");

reportsRouter.get("/admin/analytics/summary", requireRole("admin"), async (req, res) => {
  res.json(await summary(rangeSchema.parse(req.query)));
});

reportsRouter.get("/admin/analytics/daily", requireRole("admin"), async (req, res) => {
  res.json(await daily(rangeSchema.parse(req.query)));
});

reportsRouter.get("/admin/analytics/categories", requireRole("admin"), async (req, res) => {
  res.json(await byCategory(rangeSchema.parse(req.query)));
});

reportsRouter.get("/admin/analytics/top-products", requireRole("admin"), async (req, res) => {
  res.json(await topProducts(rangeSchema.parse(req.query)));
});

reportsRouter.get("/admin/attention", requireRole("admin"), async (_req, res) => {
  res.json(await needsAttention());
});

reportsRouter.get("/admin/reports/daily-pdf", requireRole("admin"), async (req, res) => {
  const { date } = z.object({ date: isoDate }).parse(req.query);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="sales-${date}.pdf"`);
  await writeDailyReport(date, res);
});
