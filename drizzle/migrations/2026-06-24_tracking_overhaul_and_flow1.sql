-- ── Dispatch batches: sea carrier fields ─────────────────────────────────────
ALTER TABLE dispatch_batches
  ADD COLUMN IF NOT EXISTS bill_of_lading_number text,
  ADD COLUMN IF NOT EXISTS vessel_name           text;

-- ── Batch documents (MAWB, BL, container/vessel photos, etc.) ────────────────
CREATE TYPE batch_document_type AS ENUM (
  'mawb',
  'bill_of_lading',
  'container_photo',
  'vessel_photo',
  'other'
);

CREATE TABLE IF NOT EXISTS batch_documents (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid        NOT NULL REFERENCES dispatch_batches(id),
  document_type batch_document_type NOT NULL,
  file_url      text        NOT NULL,
  file_name     text,
  uploaded_by   uuid        NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS batch_documents_batch_id_idx ON batch_documents (batch_id);
CREATE INDEX IF NOT EXISTS batch_documents_type_idx     ON batch_documents (document_type);

-- ── Orders: sourcing supplier fields (Flow 1 customer-initiated booking) ──────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS sourcing_supplier_id    uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS sourcing_supplier_name  text,
  ADD COLUMN IF NOT EXISTS sourcing_supplier_phone text,
  ADD COLUMN IF NOT EXISTS sourcing_supplier_email text;

CREATE INDEX IF NOT EXISTS orders_sourcing_supplier_id_idx ON orders (sourcing_supplier_id);
