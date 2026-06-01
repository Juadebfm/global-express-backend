-- Dedicated security-event log (ASVS V7.2.1).
--
-- Separate from `audit_logs` (which records admin actions and 403s) so security
-- operations can query auth-relevant events without filtering noise.
--
-- Events captured: login_success, login_failure, login_locked, mfa_verify_failure,
-- mfa_recovery_used, token_verification_failure, token_revoked, password_reset_otp_sent,
-- password_reset_otp_verified, password_reset_completed, logout, account_erased.
CREATE TABLE IF NOT EXISTS security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ip_address text,
  user_agent text,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_events_user_id_idx ON security_events(user_id);
CREATE INDEX IF NOT EXISTS security_events_event_type_idx ON security_events(event_type);
CREATE INDEX IF NOT EXISTS security_events_created_at_idx ON security_events(created_at DESC);
