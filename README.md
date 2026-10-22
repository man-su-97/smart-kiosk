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
3. Collect from the "locker": `curl -X POST -H "X-Locker-Key: dev-locker-key" localhost:3000/orders/<orderId>/pickup-claim`
   (a second call returns 409; without the locker key it is 401).

The webhook secret is `WEBHOOK_SECRET` (`dev-webhook-secret` in `docker-compose.yml`).

## Deploy (free, Render) — `deploy` branch only

One service: the root `Dockerfile` builds the React app and Express serves it together with the API under `/api`.
`render.yaml` creates that free web service plus a free Postgres, with `WEBHOOK_SECRET` and `ADMIN_PASSWORD` generated
(`NODE_ENV=production`: secure cookies, and the app refuses to start if a secret is missing).

1. Render dashboard → **New → Blueprint** → this repo, branch `deploy` → **Apply**.
2. Open the service URL. Read `WEBHOOK_SECRET` / `ADMIN_PASSWORD` under the service's **Environment** tab;
   log in at `/admin` as `admin@kiosk.local` with that password.
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
| `auth.test.ts` | Login, cookie flags, same 401 for wrong email / password, only hashes stored, logout / expiry / deactivation end the session, 429 after 10 failures, staff → 403 on admin routes. |
| `catalog.test.ts` | Product validation, create / edit / hide, hidden products cannot be ordered, stock cannot go below held units (also when an order and a stock cut race), cost snapshot. |
| `cash-log.test.ts` | Approval logs operator and amount in the same transaction; two staff at once → one payment; approve vs reject at once → never both; late approval still counted as cash. |
| `reports.test.ts` | Exact revenue / profit / units / cash for a fixed week, India-day boundary (00:30 IST), zero days, date validation, PDF download and access rules; bill register rows (number, IST time, kiosk, UPI agent vs cash collector). |
| `images.test.ts` | Any photo becomes a 512×512 WebP; the smart crop keeps the interesting part (fails with a plain centre crop); non-images, tiny and >8 MB files refused; admin only; link import refuses http, local and private addresses. |
| `staff.test.ts` | Add / deactivate staff (logged out at once), kiosks, shifts in India time, overnight shifts, overlaps refused (also 5 admins at once: exactly one saved), orders stamped with kiosk and on-duty staff. |
| `demo.test.ts` | Sample data is repeatable, replaces itself, is marked as sample, does not touch stock, and every bill names a person. |

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
  `/admin`. Rejected orders become `cancelled` and release their stock.
- Staff / admin portal at `/admin`, described below.

## Admin portal: roles, products, cash log, analytics, PDF

Local logins (from `docker-compose.yml`): **admin** `admin@kiosk.local` / `admin12345`, **staff** `staff@kiosk.local` / `staff12345`.

| Role | Can use |
|---|---|
| `staff` | Cash queue (approve / reject). |
| `admin` | Everything staff can, plus Dashboard, Products, Reports. |

- **Login** (`POST /auth/login`, `POST /auth/logout`, `GET /auth/me`): passwords hashed with bcrypt (`bcryptjs`, cost 10).
  A login creates a random 32-byte token in an `HttpOnly`, `SameSite=Strict` cookie (`sid`); the database stores only its
  SHA-256, with an 8 h expiry. Sessions live in the database, so logout or deactivating a user takes effect immediately.
  Wrong email and wrong password give the same 401. 10 failed logins per IP per 15 min → 429.
- **Roles** are checked on the server by `requireRole("staff" | "admin")` (`backend/src/auth.ts`): no session → 401,
  wrong role → 403. The UI only hides tabs.
- **Cash log**: each approval is a `payment_events` row with `source = 'cash'` and `operator_id`, written in the same
  transaction as the payment, so the log and the order can never disagree. The "is it still waiting for cash?" check is
  done after the order row is locked, so an approve and a reject at the same moment cannot both win.
  Approving twice returns `duplicate` and changes nothing (same rule as webhooks).
