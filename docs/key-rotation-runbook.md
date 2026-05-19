# Key Rotation Runbook

Covers the cryptographic and credential secrets that the backend uses. Every secret listed here has a defined rotation procedure.

| Secret | Used for | Rotation procedure |
|---|---|---|
| `ENCRYPTION_KEY` | AES-256-GCM for PII columns, HMAC-SHA256 for `emailHash` | See [§ Rotating `ENCRYPTION_KEY`](#rotating-encryption_key) — requires re-encrypt migration |
| `JWT_SECRET` | Signs internal staff/superadmin JWTs | See [§ Rotating `JWT_SECRET`](#rotating-jwt_secret) — invalidates all sessions |
| `CLERK_SECRET_KEY` | Verifies customer JWTs from Clerk | Rotate in Clerk dashboard → update env → redeploy |
| `CLERK_WEBHOOK_SECRET` | Verifies Clerk → backend webhooks (Svix) | Rotate in Clerk dashboard → update env → redeploy |
| `PAYSTACK_SECRET_KEY` | Initialize/verify Paystack transactions; verify webhook HMAC | Rotate in Paystack dashboard → update env → redeploy |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Presigned uploads to Cloudflare R2 | Rotate in Cloudflare R2 dashboard → update env → redeploy |
| `RESEND_API_KEY` | Outbound transactional email | Rotate in Resend dashboard → update env → redeploy |
| `TERMII_API_KEY` | Outbound SMS / WhatsApp | Rotate in Termii dashboard → update env → redeploy |
| `VAPID_PRIVATE_KEY` | Signs Web Push notifications | See [§ Rotating VAPID keys](#rotating-vapid-keys) — invalidates existing subscriptions |
| `ADMIN_IP_WHITELIST` | IP allowlist for admin login | Update env → redeploy (no data impact) |
| Database password (in `DATABASE_URL`) | Postgres auth | Rotate at Neon/Render → update env → redeploy |

---

## When to rotate

- **Scheduled:** Every 12 months for all secrets (calendar reminder).
- **After:** Suspected leak (push to public repo, leaked screenshot, departing engineer who had access).
- **After:** Any P0/P1 security finding involving the secret.
- **Before:** Production launch (rotate all values used in dev/staging so prod is unique).

Set a calendar reminder for the next rotation date the day you complete one.

---

## Rotating `ENCRYPTION_KEY`

This is the most dangerous rotation. The key encrypts user PII columns; changing it without re-encrypting historical rows makes those rows unreadable. **Always test on staging first.**

### Steps

1. **Generate the new key:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   The output is a 64-character hex string (32 bytes).

2. **Stage the new key alongside the old one.** Add a temporary `ENCRYPTION_KEY_NEXT` env var holding the new value. Keep `ENCRYPTION_KEY` set to the *old* value during the migration.

3. **Run a re-encrypt migration script** that for every encrypted column on every row:
   - Decrypts with the old key (`ENCRYPTION_KEY`)
   - Re-encrypts with the new key (`ENCRYPTION_KEY_NEXT`)
   - Recomputes `emailHash` using the new key
   - Writes back inside a transaction

   Encrypted columns (as of 2026-05-17):
   - `users.email`, `users.firstName`, `users.lastName`, `users.businessName`
   - `users.phone`, `users.whatsappNumber`, `users.shippingMark`
   - `users.dateOfBirth`, `users.emergencyContactName`, `users.emergencyContactPhone`, `users.nationalId`
   - `users.addressStreet`
   - `users.emailHash` (recomputed, not re-encrypted)
   - Any other column added later — search for `encrypt(` in services.

4. **Promote the new key.** Swap `ENCRYPTION_KEY` to the new value, remove `ENCRYPTION_KEY_NEXT`, redeploy.

5. **Verify** by logging in as a customer, decrypting a profile, and confirming the email lookup still works.

6. **Securely delete the old key** from password manager / dashboards once you've confirmed the new key works for at least 7 days.

> **If you only need to rotate because the old key is suspected compromised:** the data encrypted under that key is already at risk. Re-encrypting prevents *future* damage; you still need to consider notification under GDPR/NDPR if the compromise is confirmed.

---

## Rotating `JWT_SECRET`

This invalidates every active staff/superadmin session immediately. Users will be forced to log in again.

### Steps

1. **Generate:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Update env in all environments** (Render dashboard or `fly.toml` secrets).

3. **Redeploy.** Existing JWTs will fail signature verification → users get 401 and re-login.

4. **Clear the `revoked_tokens` table** *(optional)* — the old JTIs are now meaningless since the secret changed.

No data migration required. Schedule rotations during low-traffic hours so the re-login churn is minimal.

---

## Rotating VAPID keys

VAPID keys sign Web Push notifications. Rotating them invalidates every existing push subscription — users must re-subscribe.

### Steps

1. **Generate:**
   ```bash
   npx web-push generate-vapid-keys
   ```

2. **Update both env vars** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) and redeploy.

3. **Truncate `push_subscriptions` table** — old subscriptions are now dead weight.

4. **Notify users** to re-enable push if they want it; FE should detect failures and prompt re-subscribe.

---

## Verification checklist

After any rotation:

- [ ] App restarts cleanly (env-validation Zod schema passes at boot)
- [ ] `/health` returns 200
- [ ] A customer can log in and view their profile (PII decrypts correctly)
- [ ] A staff member can log in (JWT issuance + verification works)
- [ ] A payment can be initialized and a webhook is accepted (PAYSTACK_SECRET_KEY)
- [ ] An upload presign URL is generated and resolves (R2 keys)
- [ ] Old secret value is removed from password manager and `.env` backups

---

## Operational notes

- **Never commit secrets to git** — verify `.env` is in `.gitignore` (it is).
- **Never share secrets via chat** — use 1Password / Bitwarden / one-time-secret links.
- **One secret per environment** — dev, staging, prod must have distinct values for every secret. Don't reuse.
- **Audit access** — record who knows each secret. Rotate when anyone with access leaves.
