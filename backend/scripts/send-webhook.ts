// Usage: npm run send-webhook -- <orderId> <amountPaise> [eventId] [status]
// Sends a correctly signed webhook, like the payment provider would.
import { randomUUID } from "node:crypto";
import { sign } from "../src/modules/payments/signature.js";

const [orderId, amount, eventId = `evt_${randomUUID()}`, status = "captured"] = process.argv.slice(2);
if (!orderId || !amount) {
  console.error("Usage: npm run send-webhook -- <orderId> <amountPaise> [eventId] [status]");
  process.exit(1);
}

const secret = process.env.WEBHOOK_SECRET ?? "dev-webhook-secret";
const url = process.env.API_URL ?? "http://localhost:3000";

const body = JSON.stringify({ eventId, orderId, amountPaise: Number(amount), status });
const res = await fetch(`${url}/payments/webhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Signature": sign(body, secret) },
  body,
});
console.log(res.status, await res.text());
