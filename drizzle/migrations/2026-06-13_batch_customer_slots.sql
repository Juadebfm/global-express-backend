-- One tracking number per customer per batch.
-- Created when the first verified order for a customer is added to a batch.

CREATE TABLE IF NOT EXISTS batch_customer_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES dispatch_batches(id),
  customer_id UUID NOT NULL REFERENCES users(id),
  primary_tracking_number TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT batch_customer_slots_unique_idx UNIQUE(batch_id, customer_id)
);

CREATE INDEX IF NOT EXISTS batch_customer_slots_batch_id_idx ON batch_customer_slots(batch_id);
CREATE INDEX IF NOT EXISTS batch_customer_slots_customer_id_idx ON batch_customer_slots(customer_id);
CREATE INDEX IF NOT EXISTS batch_customer_slots_tracking_idx ON batch_customer_slots(primary_tracking_number);
