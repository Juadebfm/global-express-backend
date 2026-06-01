-- File AV-scan tracking (ASVS V12.4.1).
--
-- Every confirmed upload writes a row here in `pending` state. The AV scan
-- service downloads the object, hashes it (SHA-256), and queries VirusTotal.
-- Status moves to `clean` (safe to display to staff), `malicious` (quarantined
-- before staff sees it), `error` (transient — staff workflow may flag for
-- re-scan), or `skipped` (when VIRUSTOTAL_API_KEY is unset — local dev only).
--
-- Staff UI MUST gate "open file" / "view receipt" on status='clean'.
CREATE TABLE IF NOT EXISTS file_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  r2_key text NOT NULL UNIQUE,
  scope text NOT NULL,                        -- e.g. 'payments/receipt', 'gallery/claim-proof'
  scope_id text,                              -- e.g. orderId, claimId — for join lookups
  status text NOT NULL DEFAULT 'pending',     -- pending|clean|malicious|error|skipped
  sha256 text,
  bytes integer,
  scan_provider text,                         -- 'virustotal' currently
  scan_response jsonb,                        -- raw provider response for forensics
  scanned_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS file_scans_status_idx ON file_scans(status);
CREATE INDEX IF NOT EXISTS file_scans_scope_idx ON file_scans(scope, scope_id);
CREATE INDEX IF NOT EXISTS file_scans_created_at_idx ON file_scans(created_at DESC);
