ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_provision_client_login boolean NOT NULL DEFAULT false;
