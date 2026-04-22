-- Change 3: role overhaul to 4 roles (superadmin, staff, user, supplier)
-- Change 2: add optional shipping_mark to users

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS shipping_mark text;

-- Drop enum-typed default before role type swap to avoid cast failures
-- on environments where the default is still bound to the old enum type.
ALTER TABLE users
  ALTER COLUMN role DROP DEFAULT;

-- Rebuild enum to remove `admin` and add `supplier`.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'user_role'
  ) THEN
    ALTER TYPE user_role RENAME TO user_role_old;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'user_role'
  ) THEN
    CREATE TYPE user_role AS ENUM ('superadmin', 'staff', 'user', 'supplier');
  END IF;
END $$;

-- Map legacy `admin` to `staff` during cast.
ALTER TABLE users
  ALTER COLUMN role TYPE user_role
  USING (
    CASE role::text
      WHEN 'admin' THEN 'staff'
      ELSE role::text
    END
  )::user_role;

ALTER TABLE notifications
  ALTER COLUMN target_role TYPE user_role
  USING (
    CASE target_role::text
      WHEN 'admin' THEN 'staff'
      ELSE target_role::text
    END
  )::user_role;

-- Restore application default for newly created external users.
ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'user'::user_role;

DROP TYPE IF EXISTS user_role_old;
