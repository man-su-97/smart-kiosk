import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { migrate, pool } from "../src/db/db.js";
import { sign } from "../src/modules/payments/signature.js";
import { createUser, type Role } from "../src/modules/auth/service.js";

let server: Server;
let serverUrl: string;

export async function startApp() {
  await migrate();
  server = createApp().listen(0);
  serverUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
}

export const baseUrl = () => serverUrl;

export async function stopApp() {
  server.close();
  await pool.end();
}

// Empty every table so each test starts clean.
export async function resetDb() {
  await pool.query(
    "TRUNCATE payment_events, order_items, orders, products, sessions, kiosk_shifts, kiosks, images, users RESTART IDENTITY CASCADE",
  );
}

export async function addProduct(stock: number, pricePaise = 1000) {
  const { rows } = await pool.query(
    "INSERT INTO products (name, price_paise, stock) VALUES ('Test snack', $1, $2) RETURNING id",
    [pricePaise, stock],
  );
  return rows[0].id as number;
}

export async function getStock(productId: number) {
  const { rows } = await pool.query("SELECT stock FROM products WHERE id = $1", [productId]);
  return rows[0].stock as number;
}

export async function getOrderStatus(orderId: string) {
  const { rows } = await pool.query("SELECT status FROM orders WHERE id = $1", [orderId]);
  return rows[0].status as string;
}

export function placeOrder(productId: number, quantity: number) {
  return fetch(`${serverUrl}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ productId, quantity }] }),
  });
}

export function getProducts() {
  return fetch(`${serverUrl}/products`).then((r) => r.json() as Promise<any[]>);
}

export function claim(orderId: string) {
  // The locker proves who it is with its key (LOCKER_KEY in vitest.config.ts).
  return fetch(`${serverUrl}/orders/${orderId}/pickup-claim`, { method: "POST", headers: { "X-Locker-Key": process.env.LOCKER_KEY! } });
}

export function sendWebhook(
  event: { eventId: string; orderId: string; amountPaise: number; status?: string },
  signature?: string,
) {
  const body = JSON.stringify({ status: "captured", ...event });
  return fetch(`${serverUrl}/payments/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signature ?? sign(body, process.env.WEBHOOK_SECRET!),
    },
    body,
  });
}

// Create an order and pay it, returning its id.
export async function createPaidOrder(productId: number, quantity: number, totalPaise: number) {
  const order = await placeOrder(productId, quantity).then((r) => r.json());
  await sendWebhook({ eventId: `evt_${order.id}`, orderId: order.id, amountPaise: totalPaise });
  return order.id as string;
}

// Pretend the 120s hold ran out, without waiting.
export async function expireOrder(orderId: string) {
  await pool.query("UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = $1", [orderId]);
}

export const PASSWORD = "correct-horse-1";

// Create a user and log in. Returns the headers to send (the session cookie) and the user.
export async function loginAs(role: Role, email = `${role}@test.local`) {
  const user = await createUser(email, PASSWORD, role);
  const res = await fetch(`${serverUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const cookie = res.headers.get("set-cookie")!.split(";")[0]; // "sid=<token>"
  return { headers: { Cookie: cookie }, user };
}

// Small JSON request helper for the admin tests.
export function api(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return fetch(`${serverUrl}${path}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}
