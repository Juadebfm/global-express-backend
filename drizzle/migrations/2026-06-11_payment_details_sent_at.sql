ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_details_sent_at timestamptz;
