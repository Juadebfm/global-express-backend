ALTER TABLE dispatch_batches
  ADD COLUMN IF NOT EXISTS actual_departure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_arrival_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_gross_weight_kg DECIMAL(10, 2);
