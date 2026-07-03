CREATE TYPE surcharge_type AS ENUM ('BAF', 'CAF', 'PSS', 'FSC', 'OTHER');

CREATE TABLE order_surcharges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type        surcharge_type NOT NULL DEFAULT 'OTHER',
  label       TEXT NOT NULL,
  amount_usd  DECIMAL(10, 2) NOT NULL CHECK (amount_usd >= 0),
  notes       TEXT,
  added_by    UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX order_surcharges_order_id_idx ON order_surcharges(order_id);
