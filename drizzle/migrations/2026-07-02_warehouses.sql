CREATE TABLE warehouses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  city        TEXT NOT NULL,
  country     TEXT NOT NULL DEFAULT 'CN',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO warehouses (name, city, country)
VALUES ('Main Warehouse', 'Guangzhou', 'CN')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE orders ADD COLUMN warehouse_id UUID REFERENCES warehouses(id);
ALTER TABLE shipment_measurements ADD COLUMN warehouse_id UUID REFERENCES warehouses(id);
