ALTER TABLE dispatch_batches
  ADD COLUMN actual_departure_at TIMESTAMPTZ,
  ADD COLUMN actual_arrival_at TIMESTAMPTZ,
  ADD COLUMN actual_gross_weight_kg DECIMAL(10, 2);
