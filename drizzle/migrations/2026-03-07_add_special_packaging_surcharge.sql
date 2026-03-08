-- Add special packaging surcharge columns to orders and order_packages

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS special_packaging_surcharge_usd NUMERIC(10,2);

ALTER TABLE order_packages
  ADD COLUMN IF NOT EXISTS special_packaging_type TEXT,
  ADD COLUMN IF NOT EXISTS special_packaging_surcharge_usd NUMERIC(10,2);

-- Seed the app_settings row (empty types array) so GET doesn't return nothing
INSERT INTO app_settings (key, value, description)
VALUES (
  'special_packaging_surcharges',
  '{"types": []}',
  'Special packaging surcharge types for warehouse verification'
)
ON CONFLICT (key) DO NOTHING;
