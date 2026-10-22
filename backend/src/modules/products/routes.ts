import { Router } from "express";
import { pool } from "../../db/db.js";
import { listProducts } from "./service.js";

export const productsRouter = Router();

productsRouter.get("/products", async (_req, res) => {
  res.json(await listProducts(pool));
});
