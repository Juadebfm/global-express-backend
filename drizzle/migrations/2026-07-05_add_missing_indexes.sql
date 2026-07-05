-- Add index on users.role for frequent WHERE role = 'staff' / role = 'supplier' filters
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

-- Add index on gallery_claims.claimant_user_id for "my claims" queries
CREATE INDEX IF NOT EXISTS gallery_claims_claimant_user_id_idx ON gallery_claims (claimant_user_id);
