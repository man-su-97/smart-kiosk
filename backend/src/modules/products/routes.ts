import { Router } from "express";
import { pool } from "../../db/db.js";
import { listProducts } from "./service.js";

export const productsRouter = Router();

// Public kiosk list: cost price stays private.
productsRouter.get("/products", async (_req, res) => {
  const products = await listProducts(pool);
  res.json(products.map(({ costPaise, active, ...product }) => product));
});
