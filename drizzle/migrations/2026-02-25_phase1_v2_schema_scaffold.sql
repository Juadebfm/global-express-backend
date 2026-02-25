-- Phase 1 scaffold for shipment refactor v2
-- Adds new enums/tables/columns in parallel with legacy structures.

CREATE TYPE shipment_status_v2 AS ENUM (
  'PREORDER_SUBMITTED',
  'AWAITING_WAREHOUSE_RECEIPT',
  'WAREHOUSE_RECEIVED',
  'WAREHOUSE_VERIFIED_PRICED',
  'DISPATCHED_TO_ORIGIN_AIRPORT',
  'AT_ORIGIN_AIRPORT',
  'BOARDED_ON_FLIGHT',
  'FLIGHT_DEPARTED',
  'FLIGHT_LANDED_LAGOS',
  'DISPATCHED_TO_ORIGIN_PORT',
  'AT_ORIGIN_PORT',
  'LOADED_ON_VESSEL',
  'VESSEL_DEPARTED',
  'VESSEL_ARRIVED_LAGOS_PORT',
  'CUSTOMS_CLEARED_LAGOS',
  'IN_TRANSIT_TO_LAGOS_OFFICE',
  'READY_FOR_PICKUP',
  'PICKED_UP_COMPLETED',
  'ON_HOLD',
  'CANCELLED',
  'RESTRICTED_ITEM_REJECTED',
  'RESTRICTED_ITEM_OVERRIDE_APPROVED'
);

CREATE TYPE transport_mode AS ENUM ('air', 'sea');
CREATE TYPE payment_collection_status AS ENUM ('UNPAID', 'PAYMENT_IN_PROGRESS', 'PAID_IN_FULL');
CREATE TYPE pricing_source AS ENUM ('DEFAULT_RATE', 'CUSTOMER_OVERRIDE', 'MANUAL_ADJUSTMENT', 'MIGRATED_UNVERIFIED');
CREATE TYPE preferred_language AS ENUM ('en', 'ko');
CREATE TYPE notification_template_channel AS ENUM ('email', 'in_app');

ALTER TABLE users
  ADD COLUMN preferred_language preferred_language NOT NULL DEFAULT 'en';

ALTER TABLE orders
  ADD COLUMN transport_mode transport_mode,
  ADD COLUMN is_preorder boolean NOT NULL DEFAULT false,
  ADD COLUMN status_v2 shipment_status_v2,
  ADD COLUMN customer_status_v2 shipment_status_v2,
  ADD COLUMN price_calculated_at timestamp,
  ADD COLUMN price_calculated_by uuid REFERENCES users(id),
  ADD COLUMN calculated_charge_usd numeric(12, 2),
  ADD COLUMN final_charge_usd numeric(12, 2),
  ADD COLUMN pricing_source pricing_source,
  ADD COLUMN price_adjustment_reason text,
  ADD COLUMN payment_collection_status payment_collection_status NOT NULL DEFAULT 'UNPAID';

CREATE INDEX orders_status_v2_idx ON orders(status_v2);
CREATE INDEX orders_transport_mode_idx ON orders(transport_mode);

ALTER TABLE bulk_shipments
  ADD COLUMN status_v2 shipment_status_v2,
  ADD COLUMN transport_mode transport_mode;

CREATE INDEX bulk_shipments_status_v2_idx ON bulk_shipments(status_v2);
CREATE INDEX bulk_shipments_transport_mode_idx ON bulk_shipments(transport_mode);

ALTER TABLE bulk_shipment_items
  ADD COLUMN status_v2 shipment_status_v2,
  ADD COLUMN customer_status_v2 shipment_status_v2,
  ADD COLUMN transport_mode transport_mode,
  ADD COLUMN price_calculated_at timestamp,
  ADD COLUMN price_calculated_by uuid REFERENCES users(id),
  ADD COLUMN calculated_charge_usd numeric(12, 2),
  ADD COLUMN final_charge_usd numeric(12, 2),
  ADD COLUMN pricing_source pricing_source,
  ADD COLUMN price_adjustment_reason text,
  ADD COLUMN payment_collection_status payment_collection_status NOT NULL DEFAULT 'UNPAID';

