import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../../auth.js";
import { createProduct, listAllProducts, updateProduct } from "./service.js";

// Product management: admins only.
export const catalogRouter = Router();

// Same rules as frontend/src/admin/productSchema.ts (kept in sync by hand: the two apps are
// built separately). .strict() rejects unknown fields instead of silently ignoring them.
const fields = {
  name: z.string().trim().min(1).max(60),
  pricePaise: z.number().int().min(1).max(10_000_000),
  costPaise: z.number().int().min(0).max(10_000_000),
  stock: z.number().int().min(0).max(10_000),
  category: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(30)
    .regex(/^[a-z0-9 -]+$/, "letters, numbers, spaces and dashes only"),
  imageUrl: z.string().trim().url().max(500).startsWith("https://", "must be an https:// URL").nullable(),
  active: z.boolean(),
};

const createSchema = z
  .object({ ...fields, costPaise: fields.costPaise.default(0), imageUrl: fields.imageUrl.default(null), active: fields.active.default(true) })
  .strict()
  .refine((p) => p.pricePaise < 1 || p.costPaise <= p.pricePaise, { message: "Cost cannot be higher than the price", path: ["costPaise"] });

const updateSchema = z.object(fields).partial().strict();
const idSchema = z.coerce.number().int().positive();

catalogRouter.get("/admin/products", requireRole("admin"), async (_req, res) => {
  res.json(await listAllProducts());
});

catalogRouter.post("/admin/products", requireRole("admin"), async (req, res) => {
  res.status(201).json(await createProduct(createSchema.parse(req.body)));
});

// Also used to hide/show a product ({ "active": false }).
catalogRouter.patch("/admin/products/:id", requireRole("admin"), async (req, res) => {
  res.json(await updateProduct(idSchema.parse(req.params.id), updateSchema.parse(req.body)));
});
