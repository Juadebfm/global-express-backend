-- Adds channel-level notification preference columns for user settings.
-- These fields are read/updated by user ID, so dedicated indexes are not required.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notify_email_alerts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_sms_alerts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_in_app_alerts boolean NOT NULL DEFAULT true;
