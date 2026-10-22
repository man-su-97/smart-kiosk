import express, { type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "./errors.js";
import { productsRouter } from "./modules/products/routes.js";
import { ordersRouter } from "./modules/orders/routes.js";
import { paymentsRouter } from "./modules/payments/routes.js";
import { adminRouter } from "./modules/admin/routes.js";

export function createApp() {
  const app = express();

  // Payments first: it needs the raw body, so it must run before express.json().
  app.use(paymentsRouter);
  app.use(express.json());
  app.use(productsRouter);
  app.use(ordersRouter);
  app.use(adminRouter);

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    } else if (err instanceof ZodError || err instanceof SyntaxError) {
      res.status(400).json({ error: "BAD_REQUEST", message: "Invalid request body" });
    } else {
      console.error(err);
      res.status(500).json({ error: "INTERNAL", message: "Something went wrong" });
    }
  };
  app.use(errorHandler);

  return app;
}
