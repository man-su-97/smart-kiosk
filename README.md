# Pickup Counter

A self-service snack counter: pick items, pay by UPI (simulated), collect from a locker.
TypeScript throughout: Express + raw `pg` (no ORM), PostgreSQL 16, React (Vite) + Tailwind CSS.

## Run it

```bash
docker compose up --build
```

- Customer screen: http://localhost:5173
- API: http://localhost:3000

Try the flow:

1. On the screen, add items, open the cart, press **Place order**. The payment screen shows a countdown.
2. Pay by sending a signed webhook, as the provider would (order id and amount are on the payment screen):
   ```bash
   cd backend && npm install            # once
   npm run send-webhook -- <orderId> <amountPaise> [eventId] [status]
   ```
   The screen switches to "Payment Received". Repeating it with the same `eventId` changes nothing.
   The screen also has a **Simulate UPI Payment Success** button for the same thing.
3. Collect from the "locker": `curl -X POST localhost:3000/orders/<orderId>/pickup-claim` (a second call returns 409).

The webhook secret is `WEBHOOK_SECRET` (`dev-webhook-secret` in `docker-compose.yml`).

## Deploy (free, Render) — `deploy` branch only

One service: the root `Dockerfile` builds the React app and Express serves it together with the API under `/api`.
`render.yaml` creates that free web service plus a free Postgres, with `WEBHOOK_SECRET` and `ADMIN_TOKEN` generated.

1. Render dashboard → **New → Blueprint** → this repo, branch `deploy` → **Apply**.
2. Open the service URL. Read `WEBHOOK_SECRET` / `ADMIN_TOKEN` under the service's **Environment** tab.
3. Pay from your machine: `cd backend && API_URL=https://<service>.onrender.com/api WEBHOOK_SECRET=<secret> npm run send-webhook -- <orderId> <amountPaise>`

Free-plan limits: the service sleeps after 15 idle minutes (first request then takes about a minute) and the free
database expires 30 days after creation. For a longer-lived database, create a free Neon Postgres and set
`DATABASE_URL` to its connection string (with `?sslmode=require`). The demo payment simulator is on, so anyone with
an order's link can "pay" it with fake money.

## Run the tests

Backend tests run against a **real PostgreSQL** database (`pickup_test`, created by `docker compose`):

```bash
docker compose up -d db
cd backend && npm install && npm test
```

| File | Proves |
|---|---|
| `orders.test.ts` | 10 customers order the last 2 units at once → exactly 2 succeed, 8 get 409, nothing over-held. Repeated 20-buyer races. Too-large order holds nothing. Expired hold frees stock. |
| `webhook.test.ts` | Same event twice (and 5× at once) → processed once. Bad signature → 401. Wrong amount → `needs_review`. Late payments. Out-of-range payloads → 400. |
| `pickup.test.ts` | 2 (and 10) simultaneous claims → exactly one 200, the rest 409, stock reduced once. Unpaid / expired → 409. |
| `hardening.test.ts` | A webhook at the 120 s deadline cannot sell a unit twice. A connection killed mid-transaction does not crash the API. |
| `cash-and-mock-upi.test.ts` | The optional cash / mock-UPI payment paths (see "Beyond the brief"). |

Browser tests (Playwright) drive the real screen; start the app first. They reset orders and stock in the app's database.

```bash
docker compose up -d --build
cd e2e && npm install && npx playwright install chromium && npm test
```

## How correctness is kept

- **Stock.** `products.stock` only drops at pickup. `available = stock − held`, where *held* = unpaid orders still inside
  their 120 s window + paid orders not yet collected (`getHeldUnits`). An expired hold simply stops counting; a 5 s job
  also writes `status = 'expired'`.
