-- Supplier declarations: pre-shipment notices submitted by supplier partners
-- Status: pending_review → accepted (order created) | rejected (with reason)

CREATE TYPE declaration_status AS ENUM ('pending_review', 'accepted', 'rejected');

CREATE TABLE supplier_declarations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id           UUID NOT NULL REFERENCES users(id),

  -- Recipient details (customer in Nigeria — typed by supplier, manually linked by staff)
  recipient_name        TEXT NOT NULL,
  recipient_phone       TEXT NOT NULL,
  recipient_email       TEXT,
  recipient_address     TEXT,

  -- Goods
  description           TEXT NOT NULL,
  quantity              INTEGER,
  declared_value_usd    NUMERIC(12,2) NOT NULL,
  estimated_weight_kg   NUMERIC(10,3),
  shipment_type         shipment_type NOT NULL,
  special_packaging_notes TEXT,
  supplier_notes        TEXT,
  estimated_arrival_at  DATE,

  -- Review
  status                declaration_status NOT NULL DEFAULT 'pending_review',
  rejection_reason      TEXT,
  reviewed_by           UUID REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,

  -- Links set after acceptance
  order_id              UUID REFERENCES orders(id),
  linked_customer_id    UUID REFERENCES users(id),
  linked_by             UUID REFERENCES users(id),
  linked_at             TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

CREATE INDEX supplier_declarations_supplier_id_idx ON supplier_declarations(supplier_id);
CREATE INDEX supplier_declarations_status_idx      ON supplier_declarations(status);
CREATE INDEX supplier_declarations_order_id_idx    ON supplier_declarations(order_id);
CREATE INDEX supplier_declarations_created_at_idx  ON supplier_declarations(created_at);
