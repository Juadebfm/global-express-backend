-- Gallery marketplace for anonymous goods, cars, and adverts
-- Includes claim/purchase-attempt flow records for public and authenticated users.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gallery_item_type') THEN
    CREATE TYPE gallery_item_type AS ENUM ('anonymous_goods', 'car', 'advert');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gallery_item_status') THEN
    CREATE TYPE gallery_item_status AS ENUM (
      'draft',
      'published',
      'claim_pending',
      'claimed',
      'car_reserved',
      'car_sold',
      'archived'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gallery_claim_type') THEN
    CREATE TYPE gallery_claim_type AS ENUM ('ownership', 'car_purchase');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gallery_claim_status') THEN
    CREATE TYPE gallery_claim_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS gallery_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number text NOT NULL,
  item_type gallery_item_type NOT NULL,
  status gallery_item_status NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  description text,
  preview_image_url text,
  media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  cta_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_published boolean NOT NULL DEFAULT false,
  car_price_ngn numeric(14,2),
  price_currency text NOT NULL DEFAULT 'NGN',
  assigned_user_id uuid REFERENCES users(id),
  assigned_supplier_id uuid REFERENCES users(id),
  metadata jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gallery_items_tracking_number_unique_idx
  ON gallery_items (tracking_number);
CREATE INDEX IF NOT EXISTS gallery_items_item_type_idx
  ON gallery_items (item_type);
CREATE INDEX IF NOT EXISTS gallery_items_status_idx
  ON gallery_items (status);
CREATE INDEX IF NOT EXISTS gallery_items_is_published_idx
  ON gallery_items (is_published);
CREATE INDEX IF NOT EXISTS gallery_items_created_at_idx
  ON gallery_items (created_at);

CREATE TABLE IF NOT EXISTS gallery_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES gallery_items(id) ON DELETE CASCADE,
  claim_type gallery_claim_type NOT NULL,
  status gallery_claim_status NOT NULL DEFAULT 'pending',
  claimant_user_id uuid REFERENCES users(id),
  claimant_full_name text NOT NULL,
  claimant_email text NOT NULL,
  claimant_phone text NOT NULL,
  message text,
  upload_token text,
  proof_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  support_ticket_id uuid REFERENCES support_tickets(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gallery_claims_item_id_idx
  ON gallery_claims (item_id);
CREATE INDEX IF NOT EXISTS gallery_claims_status_idx
  ON gallery_claims (status);
CREATE INDEX IF NOT EXISTS gallery_claims_created_at_idx
  ON gallery_claims (created_at);
