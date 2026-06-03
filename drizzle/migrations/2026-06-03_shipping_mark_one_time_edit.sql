-- One-time customer-edit guard for shipping_mark.
--
-- Workflow:
--   1. Customer signs up → backend auto-generates shipping_mark, leaves
--      shipping_mark_user_edited_at NULL
--   2. Customer's first PATCH /api/v1/users/me with shippingMark → accepted,
--      shipping_mark_user_edited_at is set to now()
--   3. Subsequent customer attempts to change → 409 Conflict
--   4. Staff/superadmin via /admin/* paths can still change at any time
--      (no constraint enforced for them).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS shipping_mark_user_edited_at timestamp;
