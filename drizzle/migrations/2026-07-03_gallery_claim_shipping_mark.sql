-- Add shipping_mark to gallery_claims so authenticated claimants can identify
-- their parcel by the label/mark on the package without requiring photo proof.
ALTER TABLE gallery_claims
  ADD COLUMN IF NOT EXISTS shipping_mark TEXT;
