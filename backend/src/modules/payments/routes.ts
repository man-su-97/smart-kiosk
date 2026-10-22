import express, { Router } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { HttpError } from "../../errors.js";
import { isValidSignature } from "./signature.js";
import { payInternally, processWebhook } from "./service.js";

export const paymentsRouter = Router();

// Bounds match the database columns, so a strange payload is a clean 400 instead of a
// Postgres error (500) that the provider would keep retrying forever.
const webhookSchema = z.object({
  eventId: z.string().min(1).max(128),
  orderId: z.string().uuid(),
  amountPaise: z.number().int().min(0).max(2_147_483_647), // Postgres INTEGER limit
  status: z.enum(["captured", "failed", "pending", "refunded"]),
});

// Mock UPI: the phone page opened from the QR code (or the "Simulate" button) calls this.
// Demo only: off unless ENABLE_PAYMENT_SIMULATOR=true. Body: { "orderId": "<uuid>" }.
paymentsRouter.post("/payments/mock-success", express.json(), async (req, res) => {
  if (!config.paymentSimulator) throw new HttpError(404, "SIMULATOR_DISABLED", "Payment simulator is disabled");
  const { orderId } = z.object({ orderId: z.string().uuid() }).parse(req.body);
  res.json({ result: await payInternally(orderId, "mockupi") });
});

// express.raw keeps the body as untouched bytes. The signature is computed over
// those exact bytes, so we must not let express.json() re-parse them first.
paymentsRouter.post(
  "/payments/webhook",
  express.raw({ type: "*/*" }),
  async (req, res) => {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (!isValidSignature(rawBody, req.header("X-Signature"), config.webhookSecret)) {
      throw new HttpError(401, "INVALID_SIGNATURE", "Signature does not match");
    }

    const event = webhookSchema.parse(JSON.parse(rawBody.toString("utf8")));
    const result = await processWebhook(event);
    // Always 200 for a valid signed event (including repeats) so the provider stops retrying.
    res.json({ result });
  },
);
