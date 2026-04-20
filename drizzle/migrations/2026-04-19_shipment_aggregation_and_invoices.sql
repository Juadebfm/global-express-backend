-- Change 6 foundation:
-- - Dispatch batches (internal master tracking)
-- - Invoices (draft/finalized/paid lifecycle, invoice-based payment linkage)
-- - Supplier + arrival metadata on individual goods records

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispatch_batch_status') THEN
    CREATE TYPE dispatch_batch_status AS ENUM ('open', 'cutoff_pending_approval', 'closed');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
    CREATE TYPE invoice_status AS ENUM ('draft', 'finalized', 'paid', 'cancelled');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS dispatch_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_tracking_number text NOT NULL UNIQUE,
  transport_mode text NOT NULL CHECK (transport_mode IN ('air', 'sea')),
  status dispatch_batch_status NOT NULL DEFAULT 'open',
  cutoff_requested_by uuid REFERENCES users(id),
  cutoff_requested_at timestamp,
  cutoff_approved_by uuid REFERENCES users(id),
  cutoff_approved_at timestamp,
  closed_at timestamp,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  deleted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dispatch_batches_master_tracking_idx
  ON dispatch_batches(master_tracking_number);
CREATE INDEX IF NOT EXISTS dispatch_batches_transport_mode_idx
  ON dispatch_batches(transport_mode);
CREATE INDEX IF NOT EXISTS dispatch_batches_status_idx
  ON dispatch_batches(status);
CREATE INDEX IF NOT EXISTS dispatch_batches_created_at_idx
  ON dispatch_batches(created_at);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS dispatch_batch_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_dispatch_batch_id_fk'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_dispatch_batch_id_fk
      FOREIGN KEY (dispatch_batch_id) REFERENCES dispatch_batches(id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS orders_dispatch_batch_id_idx ON orders(dispatch_batch_id);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  invoice_number text NOT NULL UNIQUE,
  status invoice_status NOT NULL DEFAULT 'draft',
  total_usd numeric(12, 2) NOT NULL DEFAULT 0,
  fx_rate_ngn_per_usd numeric(12, 4) NOT NULL DEFAULT 1500,
  total_ngn numeric(14, 2) NOT NULL DEFAULT 0,
  finalized_at timestamp,
  finalized_by uuid REFERENCES users(id),
  paid_at timestamp,
  paid_by uuid REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_order_id_unique
  ON invoices(order_id);
CREATE INDEX IF NOT EXISTS invoices_invoice_number_idx
  ON invoices(invoice_number);
CREATE INDEX IF NOT EXISTS invoices_status_idx
  ON invoices(status);
CREATE INDEX IF NOT EXISTS invoices_created_at_idx
  ON invoices(created_at);

ALTER TABLE order_packages
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS arrival_at timestamp NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS item_cost_usd numeric(12, 2);

CREATE INDEX IF NOT EXISTS order_packages_supplier_id_idx
  ON order_packages(supplier_id);
CREATE INDEX IF NOT EXISTS order_packages_arrival_at_idx
  ON order_packages(arrival_at);

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id);

CREATE INDEX IF NOT EXISTS payments_invoice_id_idx ON payments(invoice_id);

-- Backfill legacy dispatch batches so existing shipments are represented in the new model.
WITH actor AS (
  SELECT id
  FROM users
  WHERE deleted_at IS NULL
  ORDER BY created_at ASC
  LIMIT 1
)
INSERT INTO dispatch_batches (
  master_tracking_number,
  transport_mode,
  status,
  closed_at,
  cutoff_approved_at,
  notes,
  created_by,
  created_at,
  updated_at
)
SELECT
  'GEX-LEGACY-AIR',
  'air',
  'closed',
  now(),
  now(),
  'Legacy backfill batch (air)',
  actor.id,
  now(),
  now()
FROM actor
ON CONFLICT (master_tracking_number) DO NOTHING;

