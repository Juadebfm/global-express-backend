-- Idempotency-Key replay store (REST best practice / Stripe-style)
-- Stores the response of the original request so retries with the same key
-- return the cached response instead of creating duplicate resources.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  method text NOT NULL,
  path text NOT NULL,
  request_hash text NOT NULL,
  status_code integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at_idx ON idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idempotency_keys_user_id_idx ON idempotency_keys(user_id);

-- Processed webhook events log — used to dedup duplicate webhook deliveries
-- by provider event id (e.g. svix-id for Clerk, transaction id for Paystack).
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  processed_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
