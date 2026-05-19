# Global Express Backend — API Reference

Complete inventory of every HTTP and WebSocket endpoint, with payloads, success responses, error bodies, expected request headers, and FE usage notes.

- **Total HTTP endpoints:** 163
- **WebSocket endpoints:** 1 (`/ws`)
- **All routes mounted under `/api/v1`** except `/health`, `/webhooks/*`, and `/ws`.
- **All authenticated endpoints expect `Authorization: Bearer <token>`** unless noted.

---

## Conventions

### Required headers (every request)

| Header | Value | When |
|---|---|---|
| `Content-Type` | `application/json` | Any request with a JSON body. Empty bodies on PATCH/DELETE are accepted with this header. |
| `Authorization` | `Bearer <jwt>` | Authenticated endpoints. Token is either a Clerk JWT (customers) or in-house JWT (staff/superadmin). |
| `Accept` | `application/json` | Recommended; the API only emits JSON except for the PDF export. |

### Response headers stamped by the server

| Header | Value | Where |
|---|---|---|
| `Cache-Control` | `no-store, private` | All authenticated/PII routes (auth, users, admin, internal, payments, orders, dashboard, notifications, shipments, team, support, reports) |
| `Pragma` | `no-cache` | Same routes as above |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | All responses |
| `X-Content-Type-Options` | `nosniff` | All responses (via helmet) |
| `Content-Security-Policy` | strict, self-only | All responses (via helmet) |
| `Content-Disposition` | `attachment; filename=...` | `GET /users/me/export` (PDF download) only |

### Webhook-specific headers (inbound)

| Endpoint | Required header | Purpose |
|---|---|---|
| `POST /api/v1/payments/webhook` | `x-paystack-signature` | HMAC-SHA512 of raw body, signed with PAYSTACK_SECRET_KEY |
| `POST /webhooks/clerk` | `svix-id`, `svix-timestamp`, `svix-signature` | Svix-standard webhook signing for Clerk |

### Success response envelope

Most endpoints wrap data:

```json
{ "success": true, "data": <T> }
```

The few legacy `auth` endpoints (`/auth/login`, `/auth/me`, `/auth/forgot-password/*`, `/auth/mfa/verify`, `/auth/mfa/recovery`) return a flat shape without the envelope (matches the operator-dashboard contract).

### Error response envelope

Standard error body:

```json
{ "success": false, "message": "<human-readable>" }
```

Validation failures additionally include the failure list:

```json
{ "success": false, "message": "Validation failed", "errors": [ { "instancePath": "...", "message": "..." } ] }
```

Legacy `auth/*` endpoints return `{ "message": "..." }` without `success`.

### HTTP status codes used

| Code | Meaning in this API |
|---|---|
| 200 | Success (GET/PATCH/PUT/DELETE) |
| 201 | Created (POST that creates a resource) |
| 400 | Validation failed (Zod schema rejected the payload) |
| 401 | Missing or invalid token; bad credentials |
| 403 | Authenticated but not permitted (wrong role, BOLA, IP allowlist) |
| 404 | Resource not found |
| 409 | Conflict (duplicate email, state-machine violation, already enrolled) |
| 422 | Semantic validation failure (profile incomplete, callbackUrl not in allowlist, missing payer) |
| 423 | Locked — account locked-out after 5 failed logins; includes `lockedUntil` ISO timestamp |
| 429 | Rate limit exceeded; includes a human-readable retry hint |
| 500 | Internal server error (in production the message is generic) |
| 503 | Service unavailable (e.g. webhook secret not configured) |

### Rate-limit headers (on every response)

| Header | Meaning |
|---|---|
| `x-ratelimit-limit` | Max requests in the current window |
| `x-ratelimit-remaining` | Requests remaining in the current window |
| `x-ratelimit-reset` | Seconds until the window resets |
| `retry-after` | Seconds to wait (only on 429) |

Global default: **100 requests / minute / IP**. Per-route overrides are called out in each endpoint's FE notes.

### Common pagination contract

Endpoints returning lists accept:

| Query param | Default | Max |
|---|---|---|
| `page` | 1 | — |
| `limit` | 20 | 100 |

Response shape:

```json
{
  "success": true,
  "data": [...],
  "pagination": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 }
}
```

### MFA login flow (FE must handle)

When an internal user has TOTP MFA enrolled, login does NOT return an access token directly. Two-step flow:

1. `POST /auth/login` (or `/internal/auth/login`) with email + password
2. If response is `{ mfaRequired: true, mfaToken, userId }`: prompt for 6-digit code, call `POST /auth/mfa/verify` with `{ mfaToken, code }`. Receives the access token.
3. Recovery alternative: `POST /auth/mfa/recovery` with `{ mfaToken, recoveryCode }`.

The `mfaToken` is a short-lived JWT (5 min). If it expires, restart at step 1.

If the login response shape is regular but `user.mustEnrollMfa === true`, the user is logged in but the FE should immediately route them to MFA enrollment (mirrors `mustChangePassword` / `mustCompleteProfile`).

---

## Table of Contents

