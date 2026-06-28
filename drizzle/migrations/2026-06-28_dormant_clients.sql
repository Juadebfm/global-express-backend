-- Allow dormant clients to be created without an email address.
-- Active clients (provisioned via Clerk) still always have email set;
-- the NOT NULL constraint is dropped so staff can create stub accounts
-- on the spot during goods intake when the customer is not yet registered.
ALTER TABLE users
  ALTER COLUMN email DROP NOT NULL;
