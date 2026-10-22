import { Router } from "express";
import { z } from "zod";
import { createOrder, getOrder, claimPickup } from "./service.js";

export const ordersRouter = Router();

const itemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(50),
});
const createOrderSchema = z.object({ items: z.array(itemSchema).min(1) });
const idSchema = z.string().uuid();

ordersRouter.post("/orders", async (req, res) => {
  // Accept either [{productId, quantity}] or { items: [...] }.
  const body = Array.isArray(req.body) ? { items: req.body } : req.body;
  const { items } = createOrderSchema.parse(body);
  res.status(201).json(await createOrder(items));
});

ordersRouter.get("/orders/:id", async (req, res) => {
  res.json(await getOrder(idSchema.parse(req.params.id)));
});

ordersRouter.post("/orders/:id/pickup-claim", async (req, res) => {
  res.json(await claimPickup(idSchema.parse(req.params.id)));
});