CREATE INDEX bulk_shipment_items_status_v2_idx ON bulk_shipment_items(status_v2);
CREATE INDEX bulk_shipment_items_transport_mode_idx ON bulk_shipment_items(transport_mode);

CREATE TABLE order_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status shipment_status_v2 NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX order_status_events_order_id_idx ON order_status_events(order_id);
CREATE INDEX order_status_events_actor_id_idx ON order_status_events(actor_id);
CREATE INDEX order_status_events_created_at_idx ON order_status_events(created_at);

CREATE TABLE order_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  bulk_item_id uuid REFERENCES bulk_shipment_items(id) ON DELETE CASCADE,
  description text,
  item_type text,
  quantity integer NOT NULL DEFAULT 1,
  length_cm numeric(10, 2),
  width_cm numeric(10, 2),
  height_cm numeric(10, 2),
  weight_kg numeric(10, 3),
  cbm numeric(12, 6),
  is_restricted boolean NOT NULL DEFAULT false,
  restricted_reason text,
  restricted_override_approved boolean NOT NULL DEFAULT false,
  restricted_override_reason text,
  restricted_override_by uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT order_packages_order_or_bulk_item_check
    CHECK (order_id IS NOT NULL OR bulk_item_id IS NOT NULL)
);

CREATE INDEX order_packages_order_id_idx ON order_packages(order_id);
CREATE INDEX order_packages_bulk_item_id_idx ON order_packages(bulk_item_id);
CREATE INDEX order_packages_item_type_idx ON order_packages(item_type);

CREATE TABLE pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mode transport_mode NOT NULL,
  min_weight_kg numeric(10, 3),
  max_weight_kg numeric(10, 3),
  rate_usd_per_kg numeric(12, 2),
  flat_rate_usd_per_cbm numeric(12, 2),
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamp,
  effective_to timestamp,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX pricing_rules_mode_idx ON pricing_rules(mode);
CREATE INDEX pricing_rules_is_active_idx ON pricing_rules(is_active);
CREATE INDEX pricing_rules_effective_from_idx ON pricing_rules(effective_from);

CREATE TABLE customer_pricing_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id),
  mode transport_mode NOT NULL,
  min_weight_kg numeric(10, 3),
  max_weight_kg numeric(10, 3),
  rate_usd_per_kg numeric(12, 2),
  flat_rate_usd_per_cbm numeric(12, 2),
  starts_at timestamp,
  ends_at timestamp,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX customer_pricing_overrides_customer_id_idx ON customer_pricing_overrides(customer_id);
CREATE INDEX customer_pricing_overrides_mode_idx ON customer_pricing_overrides(mode);
CREATE INDEX customer_pricing_overrides_is_active_idx ON customer_pricing_overrides(is_active);
CREATE INDEX customer_pricing_overrides_starts_at_idx ON customer_pricing_overrides(starts_at);

CREATE TABLE restricted_goods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name_en text NOT NULL,
  name_ko text,
  description text,
  allow_with_override boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX restricted_goods_code_unique_idx ON restricted_goods(code);
CREATE INDEX restricted_goods_is_active_idx ON restricted_goods(is_active);

CREATE TABLE app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  value jsonb NOT NULL,
  description text,
  updated_by uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX app_settings_key_unique_idx ON app_settings(key);
CREATE INDEX app_settings_updated_at_idx ON app_settings(updated_at);

CREATE TABLE notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  locale preferred_language NOT NULL DEFAULT 'en',
  channel notification_template_channel NOT NULL,
  subject text,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX notification_templates_key_locale_channel_unique_idx
  ON notification_templates(template_key, locale, channel);
CREATE INDEX notification_templates_is_active_idx ON notification_templates(is_active);

-- Bootstrap default restricted goods list approved by business.
INSERT INTO restricted_goods (code, name_en, description, allow_with_override, is_active)
VALUES
  ('batteries', 'Batteries', 'Battery-powered items require manual review', true, true),
  ('phones', 'Phones', 'Mobile phones require manual review', true, true),
  ('laptops', 'Laptops', 'Laptops require manual review', true, true)
ON CONFLICT (code) DO NOTHING;
