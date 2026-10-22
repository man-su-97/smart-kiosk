# Pickup Counter

A self-service snack counter: pick items, pay by UPI (simulated), collect from a locker.
TypeScript everywhere. Express + raw `pg` (no ORM), PostgreSQL, React (Vite).

## Run it

```bash
docker compose up --build
```

- Customer screen: http://localhost:5173
- Operator dashboard: http://localhost:5173/admin (token: `demo-admin-token`, from `ADMIN_TOKEN` in docker-compose)
- Mock UPI page (what the QR opens on a phone): http://localhost:5173/mock-pay?orderId=<id>
- API: http://localhost:3000

| Endpoint | Purpose |
|---|---|
| `GET /products` | products with `available` units |
| `POST /orders`, `GET /orders/:id` | place an order (holds stock 120 s) / poll its status |
| `POST /payments/webhook` | the payment provider's signed webhook (HMAC) |
| `POST /orders/:id/pickup-claim` | locker claims a paid order (exactly one wins) |
| `POST /orders/:id/cash-request` | customer chose cash → `pending_cash_approval` |
| `GET /admin/cash-requests`, `POST /admin/orders/:id/approve-cash` / `reject-cash` | operator, needs `X-Admin-Token` |
| `POST /payments/mock-success` | demo UPI payment, only when `ENABLE_PAYMENT_SIMULATOR=true` |

To scan the QR with a real phone, open the kiosk via your computer's LAN address (e.g. `http://192.168.1.20:5173`) so the
link in the QR is reachable from the phone. With `localhost` the QR points at the phone itself.

Try the whole flow:

1. Open the screen, add items, press **Place order**.
2. Simulate the payment provider (the order id and amount are shown on the payment screen):
   ```bash
   cd backend && npm install   # once, if you are not running inside Docker
   npm run send-webhook -- <orderId> <amountPaise>
   ```
   The screen flips to "Payment received". Sending the same command with the same `eventId`
   (3rd argument) again changes nothing.
3. Pick up from the "locker": `curl -X POST localhost:3000/orders/<orderId>/pickup-claim`
   (a second call returns 409).

`send-webhook` usage: `npm run send-webhook -- <orderId> <amountPaise> [eventId] [status]`.
The signing secret is `WEBHOOK_SECRET` (default `dev-webhook-secret`, same as in docker-compose).

## Run the tests

Tests use a **real PostgreSQL** database (`pickup_test`, created automatically by `docker compose`).

```bash
docker compose up -d db
cd backend && npm install && npm test
```

Set `TEST_DATABASE_URL` to use a different database. What they prove:

| Test file | What it proves |
|---|---|
| `orders.test.ts` | 10 simultaneous buyers for the last 2 units → exactly 2 succeed, 8 get 409, `available` ends at 0. A too-large order holds nothing. Expired hold frees stock. A repeated-race test (20 buyers × 15 rounds) fails if the row lock is removed. |
| `webhook.test.ts` | Bad signature → 401. Same event twice (and 5× at once) → processed once. Wrong amount → `needs_review`. Late payment cases. |
| `pickup.test.ts` | 2 (and 10) simultaneous claims → exactly one 200, the rest 409, stock reduced once. Unpaid/expired → 409. |
| `cash-and-mock-upi.test.ts` | Mock UPI pays once and is 404 when the simulator is off. Cash request keeps the hold; admin needs the token; approve → paid (two operators at once → paid once); reject → cancelled and stock released; a payment for a cancelled order re-checks stock (never oversells). |

### Browser (end-to-end) tests

Playwright drives the real screen against the running stack (webhooks are signed by the test itself):

```bash
docker compose up -d --build     # whole app
cd e2e && npm install && npx playwright install chromium && npm test
```

From the repo root, `npm run test:e2e` and `npm run test:backend` are shortcuts for the two suites.
**Note:** the e2e run first resets orders and stock in the running app's database (`e2e/global-setup.ts`), because the tests
buy and pick up real stock. Do not point it at data you care about.

### The screen

- **Choose:** product cards with SVG illustrations (`ProductIcon.tsx`) and green/orange/red stock badges. Adding an item shows an
  "added" toast and bumps a floating cart pill; the pill opens a cart drawer (`CartDrawer.tsx`) to review and edit the cart.
- **Pay:** order summary + a countdown badge, and a UPI / Cash toggle.
  - **UPI:** a QR (`qrcode.react`) linking to our own **mock UPI page** (`/mock-pay?orderId=…`, `MockPayPage.tsx`), plus a
    **Simulate UPI Payment Success** button and the copyable `send-webhook` command for testing without a phone.
  - **Cash:** "Pay with Cash" moves the order to `pending_cash_approval`; the kiosk shows "please pay at the counter,
    awaiting operator approval" until the operator approves or rejects on `/admin` (`AdminPage.tsx`).
- **Collect:** once paid, a CSS-only animation opens the locker door and slides the order out (`LockerAnimation.tsx`).
- `prefers-reduced-motion` turns the animations off.

### Payment simulation and cash approval (decisions to be aware of)

- **Why the QR is not a real `upi://` link:** a real link opens GPay/PhonePe, which need a real merchant and PIN and can never
  call back to a demo server. So the QR opens a mock UPI page; its button calls `POST /payments/mock-success`.
- **One payment path:** mock UPI and approved cash both become a normal captured event for the order's full total
  (`payInternally` → `processWebhook`): same row lock, same idempotency (event id `mockupi_<order>` / `cash_<order>`), same
  late-payment rule. The amount always comes from the database; the QR link carries only the order id.
