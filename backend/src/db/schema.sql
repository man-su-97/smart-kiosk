-- Money is always stored as whole paise (INTEGER). No floats anywhere.

CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  name        TEXT    NOT NULL,
  price_paise INTEGER NOT NULL CHECK (price_paise > 0),
  -- Units physically in the machine. Only goes down when a customer picks up.
  stock       INTEGER NOT NULL CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status        TEXT NOT NULL,
  total_paise   INTEGER NOT NULL CHECK (total_paise > 0),
  expires_at    TIMESTAMPTZ NOT NULL,
  review_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at       TIMESTAMPTZ,
  claimed_at    TIMESTAMPTZ
);

-- Allowed statuses. Dropped and re-added on every start so older databases pick up new statuses.
--   pending               unpaid, stock held for 120 s
--   pending_cash_approval customer asked to pay cash, waiting for the operator (still held)
--   paid / claimed        paid / picked up from the locker
--   expired               hold ran out        cancelled  operator rejected the cash request
--   needs_review          money arrived but something is wrong, a person must look
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN
  ('pending', 'pending_cash_approval', 'paid', 'expired', 'cancelled', 'needs_review', 'claimed'));

CREATE TABLE IF NOT EXISTS order_items (
  order_id         UUID    NOT NULL REFERENCES orders(id),
  product_id       INTEGER NOT NULL REFERENCES products(id),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  -- Price at the time of ordering, so later price changes don't alter old orders.
  unit_price_paise INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

-- One row per webhook event we have processed. The PRIMARY KEY is what makes
-- processing the same event twice impossible.
CREATE TABLE IF NOT EXISTS payment_events (
  event_id     TEXT PRIMARY KEY,
  order_id     UUID NOT NULL,
  status       TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Admin portal (all idempotent: this file runs on every start).

-- Catalog details. "Deleting" a product hides it (active = false): old orders still point at it.
ALTER TABLE products ADD COLUMN IF NOT EXISTS category   TEXT    NOT NULL DEFAULT 'snacks';
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url  TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_paise INTEGER NOT NULL DEFAULT 0 CHECK (cost_paise >= 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS active     BOOLEAN NOT NULL DEFAULT true;

-- Cost at the time of ordering (like unit_price_paise), so later cost changes don't rewrite past profit.
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost_paise INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per logged-in browser. Only the SHA-256 of the cookie value is stored,
-- so reading this table does not let anyone log in.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Where each payment came from and what it did. Cash approvals are logged here
-- (source = 'cash', operator_id = staff user) in the same transaction as the payment.
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS source      TEXT NOT NULL DEFAULT 'webhook';
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS operator_id INTEGER REFERENCES users(id);
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS outcome     TEXT;

-- ---------------------------------------------------------------------------
-- Smart image upload: every product photo is stored here already cropped to the same
-- 512 x 512 square (WebP), so all product cards look alike. Kept in the database so it
-- survives redeploys on hosts with a temporary disk.
CREATE TABLE IF NOT EXISTS images (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data            BYTEA NOT NULL,
  content_type    TEXT NOT NULL,
  original_width  INTEGER NOT NULL,
  original_height INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Display name for people (shown on reports instead of the email).
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;

-- Kiosks (machines / counters).
CREATE TABLE IF NOT EXISTS kiosks (
  id       SERIAL PRIMARY KEY,
  code     TEXT NOT NULL UNIQUE,
  name     TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  active   BOOLEAN NOT NULL DEFAULT true
);
-- CREATE TABLE IF NOT EXISTS never adds columns to an existing table, so list later columns again.
ALTER TABLE kiosks ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- Duty roster: which staff member looks after which kiosk, and when.
-- The two EXCLUDE constraints make the database itself refuse overlapping shifts, even when two
-- admins save at the same moment: one person per kiosk at a time, and nobody at two kiosks at once.
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- lets "=" and "overlaps" be combined in one constraint
CREATE TABLE IF NOT EXISTS kiosk_shifts (
  id        SERIAL PRIMARY KEY,
  kiosk_id  INTEGER NOT NULL REFERENCES kiosks(id),
  user_id   INTEGER NOT NULL REFERENCES users(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at   TIMESTAMPTZ NOT NULL,
  note      TEXT NOT NULL DEFAULT '',
  CHECK (ends_at > starts_at),
  CONSTRAINT one_staff_per_kiosk_at_a_time
    EXCLUDE USING gist (kiosk_id WITH =, tstzrange(starts_at, ends_at) WITH &&),
  CONSTRAINT one_kiosk_per_staff_at_a_time
    EXCLUDE USING gist (user_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
);

-- Which kiosk an order came from, and who was on duty there at the time
-- (a snapshot, so changing the roster later does not change old bills).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS kiosk_id      INTEGER REFERENCES kiosks(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS agent_user_id INTEGER REFERENCES users(id);

-- Human-friendly bill number (BILL-000123). Created step by step instead of BIGSERIAL so the
-- statements stay safe to run on every start; existing orders get numbers in creation order.
CREATE SEQUENCE IF NOT EXISTS orders_bill_no_seq;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bill_no BIGINT;
ALTER TABLE orders ALTER COLUMN bill_no SET DEFAULT nextval('orders_bill_no_seq');
ALTER SEQUENCE orders_bill_no_seq OWNED BY orders.bill_no;
WITH base AS (SELECT COALESCE(MAX(bill_no), 0) AS last FROM orders),
     todo AS (SELECT id, row_number() OVER (ORDER BY created_at) AS n FROM orders WHERE bill_no IS NULL)
UPDATE orders SET bill_no = base.last + todo.n FROM base, todo WHERE orders.id = todo.id;
SELECT setval('orders_bill_no_seq', COALESCE((SELECT MAX(bill_no) FROM orders), 0) + 1, false); -- next number
CREATE UNIQUE INDEX IF NOT EXISTS orders_bill_no_key ON orders (bill_no);

-- ---------------------------------------------------------------------------
-- Abuse and cash-handling protections.
-- Who placed the order (IP), so one client cannot hold all the stock.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_ip TEXT;
CREATE INDEX IF NOT EXISTS orders_open_holds_by_client ON orders (client_ip) WHERE status IN ('pending', 'pending_cash_approval');
-- When the customer chose cash (lets staff still approve cash handed over just before the hold ran out).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_requested_at TIMESTAMPTZ;