- **Products** (`/admin/products`, admin): create / edit / hide with strict Zod rules (whole paise, `https://` image URLs,
  cost ≤ price, unknown fields rejected), the same rules in the form. Products are hidden, never deleted (old orders point
  at them). **Stock can never be set below the units currently held by orders**: the edit locks the product row like
  `createOrder` does and refuses with 409. Each order line stores the cost at order time, so later cost changes do not
  rewrite past profit.
- **Analytics** (`/admin/analytics/summary|daily|categories|top-products?from&to`, admin): "sold" = paid or collected,
  counted on the **India (Asia/Kolkata) day** it was paid (a sale at 00:30 IST is that day, not the previous UTC day).
  Days with no sales show as 0. Cash collected counts every cash approval, even one that ended in `needs_review`
  (the money is still in the drawer).
- **Daily PDF** (`/admin/reports/daily-pdf?date=YYYY-MM-DD`, admin): `pdfkit`, built from the same functions as the
  dashboard, so the numbers match. Amounts are written "Rs." because the built-in PDF font has no ₹ sign.
- The portal (and its chart library) is loaded only on `/admin`, so the kiosk page stays small.
- **Smart image upload** (Products → product image): choose or drop a file, or paste a link to the picture. The server
  (not the browser) reads the file to check it really is an image (JPEG / PNG / WebP / GIF / AVIF, at least 200×200, at most
  8 MB), then `sharp` crops it to a **standard 512×512 WebP** with its "attention" strategy, which keeps the busiest, most
  colourful part instead of always the middle. Images are stored in Postgres (`images` table, served at
  `/api/images/:id`, cached as immutable) so they survive redeploys on hosts with a temporary disk. Products can only use
  these standardized images, so every card looks alike. Link import is **https only**, refuses local / private addresses
  (so it cannot be used to reach internal services), does not follow redirects, stops after 10 s or 8 MB, and explains
  when a link is a web page rather than a picture (e.g. a Pinterest page link).
- **Staff & duty** (admin): add staff accounts, add kiosks, and schedule **duty shifts** (kiosk, person, date, start/end in
  India time; an end before the start runs past midnight). Two `EXCLUDE` constraints in Postgres refuse overlapping shifts,
  even when two admins save at the same moment: one person per kiosk at a time, nobody at two kiosks at once.
  Deactivating a person logs them out immediately. Staff see **My duty** (their upcoming shifts) when they log in.
- **Kiosks on bills**: a kiosk screen opened as `/?kiosk=KSK-BLR-01` sends its code with each order. The order stores the
  kiosk and **who was on duty there at that moment** (a snapshot), plus a sequential bill number (`BILL-000123`).
- **Daily sales register PDF**: landscape A4, one row per bill (bill no., date, time IST, kiosk, items, qty, UPI / cash,
  agent on duty or cash collector, amount), totals, summary cards, breakdowns by payment mode, kiosk, staff (with the cash
  each person should hand over) and product, page numbers, and a proper ₹ sign (bundled DejaVu Sans font, licence in
  `backend/assets/fonts`). If the day includes sample data, the header says so.
- **Sample data for sharing**: `docker compose exec api npm run seed-demo` (or `SEED_DEMO_DATA=true` on first start)
  creates 3 Bengaluru kiosks, 4 staff, a two-week duty roster and a week of UPI / cash sales. Repeatable (fixed random
  seed), re-running replaces it, it never changes stock, and it is marked as sample (`demo_` payment ids, `.demo@` emails).
  Locally the sample staff log in with `demo12345` (e.g. `priya.demo@kiosk.local`); elsewhere they get random passwords.
- Not built: password reset, editing a shift (remove and add it again), and per-kiosk reports.

## Security & business-loss checks

