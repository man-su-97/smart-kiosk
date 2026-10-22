import { timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { HttpError } from "../../errors.js";
import { createOrder, getOrder, claimPickup, requestCash } from "./service.js";

export const ordersRouter = Router();

const itemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(50),
});
const createOrderSchema = z.object({
  items: z.array(itemSchema).min(1),
  kioskCode: z.string().trim().min(1).max(30).optional(), // which kiosk is selling (optional)
});
const idSchema = z.string().uuid();

ordersRouter.post("/orders", async (req, res) => {
  // Accept either [{productId, quantity}] or { items: [...] }.
  const body = Array.isArray(req.body) ? { items: req.body } : req.body;
  const { items, kioskCode } = createOrderSchema.parse(body);
  res.status(201).json(await createOrder(items, kioskCode, req.ip ?? "unknown"));
});

ordersRouter.get("/orders/:id", async (req, res) => {
  res.json(await getOrder(idSchema.parse(req.params.id)));
});

// Only JSON requests: a hidden form on another website can send form data with the customer's
// browser, but not JSON (that needs permission from this server), so it cannot switch orders to cash.
ordersRouter.post("/orders/:id/cash-request", async (req, res) => {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new HttpError(415, "JSON_REQUIRED", "Send this request as JSON");
  }
  res.json(await requestCash(idSchema.parse(req.params.id)));
});

// The locker controller proves who it is with a shared key (X-Locker-Key). Without this, anyone who
// saw an order id (it is on the customer's screen) could open that locker. Constant-time compare.
const requireLocker: RequestHandler = (req, _res, next) => {
  const given = Buffer.from(req.header("X-Locker-Key") ?? "");
  const expected = Buffer.from(config.lockerKey);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new HttpError(401, "LOCKER_KEY_REQUIRED", "Only the locker can claim an order");
  }
  next();
};

ordersRouter.post("/orders/:id/pickup-claim", requireLocker, async (req, res) => {
  res.json(await claimPickup(idSchema.parse(req.params.id)));
});
