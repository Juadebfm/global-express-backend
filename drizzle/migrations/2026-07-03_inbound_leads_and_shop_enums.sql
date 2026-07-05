-- Add for_sale item type (shop listings by GEX staff)
ALTER TYPE gallery_item_type ADD VALUE IF NOT EXISTS 'for_sale';

-- Add generic reserved/sold statuses (for_sale items use these instead of car_reserved/car_sold)
ALTER TYPE gallery_item_status ADD VALUE IF NOT EXISTS 'reserved';
ALTER TYPE gallery_item_status ADD VALUE IF NOT EXISTS 'sold';

-- Add USD price column for shop listings (car_price_ngn remains for NGN pricing)
ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS price_usd DECIMAL(14, 2);

-- Unified inbound leads table: D2D intake + shop buyer inquiries
CREATE TYPE inbound_lead_type AS ENUM ('d2d_intake', 'shop_inquiry');
CREATE TYPE inbound_lead_status AS ENUM ('new', 'contacted', 'converted', 'closed');

CREATE TABLE inbound_leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_type         inbound_lead_type NOT NULL,
  status            inbound_lead_status NOT NULL DEFAULT 'new',

  -- Contact details
  full_name         TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,

  -- For D2D: origin country; for shop_inquiry: null
  origin_country    TEXT,

  -- Free-form notes / inquiry message
  message           TEXT,

  -- For shop_inquiry: which gallery item they are interested in
  item_id           UUID REFERENCES gallery_items(id) ON DELETE SET NULL,

  -- Staff assignment
  assigned_to       UUID REFERENCES users(id) ON DELETE SET NULL,

  -- If this lead came from an authenticated user
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Flexible bag for D2D goods description, dimensions, etc.
  metadata          JSONB,

  converted_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX inbound_leads_lead_type_idx  ON inbound_leads(lead_type);
CREATE INDEX inbound_leads_status_idx     ON inbound_leads(status);
CREATE INDEX inbound_leads_item_id_idx    ON inbound_leads(item_id);
CREATE INDEX inbound_leads_assigned_to_idx ON inbound_leads(assigned_to);
CREATE INDEX inbound_leads_created_at_idx ON inbound_leads(created_at);
