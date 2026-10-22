import path from "node:path";
import express, { type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { config } from "./config.js";
import { HttpError } from "./errors.js";
import { productsRouter } from "./modules/products/routes.js";
import { ordersRouter } from "./modules/orders/routes.js";
import { paymentsRouter } from "./modules/payments/routes.js";
import { adminRouter } from "./modules/admin/routes.js";

export function createApp() {
  const app = express();

  // The browser calls /api/products etc. Locally the Vite dev server strips /api; in the deployed
  // single service there is no Vite, so strip it here. Plain /products keeps working too.
  app.use((req, _res, next) => {
    if (req.url.startsWith("/api/")) req.url = req.url.slice("/api".length);
    next();
  });

  // Payments first: it needs the raw body, so it must run before express.json().
  app.use(paymentsRouter);
  app.use(express.json());
  app.use(productsRouter);
  app.use(ordersRouter);
  app.use(adminRouter);

  // Deployed: also serve the built React app (STATIC_DIR) from the same address. Any other
  // GET (/, /admin, /mock-pay) gets index.html and React picks the page from the URL.
  if (config.staticDir) {
    const staticDir = config.staticDir;
    app.use(express.static(staticDir));
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }

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
