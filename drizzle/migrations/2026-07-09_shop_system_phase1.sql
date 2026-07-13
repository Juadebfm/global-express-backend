-- Phase 1 of the dedicated shop subsystem.
-- Splits public shop data out of gallery_items into first-class shop tables,
-- preserves lineage to legacy gallery/inbound lead rows, and backfills
-- current car/for_sale records without changing runtime code yet.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shop_listing_kind') THEN
    CREATE TYPE shop_listing_kind AS ENUM ('vehicle', 'general_item');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shop_listing_status') THEN
    CREATE TYPE shop_listing_status AS ENUM (
      'draft',
      'published',
      'unpublished',
      'archived',
      'sold'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shop_interest_source') THEN
    CREATE TYPE shop_interest_source AS ENUM ('public', 'authenticated', 'staff');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shop_interest_status') THEN
    CREATE TYPE shop_interest_status AS ENUM (
      'new',
      'contacted',
      'qualified',
      'hold_offered',
      'converted',
      'closed'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shop_hold_status') THEN
    CREATE TYPE shop_hold_status AS ENUM ('active', 'expired', 'released', 'converted');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS shop_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number text NOT NULL,
  listing_kind shop_listing_kind NOT NULL,
  status shop_listing_status NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  description text,
  preview_image_url text,
  media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  price_amount numeric(14,2),
  price_currency text NOT NULL,
  is_price_public boolean NOT NULL DEFAULT true,
  source_gallery_item_id uuid REFERENCES gallery_items(id) ON DELETE SET NULL,
  metadata jsonb,
  published_at timestamptz,
  archived_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_listings_tracking_number_format_check
    CHECK (tracking_number ~ '^[0-9]{8}-[0-9]{4}$'),
  CONSTRAINT shop_listings_price_amount_non_negative_check
    CHECK (price_amount IS NULL OR price_amount >= 0),
  CONSTRAINT shop_listings_visibility_window_check
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_listings_tracking_number_unique_idx
  ON shop_listings (tracking_number);
CREATE UNIQUE INDEX IF NOT EXISTS shop_listings_source_gallery_item_id_unique_idx
  ON shop_listings (source_gallery_item_id)
  WHERE source_gallery_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shop_listings_status_listing_kind_published_at_idx
  ON shop_listings (status, listing_kind, published_at);
CREATE INDEX IF NOT EXISTS shop_listings_created_at_idx
  ON shop_listings (created_at);

CREATE TABLE IF NOT EXISTS shop_vehicle_details (
  listing_id uuid PRIMARY KEY REFERENCES shop_listings(id) ON DELETE CASCADE,
  make text,
  model text,
  year integer,
  mileage_km integer,
  fuel_type text,
  transmission text,
  location text,
  vin text,
  exterior_color text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shop_item_details (
  listing_id uuid PRIMARY KEY REFERENCES shop_listings(id) ON DELETE CASCADE,
  category text,
  quantity integer,
  condition text,
  sku text,
  location text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shop_interest_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES shop_listings(id),
  source shop_interest_source NOT NULL,
  status shop_interest_status NOT NULL DEFAULT 'new',
  source_inbound_lead_id uuid REFERENCES inbound_leads(id) ON DELETE SET NULL,
  requester_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  support_ticket_id uuid REFERENCES support_tickets(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text,
  phone text,
  message text,
  staff_notes text,
  metadata jsonb,
  contacted_at timestamptz,
  qualified_at timestamptz,
  converted_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_interest_requests_contact_present_check
    CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_interest_requests_source_inbound_lead_id_unique_idx
  ON shop_interest_requests (source_inbound_lead_id)
  WHERE source_inbound_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS shop_interest_requests_listing_id_created_at_idx
  ON shop_interest_requests (listing_id, created_at);
CREATE INDEX IF NOT EXISTS shop_interest_requests_status_created_at_idx
  ON shop_interest_requests (status, created_at);
CREATE INDEX IF NOT EXISTS shop_interest_requests_assigned_to_idx
  ON shop_interest_requests (assigned_to);

CREATE TABLE IF NOT EXISTS shop_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES shop_listings(id) ON DELETE CASCADE,
  interest_request_id uuid REFERENCES shop_interest_requests(id) ON DELETE SET NULL,
  status shop_hold_status NOT NULL DEFAULT 'active',
  reason text,
  expires_at timestamptz NOT NULL,
  released_at timestamptz,
  converted_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  released_by uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_holds_expires_after_created_check
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_holds_one_active_per_listing_unique_idx
  ON shop_holds (listing_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS shop_holds_listing_id_status_expires_at_idx
  ON shop_holds (listing_id, status, expires_at);

-- Backfill legacy gallery-based shop rows into the new shop_listings table.
INSERT INTO shop_listings (
  tracking_number,
  listing_kind,
  status,
  title,
  description,
  preview_image_url,
  media_urls,
  starts_at,
  ends_at,
  price_amount,
  price_currency,
  is_price_public,
  source_gallery_item_id,
  metadata,
  published_at,
  archived_at,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  gi.tracking_number,
  CASE
    WHEN gi.item_type = 'car' THEN 'vehicle'::shop_listing_kind
    ELSE 'general_item'::shop_listing_kind
  END,
  CASE
    WHEN gi.status IN ('car_sold', 'sold') THEN 'sold'::shop_listing_status
    WHEN gi.status = 'archived' THEN 'archived'::shop_listing_status
    WHEN gi.status = 'draft' THEN 'draft'::shop_listing_status
    WHEN gi.is_published = true THEN 'published'::shop_listing_status
    ELSE 'unpublished'::shop_listing_status
  END,
  gi.title,
  gi.description,
  gi.preview_image_url,
  COALESCE(gi.media_urls, '[]'::jsonb),
  gi.starts_at,
  gi.ends_at,
  CASE
    WHEN gi.item_type = 'car' THEN gi.car_price_ngn
    WHEN gi.item_type = 'for_sale' THEN gi.price_usd
    ELSE NULL
  END,
  CASE
    WHEN gi.item_type = 'car' THEN 'NGN'
    WHEN gi.item_type = 'for_sale' THEN 'USD'
    ELSE gi.price_currency
  END,
  CASE
    WHEN gi.item_type = 'car' THEN COALESCE(gi.car_price_ngn, 0) > 0
    WHEN gi.item_type = 'for_sale' THEN COALESCE(gi.price_usd, 0) > 0
    ELSE false
  END,
  gi.id,
  COALESCE(gi.metadata, '{}'::jsonb) ||
    jsonb_build_object(
      'migration',
      jsonb_build_object(
        'source', 'gallery_items',
        'legacyItemType', gi.item_type,
        'legacyStatus', gi.status
      )
    ),
  CASE
    WHEN gi.is_published = true THEN COALESCE(gi.updated_at, gi.created_at)
    ELSE NULL
  END,
  CASE
    WHEN gi.status = 'archived' THEN COALESCE(gi.archived_at, gi.updated_at, gi.created_at)
    ELSE NULL
  END,
  gi.created_by,
  gi.updated_by,
  gi.created_at,
  gi.updated_at
FROM gallery_items gi
WHERE gi.item_type IN ('car', 'for_sale')
ON CONFLICT DO NOTHING;

INSERT INTO shop_vehicle_details (
  listing_id,
  year,
  mileage_km,
  fuel_type,
  transmission,
  location,
  metadata,
  created_at,
  updated_at
)
SELECT
  sl.id,
  CASE
    WHEN COALESCE(gi.metadata ->> 'year', '') ~ '^[0-9]{4}$'
      THEN (gi.metadata ->> 'year')::integer
    ELSE NULL
  END,
  CASE
    WHEN COALESCE(gi.metadata ->> 'mileageKm', '') ~ '^[0-9]+$'
      THEN (gi.metadata ->> 'mileageKm')::integer
    ELSE NULL
  END,
  gi.metadata ->> 'fuelType',
  gi.metadata ->> 'transmission',
  gi.metadata ->> 'location',
  COALESCE(gi.metadata, '{}'::jsonb),
  gi.created_at,
  gi.updated_at
FROM gallery_items gi
INNER JOIN shop_listings sl
  ON sl.source_gallery_item_id = gi.id
WHERE gi.item_type = 'car'
ON CONFLICT (listing_id) DO NOTHING;

INSERT INTO shop_item_details (
  listing_id,
  category,
  quantity,
  condition,
  sku,
  location,
  metadata,
  created_at,
  updated_at
)
SELECT
  sl.id,
  gi.metadata ->> 'category',
  CASE
    WHEN COALESCE(gi.metadata ->> 'quantity', '') ~ '^[0-9]+$'
      THEN (gi.metadata ->> 'quantity')::integer
    ELSE NULL
  END,
  gi.metadata ->> 'condition',
  gi.metadata ->> 'sku',
  gi.metadata ->> 'location',
  COALESCE(gi.metadata, '{}'::jsonb),
  gi.created_at,
  gi.updated_at
FROM gallery_items gi
INNER JOIN shop_listings sl
  ON sl.source_gallery_item_id = gi.id
WHERE gi.item_type = 'for_sale'
ON CONFLICT (listing_id) DO NOTHING;

-- Backfill legacy shop inquiries from inbound_leads.
INSERT INTO shop_interest_requests (
  listing_id,
  source,
  status,
  source_inbound_lead_id,
  requester_user_id,
  assigned_to,
  full_name,
  email,
  phone,
  message,
  metadata,
  contacted_at,
  converted_at,
  closed_at,
  created_at,
  updated_at
)
SELECT
  sl.id,
  CASE
    WHEN il.user_id IS NOT NULL THEN 'authenticated'::shop_interest_source
    ELSE 'public'::shop_interest_source
  END,
  CASE
    WHEN il.status = 'new' THEN 'new'::shop_interest_status
    WHEN il.status = 'contacted' THEN 'contacted'::shop_interest_status
    WHEN il.status = 'converted' THEN 'converted'::shop_interest_status
    WHEN il.status = 'closed' THEN 'closed'::shop_interest_status
    ELSE 'new'::shop_interest_status
  END,
  il.id,
  il.user_id,
  il.assigned_to,
  il.full_name,
  il.email,
  il.phone,
  il.message,
  COALESCE(il.metadata, '{}'::jsonb) ||
    jsonb_build_object(
      'migration',
      jsonb_build_object(
        'source', 'inbound_leads',
        'legacyLeadType', il.lead_type,
        'legacyStatus', il.status
      ),
      'legacyGalleryItemId', il.item_id,
      'originCountry', il.origin_country
    ),
  CASE
    WHEN il.status IN ('contacted', 'converted', 'closed') THEN COALESCE(il.updated_at, il.created_at)
    ELSE NULL
  END,
  il.converted_at,
  CASE
    WHEN il.status = 'closed' THEN COALESCE(il.updated_at, il.created_at)
    ELSE NULL
  END,
  il.created_at,
  il.updated_at
FROM inbound_leads il
INNER JOIN shop_listings sl
  ON sl.source_gallery_item_id = il.item_id
WHERE il.lead_type = 'shop_inquiry'
ON CONFLICT DO NOTHING;

-- Backfill active holds from legacy reserved gallery rows.
INSERT INTO shop_holds (
  listing_id,
  interest_request_id,
  status,
  reason,
  expires_at,
  created_by,
  metadata,
  created_at,
  updated_at
)
SELECT
  sl.id,
  (
    SELECT sir.id
    FROM shop_interest_requests sir
    WHERE sir.listing_id = sl.id
    ORDER BY sir.created_at DESC
    LIMIT 1
  ),
  'active'::shop_hold_status,
  'Backfilled from legacy reserved gallery status',
  GREATEST(
    COALESCE(gi.ends_at, now() + interval '7 days'),
    COALESCE(gi.updated_at, gi.created_at) + interval '1 second'
  ),
  COALESCE(gi.updated_by, gi.created_by),
  jsonb_build_object(
    'migration',
    jsonb_build_object(
      'source', 'gallery_items',
      'legacyStatus', gi.status
    )
  ),
  COALESCE(gi.updated_at, gi.created_at),
  COALESCE(gi.updated_at, gi.created_at)
FROM gallery_items gi
INNER JOIN shop_listings sl
  ON sl.source_gallery_item_id = gi.id
WHERE gi.item_type IN ('car', 'for_sale')
  AND gi.status IN ('car_reserved', 'reserved')
ON CONFLICT DO NOTHING;