WITH actor AS (
  SELECT id
  FROM users
  WHERE deleted_at IS NULL
  ORDER BY created_at ASC
  LIMIT 1
)
INSERT INTO dispatch_batches (
  master_tracking_number,
  transport_mode,
  status,
  closed_at,
  cutoff_approved_at,
  notes,
  created_by,
  created_at,
  updated_at
)
SELECT
  'GEX-LEGACY-SEA',
  'sea',
  'closed',
  now(),
  now(),
  'Legacy backfill batch (sea)',
  actor.id,
  now(),
  now()
FROM actor
ON CONFLICT (master_tracking_number) DO NOTHING;

-- Assign all existing orders to a legacy dispatch batch by inferred mode.
UPDATE orders o
SET dispatch_batch_id = db.id
FROM dispatch_batches db
WHERE o.dispatch_batch_id IS NULL
  AND db.master_tracking_number = CASE
    WHEN COALESCE(
      o.transport_mode::text,
      CASE WHEN o.shipment_type = 'ocean' THEN 'sea' WHEN o.shipment_type = 'air' THEN 'air' ELSE NULL END
    ) = 'sea' THEN 'GEX-LEGACY-SEA'
    ELSE 'GEX-LEGACY-AIR'
  END;

-- Create one invoice per existing order (draft/finalized/paid derived from status/payment).
INSERT INTO invoices (
  order_id,
  invoice_number,
  status,
  total_usd,
  fx_rate_ngn_per_usd,
  total_ngn,
  finalized_at,
  paid_at,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  o.id AS order_id,
  'INV-' || replace(o.id::text, '-', '') AS invoice_number,
  CASE
    WHEN o.payment_collection_status = 'PAID_IN_FULL' THEN 'paid'::invoice_status
    WHEN o.status_v2 IN (
      'FLIGHT_DEPARTED',
      'VESSEL_DEPARTED',
      'FLIGHT_LANDED_LAGOS',
      'VESSEL_ARRIVED_LAGOS_PORT',
      'CUSTOMS_CLEARED_LAGOS',
      'IN_TRANSIT_TO_LAGOS_OFFICE',
      'READY_FOR_PICKUP',
      'PICKED_UP_COMPLETED'
    ) THEN 'finalized'::invoice_status
    ELSE 'draft'::invoice_status
  END AS status,
  COALESCE(o.final_charge_usd, o.calculated_charge_usd, 0) AS total_usd,
  1500::numeric(12, 4) AS fx_rate_ngn_per_usd,
  COALESCE(o.final_charge_usd, o.calculated_charge_usd, 0) * 1500::numeric(12, 4) AS total_ngn,
  CASE
    WHEN o.status_v2 IN (
      'FLIGHT_DEPARTED',
      'VESSEL_DEPARTED',
      'FLIGHT_LANDED_LAGOS',
      'VESSEL_ARRIVED_LAGOS_PORT',
      'CUSTOMS_CLEARED_LAGOS',
      'IN_TRANSIT_TO_LAGOS_OFFICE',
      'READY_FOR_PICKUP',
      'PICKED_UP_COMPLETED'
    ) OR o.payment_collection_status = 'PAID_IN_FULL'
    THEN now()
    ELSE NULL
  END AS finalized_at,
  CASE
    WHEN o.payment_collection_status = 'PAID_IN_FULL'
    THEN now()
    ELSE NULL
  END AS paid_at,
  o.created_by AS created_by,
  o.created_by AS updated_by,
  o.created_at AS created_at,
  now() AS updated_at
FROM orders o
LEFT JOIN invoices i ON i.order_id = o.id
WHERE i.id IS NULL
  AND o.deleted_at IS NULL;

-- Link historical payments to invoices.
UPDATE payments p
SET invoice_id = i.id
FROM invoices i
WHERE p.order_id = i.order_id
  AND p.invoice_id IS NULL;

-- If any linked payment is successful, force invoice status to paid.
UPDATE invoices i
SET
  status = 'paid',
  paid_at = COALESCE(latest_success.paid_at, i.paid_at),
  finalized_at = COALESCE(i.finalized_at, latest_success.paid_at, now()),
  updated_at = now()
FROM (
  SELECT invoice_id, MAX(paid_at) AS paid_at
  FROM payments
  WHERE status = 'successful'
    AND invoice_id IS NOT NULL
  GROUP BY invoice_id
) latest_success
WHERE i.id = latest_success.invoice_id;

COMMIT;
