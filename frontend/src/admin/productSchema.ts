import { z } from "zod";

// Same rules as the server (backend/src/modules/catalog/routes.ts), so the form can show errors
// before saving. Kept in sync by hand: the backend and frontend are built separately.
// The server checks again anyway; this is only for a friendlier form.
export const productSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(60),
    pricePaise: z.number().int().min(1, "Price must be above ₹0").max(10_000_000),
    costPaise: z.number().int().min(0).max(10_000_000),
    stock: z.number().int().min(0, "Stock cannot be negative").max(10_000),
    category: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Category is required")
      .max(30)
      .regex(/^[a-z0-9 -]+$/, "Letters, numbers, spaces and dashes only"),
    // Set by the image picker after the smart upload (always one of our own 512 x 512 images).
    imageUrl: z.string().regex(/^\/api\/images\/[0-9a-f-]{36}$/, "Use the image picker").nullable(),
    active: z.boolean(),
  })
  .refine((p) => p.pricePaise < 1 || p.costPaise <= p.pricePaise, { message: "Cost cannot be higher than the price", path: ["costPaise"] });

export type ProductForm = z.infer<typeof productSchema>;
