ALTER TABLE orders
  ADD COLUMN pickup_pin_hash TEXT,
  ADD COLUMN pickup_pin_sent_at TIMESTAMPTZ,
  ADD COLUMN pickup_collector_name TEXT,
  ADD COLUMN pickup_collector_relationship TEXT,
  ADD COLUMN picked_up_at TIMESTAMPTZ;