`e2e/tests/loopholes.spec.ts` (Playwright) tries each of these the way a dishonest customer, staff member or outsider would,
and asserts the safe outcome; `backend/test/protections.test.ts` covers the same at API level. Before the fixes, 7 of them
succeeded (marked ✘ before). For each fix, removing it makes its test fail again.

| # | Attack (how money or stock could be lost) | Protection | Before |
|---|---|---|---|
| L1 | Pay for free through the mock UPI page | Simulator off in production unless `ALLOW_SIMULATOR_IN_PRODUCTION=true` (demo; logs a warning) | ✘ |
| L2 | Someone who saw an order id on screen opens its locker | Pickup claim needs `X-Locker-Key` (`LOCKER_KEY`), constant-time compare | ✘ |
| L3 | A script orders in a loop until everything shows "Sold out" | Per IP: max open unpaid holds (`MAX_OPEN_HOLDS_PER_CLIENT`, 5) and orders per 10 min (`MAX_ORDERS_PER_CLIENT_PER_10_MIN`, 40) → 429; a per-IP database lock makes parallel requests take turns | ✘ |
| L4 | Dodge the 50-per-product limit by repeating a line | Limit checked after lines are added up | ✘ |
| L5 | Customer pays twice (UPI + cash, or two payments): money silently kept | Recorded as `duplicate_payment`; Dashboard **Needs attention** lists it for a refund; staff get "already paid (UPI), do not take cash" | ✘ |
| L6 | Cash handed over just before the hold ends cannot be recorded (cash in drawer, no sale) | Staff can approve for `CASH_GRACE_MINUTES` (10) after expiry, marked "Late"; the late-payment rule decides; the kiosk keeps waiting and unlocks | ✘ |
| L7 | Image import used to reach internal services (incl. DNS rebinding) | https only, private addresses refused **in the same DNS lookup that connects**, no redirects, 10 s / 8 MB limits | partly |
| L8 | Customer sends their own price or total | Ignored; prices come from the database | ✔ |
| L9 | Hidden products, 0 / negative / fractional quantities | Refused | ✔ |
| L10 | Stock edited below what customers already hold | 409 | ✔ |
| L11 | Forged, replayed or underpaid webhooks | 401 / processed once / `needs_review` | ✔ |
| L12 | Staff opening admin data | 403 | ✔ |
| L13 | Two lockers, or approve + reject, at the same moment | Exactly one wins (row locks) | ✔ |
| L14 | Another website switches a customer's order to cash with a hidden form | Cash request accepts JSON only (415 otherwise) | ✘ |
| L15 | Sample data mixed into a real shop's reports | `SEED_DEMO_DATA` only fills a database with no real sales | ✘ |

Still open (known): limits are per IP (all kiosks behind one router share them, so the defaults are generous), the
login and order limits do not persist across restarts of several servers, there are no database timeouts, and
`needs_review` / "Paid twice" items are listed but have no refund button yet.

## What I would do next

- A refund / resolution flow for "Needs attention" items (today they are listed, then handled outside the app).
- Authenticate kiosk devices (so limits are per device, not per IP) and lockers per locker instead of one shared key.
- Database timeouts (connection, statement, lock).
- Tests with several API instances.

## How I checked it

- 93 backend tests and 35 browser tests pass (one browser test, L1, only runs against a production build), also from a
  fresh `docker compose down -v && docker compose up --build`, and against the production image (root `Dockerfile`,
  `NODE_ENV=production`): with the simulator opted in (demo) all pass; without the opt-in, L1 proves free payment is refused.
- The tests can fail: removing `FOR UPDATE` from `createOrder` makes the race tests fail (9 orders for 2 units), and
  the deadline test fails against the earlier webhook code. Likewise for the portal: removing the locked status check,
  the stock-vs-held rule, or the India time zone each makes its test fail.
- Manually: order → webhook → same webhook again (no change) → two parallel pickup claims (200 and 409);
  `docker compose restart db` leaves the API serving.
- How AI tools were used: see `AI_NOTES.md`.
