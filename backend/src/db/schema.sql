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
  status        TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'expired', 'needs_review', 'claimed')),
  total_paise   INTEGER NOT NULL CHECK (total_paise > 0),
  expires_at    TIMESTAMPTZ NOT NULL,
  review_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at       TIMESTAMPTZ,
  claimed_at    TIMESTAMPTZ
);

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
