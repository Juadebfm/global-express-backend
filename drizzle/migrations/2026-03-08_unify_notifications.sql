-- Unify notifications: merge admin_notifications into notifications table
-- with role-based targeting via target_role column.

-- 1. Add admin notification types to the existing notification_type enum
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'new_customer';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'new_order';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_received';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_failed';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'new_staff_account';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'staff_onboarding_complete';

-- 2. Add target_role column to notifications table
--    null = personal (userId set) or broadcast (isBroadcast=true)
--    'staff' = visible to staff, admin, superadmin
--    'admin' = visible to admin, superadmin
--    'superadmin' = visible to superadmin only
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_role user_role;

-- 3. Add index for efficient role-based queries
CREATE INDEX IF NOT EXISTS notifications_target_role_idx ON notifications (target_role)
  WHERE target_role IS NOT NULL;

-- 4. Migrate existing admin_notifications into notifications table
INSERT INTO notifications (id, type, title, body, metadata, is_broadcast, is_read, is_saved, created_at, target_role)
SELECT
  id,
  type::text::notification_type,
  title,
  body,
  metadata,
  false,        -- not a broadcast — role-targeted
  false,        -- per-user read state via notification_reads
  false,
  created_at,
  'admin'::user_role  -- admin notifications visible to admin+
FROM admin_notifications
ON CONFLICT (id) DO NOTHING;

-- 5. Migrate read state: admin_notifications with read_at set
--    We insert a notification_reads row for every admin/superadmin user
--    so their existing read state is preserved.
--    (Skip if no admin_notifications have been read)
INSERT INTO notification_reads (notification_id, user_id, read_at)
SELECT an.id, u.id, an.read_at
FROM admin_notifications an
CROSS JOIN users u
WHERE an.read_at IS NOT NULL
  AND u.role IN ('admin', 'superadmin')
  AND u.deleted_at IS NULL
ON CONFLICT (notification_id, user_id) DO NOTHING;
