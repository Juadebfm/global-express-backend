ALTER TABLE dispatch_batches
  ADD COLUMN IF NOT EXISTS carrier_name text,
  ADD COLUMN IF NOT EXISTS airline_tracking_number text,
  ADD COLUMN IF NOT EXISTS ocean_tracking_number text,
  ADD COLUMN IF NOT EXISTS d2d_tracking_number text,
  ADD COLUMN IF NOT EXISTS voyage_or_flight_number text,
  ADD COLUMN IF NOT EXISTS estimated_departure_at timestamp,
  ADD COLUMN IF NOT EXISTS estimated_arrival_at timestamp;
