ALTER TABLE order_packages
  ADD COLUMN IF NOT EXISTS requires_extra_truck_movement boolean NOT NULL DEFAULT false;
