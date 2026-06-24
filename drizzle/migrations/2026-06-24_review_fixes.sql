-- ── Atomic slot counter (replaces SELECT COUNT race condition) ─────────────────
ALTER TABLE dispatch_batches
  ADD COLUMN IF NOT EXISTS slot_counter integer NOT NULL DEFAULT 0;

-- ── Guarantee unique tracking numbers per batch ────────────────────────────────
ALTER TABLE batch_customer_slots
  ADD CONSTRAINT batch_customer_slots_tracking_unique
    UNIQUE (batch_id, primary_tracking_number);
