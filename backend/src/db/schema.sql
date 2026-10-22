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
