import { createHmac } from "node:crypto";
import pg from "pg";

const API = "http://localhost:3000";
const SECRET = process.env.WEBHOOK_SECRET ?? "dev-webhook-secret";

// Same thing the payment provider does: sign the raw body with the shared secret.
export async function sendWebhook(orderId: string, amountPaise: number, eventId = `evt_${Date.now()}_${Math.random()}`) {
  const body = JSON.stringify({ eventId, orderId, amountPaise, status: "captured" });
  const signature = createHmac("sha256", SECRET).update(body).digest("hex");
  return fetch(`${API}/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Signature": signature },
    body,
  });
}

// Pretend the 120s hold ran out, without waiting two minutes.
export async function expireOrder(orderId: string) {
  const db = new pg.Client({ connectionString: "postgres://postgres:postgres@localhost:5432/pickup" });
  await db.connect();
  await db.query("UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = $1", [orderId]);
  await db.end();
}

export const getProducts = () => fetch(`${API}/products`).then((r) => r.json() as Promise<any[]>);
export const claimPickup = (orderId: string) => fetch(`${API}/orders/${orderId}/pickup-claim`, { method: "POST" });
