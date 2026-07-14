CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'CN',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO warehouses (name, city, country)
VALUES ('Main Warehouse', 'Guangzhou', 'CN')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id),
  ADD COLUMN IF NOT EXISTS pickup_pin_hash TEXT,
  ADD COLUMN IF NOT EXISTS pickup_pin_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_collector_name TEXT,
  ADD COLUMN IF NOT EXISTS pickup_collector_relationship TEXT,
  ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_pin_failure_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS shipment_measurements
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id);
