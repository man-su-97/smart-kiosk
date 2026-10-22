import express, { Router } from "express";
import { z } from "zod";
import { config } from "../../config.js";
import { HttpError } from "../../errors.js";
import { isValidSignature } from "./signature.js";
import { processWebhook } from "./service.js";

export const paymentsRouter = Router();

const eventSchema = z.object({
  eventId: z.string().min(1),
  orderId: z.string().uuid(),
  amountPaise: z.number().int(),
  status: z.string(),
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

    const event = eventSchema.parse(JSON.parse(rawBody.toString("utf8")));
    const result = await processWebhook(event);
    // Always 200 for a valid signed event (including repeats) so the provider stops retrying.
    res.json({ result });
  },
);
