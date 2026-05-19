-- Per-account login lockout (ASVS 2.2.3)
-- failed_login_count: incremented on each invalid password attempt; reset on success
-- locked_until: timestamp until which login is rejected with 423; null = not locked
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamp;