- **No overselling.** `createOrder` is one transaction: `SELECT … FROM products WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
  count held units, insert. Competing buyers wait on the row lock and then see the new hold. Ids are sorted, so no deadlocks.
  Not enough stock → throw → rollback → nothing held, 409 `INSUFFICIENT_STOCK`.
- **Webhook.** HMAC-SHA256 checked on the raw body with `crypto.timingSafeEqual`. Idempotency: the transaction starts with
  `INSERT INTO payment_events (event_id …) ON CONFLICT DO NOTHING`; 0 rows → already processed → no change. The order row
  and its products are locked **before** the deadline is read, so a payment at 119.999 s cannot race a new order at 120.001 s.
- **Pickup.** `UPDATE orders SET status = 'claimed' WHERE id = $1 AND status = 'paid'`: only one caller can match the row,
  the other gets 409. Stock is decremented in the same transaction.
- **Countdown with a wrong clock.** The server sends `expiresInSeconds` measured with the database clock. The browser counts
  it down with `performance.now()` (elapsed time, unaffected by the clock setting) and re-syncs on every 2 s poll. It never reads the date.
- **Resilience.** The DB pool and in-use clients have error listeners (a database restart used to crash the API), a dead
  connection is destroyed instead of reused, and the API container has `restart: unless-stopped`.

## Decision: payment arrives after the hold expired

**Re-check the stock at that moment.**
- Units still free → accept, order becomes `paid`. The customer really paid and nobody loses out.
- Units already taken → `needs_review` (`LATE_PAYMENT_STOCK_GONE`); never oversell, a person refunds.

Refusing a payment we could fulfil is a bad customer outcome; fulfilling one we cannot breaks "never sold twice".
This avoids both. Trade-off: a late payer can still get released units if nobody bought them yet.

## Assumptions

- *Available* also subtracts **paid orders not yet picked up**, not only unpaid holds: stock only drops at pickup, so a
  paid-but-uncollected unit must not be sold again.
- Money is integer paise everywhere; rupees appear only on screen. Totals come from database prices, never the client.
- `POST /orders` accepts `{ "items": [...] }` or a bare array; duplicate lines are merged.
- A valid signed webhook gets 200 even when repeated, for an unknown order, or for `failed` / `pending` / `refunded`
  (recorded, no change). Malformed or out-of-range fields → 400.
- Pickup: unknown order → 404; unpaid, expired, needs_review or already claimed → 409.
- One API instance, no authentication for the kiosk or locker, no refund flow. The frontend runs on the Vite dev server
  (proxy `/api` → API) to keep `docker compose up` simple.

## Beyond the brief (optional extras)

Added after the core was done; the core does not depend on them.
- Kiosk UI: product illustrations, stock badges, cart drawer, locker-opening animation.
- UPI QR that opens a demo payment page (`/mock-pay`), and the on-screen Simulate button. Both go through the same
  payment code as the webhook. Only enabled with `ENABLE_PAYMENT_SIMULATOR=true` (on in `docker-compose.yml`).
- Cash: the customer chooses cash, the order waits as `pending_cash_approval`, and an operator approves or rejects it on
  `/admin` (token `demo-admin-token`). Rejected orders become `cancelled` and release their stock.

## What I would do next

- Refund / resolution screen for `needs_review` orders, and flag a second payment for an already-paid order.
- Let an operator approve cash that arrives just after the hold expired (today it is refused), and do the approve/reject
  status check inside the lock.
- Rate-limit `POST /orders` (a script can keep stock held) and cap total quantity per product after merging lines.
- Database timeouts (connection, statement, lock); require real secrets in production instead of dev defaults.
- Production frontend build, authentication for lockers, and tests with several API instances.

## How I checked it

- 31 backend tests and 13 browser tests pass, also from a fresh `docker compose down -v && docker compose up --build`.
- The tests can fail: removing `FOR UPDATE` from `createOrder` makes the race tests fail (9 orders for 2 units), and
  the deadline test fails against the earlier webhook code.
- Manually: order → webhook → same webhook again (no change) → two parallel pickup claims (200 and 409);
  `docker compose restart db` leaves the API serving.
- How AI tools were used: see `AI_NOTES.md`.
