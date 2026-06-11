-- Add package-level dispatch batch assignment (Option B)
ALTER TABLE order_packages
  ADD COLUMN IF NOT EXISTS dispatch_batch_id uuid REFERENCES dispatch_batches(id);

CREATE INDEX IF NOT EXISTS order_packages_dispatch_batch_id_idx
  ON order_packages(dispatch_batch_id);

-- Backfill: copy the order-level batch down to each package
UPDATE order_packages op
SET dispatch_batch_id = o.dispatch_batch_id
FROM orders o
WHERE op.order_id = o.id
  AND o.dispatch_batch_id IS NOT NULL
  AND op.dispatch_batch_id IS NULL;
