-- Change 7 (D2D) foundation:
-- - Shipment type: d2d
-- - Shipment payer model
-- - Measurement checkpoints (SK/Airport/Nigeria)
-- - Supplier task-invoice attachments

-- 1) Extend shipment_type enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'shipment_type' AND e.enumlabel = 'd2d'
  ) THEN
    ALTER TYPE shipment_type ADD VALUE 'd2d';
  END IF;
END $$;

-- 2) Extend shipment_status_v2 enum with D2D last-mile statuses
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'shipment_status_v2' AND e.enumlabel = 'LOCAL_COURIER_ASSIGNED'
  ) THEN
    ALTER TYPE shipment_status_v2 ADD VALUE 'LOCAL_COURIER_ASSIGNED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'shipment_status_v2' AND e.enumlabel = 'IN_TRANSIT_TO_DESTINATION_CITY'
  ) THEN
    ALTER TYPE shipment_status_v2 ADD VALUE 'IN_TRANSIT_TO_DESTINATION_CITY';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'shipment_status_v2' AND e.enumlabel = 'OUT_FOR_DELIVERY_DESTINATION_CITY'
  ) THEN
    ALTER TYPE shipment_status_v2 ADD VALUE 'OUT_FOR_DELIVERY_DESTINATION_CITY';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'shipment_status_v2' AND e.enumlabel = 'DELIVERED_TO_RECIPIENT'
  ) THEN
    ALTER TYPE shipment_status_v2 ADD VALUE 'DELIVERED_TO_RECIPIENT';
  END IF;
END $$;

-- 3) Add shipment_payer enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shipment_payer') THEN
    CREATE TYPE shipment_payer AS ENUM ('USER', 'SUPPLIER');
  END IF;
END $$;

-- 4) Extend orders for payer metadata
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipment_payer shipment_payer NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS billing_supplier_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'orders'
      AND constraint_name = 'orders_billing_supplier_id_users_id_fk'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_billing_supplier_id_users_id_fk
      FOREIGN KEY (billing_supplier_id) REFERENCES users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orders_shipment_payer_idx ON orders(shipment_payer);
CREATE INDEX IF NOT EXISTS orders_billing_supplier_id_idx ON orders(billing_supplier_id);

-- 5) Extend invoices for payer + billed party
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS shipment_payer shipment_payer NOT NULL DEFAULT 'USER',
  ADD COLUMN IF NOT EXISTS bill_to_user_id uuid,
  ADD COLUMN IF NOT EXISTS bill_to_supplier_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'invoices'
      AND constraint_name = 'invoices_bill_to_user_id_users_id_fk'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_bill_to_user_id_users_id_fk
      FOREIGN KEY (bill_to_user_id) REFERENCES users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'invoices'
      AND constraint_name = 'invoices_bill_to_supplier_id_users_id_fk'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_bill_to_supplier_id_users_id_fk
      FOREIGN KEY (bill_to_supplier_id) REFERENCES users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS invoices_shipment_payer_idx ON invoices(shipment_payer);
CREATE INDEX IF NOT EXISTS invoices_bill_to_user_id_idx ON invoices(bill_to_user_id);
CREATE INDEX IF NOT EXISTS invoices_bill_to_supplier_id_idx ON invoices(bill_to_supplier_id);

-- Backfill existing invoice billed party from existing order owner/payer
UPDATE invoices i
SET shipment_payer = o.shipment_payer,
    bill_to_user_id = CASE WHEN o.shipment_payer = 'USER' THEN o.sender_id ELSE NULL END,
    bill_to_supplier_id = CASE WHEN o.shipment_payer = 'SUPPLIER' THEN o.billing_supplier_id ELSE NULL END
FROM orders o
WHERE i.order_id = o.id;

-- 6) Measurement checkpoint enum + table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'measurement_checkpoint') THEN
    CREATE TYPE measurement_checkpoint AS ENUM ('SK_WAREHOUSE', 'AIRPORT', 'NIGERIA_OFFICE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS shipment_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  checkpoint measurement_checkpoint NOT NULL,
  measured_weight_kg numeric(10,3) NOT NULL,
  measured_cbm numeric(12,6) NOT NULL,
  delta_from_sk_weight_kg numeric(10,3),
  delta_from_sk_cbm numeric(12,6),
  measured_at timestamp NOT NULL DEFAULT now(),
  measured_by uuid REFERENCES users(id),
  notes text,
  attachments_count integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shipment_measurements_order_checkpoint_unique
  ON shipment_measurements(order_id, checkpoint);
CREATE INDEX IF NOT EXISTS shipment_measurements_order_id_idx
  ON shipment_measurements(order_id);
CREATE INDEX IF NOT EXISTS shipment_measurements_checkpoint_idx
  ON shipment_measurements(checkpoint);
CREATE INDEX IF NOT EXISTS shipment_measurements_measured_at_idx
  ON shipment_measurements(measured_at);

-- 7) Invoice attachment enum + table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_attachment_type') THEN
    CREATE TYPE invoice_attachment_type AS ENUM ('TASK_INVOICE', 'REGULATED_DOCUMENT');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS invoice_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  attachment_type invoice_attachment_type NOT NULL DEFAULT 'TASK_INVOICE',
  original_file_name text NOT NULL,
  content_type text NOT NULL,
  file_size_bytes integer NOT NULL,
  r2_key text NOT NULL UNIQUE,
  r2_url text NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invoice_attachments_invoice_id_idx
  ON invoice_attachments(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_attachments_order_id_idx
  ON invoice_attachments(order_id);
CREATE INDEX IF NOT EXISTS invoice_attachments_attachment_type_idx
  ON invoice_attachments(attachment_type);
CREATE INDEX IF NOT EXISTS invoice_attachments_uploaded_by_idx
  ON invoice_attachments(uploaded_by);
CREATE INDEX IF NOT EXISTS invoice_attachments_created_at_idx
  ON invoice_attachments(created_at);