- **Not an open door:** `/payments/mock-success` only works when `ENABLE_PAYMENT_SIMULATOR=true` (demo and tests; 404
  otherwise). Admin endpoints need `X-Admin-Token`, compared in constant time; the kiosk never knows it.
- **Cash keeps the same 120 s hold.** An unpaid hold should not last forever. If the operator approves after it ran out,
  the late-payment rule decides (paid if units are still free, otherwise `needs_review`).
- **Reject = `cancelled`**, which releases the units. If money then still arrives (e.g. by UPI), the stock is re-checked
  exactly like a late payment, so a cancelled order can never oversell.
- New statuses: `pending_cash_approval` (counts as held while inside the window) and `cancelled` (not held).

### Browser tests cover

Product list with illustrations and badges; toast, cart pill and drawer editing; order → QR + countdown → paid → locker
animation → pickup (second claim 409); mock UPI page on a second "phone" tab; the Simulate button; cash → operator approves on `/admin` → locker; cash rejected →
declined + stock back; wrong admin token refused; countdown with the browser clock set 10 minutes ahead; expired hold
message + stock released; wrong amount → needs-review message; cart cap. The frontend never reads `Date`, so the clock-skew
test confirms the countdown is unaffected by it.

## How it works (the important parts)

**Stock.** `products.stock` is what is physically in the machine; it only goes down at pickup.
`available = stock − held`, where *held* = units in unpaid orders still inside their 120 s
window + units in paid orders not yet picked up (`getHeldUnits` in `modules/products/service.ts`).
Nothing is "released" by a job: an expired order simply stops matching the `expires_at > clock_timestamp()` filter.
A small job (every 5 s) also writes `status = 'expired'` so the table looks right.

**No overselling.** `createOrder` runs in one transaction: `SELECT … FROM products WHERE id = ANY(…) ORDER BY id FOR UPDATE`
locks the product rows, then counts held units, then inserts. A competing buyer waits on the lock and
afterwards sees our hold. Ids are sorted so two transactions never lock in opposite order (no deadlock).
If anything is short we throw and the transaction rolls back, so nothing is held.

**Webhook.** The route uses `express.raw` so the HMAC-SHA256 is checked on the exact bytes received,
compared with `crypto.timingSafeEqual`. Idempotency: the first thing the transaction does is
`INSERT INTO payment_events (event_id …) ON CONFLICT DO NOTHING`; zero rows inserted means "seen before" → do nothing.
Two copies arriving at the same instant are serialised by the primary key. The order row is then locked with `FOR UPDATE`.
Wrong amount → `needs_review`.

**Pickup.** `UPDATE orders SET status='claimed' WHERE id=$1 AND status='paid'`. Postgres lets only one
transaction change the row; the other re-checks, matches 0 rows, and gets 409. Stock is decremented in the same transaction.

**Countdown / wrong clocks.** The server returns `expiresInSeconds` computed with the *database* clock when the
response is built. The browser counts that number down with `performance.now()` (elapsed time, independent of the
wall-clock setting) in `frontend/src/useCountdown.ts`. Each poll (every 2 s) restarts it with a fresh server value.
The browser's date/time is never read. Small error: network delay (a fraction of a second) is not subtracted.

## Decision: payment arrives after the hold expired

Chosen behaviour: **re-check the stock at that moment.**

- Units are still free → accept the payment, order becomes `paid`. The customer really paid and nobody was harmed, so we honour it.
- Units were taken by someone else → order becomes `needs_review` (`review_reason = LATE_PAYMENT_STOCK_GONE`).
  We never oversell; the money is flagged for a human to refund.

Why: automatically refusing a real payment that we could fulfil is a bad customer outcome, and
fulfilling one we cannot would break the "never sold twice" rule. This is the choice that avoids both.
Trade-off: a late payer can "win" units that were released, as long as nobody else bought them yet.

## Other decisions and assumptions

- Money: integer paise only; the UI formats rupees at the very last step. Totals are computed on the server from DB prices.
- `POST /orders` accepts `{ "items": [{productId, quantity}] }` or a bare array. Duplicate product lines are merged.
- Stock errors return **409** `INSUFFICIENT_STOCK` with per-product `requested`/`available`.
- A valid signed webhook always returns 200, including repeats, so a real provider would stop retrying.
  Unknown order ids are recorded and ignored. Non-`captured` statuses are recorded and ignored.
- Pickup: unknown order → 404; unpaid / expired / needs_review / already claimed → 409.
- No authentication on the locker endpoint, no refunds, a single API instance (the expiry job is per instance, but harmless if repeated).
- The web container runs the Vite dev server with a proxy (`/api` → API) to keep the setup simple.

## What I would do next

- A refund/resolution flow and an admin view for `needs_review` orders.
- Authenticate lockers; rate-limit and log webhook failures.
- Run the same concurrency tests against more parallel API instances.
- Build the frontend for production (static files) instead of the dev server.
- Component tests for the countdown (fake timers, shifted system clock).

## How I checked it

Automated tests above (real Postgres, 27 tests, 13 browser tests) plus the manual flow in "Run it" (order → webhook → repeat webhook → two parallel claims returned 200 and 409).
I also checked the tests can fail: removing `FOR UPDATE` from `createOrder` makes the stock tests fail (orders oversold). See `AI_NOTES.md` for the AI usage notes.
