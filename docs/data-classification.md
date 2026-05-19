# Data Classification

Defines the sensitivity tiers used in the backend and the handling rules for each.

## Tiers

| Tier | Examples | At-rest | In transit | In logs | Retention | Cross-border |
|---|---|---|---|---|---|---|
| **T1 — Highly Sensitive** | Passwords, encryption keys, JWT secrets, Paystack/Clerk secrets, payment card data, national ID | Hashed (bcrypt/argon2) or AES-256-GCM | TLS 1.2+ only | NEVER (redacted) | Per regulation only | Subject to NDPR/GDPR/PIPA |
| **T2 — Sensitive / PII** | Email, phone, full name, address street, date of birth, emergency contact, business name, shipping mark | AES-256-GCM (column-level) | TLS | NEVER (redacted in pino) | Until account erasure + retention period for transactions | Restricted to processing locations |
| **T3 — Internal** | Order details, tracking numbers, shipment metadata, support ticket messages | Plain text (DB-level encryption at rest via provider) | TLS | OK, but no PII | 7 years (financial records) | Same as T2 |
| **T4 — Public** | Marketing pages, gallery items, pricing tiers, shipment-type catalog, public tracking events | Plain text | TLS optional but used | OK | Indefinite | None |

## Column-level inventory

### T1 — Hashed / never decryptable
- `users.passwordHash` — bcrypt (cost 12)
- `revokedTokens.jti` — opaque token ID
- `passwordResetOtps.otp` — short-lived, single-use

### T2 — Encrypted PII (AES-256-GCM)
Source of truth: search the codebase for `encrypt(...)` calls.

Currently:
- `users.email` (encrypted) + `users.emailHash` (HMAC for lookup)
- `users.firstName`, `users.lastName`, `users.businessName`
- `users.phone`, `users.whatsappNumber`, `users.shippingMark`
- `users.dateOfBirth`, `users.emergencyContactName`, `users.emergencyContactPhone`, `users.nationalId`
- `users.addressStreet`
- `galleryClaims.claimantFullName`, `claimantEmail`, `claimantPhone` (encrypted via `encrypt()` in gallery service)

### T3 — Internal (clear in DB, gated by auth)
- `orders.*` (except encrypted fields above), `orderPackages.*`
- `payments.*`
- `invoices.*`, `invoiceAttachments.*`
- `supportTickets.*`, `supportMessages.*`
- `shipmentMeasurements.*`, `dispatchBatches.*`
- `auditLogs.*`
- `pricingRules.*`, `customerPricingOverrides.*`
- `notifications.*`

### T4 — Public (no auth needed to read)
- `galleryItems.*` where `isPublished = true`
- `pricingRules.*` exposed via `/api/v1/public/calculator/rates`
- `appSettings.shipmentTypeCatalog`
- Tracking-by-number response for `/api/v1/orders/track/:trackingNumber`

## Handling rules per tier

### T1
- Never logged. Pino redact list ([src/app.ts](../src/app.ts)) covers `authorization`, `cookie`, signature headers, `password`, `newPassword`, `currentPassword`, `token`, `otp`, `cardNumber`, `cvv`.
- Never returned in API responses.
- Never sent over chat, email plaintext, or commit messages.
- Rotation: see [key-rotation-runbook.md](key-rotation-runbook.md).

### T2
- Encrypted at rest via `src/utils/encryption.ts` (`AES-256-GCM`, 32-byte key, random IV per row).
- Pino redact list also covers `email`, `phone`, `whatsappNumber`, `firstName`, `lastName`, `nationalId`, `dateOfBirth`.
- Decrypted only inside service layer and only for authorized callers (ownership + role checks).
- HTTP responses carry `Cache-Control: no-store, private` for any authenticated PII route.
- Erasure: `usersService.eraseUserPersonalData()` scrubs to tombstone values while keeping the row as an FK anchor for T3 records.

### T3
- Plain text in DB; provider-level encryption-at-rest covers the underlying disks.
- Access gated by `authenticate` middleware + ownership checks.
- Logged at INFO with body redaction; full request bodies only at DEBUG in non-prod.
- Retention: 7 years for financial records (NGN tax law); align with audit/regulatory needs.

### T4
- No auth required.
- Should not contain any T1/T2 data. Code review must reject any controller returning encrypted fields on a public route.

## Cross-border considerations

- **NDPR (Nigeria):** Customers' PII can be processed cross-border with consent. Lawful basis for processing is contract performance (shipping service).
- **GDPR:** If EU customers are added in future, an Article 28 processing agreement with sub-processors (Render, Cloudflare, Paystack, Clerk) is required.
- **PIPA (South Korea):** Customer data originates from Korea; storage in non-Korean facilities requires explicit consent on signup. Confirm Clerk and Render disclose locations in the user-facing consent flow.

## When this doc must be updated

- A new column is added that holds PII → add to T2 list and confirm encryption.
- A new public endpoint is added → confirm payload doesn't leak T2/T3.
- A new external sub-processor is integrated (e.g., a different SMS gateway, a new analytics tool) → update Cross-border section.
- Pino redact list is changed → update T1/T2 handling rules.

## Related

- [SECURITY.md](../SECURITY.md) — vulnerability reporting
- [SECURITY_CHECKLIST.md](../SECURITY_CHECKLIST.md) — ASVS L2 status
- [key-rotation-runbook.md](key-rotation-runbook.md)
- [threat-model.md](threat-model.md)
