-- Add pickup representative fields to orders and bulk_shipment_items
-- Allows customers to designate someone else to pick up their package at the Lagos office

ALTER TABLE orders ADD COLUMN pickup_rep_name TEXT;
ALTER TABLE orders ADD COLUMN pickup_rep_phone TEXT;

ALTER TABLE bulk_shipment_items ADD COLUMN pickup_rep_name TEXT;
ALTER TABLE bulk_shipment_items ADD COLUMN pickup_rep_phone TEXT;
