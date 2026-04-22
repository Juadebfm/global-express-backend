-- User-submitted supplier/vendor info update requests with supplier validation workflow.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'supplier_update_request_status') THEN
    CREATE TYPE supplier_update_request_status AS ENUM ('pending', 'accepted', 'rejected');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS supplier_update_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id uuid NOT NULL REFERENCES users(id),
  supplier_id uuid NOT NULL REFERENCES users(id),
  status supplier_update_request_status NOT NULL DEFAULT 'pending',
  proposed_first_name text,
  proposed_last_name text,
  proposed_business_name text,
  proposed_phone text,
  proposed_email text,
  note text,
  supplier_response_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_update_requests_requester_idx
  ON supplier_update_requests (requester_user_id);
CREATE INDEX IF NOT EXISTS supplier_update_requests_supplier_idx
  ON supplier_update_requests (supplier_id);
CREATE INDEX IF NOT EXISTS supplier_update_requests_status_idx
  ON supplier_update_requests (status);
CREATE INDEX IF NOT EXISTS supplier_update_requests_created_at_idx
  ON supplier_update_requests (created_at);
