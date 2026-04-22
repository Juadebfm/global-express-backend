ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_manage_shipment_batches boolean NOT NULL DEFAULT false;
