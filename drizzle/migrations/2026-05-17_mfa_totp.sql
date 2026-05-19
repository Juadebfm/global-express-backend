-- TOTP MFA for internal users (ASVS 4.3.1)
-- totp_secret: AES-256-GCM encrypted base32 TOTP shared secret (null = MFA not enrolled)
-- totp_enabled_at: when the user finished enrollment (null = not enrolled)
-- mfa_recovery_codes: JSON array of HMAC-SHA256 hashes of single-use recovery codes
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret text,
  ADD COLUMN IF NOT EXISTS totp_enabled_at timestamp,
  ADD COLUMN IF NOT EXISTS mfa_recovery_codes jsonb;