- [Health](#health)
- [Auth — `/api/v1/auth`](#auth)
- [Users — `/api/v1/users`](#users)
- [Orders — `/api/v1/orders`](#orders)
- [Payments — `/api/v1/payments`](#payments)
- [Uploads — `/api/v1/uploads`](#uploads)
- [Reports — `/api/v1/reports`](#reports)
- [Webhooks — `/webhooks`](#webhooks)
- [Internal — `/api/v1/internal`](#internal)
- [Dashboard — `/api/v1/dashboard`](#dashboard)
- [Notifications — `/api/v1/notifications`](#notifications)
- [Shipments — `/api/v1/shipments`](#shipments)
- [Team — `/api/v1/team`](#team)
- [Admin — `/api/v1/admin`](#admin)
- [Settings — `/api/v1/settings`](#settings)
- [Support — `/api/v1/support`](#support)
- [Public — `/api/v1/public`](#public)
- [Gallery — `/api/v1/gallery`](#gallery)
- [WebSocket — `/ws`](#websocket)

---

## Health

### `GET /health`
**Use:** liveness probe — FE doesn't normally call this, but uptime checks and Render rely on it.
**Auth:** none.
**Headers:** none required.
**Payload:** none.
**Success 200:** `{ "status": "ok", "timestamp": "<ISO 8601>" }`.
**Errors:** none expected.

---

## Auth
File: [src/routes/auth.routes.ts](src/routes/auth.routes.ts)

> The `auth/*` endpoints use the **legacy flat envelope** (no `success` wrapper) on responses and errors — matches the operator-dashboard contract.

### `POST /api/v1/auth/register`
**Use:** informational — directs FE to Clerk SDK. Customers register via Clerk's `useSignUp()` hook.
**Auth:** none.
**Payload:** empty `{}`.
**Success 200:** `{ "message": "...", "clerkSignUpUrl": "https://..." }`.
**Errors:** none in practice.

### `POST /api/v1/auth/sync`
**Use:** call this immediately after a customer finishes Clerk signup/login. Provisions the user row in our DB. Idempotent — safe to call on every Clerk session bootstrap.
**Auth:** Bearer (Clerk token).
**Payload:** none.
**Success 200:** `{ "success": true, "data": <FullUser> }` — see [Users](#users) for the User shape.
**Errors:** 401 (no token), 409 (race during creation).

### `POST /api/v1/auth/login`
**Use:** operator (staff/superadmin) sign-in. Customers DO NOT use this — they use Clerk.
**Auth:** none.
**Rate limit:** 5/min/IP.
**Special header:** subject to `ADMIN_IP_WHITELIST` if configured — returns 403 if IP not on list.
**Payload:**
```json
{ "email": "staff@example.com", "password": "string" }
```
**Success 200 (no MFA):**
```json
{
  "user": { "id": "...", "email": "...", "firstName": "...", "lastName": "...", "role": "staff|superadmin", "mustChangePassword": false, "mustCompleteProfile": false, "mustEnrollMfa": false, "createdAt": "...", "updatedAt": "..." },
  "tokens": { "accessToken": "<jwt>" }
}
```
**Success 200 (MFA enrolled — challenge required):**
```json
{ "mfaRequired": true, "mfaToken": "<short-lived jwt>", "userId": "..." }
```
**Errors:**
- 401 `{ "message": "Invalid email or password" }`
- 423 `{ "message": "Account locked due to too many failed attempts. Try again later.", "lockedUntil": "<ISO 8601>" }` — after 5 failures
- 403 (IP allowlist denied) `{ "success": false, "message": "Forbidden — request IP not in admin allowlist" }`
- 429 (rate limit)

**FE Notes:**
- Branch on `mfaRequired === true` to redirect to MFA verify screen.
- Branch on `user.mustEnrollMfa === true` to redirect to MFA enrollment.
- Branch on `mustChangePassword` / `mustCompleteProfile` (existing logic).
- On 423, show countdown to `lockedUntil`. Do not retry until then.

### `POST /api/v1/auth/mfa/verify`
**Use:** exchange the `mfaToken` from `/login` for a real access token using the 6-digit code from the user's authenticator app.
**Auth:** none (the `mfaToken` carries identity).
**Rate limit:** 10/min/IP.
**Subject to:** `ADMIN_IP_WHITELIST` if configured.
**Payload:**
```json
{ "mfaToken": "<from /login>", "code": "123456" }
```
**Success 200:** same shape as `POST /auth/login` success-no-MFA.
**Errors:**
- 401 `{ "message": "MFA challenge expired or invalid" }` — mfaToken bad/expired (>5 min old)
- 401 `{ "message": "Invalid verification code" }` — wrong/stale TOTP

**FE Notes:** if 401 "expired", restart at `/login`. If 401 "Invalid code", clear the input and let the user retry (codes rotate every 30s, drift window is ±30s).

### `POST /api/v1/auth/mfa/recovery`
**Use:** fallback when the user has lost their authenticator. Consumes one recovery code permanently.
**Auth:** none (mfaToken).
**Rate limit:** 5/min/IP.
**Payload:**
```json
{ "mfaToken": "<from /login>", "recoveryCode": "XXXXX-XXXXX" }
```
**Success 200:**
```json
{ "user": <Operator>, "tokens": { "accessToken": "..." }, "remainingRecoveryCodes": 9 }
```
**Errors:**
- 401 `{ "message": "MFA challenge expired or invalid" }`
- 401 `{ "message": "Invalid recovery code" }`

**FE Notes:** Show `remainingRecoveryCodes`. Warn if ≤ 2 and prompt user to regenerate codes after login.

### `GET /api/v1/auth/me`
**Use:** restore operator session on every dashboard page load.
**Auth:** Bearer (internal JWT).
**Payload:** none.
**Success 200:** operator object (id, email, firstName, lastName, role, mustChangePassword, mustCompleteProfile, createdAt, updatedAt).
**Errors:** 401 `{ "message": "..." }`.

**FE Notes:** call this immediately after restoring a stored JWT to validate it before showing the dashboard.

### `POST /api/v1/auth/logout`
**Use:** revoke the current JWT's JTI server-side. Without this, a token remains valid until expiry even after FE clears it.
**Auth:** Bearer (staff or above).
**Payload:** none.
**Success 200:** `{ "message": "Logged out" }`.
**Errors:** 401.

### `POST /api/v1/auth/forgot-password/send-otp`
**Use:** start operator password-reset flow. Sends a 4-digit OTP to the email if the account exists.
**Auth:** none.
**Rate limit:** 3/min/IP.
**Payload:** `{ "email": "staff@example.com" }`.
**Success 200:** `{ "message": "If the account exists, an OTP has been sent." }` — always 200 to prevent enumeration.
**Errors:** 429.

### `POST /api/v1/auth/forgot-password/verify-otp`
**Use:** step 2 of reset — verify the user-entered OTP.
**Auth:** none.
**Rate limit:** 10/min/IP.
**Payload:** `{ "email": "...", "otp": "1234" }`.
**Success 200:** `{ "message": "Code verified successfully" }`.
**Errors:** 400 `{ "message": "Invalid or expired code" }`.

### `POST /api/v1/auth/forgot-password/reset`
**Use:** step 3 of reset — set new password. Requires a previously-verified OTP within 15 min.
**Auth:** none.
**Rate limit:** 5/min/IP.
**Payload:** `{ "email": "...", "password": "min 12 chars" }`.
**Success 200:** `{ "message": "Password reset successfully" }`.
**Errors:** 400 `{ "message": "User not found or reset session expired. Please request a new code." }`.

---

## Users
File: [src/routes/users.routes.ts](src/routes/users.routes.ts)

User object fields (used in responses below): `id, clerkId, email, firstName, lastName, businessName, phone, whatsappNumber, shippingMark, addressStreet, addressCity, addressState, addressCountry, addressPostalCode, role, isActive, canProvisionClientLogin, canManageShipmentBatches, consentMarketing, notifyEmailAlerts, notifySmsAlerts, notifyInAppAlerts, preferredLanguage, deletedAt, createdAt, updatedAt`.

### `GET /api/v1/users/me`
**Use:** fetch the current customer's profile — call on every Clerk session restore.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": <User> }`.
**Errors:** 401.

### `GET /api/v1/users/me/completeness`
**Use:** check whether the user can place an order. Customer must have a complete profile before `POST /orders` will accept their request.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": { "isComplete": boolean, "missingFields": ("name"|"phone"|"addressStreet"|"addressCity"|"addressState"|"addressCountry"|"addressPostalCode")[] } }`.
**Errors:** 401.

**FE Notes:** if `isComplete === false`, route the user to the profile-completion form before letting them open the order wizard.

### `PATCH /api/v1/users/me`
**Use:** update customer's own profile fields.
**Auth:** Bearer.
**Payload (all optional):**
```json
{
  "firstName": "...", "lastName": "...", "businessName": "...",
  "phone": "...", "whatsappNumber": "...",
  "addressStreet": "...", "addressCity": "...", "addressState": "...",
  "addressCountry": "...", "addressPostalCode": "...",
  "shippingMark": "...",
  "consentMarketing": true, "notifyEmailAlerts": true,
  "notifySmsAlerts": true, "notifyInAppAlerts": true,
  "preferredLanguage": "en"
}
```
**Success 200:** `{ "success": true, "data": <User> }`.
**Errors:** 401, 400 (validation).

### `GET /api/v1/users/me/notification-preferences`
**Use:** load notification toggles for the settings screen.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": { "notifyEmailAlerts": bool, "notifySmsAlerts": bool, "notifyInAppAlerts": bool, "consentMarketing": bool } }`.
**Errors:** 401.

### `PATCH /api/v1/users/me/notification-preferences`
**Use:** save notification toggles.
**Auth:** Bearer.
**Payload:** subset of the same 4 booleans.
**Success 200:** same shape as GET.
**Errors:** 401, 400.

### `GET /api/v1/users/me/suppliers`
**Use:** populate the customer's supplier address book on the order wizard.
**Auth:** Bearer.
**Query:** `page, limit (max 100), isActive ('true'|'false')`.
**Success 200:** paginated list of `{ id, displayName, firstName, lastName, businessName, email, phone, whatsappNumber, shippingMark, addressStreet, addressCity, addressState, addressCountry, addressPostalCode, isActive, createdAt, updatedAt, linkedCustomersCount, lastLinkedAt, shipmentUsageCount, lastShipmentUsedAt, source('saved'|'used'|'saved_and_used'), savedAt, usageCount, lastUsedAt }`.
**Errors:** 401, 400.

### `POST /api/v1/users/me/suppliers`
**Use:** add/link a supplier to the customer's address book — by existing supplier id or by inviting a new one via email.
**Auth:** Bearer.
**Payload:** `{ supplierId?: uuid, email?: string, firstName?: string, lastName?: string, businessName?: string, phone?: string }` — `supplierId` OR `email` required.
**Success 200:** `{ "success": true, "data": { "supplier": <Supplier>, "createdSupplier": bool, "linkedNow": bool } }`.
**Errors:** 401, 400, 422.

### `POST /api/v1/users/me/suppliers/:supplierId/update-request`
**Use:** propose a correction to a supplier's contact details. Goes through a supplier-approval flow.
**Auth:** Bearer.
**Payload:** at least one of `{ firstName, lastName, businessName, phone, email }` + optional `note (max 1000)`.
**Success 201:** `{ "success": true, "data": <SupplierUpdateRequest> }`.
**Errors:** 401, 400, 404.

### `GET /api/v1/users/me/suppliers/update-requests`
**Use:** list customer's outgoing supplier-update requests for the audit screen.
**Auth:** Bearer.
**Query:** `page, limit, status ('pending'|'accepted'|'rejected')`.
**Success 200:** paginated `<SupplierUpdateRequest>` list.

### `GET /api/v1/users/me/suppliers/validation-requests`
**Use:** for a supplier-role user — list incoming update requests to validate.
**Auth:** Bearer.
**Query:** `page, limit, status`.
**Success 200:** paginated `<SupplierUpdateRequest>` list.

### `PATCH /api/v1/users/me/suppliers/validation-requests/:id`
**Use:** supplier accepts/rejects a customer's proposed update.
**Auth:** Bearer.
**Payload:** `{ "isTrue": boolean, "note?": "string (max 1000)" }`.
**Success 200:** `{ "success": true, "data": <SupplierUpdateRequest> }`.
**Errors:** 401, 403, 404.

### `DELETE /api/v1/users/me`
**Use:** GDPR right-to-erasure. **Irreversible.** Scrubs all PII; the row remains as an FK anchor for orders/payments under retention policy. Customer cannot log in again after this.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": { "message": "Account erased. Personal data has been removed; transaction records are retained under our retention policy." } }`.
**Errors:** 401, 404.

**FE Notes:** Show a strong confirmation dialog with explicit "this is irreversible" wording. After 200, force log out and clear all local state.

### `GET /api/v1/users/me/export`
**Use:** GDPR data-portability — downloads a PDF of all the user's data (profile + orders + payments).
**Auth:** Bearer.
**Response:** binary PDF. `Content-Disposition: attachment; filename=user-export-<id>.pdf`.
**Errors:** 401.

**FE Notes:** treat this as a file download, not JSON. Use `<a download>` or `fetch().then(r => r.blob())`.

### `GET /api/v1/users/`
**Use:** admin user-management list.
**Auth:** Bearer (admin+).
**Query:** `page, limit, role ('user'|'supplier'|'staff'|'superadmin'), isActive`.
**Success 200:** paginated `<User>` list.
**Errors:** 401, 403.

### `GET /api/v1/users/suppliers`
**Use:** admin supplier list (more detail than the customer-scoped one).
**Auth:** Bearer (admin+).
**Query:** `page, limit, isActive`.
**Success 200:** paginated supplier list (admin shape).
**Errors:** 401, 403.

### `GET /api/v1/users/:id`
**Use:** admin views a specific user.
**Auth:** Bearer (admin+).
**Success 200:** `{ "success": true, "data": <User> }`.
**Errors:** 401, 403, 404.

### `PATCH /api/v1/users/:id`
**Use:** admin edits any user's profile.
**Auth:** Bearer (admin+).
**Payload:** any subset of `{ firstName, lastName, businessName, phone, whatsappNumber, addressStreet, addressCity, addressState, addressCountry, addressPostalCode, shippingMark, isActive, preferredLanguage }`.
**Success 200:** `{ "success": true, "data": <User> }`.
**Errors:** 401, 403, 404, 400.

### `PATCH /api/v1/users/:id/role`
**Use:** promote/demote a user. Staff cannot assign superadmin (would 403).
**Auth:** Bearer (admin+).
**Payload:** `{ "role": "user|supplier|staff|superadmin" }`.
**Success 200:** `{ "success": true, "data": <User> }`.
**Errors:** 401, 403, 404.

### `PATCH /api/v1/users/:id/client-login-permission`
**Use:** superadmin toggles a staff member's ability to provision customer login links.
**Auth:** Bearer (superadmin).
**Payload:** `{ "canProvisionClientLogin": boolean }`.
**Success 200:** `{ "success": true, "data": <User> }`.

### `PATCH /api/v1/users/:id/shipment-batch-permission`
**Use:** superadmin toggles a staff member's ability to manage shipment batches.
**Auth:** Bearer (superadmin).
**Payload:** `{ "canManageShipmentBatches": boolean }`.
**Success 200:** `{ "success": true, "data": <User> }`.

### `DELETE /api/v1/users/:id`
**Use:** superadmin soft-deletes a user (sets deletedAt). Not a GDPR erasure — use `/users/me` for that.
**Auth:** Bearer (superadmin).
**Success 200:** `{ "success": true, "data": { "message": "User deleted" } }`.
**Errors:** 401, 403, 404.

---

## Orders
File: [src/routes/orders.routes.ts](src/routes/orders.routes.ts)

Order object fields: `id, trackingNumber, senderId, recipientName, recipientAddress, recipientPhone, recipientEmail, origin, destination, orderDirection, weight, declaredValue, description, shipmentType, shipmentPayer, billingSupplierId, transportMode, isPreorder, departureDate, eta, statusV2, customerStatusV2, priceCalculatedAt, priceCalculatedBy, calculatedChargeUsd, specialPackagingSurchargeUsd, finalChargeUsd, pricingSource, paymentCollectionStatus, amountDue, pickupRepName, pickupRepPhone, createdBy, deletedAt, createdAt, updatedAt`.

### `GET /api/v1/orders/track/:trackingNumber`
**Use:** **public tracking page** — anyone with a tracking number can view shipment status. No PII.
**Auth:** none.
**Success 200:** `{ "success": true, "data": { trackingNumber, status, statusLabel, origin, destination, estimatedDelivery, lastUpdate, lastLocation, paymentStatus('pending'|'completed'), shipmentCost: { usd, ngn, invoiceStatus }, vendorCount, cargoMetrics: { packageCount, totalWeightKg, totalCbm }, timeline: [{ status, statusLabel, timestamp }] } }`.
**Errors:** 404 `{ success: false, message: "Tracking number not found" }`.

**FE Notes:** safe to embed on marketing pages. No login wall.

### `GET /api/v1/orders/my-shipments`
**Use:** populate the customer dashboard's shipment list.
**Auth:** Bearer.
**Query:** `page, limit`.
**Success 200:** paginated array of `{ type: "solo", id, trackingNumber, origin, destination, statusV2, orderDirection, recipientName, recipientAddress, recipientPhone, recipientEmail, weight, declaredValue, description, shipmentType, departureDate, eta, invoiceStatus?, invoiceTotalUsd?, invoiceTotalNgn?, createdAt, updatedAt }`.
**Errors:** 401.

### `POST /api/v1/orders/`
**Use:** create a new shipment order (customer or staff-on-behalf-of).
**Auth:** Bearer.
**Rate limit:** **20/min/user** (per-user, not per-IP).
**Payload:**
```json
{
  "senderId": "uuid (staff only)",
  "recipientName": "string",
  "recipientAddress": "string?",
  "recipientPhone": "string",
  "recipientEmail": "string?",
  "orderDirection": "outbound|inbound",
  "weight": "string?", "declaredValue": "string?", "description": "string?",
  "shipmentType": "air|ocean|d2d",
  "shipmentPayer": "USER|SUPPLIER",
  "billingSupplierId": "uuid (required when shipmentPayer=SUPPLIER)",
  "pickupRepName": "string?", "pickupRepPhone": "string?"
}
```
**Success 201:** `{ "success": true, "data": <Order> }`.
**Errors:**
- 401
- 400 (validation)
- 422 `{ success: false, message: "Profile incomplete — missing: name, phone, addressStreet, ..." }` — customer profile not complete
- 422 `{ success: false, message: "billingSupplierId required when shipmentPayer=SUPPLIER" }`
- 429

**FE Notes:** call `/users/me/completeness` first; if incomplete, route to profile form before opening the wizard to avoid the 422.

### `POST /api/v1/orders/estimate`
**Use:** real-time price estimate inside the order wizard.
**Auth:** Bearer.
**Payload:** `{ "shipmentType": "air|ocean", "weightKg?": number, "cbm?": number }`.
**Success 200:** `{ "success": true, "data": { mode: "air"|"sea", weightKg, cbm, estimatedCostUsd, pricingSource, departureFrequency, estimatedTransitDays, disclaimer } }`.
**Errors:** 401, 400.

### `GET /api/v1/orders/`
**Use:** customer's order list (or staff filtering by sender).
**Auth:** Bearer.
**Query:** `page, limit, statusV2 (enum), senderId (staff+ only)`.
**Success 200:** paginated `<Order>` list.
**Errors:** 401, 403 (customer using senderId).

### `GET /api/v1/orders/:id`
**Use:** order detail view. BOLA-protected (customers see only their own).
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": <Order> }`.
**Errors:** 401, 403, 404.

### `GET /api/v1/orders/:id/timeline`
**Use:** full timeline view for the order detail screen — includes goods breakdown, invoice info, and chronological events.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": { orderId, trackingNumber, status, statusLabel, internalStatus, internalStatusLabel, origin, destination, estimatedDelivery, lastUpdate, lastLocation, paymentStatus, shipmentCost, vendorCount, cargoMetrics, goodsBreakdown: [{ id, description, itemType, quantity, weightKg, cbm, dimensionsCm: {length,width,height}, itemCostUsd, requiresExtraTruckMovement, arrivalAt, supplierId, supplierName }], invoice: { id, invoiceNumber, status, shipmentPayer, totalUsd, totalNgn, fxRateNgnPerUsd, finalizedAt, paidAt } | null, timeline: [{ id?, status, statusLabel, internalStatus?, internalStatusLabel?, timestamp }] } }`.
**Errors:** 401, 403, 404.

### `PATCH /api/v1/orders/:id/status`
**Use:** staff updates an individual order's status.
**Auth:** Bearer (staff+).
**Payload:** `{ "statusV2": "<ShipmentStatusV2 enum>" }`.
**Success 200:** `{ "success": true, "data": <Order> }`.
**Errors:** 401, 403, 404, 422 (invalid transition).

### `PATCH /api/v1/orders/:id/pickup-rep`
**Use:** customer assigns/updates the pickup-rep contact for a shipment.
**Auth:** Bearer.
**Payload:** `{ "pickupRepName": "string", "pickupRepPhone": "string" }`.
**Success 200:** `{ "success": true, "data": <Order> }`.
**Errors:** 401, 403, 404.

### `POST /api/v1/orders/:id/warehouse-verify`
**Use:** staff records the actual measurements + packages on warehouse intake. Triggers pricing recalculation.
**Auth:** Bearer (staff+).
**Payload:**
```json
{
  "transportMode": "air|sea?",
  "departureDate": "ISO 8601?",
  "packages": [{
    "supplierId": "uuid?", "arrivalAt": "ISO?", "description": "?", "itemType": "?",
    "quantity": 1, "lengthCm": 0, "widthCm": 0, "heightCm": 0, "weightKg": 0, "cbm": 0,
    "itemCostUsd": 0, "requiresExtraTruckMovement": false,
    "specialPackagingType": "string?", "isRestricted": false, "restrictedReason": "?",
    "restrictedOverrideApproved": false, "restrictedOverrideReason": "?"
  }]
}
```
**Success 200:** `{ "success": true, "data": <Order> }`.
**Errors:** 401, 403, 404, 422.

### `DELETE /api/v1/orders/:id`
**Use:** admin soft-deletes an order.
**Auth:** Bearer (admin+).
**Success 200:** `{ "success": true, "data": { "message": "Order deleted" } }`.
**Errors:** 401, 403, 404.

### `GET /api/v1/orders/:id/images`
**Use:** list of package photos uploaded for this order (staff-visible).
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": [{ id, orderId, r2Key, r2Url, uploadedBy, createdAt }] }`.
**Errors:** 401, 403, 404.

---

## Payments
File: [src/routes/payments.routes.ts](src/routes/payments.routes.ts)

Payment fields: `id, orderId, invoiceId, userId, amount, currency, paystackReference, paystackTransactionId, status('pending'|'successful'|'failed'|'abandoned'), paymentType('online'|'transfer'|'cash'), recordedBy, proofReference, note, paidAt, metadata, createdAt, updatedAt`.

### `POST /api/v1/payments/initialize`
**Use:** start a Paystack checkout. Returns the URL to redirect/iframe.
**Auth:** Bearer.
**Rate limit:** 10/min.
**Payload:**
```json
{
  "orderId": "uuid? (legacy)",
  "invoiceId": "uuid? (preferred)",
  "amount": 500000,
  "currency": "NGN?",
  "callbackUrl": "https://yourfrontend.tld/payment/callback?"
}
```
`amount` is in kobo. Either `orderId` or `invoiceId` is required.
**Success 201:** `{ "success": true, "data": { "payment": <Payment>, "authorizationUrl": "https://checkout.paystack.com/...", "reference": "ref_..." } }`.
**Errors:**
- 401
- 400 (validation)
- 422 `{ success: false, message: "callbackUrl origin \"https://foo\" is not in the allowed list" }` — must be in `CORS_ORIGINS`
- 422 `{ success: false, message: "callbackUrl must use http(s)" }`
- 422 (no orderId or invoiceId)
- 403 (BOLA — not your invoice)

**FE Notes:** the `callbackUrl` MUST point to a domain in `CORS_ORIGINS`. Always pass your own production/staging origin — Paystack will redirect the browser back here after payment.

### `POST /api/v1/payments/receipts/presign`
**Use:** customer/staff uploads proof-of-payment receipt — step 1 (get a presigned R2 URL).
**Auth:** Bearer.
**Payload:** `{ "orderId": "uuid", "contentType": "application/pdf|image/jpeg|image/jpg|image/png|image/webp", "originalFileName?": "string" }`.
**Success 200:** `{ "success": true, "data": { "uploadUrl": "https://...", "r2Key": "...", "publicUrl": "https://...", "expiresInSeconds": 300 } }`.
**Errors:** 401, 400.

**FE Notes:** PUT the file binary directly to `uploadUrl` from the browser (do NOT proxy through the API). Then call `/payments/receipts` with the `r2Key`.

### `POST /api/v1/payments/receipts`
**Use:** step 2 — submit the receipt metadata referencing the uploaded R2 key.
**Auth:** Bearer.
**Payload:** `{ "orderId": "uuid", "amount": number, "currency?": "NGN", "r2Key": "string", "referenceCode?": "string", "note?": "string" }`.
**Success 201:** `{ "success": true, "data": <Payment> }`.
**Errors:** 401, 400, 404.

### `PATCH /api/v1/payments/receipts/:id/verify`
**Use:** superadmin reviews and approves/rejects a submitted offline receipt.
**Auth:** Bearer (superadmin).
**Payload:** `{ "decision": "approve|reject", "note?": "string" }`.
**Success 200:** `{ "success": true, "data": <Payment> }`.
**Errors:** 401, 403, 404.

### `POST /api/v1/payments/verify/:reference`
**Use:** after a Paystack redirect, FE calls this to confirm the payment status before showing success/failure UI. **Idempotent** — duplicate calls return the cached successful payment without re-firing webhooks.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": <Payment> }`.
**Errors:** 401, 404 (reference not found).

### `POST /api/v1/payments/webhook`
**Use:** **Paystack-side only** — FE never calls this. Paystack delivers `charge.success` / `charge.failed` events here.
**Auth:** HMAC signature in `x-paystack-signature` header (SHA-512 of raw body using `PAYSTACK_SECRET_KEY`).
**Rate limit:** 50/min.
**Payload:** raw Paystack event JSON.
**Success 200:** `{ "success": true }`.
**Errors:** 400 (bad/missing signature).

### `GET /api/v1/payments/me`
**Use:** customer's own payment history.
**Auth:** Bearer.
**Query:** `page, limit, status`.
**Success 200:** paginated `<Payment>` list.
**Errors:** 401.

### `GET /api/v1/payments/`
**Use:** superadmin views all payments.
**Auth:** Bearer (superadmin).
**Query:** `page, limit, userId, status`.
**Success 200:** paginated `<Payment>` list.
**Errors:** 401, 403.

### `GET /api/v1/payments/:id`
**Use:** superadmin views a specific payment.
**Auth:** Bearer (superadmin).
**Success 200:** `{ "success": true, "data": <Payment> }`.
**Errors:** 401, 403, 404.

### `POST /api/v1/payments/:orderId/record-offline`
**Use:** staff records a transfer/cash payment received outside Paystack.
**Auth:** Bearer (staff+).
**Payload:** `{ "userId": "uuid", "invoiceId?": "uuid", "amount": number, "paymentType": "transfer|cash", "proofReference?": "string", "note?": "string" }`.
**Success 201:** `{ "success": true, "data": <Payment> }`.
**Errors:** 401, 403, 404.

---

## Uploads
File: [src/routes/uploads.routes.ts](src/routes/uploads.routes.ts)

### `POST /api/v1/uploads/presign`
**Use:** staff uploads a package photo — step 1 (presigned R2 URL).
**Auth:** Bearer (staff+).
**Payload:** `{ "orderId": "uuid", "contentType": "image/jpeg|image/jpg|image/png|image/webp" }`.
**Success 200:** `{ "success": true, "data": { "uploadUrl": "https://...", "r2Key": "...", "publicUrl": "https://...", "expiresInSeconds": 300 } }`.
**Errors:** 401, 403, 400 (bad content-type).

### `POST /api/v1/uploads/confirm`
**Use:** step 2 — register the uploaded photo against the order.
**Auth:** Bearer (staff+).
**Payload:** `{ "orderId": "uuid", "r2Key": "string" }`.
**Success 201:** `{ "success": true, "data": { id, orderId, r2Key, r2Url, uploadedBy, createdAt } }`.
**Errors:** 401, 403, 404.

### `GET /api/v1/uploads/orders/:orderId/images`
**Use:** list photos for an order.
**Auth:** Bearer (BOLA: customer can only see their own order's images).
**Success 200:** `{ "success": true, "data": [<Image>] }`.
**Errors:** 401, 403, 404.

### `DELETE /api/v1/uploads/images/:imageId`
**Use:** admin removes an uploaded image.
**Auth:** Bearer (admin+).
**Success 200:** `{ "success": true, "data": { "message": "Image deleted" } }`.
**Errors:** 401, 403, 404.

---

## Reports
File: [src/routes/reports.routes.ts](src/routes/reports.routes.ts)

Common query params (where indicated): `from (ISO 8601, default 12 months ago), to (ISO 8601, default now), groupBy ('day'|'week'|'month', default month)`.

### `GET /api/v1/reports/summary`
**Use:** superadmin dashboard headline numbers.
**Auth:** Bearer (superadmin).
**Success 200:** `{ "success": true, "data": { "totalOrders": number, "totalUsers": number, "totalRevenue": number } }`.
**Errors:** 401, 403.

### `GET /api/v1/reports/orders/by-status`
**Use:** pie chart of orders by status.
**Auth:** Bearer (admin+).
**Success 200:** `{ "success": true, "data": [{ "status": string, "count": number }] }`.
**Errors:** 401, 403.

### `GET /api/v1/reports/revenue`
**Use:** revenue trend chart with period-over-period comparison.
**Auth:** Bearer (superadmin).
**Query:** `from, to, groupBy, compareToLastPeriod ('true'|'false')`.
**Success 200:** `{ "success": true, "data": { "periods": [{ "period": "...", "revenue": number, "paymentCount": number, "avgOrderValue": number }], "totals": {...}, "comparison?": { "previousRevenue": ..., "previousPayments": ..., "revenueChange": { "value": number, "direction": "up"|"down" } | null } } }`.
**Errors:** 401, 403.

### `GET /api/v1/reports/shipment-volume`
**Use:** bar chart of shipment volume by transport mode.
**Auth:** Bearer (admin+).
**Query:** `from, to, groupBy`.
**Success 200:** `{ "success": true, "data": { "periods": [{ "period", "total", "air", "sea", "totalWeight", "airWeight", "seaWeight" }], "totals": {...} } }`.
**Errors:** 401, 403.

### `GET /api/v1/reports/top-customers`
**Use:** leaderboard of top customers by chosen metric.
**Auth:** Bearer (admin+).
**Query:** `from, to, sortBy ('orderCount'|'totalWeight'|'revenue'), limit (5-50)`.
**Success 200:** `{ "success": true, "data": [{ customerId, displayName, email, orderCount, totalWeight, avgWeight, revenue? }] }`.
**Errors:** 401, 403.

### `GET /api/v1/reports/delivery-performance`
**Use:** delivery-time stats by mode and month.
**Auth:** Bearer (admin+).
**Query:** `from, to`.
**Success 200:** `{ "success": true, "data": { "overall": {...}, "byTransportMode": [...], "byMonth": [...] } }`.
**Errors:** 401, 403.

### `GET /api/v1/reports/status-pipeline`
**Use:** funnel of in-flight shipments by phase.
**Auth:** Bearer (admin+).
**Query:** `transportMode ('air'|'sea')`.
**Success 200:** `{ "success": true, "data": { "pipeline": [{ status, label, count, percentage, phase('pre_transit'|'air_transit'|'sea_transit'|'lagos_processing'|'terminal') }], "totalActive": number, "totalAll": number } }`.
**Errors:** 401, 403.

### `GET /api/v1/reports/payment-breakdown`
**Use:** payment success/failure stats for the finance screen.
**Auth:** Bearer (superadmin).
**Query:** `from, to`.
**Success 200:** `{ "success": true, "data": { "byType": [...], "byStatus": [...], "collectionStatus": [...] } }`.
**Errors:** 401, 403.

### `GET /api/v1/reports/shipment-comparison`
**Use:** mode-by-mode comparison table (air vs ocean vs D2D).
**Auth:** Bearer (admin+).
**Query:** `from, to`.
**Success 200:** `{ "success": true, "data": { "comparison": [{ transportMode, orderCount, totalWeight, avgWeight, totalRevenue?, avgRevenue?, completedCount, cancelledCount, completionRate, avgDeliveryDays }] } }`.
**Errors:** 401, 403.

---

## Webhooks
File: [src/routes/webhooks.routes.ts](src/routes/webhooks.routes.ts)

### `POST /webhooks/clerk`
**Use:** Clerk-side only — handles `user.updated` (sync profile changes) and `user.deleted` (soft-delete).
**Auth:** Svix signature headers — `svix-id`, `svix-timestamp`, `svix-signature`.
**Rate limit:** 200/min.
**Payload:** Clerk lifecycle event (raw body — signature is verified before parsing).
**Success 200:** `{ "received": true }`.
**Errors:**
- 400 `{ success: false, message: "Invalid webhook signature" }`
- 503 (`CLERK_WEBHOOK_SECRET` not configured)

**FE Notes:** FE never calls this. Configure the URL + secret in Clerk dashboard.

---

## Internal
File: [src/routes/internal.routes.ts](src/routes/internal.routes.ts)

Internal user fields (response): `id, clerkId, email, firstName, lastName, role, isActive, mustChangePassword, mustCompleteProfile, mustEnrollMfa?, createdAt, updatedAt`.

### `POST /api/v1/internal/auth/login`
**Use:** alternative internal-operator login (same flow as `/auth/login` but envelope-wrapped). Use whichever your FE prefers — `/auth/login` is the legacy flat shape; this returns `{ success, data }`.
**Auth:** none.
**Special:** subject to `ADMIN_IP_WHITELIST`.
**Payload:** `{ "email": "...", "password": "..." }`.
**Success 200 (no MFA):** `{ "success": true, "data": { "token": "<jwt>", "user": <InternalUser> } }`.
**Success 200 (MFA challenge):** `{ "success": true, "data": { "mfaRequired": true, "mfaToken": "...", "userId": "..." } }`.
**Errors:**
- 401 `{ success: false, message: "Invalid email or password" }`
- 403 `{ success: false, message: "..." }` (IP allowlist)
- 423 `{ success: false, message: "...", "lockedUntil": "<ISO>" }`

### `POST /api/v1/internal/users`
**Use:** create a new staff or superadmin account. Sends a welcome email with a temp password.
**Auth:** Bearer (admin+). Staff can only create staff; superadmin can create either.
**Payload:** `{ "email": "...", "role": "staff|superadmin", "firstName": "...", "lastName": "..." }`.
**Success 201:** `{ "success": true, "data": <InternalUser> }`.
**Errors:** 401, 403, 409 `{ success: false, message: "An account with that email already exists" }`.

### `PATCH /api/v1/internal/users/:id/password`
**Use:** superadmin force-resets another internal user's password.
**Auth:** Bearer (superadmin).
**Payload:** `{ "newPassword": "min 12 chars" }`.
**Success 200:** `{ "success": true, "data": { "message": "Password updated successfully" } }`.
**Errors:** 401, 403, 404.

### `PATCH /api/v1/internal/me/password`
**Use:** internal user changes their own password. Requires current password.
**Auth:** Bearer (staff+).
**Payload:** `{ "currentPassword": "string", "newPassword": "min 12 chars" }`.
**Success 200:** `{ "success": true, "data": { "message": "Password updated successfully" } }`.
**Errors:** 401, 403.

### `GET /api/v1/internal/me/mfa/status`
**Use:** MFA settings screen — show whether enrolled and how many recovery codes left.
**Auth:** Bearer (staff+).
**Success 200:** `{ "success": true, "data": { "enabled": bool, "enabledAt": "ISO|null", "remainingRecoveryCodes": number, "isRequiredForRole": bool } }`.
**Errors:** 401.

**FE Notes:** if `isRequiredForRole && !enabled` show "MFA required" badge and prompt enrollment. If `remainingRecoveryCodes <= 2`, prompt regeneration.

### `POST /api/v1/internal/me/mfa/enroll`
**Use:** start MFA enrollment — returns the secret to scan/copy into an authenticator app.
**Auth:** Bearer (staff+).
**Success 200:** `{ "success": true, "data": { "secret": "BASE32SECRET", "otpauthUri": "otpauth://totp/..." } }`.
**Errors:**
- 401
- 403 `{ success: false, message: "MFA is only available for internal users" }`
- 404 (user not found)
- 409 `{ success: false, message: "MFA is already enabled. Disable it first to re-enroll." }`

**FE Notes:** render `otpauthUri` as a QR code (e.g. with `qrcode` npm package). Also show `secret` as a copy-paste fallback. Both forms encode the same data.

### `POST /api/v1/internal/me/mfa/verify-enrollment`
**Use:** finish MFA enrollment — verify the first 6-digit code, returns recovery codes (shown **once**).
**Auth:** Bearer (staff+).
**Payload:** `{ "code": "123456" }`.
**Success 200:** `{ "success": true, "data": { "enabled": true, "recoveryCodes": ["XXXXX-YYYYY", ...10], "warning": "Save these recovery codes somewhere safe. Each can be used once and will not be shown again." } }`.
**Errors:**
- 401 `{ success: false, message: "Invalid verification code" }`
- 409 (no enrollment in progress / already enabled)

**FE Notes:** **make the user actively download or copy the recovery codes** before moving on (e.g. a "I've saved them" checkbox + a download-as-text button). They cannot be retrieved later.

### `POST /api/v1/internal/me/mfa/disable`
**Use:** user removes their own MFA. Requires password AND TOTP — so a stolen session can't disable MFA on its own.
**Auth:** Bearer (staff+).
**Payload:** `{ "currentPassword": "string", "code": "123456" }`.
**Success 200:** `{ "success": true, "data": { "enabled": false } }`.
**Errors:** 401 (bad password OR bad TOTP), 409 (MFA not enabled).

### `POST /api/v1/internal/me/mfa/recovery-codes/regenerate`
**Use:** invalidate the existing recovery codes and issue a fresh set. Requires a current TOTP code.
**Auth:** Bearer (staff+).
**Payload:** `{ "code": "123456" }`.
**Success 200:** `{ "success": true, "data": { "recoveryCodes": [...10], "warning": "Previous recovery codes are invalidated. Save these somewhere safe — each can be used once." } }`.
**Errors:** 401, 409.

### `GET /api/v1/internal/me/profile-requirements`
**Use:** profile-completion form — tells the FE which fields to demand based on superadmin's "require national ID" setting.
**Auth:** Bearer (staff+).
**Success 200:** `{ "success": true, "data": { "requireNationalId": bool, "allowedCountries": ["SK", "Nigeria"] } }`.
**Errors:** 401.

### `PATCH /api/v1/internal/me/profile`
**Use:** staff submits profile-completion form on first login.
**Auth:** Bearer (staff+).
**Payload:**
```json
{
  "gender": "male|female|other",
  "dateOfBirth": "string",
  "phone": "string",
  "addressStreet": "...", "addressCity": "...", "addressState": "...",
  "addressCountry": "SK|Nigeria", "addressPostalCode": "...",
  "emergencyContactName": "...", "emergencyContactPhone": "...", "emergencyContactRelationship": "...",
  "nationalId": "string? (required when superadmin enabled it)"
}
```
**Success 200:** `{ "success": true, "data": { "message": "Profile updated" } }`.
**Errors:** 401, 400, 422 (national ID required but missing).

### `GET /api/v1/internal/settings/require-national-id`
**Use:** superadmin admin-settings screen — read the "require national ID" toggle.
**Auth:** Bearer (superadmin).
**Success 200:** `{ "success": true, "data": { "enabled": bool } }`.
**Errors:** 401, 403.

### `PATCH /api/v1/internal/settings/require-national-id`
**Use:** superadmin toggles whether new staff must submit national ID.
**Auth:** Bearer (superadmin).
**Payload:** `{ "enabled": bool }`.
**Success 200:** `{ "success": true, "data": { "enabled": bool, "message": "..." } }`.
**Errors:** 401, 403.

### `GET /api/v1/internal/settings/special-packaging`
**Use:** load the special-packaging surcharge catalog (used during warehouse-verify).
**Auth:** Bearer (staff+).
**Success 200:** `{ "success": true, "data": { "types": [{ "key": "...", "name": "...", "surchargeUsd": number }] } }`.
**Errors:** 401.

### `PUT /api/v1/internal/settings/special-packaging`
**Use:** superadmin edits the special-packaging catalog (full replace).
**Auth:** Bearer (superadmin).
**Payload:** `{ "types": [{ "key": "string", "name": "string", "surchargeUsd": number >= 0 }] }` (0-50 entries).
**Success 200:** `{ "success": true, "data": { "types": [...], "message": "..." } }`.
**Errors:** 401, 403, 400.

### `GET /api/v1/internal/push/vapid-key`
**Use:** Web Push setup — FE fetches the VAPID public key before calling `subscribe`.
**Auth:** Bearer (staff+).
**Success 200:** `{ "success": true, "data": { "vapidPublicKey": "<string>|null" } }`.

### `POST /api/v1/internal/push/subscribe`
**Use:** register a browser Web Push subscription.
**Auth:** Bearer (staff+).
**Payload:** `{ "endpoint": "https://...", "keys": { "p256dh": "...", "auth": "..." }, "deviceLabel?": "string" }`.
**Success 200:** `{ "success": true, "data": { "message": "Subscribed" } }`.
**Errors:** 401, 400, 503 (VAPID not configured).

### `POST /api/v1/internal/push/unsubscribe`
**Use:** unregister a Web Push subscription on logout / disable.
**Auth:** Bearer (staff+).
**Payload:** `{ "endpoint": "https://..." }`.
**Success 200:** `{ "success": true, "data": { "message": "Unsubscribed" } }`.

---

## Dashboard
File: [src/routes/dashboard.routes.ts](src/routes/dashboard.routes.ts)

`changeSchema` = `{ value: number, direction: 'up'|'down' } | null` (period-over-period). Customer vs staff role-gates which `*Spent`/`*Revenue` fields appear.

### `GET /api/v1/dashboard/stats`
**Use:** dashboard headline cards.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": { totalOrders, totalOrdersChange, totalShipments, ..., revenueMtd?, totalSpent?, fxRateNgnPerUsd?, fxRateSource? } }`.
**Errors:** 401.

### `GET /api/v1/dashboard/trends`
**Use:** monthly trend chart.
**Auth:** Bearer.
**Query:** `months (1-12, default 3)`.
**Success 200:** `{ "success": true, "data": [{ "period": "YYYY-MM", "year", "month", "totalShipmentCount", "cancelledShipmentCount", "deliveryCompletedCount", "deliveredWeight", "activeWeight", "totalWeight" }] }`.
**Errors:** 401.

### `GET /api/v1/dashboard/active-deliveries`
**Use:** map/list of in-flight shipments by destination.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": [{ "destination", "shipmentType": "air|ocean|null", "activeCount", "nextEta", "status": "on_time|delayed|unknown" }] }`.
**Errors:** 401.

### `GET /api/v1/dashboard/`
**Use:** convenience endpoint that returns stats + trends + active-deliveries in one shot for the initial dashboard load.
**Auth:** Bearer.
**Query:** `months (1-12, default 3)`.
**Success 200:** `{ "success": true, "data": { "stats": <statsSchema>, "trends": [...], "activeDeliveries": [...] } }`.
**Errors:** 401.

---

## Notifications
File: [src/routes/notifications.routes.ts](src/routes/notifications.routes.ts)

Notification fields: `id, userId, orderId, type, title, subtitle, body, metadata, isBroadcast, isRead, isSaved, createdBy, createdAt`. `type` is one of: `order_status_update`, `payment_event`, `system_announcement`, `admin_alert`, `new_customer`, `new_order`, `payment_received`, `payment_failed`, `new_staff_account`, `staff_onboarding_complete`.

### `GET /api/v1/notifications/`
**Use:** inbox list.
**Auth:** Bearer.
**Query:** `page, limit`.
**Success 200:** paginated `<Notification>` list.
**Errors:** 401.

### `GET /api/v1/notifications/unread-count`
**Use:** badge on the bell icon.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": { "count": number } }`.

**FE Notes:** poll every 60s, or rely on the WebSocket and call once on session restore.

### `PATCH /api/v1/notifications/:id/read`
**Use:** mark one notification as read.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": { "message": "..." } }`.
**Errors:** 401, 404.

### `PATCH /api/v1/notifications/read-all`
**Use:** mark all as read.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": { "message": "..." } }`.

### `PATCH /api/v1/notifications/:id/save`
**Use:** toggle pin/star on a notification.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": { "message": "..." } }`.

### `DELETE /api/v1/notifications/:id`
**Use:** delete one notification.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": { "message": "..." } }`.

### `DELETE /api/v1/notifications/`
**Use:** bulk delete (1–100 ids per call).
**Auth:** Bearer.
**Payload:** `{ "ids": ["uuid", ...] }`.
**Success 200:** `{ "success": true, "data": { "deleted": number } }`.

### `POST /api/v1/notifications/broadcast`
**Use:** superadmin sends a system-wide announcement.
**Auth:** Bearer (superadmin).
**Payload:** `{ "type": "system_announcement|admin_alert", "title": "...", "subtitle?": "...", "body": "...", "metadata?": {} }`.
**Success 201:** `{ "success": true, "data": <Notification> }`.
**Errors:** 401, 403.

---

## Shipments
File: [src/routes/shipments.routes.ts](src/routes/shipments.routes.ts)

Shipment fields: `id, trackingNumber, invoiceId, senderId, senderName, recipientName, recipientAddress, recipientPhone, recipientEmail, origin, destination, statusV2, statusLabel, orderDirection, weight, declaredValue, description, shipmentType, packageCount, departureDate, eta, createdBy, createdAt, updatedAt`.

### `GET /api/v1/shipments/`
**Use:** list shipments (customer's own or staff filtered by sender).
**Auth:** Bearer.
**Query:** `page, limit, statusV2, senderId (staff+ only)`.
**Success 200:** paginated `<Shipment>` list.
**Errors:** 401, 403.

### `POST /api/v1/shipments/intake`
**Use:** staff records a new shipment intake (origin warehouse).
**Auth:** Bearer (admin+).
**Payload:**
```json
{
  "customerId": "uuid",
  "mode": "air|sea",
  "shipmentType": "air|ocean|d2d?",
  "shipmentPayer": "USER|SUPPLIER (default USER)",
  "billingSupplierId": "uuid (required when SUPPLIER)",
  "goods": [{
    "supplierId": "uuid",
    "description": "?", "itemType": "?", "quantity": 1,
    "lengthCm": 0, "widthCm": 0, "heightCm": 0,
    "weightKg": 0, "cbm": 0, "itemCostUsd": 0,
    "requiresExtraTruckMovement": false
  }]
}
```
**Success 201:** `{ "success": true, "data": <Shipment & appended goods> }`.
**Errors:** 401, 403, 400, 404 (customerId not found).

### `PUT /api/v1/shipments/:id/measurements`
**Use:** record a weight/CBM measurement at a specific checkpoint.
**Auth:** Bearer (admin+).
**Payload:** `{ "checkpoint": "<MeasurementCheckpoint enum>", "measuredWeightKg": number, "measuredCbm": number, "notes?": "string" }`.
**Success 200:** `{ "success": true, "data": <Measurement> }`.
**Errors:** 401, 403, 404.

### `GET /api/v1/shipments/:id/measurements`
**Use:** view all measurements taken for a shipment.
**Auth:** Bearer (admin+).
**Success 200:** `{ "success": true, "data": [<Measurement>] }`.

### `POST /api/v1/shipments/invoices/:invoiceId/task-invoice/presign`
**Use:** staff uploads the task invoice (per-supplier billing doc) — step 1.
**Auth:** Bearer (admin+).
**Payload:** `{ "contentType": "application/pdf|image/...", "fileSizeBytes": number, "originalFileName?": "string" }`.
**Success 200:** `{ "success": true, "data": <PresignResult> }`.

### `POST /api/v1/shipments/invoices/:invoiceId/task-invoice/confirm`
**Use:** step 2 — register the uploaded task invoice.
**Auth:** Bearer (admin+).
**Payload:** `{ "r2Key": "string", "contentType": "...", "fileSizeBytes": number, "originalFileName": "string" }`.
**Success 201:** `{ "success": true, "data": <Attachment> }`.

### `GET /api/v1/shipments/invoices/:invoiceId/task-invoice`
**Use:** list task invoices for the customer/staff invoice view.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": [<Attachment>] }`.

### `POST /api/v1/shipments/invoices/:invoiceId/reg-docs/presign`
**Use:** customer/staff uploads regulatory docs (export permits, manifests).
**Auth:** Bearer.
**Payload:** `{ "contentType": "...", "fileSizeBytes": number, "originalFileName?": "string" }`.
**Success 200:** `{ "success": true, "data": <PresignResult> }`.

### `POST /api/v1/shipments/invoices/:invoiceId/reg-docs/confirm`
**Use:** register an uploaded reg-doc.
**Auth:** Bearer.
**Payload:** `{ "r2Key": "string", "contentType": "...", "fileSizeBytes": number, "originalFileName": "string" }`.
**Success 201:** `{ "success": true, "data": <Attachment> }`.

### `GET /api/v1/shipments/invoices/:invoiceId/reg-docs`
**Use:** list reg-docs for an invoice.
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": [<Attachment>] }`.

### `GET /api/v1/shipments/internal-track/:masterTrackingNumber`
**Use:** staff-only lookup against master tracking IDs (multi-customer batches).
**Auth:** Bearer (admin+).
**Success 200/404:** `{ "success": true, "data": <DispatchBatch> }` | `{ "success": false, "message": "Not found" }`.

### `POST /api/v1/shipments/batches/:batchId/approve-cutoff`
**Use:** superadmin approves a dispatch batch cutoff (locks members in).
**Auth:** Bearer (superadmin).
**Success 200/404:** `{ "success": true, "data": <Batch> }` | `{ "success": false, "message": "Not found" }`.

### `PATCH /api/v1/shipments/batches/:batchId/carrier-info`
**Use:** staff fills in airline/ocean/D2D carrier details for a batch.
**Auth:** Bearer (staff+).
**Payload (≥ 1 field):** `{ "carrierName?", "airlineTrackingNumber?", "oceanTrackingNumber?", "d2dTrackingNumber?", "voyageOrFlightNumber?", "estimatedDepartureAt?(ISO)", "estimatedArrivalAt?(ISO)", "notes?" }`.
**Success 200:** `{ "success": true, "data": <Batch> }`.
**Errors:** 401, 403, 404, 400.

### `PATCH /api/v1/shipments/batches/:batchId/status`
**Use:** staff updates the batch status (cascades to member orders).
**Auth:** Bearer (staff+).
**Payload:** `{ "statusV2": "<ShipmentStatusV2 enum>" }`.
**Success 200:** `{ "success": true, "data": <Batch> }`.
**Errors:** 401, 403, 404, 422.

### `POST /api/v1/shipments/batches/:batchId/move-to-next`
**Use:** move specific package(s) or all of a supplier's packages out of one batch and into the next phase.
**Auth:** Bearer (staff+).
**Payload:** `{ "orderId": "uuid", "supplierId?": "uuid", "packageIds?": ["uuid"] }` — supply **exactly one** of `supplierId` or `packageIds`.
**Success 200:** `{ "success": true, "data": <Batch> }`.
**Errors:** 401, 403, 404, 422.

---

## Team
File: [src/routes/team.routes.ts](src/routes/team.routes.ts)

Team member fields: `id, email, firstName, lastName, displayName, role('staff'|'superadmin'), isActive, canProvisionClientLogin, canManageShipmentBatches, permissions: string[], createdAt, updatedAt`.

### `GET /api/v1/team/`
**Use:** internal-team-management list.
**Auth:** Bearer (admin+).
**Query:** `page, limit, role ('staff'|'superadmin'), isActive ('true'|'false')`.
**Success 200:** paginated `<TeamMember>` list.
**Errors:** 401, 403.

### `PATCH /api/v1/team/:id/approve`
**Use:** superadmin approves a newly-created staff account (flips `isActive` to true after profile completion).
**Auth:** Bearer (superadmin).
**Success 200:** `{ "success": true, "data": <TeamMember> }`.
**Errors:** 401, 403, 404.

---

## Admin
File: [src/routes/admin.routes.ts](src/routes/admin.routes.ts)

### `POST /api/v1/admin/imports/users-suppliers`
**Use:** bulk-import users+suppliers from CSV.
**Auth:** Bearer (staff+). **`multipart/form-data`**.
**Headers:** `Content-Type: multipart/form-data; boundary=...` (set automatically by `FormData`).
**Form field:** `file` (CSV).
**Query:** `dryRun (boolean, default false)`.
**Success 200/201:** `{ "success": true, "data": { "dryRun": bool, "summary": { "totalRows", "created", "updated", "skipped", "errors" }, "results": [{ "rowNumber", "role", "email", "action": "create|update|skip|error", "message" }] } }`.
**Errors:** 401, 403, 400 (bad file).

**FE Notes:** call with `dryRun=true` first, show the preview, then ask the user to confirm before sending the real import.

### `POST /api/v1/admin/clients`
**Use:** staff provisions a new customer account and returns a one-time login link (Clerk invitation or sign-in token).
**Auth:** Bearer (staff+).
**Payload:** `{ "email": "...", "firstName?", "lastName?", "businessName?", "phone?", "whatsappNumber?", "addressStreet?", "addressCity?", "addressState?", "addressCountry?", "addressPostalCode?", "consentMarketing?", "shippingMark?" }`.
**Success 201:** `{ "success": true, "data": { "id", "email", "loginLink", "linkType": "invitation|signin_token", "whatsappNumber", "wasExistingClient" } }`.
**Errors:** 401, 403, 400, 409.

### `POST /api/v1/admin/clients/:id/send-invite`
**Use:** re-send the login link to an existing client (e.g. they lost the original).
**Auth:** Bearer (staff+).
**Payload (optional):** `{ "whatsappNumber?", "phone?" }`.
**Success 200:** `{ "success": true, "data": { "id", "email", "loginLink", "linkType", "whatsappNumber" } }`.
**Errors:** 401, 403, 404.

### `GET /api/v1/admin/clients`
**Use:** staff CRM list.
**Auth:** Bearer (staff+).
**Query:** `page, limit, isActive`.
**Success 200:** paginated client list (`{ id, email, firstName, lastName, businessName, displayName, phone, shippingMark, addressCity, addressCountry, isActive, orderCount, totalSpent, lastOrderDate, createdAt }`).
**Errors:** 401, 403.

### `GET /api/v1/admin/clients/:id`
**Use:** client detail page.
**Auth:** Bearer (staff+).
**Success 200:** `{ "success": true, "data": <ClientDetail> }` (Client + `whatsappNumber, addressStreet, addressState, addressPostalCode, consentMarketing`).
**Errors:** 401, 403, 404.

### `GET /api/v1/admin/clients/:id/orders`
**Use:** all orders belonging to a client.
**Auth:** Bearer (staff+).
**Query:** `page, limit, statusV2`.
**Success 200:** paginated order list (admin shape).
**Errors:** 401, 403, 404.

### `GET /api/v1/admin/clients/:id/workbench`
**Use:** one-shot endpoint for the staff client-workbench page (client + suppliers + recent orders in one call).
**Auth:** Bearer (staff+).
**Success 200:** `{ "success": true, "data": { "client": <ClientDetail>, "suppliers": [...], "suppliersPagination": {...}, "recentOrders": [...], "recentOrdersPagination": {...} } }`.
**Errors:** 401, 403, 404.

### `GET /api/v1/admin/clients/:id/suppliers`
**Use:** suppliers linked to a specific client.
**Auth:** Bearer (staff+).
**Query:** `page, limit, isActive`.
**Success 200:** paginated supplier list.

### `POST /api/v1/admin/clients/:id/suppliers`
**Use:** staff adds a supplier to a client's book (by id or by invite).
**Auth:** Bearer (staff+).
**Payload:** `{ "supplierId?", "email?", "firstName?", "lastName?", "businessName?", "phone?" }` (one of supplierId/email required).
**Success 200:** `{ "success": true, "data": { "supplier", "createdSupplier", "linkedNow" } }`.

### `POST /api/v1/admin/clients/:id/goods-intake`
**Use:** staff creates an order on behalf of a client with full package detail in one call.
**Auth:** Bearer (staff+).
**Payload:**
```json
{
  "shipmentType": "air|ocean|d2d?",
  "orderDirection": "outbound|inbound?",
  "recipientName": "?", "recipientAddress": "?", "recipientPhone": "?", "recipientEmail": "?",
  "description": "?",
  "shipmentPayer": "USER|SUPPLIER?", "billingSupplierId": "uuid?",
  "transportMode": "air|sea?", "departureDate": "ISO?",
  "packages": [{
    "supplierId": "uuid?", "arrivalAt": "ISO?", "description": "?",
    "itemType": "?", "quantity": 1,
    "lengthCm": 0, "widthCm": 0, "heightCm": 0, "weightKg": 0, "cbm": 0,
    "itemCostUsd": 0, "requiresExtraTruckMovement": false,
    "specialPackagingType": "?", "isRestricted": false,
    "restrictedReason": "?", "restrictedOverrideApproved": false, "restrictedOverrideReason": "?"
  }]
}
```
**Success 201:** `{ "success": true, "data": <Order> }`.
**Errors:** 401, 403, 400, 404 (client not found), 422.

---

## Settings
File: [src/routes/settings.routes.ts](src/routes/settings.routes.ts)

### `GET /api/v1/settings/logistics`
**Use:** load the lane + office address config (used by the calculator, public info pages, internal logistics screen).
**Auth:** Bearer (staff+).
**Success 200:** `{ "success": true, "data": { "lane": { originCountry, originCity, destinationCountry, destinationCity, isLocked }, "koreaOffice": { nameEn, nameKo, addressEn, addressKo, phone }, "lagosOffice": {...}, "etaNotes": { airLeadTimeNote, seaLeadTimeNote }, "updatedAt" } }`.
**Errors:** 401, 403.

### `PATCH /api/v1/settings/logistics`
**Use:** edit lane/office/ETA notes. Office address edits require superadmin.
**Auth:** Bearer (admin+; office address requires superadmin).
**Payload (any subset):** `{ "lane?", "koreaOffice?", "lagosOffice?", "etaNotes?" }`.
**Success 200:** same shape as GET.
**Errors:** 401, 403, 400.

### `GET /api/v1/settings/fx-rate`
**Use:** read the current USD→NGN rate setting.
**Auth:** Bearer (staff+).
**Success 200:** `{ "success": true, "data": { "currencyPair": "USD_NGN", "mode": "live|manual", "manualRate": number|null, "updatedAt", "effectiveRate": number } }`.

### `PATCH /api/v1/settings/fx-rate`
**Use:** superadmin sets the FX mode (live vs manual override).
**Auth:** Bearer (superadmin).
**Payload (≥ 1 field):** `{ "mode?": "live|manual", "manualRate?": number|null }`.
**Success 200:** same shape as GET.
**Errors:** 401, 403, 400.

### `GET /api/v1/settings/shipment-types`
**Use:** staff view of the editable shipment-type catalog.
**Auth:** Bearer (staff+).
**Success 200:** `{ "success": true, "data": { "items": [{ key, label, isActive, coreShipmentType("air|ocean|d2d"), estimatorMode("CALCULATED|INTAKE"), infoTitle, infoDescription, submitEndpoint, requiredFields, nextStep }], "updatedAt" } }`.

### `PATCH /api/v1/settings/shipment-types`
**Use:** superadmin edits the catalog (upsert + delete).
**Auth:** Bearer (superadmin).
**Payload:** `{ "items?": [...], "deleteKeys?": ["..."] }`.
**Success 200:** `{ "success": true, "data": { "summary": { "createdKeys", "updatedKeys", "deletedKeys" }, "items": [...], "updatedAt" } }`.

### `GET /api/v1/settings/templates`
**Use:** notification-template catalog (email + in-app).
**Auth:** Bearer (admin+).
**Query:** `templateKey?, locale? ("en"|"ko"), channel? ("email"|"in_app"), includeInactive? ("true"|"false")`.
**Success 200:** `{ "success": true, "data": [{ id, templateKey, locale, channel, subject, body, isActive, createdBy, updatedBy, createdAt, updatedAt }] }`.

### `PATCH /api/v1/settings/templates/:id`
**Use:** edit one template.
**Auth:** Bearer (admin+).
**Payload (≥ 1):** `{ "templateKey?", "locale?", "channel?", "subject?", "body?", "isActive?" }`.
**Success 200:** `{ "success": true, "data": <Template> }`.

### `GET /api/v1/settings/pricing`
**Use:** load pricing rules + customer overrides for the pricing-admin screen.
**Auth:** Bearer (staff+).
**Query:** `mode? ("air"|"sea"), customerId?, includeInactive? ("true"|"false")`.
**Success 200:** `{ "success": true, "data": { "defaultRules": [...], "customerOverrides": [...] } }`.

### `PATCH /api/v1/settings/pricing`
**Use:** superadmin bulk-edits pricing rules + overrides.
**Auth:** Bearer (superadmin).
**Payload (≥ 1):** `{ "defaultRules?": [...], "customerOverrides?": [...], "deleteDefaultRuleIds?": ["uuid"], "deleteCustomerOverrideIds?": ["uuid"] }`.
**Success 200:** `{ "success": true, "data": { "summary": {...}, "defaultRules": [...], "customerOverrides": [...] } }`.

### `GET /api/v1/settings/restricted-goods`
**Use:** load restricted-goods catalog (used at intake to flag dangerous items).
**Auth:** Bearer (staff+).
**Query:** `includeInactive? ("true"|"false")`.
**Success 200:** `{ "success": true, "data": [{ id, code, nameEn, nameKo, description, allowWithOverride, isActive, ... }] }`.

### `PATCH /api/v1/settings/restricted-goods`
**Use:** admin bulk-edits the restricted-goods catalog.
**Auth:** Bearer (admin+).
**Payload (≥ 1):** `{ "items?": [...], "deleteIds?": ["uuid"] }`.
**Success 200:** `{ "success": true, "data": { "summary": {...}, "items": [...] } }`.

---

## Support
File: [src/routes/support.routes.ts](src/routes/support.routes.ts)

Ticket fields: `id, ticketNumber, userId, orderId, category, status('open'|'in_progress'|'resolved'|'closed'), subject, assignedTo, closedAt, createdAt, updatedAt`. `category`: `shipment_inquiry | payment_issue | damaged_goods | document_request | account_issue | general`.
Message fields: `id, ticketId, authorId, authorName, body, isInternal, createdAt`.

### `POST /api/v1/support/tickets`
**Use:** open a new support thread.
**Auth:** Bearer.
**Rate limit:** **10/min/user**.
**Payload:** `{ "subject": "3-200 chars", "category": "<enum>", "body": "1-5000 chars", "orderId?": "uuid", "forUserId?": "uuid (staff only)" }`.
**Success 201:** `{ "success": true, "data": { "ticket": <Ticket>, "message": <Message> } }`.
**Errors:** 401, 400, 403 (customer using forUserId), 429.

### `GET /api/v1/support/tickets`
**Use:** ticket inbox list.
**Auth:** Bearer.
**Query:** `page?, limit?, status?, category?, assignedTo?, userId? (staff only)`.
**Success 200:** paginated `<Ticket>` list.

### `GET /api/v1/support/tickets/:id`
**Use:** ticket detail + messages. Customers only see their own (BOLA).
**Auth:** Bearer.
**Success 200:** `{ "success": true, "data": { "ticket": <Ticket>, "messages": [<Message>] } }`.
**Errors:** 401, 403, 404.

**FE Notes:** subscribe to the WebSocket `support:join` room for this ticketId to receive new messages in real-time.

### `POST /api/v1/support/tickets/:id/messages`
**Use:** post a reply to a ticket.
**Auth:** Bearer.
**Payload:** `{ "body": "1-5000 chars", "isInternal?": bool (staff only) }`.
**Success 201:** `{ "success": true, "data": <Message> }`.
**Errors:** 401, 403, 404, 422 `{ success: false, message: "Cannot post to a closed ticket" }`.

### `PATCH /api/v1/support/tickets/:id`
**Use:** staff updates status/assignee.
**Auth:** Bearer (staff+).
**Payload:** `{ "status?": "<enum>", "assignedTo?": "uuid|null" }`.
**Success 200:** `{ "success": true, "data": <Ticket> }`.

---

## Public
File: [src/routes/public.routes.ts](src/routes/public.routes.ts) — All endpoints are unauthenticated.

### `POST /api/v1/public/calculator/estimate`
**Use:** public pricing calculator on the marketing site.
**Payload:** `{ "shipmentType": "air|ocean|d2d", "weightKg?": number, "lengthCm?": number, "widthCm?": number, "heightCm?": number, "cbm?": number }`.
**Success 200:** `{ "success": true, "data": { shipmentType, mode, weightKg, cbm, estimatedCostUsd, departureFrequency, estimatedTransitDays, disclaimer, intake?, d2dIntake?, estimateDetails? } }`.
**Errors:** 400.

### `GET /api/v1/public/shipment-types`
**Use:** populate the calculator's shipment-type selector + the public services page.
**Success 200:** `{ "success": true, "data": { "items": [{ key, label, coreShipmentType, estimatorMode, intake: {title, description, submitEndpoint, requiredFields, nextStep} | null }], "updatedAt" } }`.

### `GET /api/v1/public/calculator/rates`
**Use:** raw rate cards for transparency.
**Success 200:** `{ "success": true, "data": { "air": { "unit": "kg", "tiers": [{ "minKg", "maxKg", "rateUsdPerKg" }] }, "sea": { "unit": "cbm", "flatRateUsdPerCbm": number } } }`.

### `POST /api/v1/public/newsletter/subscribe`
**Use:** newsletter form on marketing site.
**Payload:** `{ "email": "..." }`.
**Success 200:** `{ "success": true, "data": { "message": "Subscribed" } }`.
**Errors:** 400, 409 (already subscribed).

### `GET /api/v1/public/gallery`
**Use:** marketing-site gallery (anonymous goods awaiting claim + sales + cars + adverts).
**Query:** `limitPerSection (1-100, default 20)`.
**Success 200:** `{ "success": true, "data": { "anonymousGoods": [...], "sales": [...], "cars": [...], "adverts": [...] } }`.

### `GET /api/v1/public/gallery/adverts`
**Query:** `limit (1-100, default 20)`.
**Success 200:** `{ "success": true, "data": [<GalleryItem>] }`.

### `GET /api/v1/public/gallery/sales`
**Query:** `limit (1-100, default 20)`.
**Success 200:** `{ "success": true, "data": [<GalleryItem>] }`.

### `POST /api/v1/public/gallery/claims/presign`
**Use:** anonymous claimant uploads proof — step 1.
**Payload:** `{ "uploadToken?": "string", "contentType": "application/pdf|image/...", "originalFileName?": "string" }`.
**Success 200:** `{ "success": true, "data": { "uploadUrl", "r2Key", "publicUrl", "expiresInSeconds", "uploadToken" } }`.

**FE Notes:** pass the returned `uploadToken` to subsequent presign + claim submission calls so the server can group multiple uploads into one claim.

### `POST /api/v1/public/gallery/anonymous/:trackingNumber/claim`
**Use:** anonymous claimant submits an ownership claim for a gallery item.
**Payload:** `{ "itemId": "uuid", "fullName": "≥ 2 chars", "email": "...", "phone": "≥ 5 chars", "city?", "country?", "message?", "uploadToken": "string", "proofR2Keys": ["string", ... (1-5)] }`.
**Success 201:** `{ "success": true, "data": { "item": <GalleryItem>, "claim": <Claim>, "ticket": <Ticket> } }`.
**Errors:** 400, 404, 409 `{ success: false, message: "Item already claimed" }`.

### `POST /api/v1/public/gallery/cars/:trackingNumber/purchase-attempt`
**Use:** anonymous prospect expresses interest in a car listing (first-come-first-served).
**Payload:** `{ "fullName", "email", "phone", "city?", "country?", "message?" }`.
**Success 201:** `{ "success": true, "data": { "item", "claim", "ticket" } }`.

### `POST /api/v1/public/d2d/intake`
**Use:** unauthenticated D2D order intake — useful for first-time visitors before they have an account.
**Payload:**
```json
{
  "fullName": "≥ 2", "email": "...", "phone": "≥ 5",
  "city": "...", "country": "...",
  "goodsDescription": "3-5000 chars",
  "deliveryPhone": "≥ 5",
  "deliveryAddressLine1": "≥ 5",
  "deliveryState?", "deliveryCity?", "deliveryPostalCode?", "deliveryLandmark?",
  "wantsAccount": true,
  "consentAcknowledgement": true,
  "estimatedWeightKg": 0, "estimatedCbm": 0
}
```
**Success 201:** `{ "success": true, "data": { "ticket": <Ticket>, "contact": { "userId", "role", "email", "accountLinked", "isActive", "registerIntent" }, "intakeRequest": {...} } }`.
**Errors:** 400, 409.

---

## Gallery
File: [src/routes/gallery.routes.ts](src/routes/gallery.routes.ts)

GalleryItem fields: `id, trackingNumberMasked, itemType('anonymous_goods'|'car'|'advert'), title, description, previewImageUrl, mediaUrls, ctaUrl, startsAt, endsAt, status('draft'|'published'|'claim_pending'|'claimed'|'car_reserved'|'car_sold'|'archived'), isPublished, carPriceNgn, priceCurrency, createdAt, updatedAt`.
Claim fields: `id, itemId, itemTrackingNumber, itemType, itemTitle, claimType('ownership'|'car_purchase'), status('pending'|'approved'|'rejected'), claimantUserId, claimantFullName, claimantEmail, claimantPhone, message, uploadToken, proofUrls, supportTicketId, reviewNote, reviewedBy, reviewedAt, createdAt, updatedAt`.

### `GET /api/v1/gallery/`
**Use:** authenticated gallery view — includes the user's own claims so the FE can show pending/approved status.
**Auth:** Bearer.
**Query:** `limitPerSection (1-100, default 20)`.
**Success 200:** `{ "success": true, "data": { "anonymousGoods", "sales", "cars", "adverts", "myClaims": [<Claim>] } }`.

### `POST /api/v1/gallery/claims/presign`
**Use:** authenticated claim-proof upload — step 1.
**Auth:** Bearer.
**Payload:** `{ "uploadToken?": "string", "contentType": "application/pdf|image/...", "originalFileName?": "string" }`.
**Success 200:** `{ "success": true, "data": { "uploadUrl", "r2Key", "publicUrl", "expiresInSeconds", "uploadToken" } }`.

### `POST /api/v1/gallery/items/media/presign`
**Use:** staff uploads gallery item media — step 1.
**Auth:** Bearer (staff+).
**Payload:** `{ "uploadToken?", "contentType": "image/...", "originalFileName?" }`.
**Success 200:** same shape as claims/presign.

### `POST /api/v1/gallery/anonymous/:trackingNumber/claim`
**Use:** authenticated claimant submits ownership claim. Picks up the user's contact details from their account.
**Auth:** Bearer.
**Payload:** `{ "itemId": "uuid", "message?": "string", "uploadToken": "string", "proofR2Keys": ["string", ... (1-5)] }`.
**Success 201:** `{ "success": true, "data": { "item", "claim", "ticket" } }`.
**Errors:** 401, 400, 404, 409.

### `POST /api/v1/gallery/cars/:trackingNumber/purchase-attempt`
**Use:** authenticated car purchase attempt.
**Auth:** Bearer.
**Payload:** `{ "message?": "string" }`.
**Success 201:** `{ "success": true, "data": { "item", "claim", "ticket" } }`.

### `POST /api/v1/gallery/items`
**Use:** staff creates a new gallery item (anonymous goods / car / advert).
**Auth:** Bearer (staff+).
**Payload:** `{ "itemType": "anonymous_goods|car|advert", "title": "≥ 2", "description?", "previewImageUrl?(url)", "mediaUrls?(url[])", "ctaUrl?(url)", "startsAt?(ISO)", "endsAt?(ISO)", "isPublished?", "status?", "carPriceNgn?", "metadata?" }`.
**Success 201:** `{ "success": true, "data": <GalleryItem> }`.

### `POST /api/v1/gallery/adverts`
**Use:** convenience shortcut for creating an advert (same as `/items` with itemType=advert).
**Auth:** Bearer (staff+).
**Payload:** same as `/items` minus `carPriceNgn` and `itemType`.
**Success 201:** `{ "success": true, "data": <GalleryItem> }`.

### `PATCH /api/v1/gallery/items/:id`
**Use:** staff edits a gallery item.
**Auth:** Bearer (staff+).
**Payload (all optional):** `{ title?, description?, previewImageUrl?, mediaUrls?, ctaUrl?, startsAt?, endsAt?, isPublished?, status?, carPriceNgn?, metadata? }`.
**Success 200:** `{ "success": true, "data": <GalleryItem> }`.

### `PATCH /api/v1/gallery/adverts/:id`
**Use:** convenience shortcut for editing an advert (same as `/items/:id` minus carPriceNgn).
**Auth:** Bearer (staff+).
**Success 200:** `{ "success": true, "data": <GalleryItem> }`.

### `GET /api/v1/gallery/claims`
**Use:** staff queue of incoming claims to review.
**Auth:** Bearer (staff+).
**Query:** `status? ('pending'|'approved'|'rejected'), claimType? ('ownership'|'car_purchase'), itemTrackingNumber?, limit (1-200, default 50)`.
**Success 200:** `{ "success": true, "data": [<Claim>] }`.

### `PATCH /api/v1/gallery/claims/:id/review`
**Use:** staff approves/rejects a claim. Race-safe (row-locked inside transaction). Optionally creates a shipment from an approved ownership claim.
**Auth:** Bearer (staff+).
**Payload:**
```json
{
  "decision": "approve|reject",
  "note?": "string",
  "postApprovalAction?": "create_shipment|approve_only",
  "shipmentType?": "air|ocean|d2d (required if postApprovalAction=create_shipment)",
  "d2dDispatchMode?": "air|sea (required if shipmentType=d2d)"
}
```
**Success 200:** `{ "success": true, "data": { "item": <GalleryItem>, "claim": <Claim>, "shipment": { "orderId", "orderTrackingNumber", "dispatchBatchId", "dispatchMasterTrackingNumber" } | null } }`.
**Errors:** 401, 403, 404, 409 (already reviewed), 422 (postApprovalAction without required fields).

---

## WebSocket
File: [src/websocket/handlers.ts](src/websocket/handlers.ts)

### `GET ws://host/ws`
**Use:** real-time push channel for: order status updates, support ticket messages, broadcast notifications.
**Auth:** JWT via EITHER:
- `Authorization: Bearer <jwt>` header, OR
- `Sec-WebSocket-Protocol: bearer, <jwt>` subprotocol header (use this from browser code — `WebSocket` constructor's second arg sets the subprotocol).

**Connection close codes:**
- `4001 Unauthorized` — missing/invalid/revoked token, user not found
- `4003 Forbidden` — wrong role for this path, account inactive

**Messages from server → client (JSON):**
- `{ type: "connected", message: "..." }` — sent immediately on successful auth
- `{ type: "support:new_ticket", ticket: <Ticket> }` — staff only
- `{ type: "support:new_message", ticketId, message: <Message> }` — to participants in the room
- `{ type: "support:join:denied", ticketId, message: "Forbidden" }` — sent if a customer attempts to join another user's ticket
- `{ type: "notification", notification: <Notification> }`
- `{ type: "order:status_update", orderId, ... }`

**Messages from client → server (JSON):**
- `{ type: "support:join", ticketId }` — subscribe to a ticket's events (BOLA-checked: customers can only join their own tickets)
- `{ type: "support:leave", ticketId }` — unsubscribe

**FE Notes:**
- Connect on app boot once the user is authenticated. Re-connect on reconnect with exponential backoff.
- Treat `support:join:denied` as a hard failure for that ticket — don't keep retrying.
- A `4001` close code means the access token is no longer valid → log the user out client-side and force re-login.

---

## Global behaviors

- **Rate limit (global):** 100 requests / minute / IP. Per-route overrides are noted inline. Exceeded → `429` with `{ success: false, message: "Too many requests — you are being rate limited. Try again in N seconds." }`.
- **Account lockout:** 5 failed password attempts → 15-minute lockout on `/auth/login` and `/internal/auth/login`. Returns `423` with `lockedUntil` (ISO 8601). Rate limit is per-IP; lockout is per-account.
- **MFA:** required for `superadmin` role. Login returns an `mfaToken` to exchange via `/auth/mfa/verify` (TOTP) or `/auth/mfa/recovery` (single-use code).
- **CORS:** origins are loaded from `CORS_ORIGINS` env. Methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`. Credentials allowed. Exposes `Content-Disposition`.
- **Empty bodies:** PATCH/DELETE with `Content-Type: application/json` and an empty body are accepted (Fastify default rejects them — we override).
- **PII fields** (`firstName`, `lastName`, `phone`, address fields, emergency contacts, `nationalId`, `dateOfBirth`, `email`) are encrypted at rest with AES-256-GCM and decrypted into responses only for authorized callers.
- **Audit:** every 403 from `requireRole` is recorded in `auditLogs`. Sensitive admin actions also write audit entries.
- **Cache busting:** authenticated/PII responses include `Cache-Control: no-store, private`. Treat these as never-cacheable on the FE side too.

## Updating this doc

The total count is verified by:

```bash
grep -nE "\.(get|post|put|patch|delete)\(['\"]" src/routes/*.routes.ts | wc -l
# Should match the total HTTP endpoint count above (excluding /health and /ws).
```

If you add a route, also add a section here. If you change a payload shape, update the example. The Zod schemas in the route file are the source of truth — this doc reflects them as of 2026-05-17.
