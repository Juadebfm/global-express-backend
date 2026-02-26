# Frontend API Manual — Global Express Backend

> Base URL: `https://<your-domain>/api/v1`
> All responses follow `{ success: true, data: ... }` on success and `{ success: false, message: "..." }` on error.
> Dates are ISO 8601 strings unless otherwise noted.

---

## Authentication Overview

There are two separate authentication systems in this backend. Understanding which one applies to a given user is the most important thing to get right.

### Customer Authentication (Clerk)

Customers sign up and sign in via Clerk on the frontend. After Clerk returns a session JWT, you must sync it to the backend once. After that, include the JWT as a Bearer token on every request.

**Step 1 — Sync after Clerk sign-in:**

```http
POST /api/v1/auth/sync
Authorization: Bearer <clerk-jwt>
```

No body needed. The backend auto-provisions the user if new, or links to an existing stub if created by staff. After this call you have a user record in the backend.

**Step 2 — All subsequent requests:**

```http
Authorization: Bearer <clerk-jwt>
```

Use the same Clerk JWT. The backend re-verifies it on every request.

**Sign-out:**

Customer session termination is handled entirely on the frontend via the Clerk SDK — no backend API call is needed.

```typescript
// React / Next.js (Clerk frontend SDK)
import { useClerk } from '@clerk/nextjs'

const { signOut } = useClerk()
await signOut()
```

When `signOut()` is called, Clerk immediately invalidates the session on its own servers. Any subsequent request to this backend with the old JWT will fail verification in the authenticate middleware and return `401`. There is no `POST /logout` route for customers.

---

### Internal Operator Authentication (Staff / Admin / Superadmin)

Internal operators do not use Clerk. They have email + password credentials stored in the backend database.

**Step 1 — Login:**

```http
POST /api/v1/internal/auth/login
Content-Type: application/json

{
  "email": "staff@example.com",
  "password": "yourpassword"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "token": "<jwt>",
    "user": {
      "id": "uuid",
      "email": "staff@example.com",
      "firstName": "Ada",
      "lastName": "Obi",
      "role": "staff",
      "isActive": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
}
```

Store the token and send it on every request:

```http
Authorization: Bearer <internal-jwt>
```

The middleware distinguishes internal tokens from Clerk tokens automatically via a claim in the JWT payload. You do not need to pass anything extra.

**Sign-out:**

Call `POST /api/v1/auth/logout` with the Bearer token. The JTI is added to a server-side blocklist — the token is rejected immediately on any further request even if it hasn't expired yet. Remove it from client storage after the call succeeds.

```http
POST /api/v1/auth/logout
Authorization: Bearer <internal-jwt>
```

---

### Role Hierarchy

From most privileged to least:

- `superadmin` — full system access, can create any account, update office addresses, reset any password
- `admin` — management access, can create staff accounts, manage pricing and settings (not office addresses)
- `staff` — operational access, can create orders on behalf of customers, verify warehouse, record payments
- `user` — customer account, can only see and act on their own data

In this document, access levels are described as:

- **Public** — no token needed
- **Any authenticated** — any valid token (customer or operator)
- **Staff+** — staff, admin, or superadmin
- **Admin+** — admin or superadmin only
- **Superadmin only**

---

## Health Check

### `GET /health`

**Auth:** Public

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-02-26T10:00:00.000Z"
}
```

---

## Auth Routes

### `POST /api/v1/auth/sync`

Syncs a Clerk-authenticated user into the backend. Call this once after every Clerk sign-in. Safe to call repeatedly.

**Auth:** Bearer (Clerk JWT)

**Body:** none

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "clerkId": "user_xxx",
    "email": "customer@email.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "role": "user",
    "isActive": true,
    ...
  }
}
```

---

### `GET /api/v1/auth/me`

Returns the current user's profile. Useful for restoring session state after page reload.

**Auth:** Bearer (Clerk JWT)

**Response:** Same user object as `/auth/sync`.

---

### `POST /api/v1/auth/forgot-password/send-otp`

Initiates password reset for internal operators. Sends an OTP to the operator's email.

**Auth:** Public

**Body:**

```json
{
  "email": "staff@example.com"
}
```

**Response:**

```json
{
  "success": true,
  "data": { "message": "OTP sent" }
}
```

---

### `POST /api/v1/auth/forgot-password/verify-otp`

Verifies the OTP that was sent. Returns a reset token.

**Auth:** Public

**Body:**

```json
{
  "email": "staff@example.com",
  "otp": "123456"
}
```

---

### `POST /api/v1/auth/forgot-password/reset`

Completes the password reset using the token from the verify step.

**Auth:** Public

**Body:**

```json
{
  "email": "staff@example.com",
  "token": "<reset-token>",
  "newPassword": "newpassword123"
}
```

---

### `POST /api/v1/auth/logout`

**Applies to: internal operators only** (staff / admin / superadmin).

Revokes the current operator JWT server-side. The token's JTI is written to the `revoked_tokens` blocklist and will be rejected immediately on any subsequent request — even before the token's natural expiry. After a successful response, remove the token from client storage.

**Clerk customers do not use this endpoint.** Customer sessions are terminated via `clerk.signOut()` on the frontend; Clerk handles server-side session invalidation automatically.

**Auth:** Bearer (internal operator JWT — required)

**Body:** none

**Response:**

```json
{
  "message": "Logged out successfully"
}
```

`401` if no token is provided or the token is already invalid/expired.

---

## Users Routes

### `GET /api/v1/users/me`

Returns the authenticated user's full profile.

**Auth:** Any authenticated

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "clerkId": "user_xxx",
    "email": "user@email.com",
    "firstName": "Jane",
    "lastName": "Doe",
    "businessName": null,
    "phone": "+2348012345678",
    "whatsappNumber": "+2348012345678",
    "addressStreet": "14 Broad Street",
    "addressCity": "Lagos",
    "addressState": "Lagos",
    "addressCountry": "Nigeria",
    "addressPostalCode": "100001",
    "role": "user",
    "isActive": true,
    "consentMarketing": true,
    "notifyEmailAlerts": true,
    "notifySmsAlerts": false,
    "notifyInAppAlerts": true,
    "preferredLanguage": "en",
    "deletedAt": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

### `GET /api/v1/users/me/completeness`

Checks whether the authenticated customer's profile is complete enough to place orders. A complete profile requires: name (firstName + lastName OR businessName), phone number, and a full address (street, city, state, country, postal code).

**Auth:** Any authenticated

**Response:**

```json
{
  "success": true,
  "data": {
    "isComplete": false,
    "missingFields": ["addressStreet", "addressPostalCode"],
    "completedFields": [
      "firstName",
      "lastName",
      "phone",
      "addressCity",
      "addressState",
      "addressCountry"
    ]
  }
}
```

Show this before allowing a customer to place an order, and route them to a profile completion screen if `isComplete` is `false`.

---

### `PATCH /api/v1/users/me`

Updates the authenticated user's own profile. All fields are optional — only send what changed.

**Auth:** Any authenticated

**Body:**

```json
{
  "firstName": "Jane",
  "lastName": "Doe",
  "businessName": null,
  "phone": "+2348012345678",
  "whatsappNumber": "+2348012345678",
  "addressStreet": "14 Broad Street",
  "addressCity": "Lagos",
  "addressState": "Lagos",
  "addressCountry": "Nigeria",
  "addressPostalCode": "100001",
  "consentMarketing": true,
  "notifyEmailAlerts": true,
  "notifySmsAlerts": false,
  "notifyInAppAlerts": true,
  "preferredLanguage": "en"
}
```

`preferredLanguage` accepts `"en"` or `"ko"`.

**Response:** Updated user object (same shape as `/users/me`).

---

### `GET /api/v1/users/me/notification-preferences`

Returns only the notification preference fields.

**Auth:** Any authenticated

**Response:**

```json
{
  "success": true,
  "data": {
    "notifyEmailAlerts": true,
    "notifySmsAlerts": false,
    "notifyInAppAlerts": true,
    "consentMarketing": true
  }
}
```

---

### `PATCH /api/v1/users/me/notification-preferences`

Updates notification preferences.

**Auth:** Any authenticated

**Body:**

```json
{
  "notifyEmailAlerts": true,
  "notifySmsAlerts": false,
  "notifyInAppAlerts": true,
  "consentMarketing": false
}
```

**Response:** Same shape as the GET above.

---

### `DELETE /api/v1/users/me`

GDPR soft-delete. Marks the account as deleted. Data is retained per retention policy but the account becomes inaccessible.

**Auth:** Any authenticated

**Response:**

```json
{
  "success": true,
  "data": { "message": "Account deleted successfully" }
}
```

---

### `GET /api/v1/users/me/export`

GDPR data export. Returns all personal data associated with the account.

**Auth:** Any authenticated

**Response:** A data object containing the user's profile, orders, and payment history.

---

### `GET /api/v1/users/` (Admin+)

Lists all users with pagination and optional filters.

**Auth:** Admin+ | IP-whitelisted

**Query params:**

- `page` — default `1`
- `limit` — default `20`
- `role` — filter by role: `user`, `staff`, `admin`, `superadmin`
- `isActive` — filter by active status: `true` or `false`

**Response:**

```json
{
  "success": true,
  "data": {
    "data": [ ...user objects... ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 87,
      "totalPages": 5
    }
  }
}
```

---

### `GET /api/v1/users/:id` (Admin+)

Returns a single user by internal UUID.

**Auth:** Admin+ | IP-whitelisted

**Response:** Single user object.

---

### `PATCH /api/v1/users/:id` (Admin+)

Admin update of any user's profile. Accepts the same fields as `PATCH /users/me`, plus `isActive`.

**Auth:** Admin+ | IP-whitelisted

**Body:**

```json
{
  "firstName": "Jane",
  "isActive": false,
  "preferredLanguage": "ko"
}
```

---

### `PATCH /api/v1/users/:id/role` (Admin+)

Changes a user's role.

**Auth:** Admin+ | IP-whitelisted

**Important role assignment constraints:**

- An `admin` can only assign `staff` or `user` roles
- Only `superadmin` can assign `admin` or `superadmin`

**Body:**

```json
{
  "role": "staff"
}
```

Valid values: `user`, `staff`, `admin`, `superadmin`

**Response:** Updated user object.

---

### `DELETE /api/v1/users/:id` (Admin+)

Soft-deletes any user account.

**Auth:** Superadmin only | IP-whitelisted

**Response:**

```json
{
  "success": true,
  "data": { "message": "User deleted successfully" }
}
```

---

## Orders Routes

### `GET /api/v1/orders/track/:trackingNumber`

Public shipment tracking. No authentication required. This is the endpoint for the public-facing tracking page. Checks solo orders first, then bulk shipment items.

**Auth:** Public

**Example:** `GET /api/v1/orders/track/GEX-20240301-A1B2`

**Response:**

```json
{
  "success": true,
  "data": {
    "trackingNumber": "GEX-20240301-A1B2",
    "status": "FLIGHT_DEPARTED",
    "statusLabel": "Flight Departed",
    "origin": "Seoul, South Korea",
    "destination": "Lagos, Nigeria",
    "estimatedDelivery": null,
    "lastUpdate": "Feb 26, 2026 · 10:30 AM",
    "lastLocation": "Lagos, Nigeria"
  }
}
```

`statusLabel` is the human-readable display string. `status` is the raw enum value. If no shipment is found, returns `404`.

---

### `POST /api/v1/orders/`

Creates a new shipment order.

**Auth:** Any authenticated

**Role behaviour:**

- `user` (customer): always creates for themselves, `senderId` in body is ignored. The customer's profile must be complete before this succeeds — check `/users/me/completeness` first. The order is created as a pre-order (`isPreorder: true`), meaning the item has not yet arrived at the warehouse.
- `staff`, `admin`, `superadmin`: can specify a `senderId` to create on behalf of a customer. If omitted, creates for themselves.

**Body:**

```json
{
  "senderId": "uuid-of-customer",
  "recipientName": "Adeola Johnson",
  "recipientAddress": "5 Victoria Island, Lagos",
  "recipientPhone": "+2348098765432",
  "recipientEmail": "adeola@email.com",
  "orderDirection": "outbound",
  "weight": "3.5",
  "declaredValue": "25000",
  "description": "Electronics — laptop",
  "shipmentType": "air",
  "departureDate": "2026-03-01T00:00:00.000Z",
  "eta": "2026-03-10T00:00:00.000Z"
}
```

Required fields: `recipientName`, `recipientAddress`, `recipientPhone`.

`orderDirection` accepts `"outbound"` (we ship to customer) or `"inbound"` (customer ships to us). Defaults to `"outbound"`.

`shipmentType` accepts `"air"` or `"ocean"`. This is the legacy field. The backend will derive `transportMode` (`"air"` or `"sea"`) during warehouse verification.

**Response on success (201):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "trackingNumber": "GEX-20260226-X7K9",
    "senderId": "uuid",
    "statusV2": "PREORDER_SUBMITTED",
    "isPreorder": true,
    ...all order fields
  }
}
```

**Response on incomplete profile (422):**

```json
{
  "success": false,
  "message": "Please complete your profile before placing an order. Required: name (or business name), phone number, and full address (street, city, state, country, postal code)."
}
```

---

### `GET /api/v1/orders/`

Lists orders with pagination and optional filters.

**Auth:** Any authenticated

**Role behaviour:**

- `user`: always sees only their own orders regardless of query params
- `staff+`: sees all orders, can filter by `senderId`

**Query params:**

- `page` — default `1`
- `limit` — default `20`
- `statusV2` — filter by V2 status enum value (e.g. `FLIGHT_DEPARTED`)
- `senderId` — staff+ only; filter by customer UUID

**Response:**

```json
{
  "success": true,
  "data": {
    "data": [ ...order objects... ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 14,
      "totalPages": 1
    }
  }
}
```

---

### `GET /api/v1/orders/my-shipments`

Returns the authenticated user's unified shipment feed — both solo orders and individual bulk shipment items in a single list, each with its own tracking number.

**Auth:** Any authenticated

**Query params:**

- `page` — default `1`
- `limit` — default `20`

**Response:** Same pagination shape as list orders, but each item may be a solo order or a bulk item. Each item has a `trackingNumber`, `statusV2`, `statusLabel`, `origin`, `destination`.

---

### `GET /api/v1/orders/:id`

Returns a single order by UUID.

**Auth:** Any authenticated

**Role behaviour:**

- `user`: can only fetch their own order. Returns `403` if the order belongs to a different user.
- `staff+`: can fetch any order.

**Response:** Full order object including pricing fields, packages (after warehouse verification), and payment collection status.

---

### `GET /api/v1/orders/:id/images`

Returns all uploaded warehouse images for an order.

**Auth:** Any authenticated

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "orderId": "uuid",
      "r2Key": "orders/uuid/filename.jpg",
      "url": "https://cdn.example.com/orders/uuid/filename.jpg",
      "uploadedBy": "uuid",
      "createdAt": "..."
    }
  ]
}
```

---

### `PATCH /api/v1/orders/:id/status` (Staff+)

Updates the operational status of an order. Sends notifications to the customer based on their preferences (email, SMS, in-app).

**Auth:** Staff+ (authenticated)

**Body:**

```json
{
  "statusV2": "FLIGHT_DEPARTED"
}
```

Valid `statusV2` values — in the typical air shipment flow:

```
PREORDER_SUBMITTED
AWAITING_WAREHOUSE_RECEIPT
WAREHOUSE_RECEIVED
WAREHOUSE_VERIFIED_PRICED
DISPATCHED_TO_ORIGIN_AIRPORT
AT_ORIGIN_AIRPORT
BOARDED_ON_FLIGHT
FLIGHT_DEPARTED
FLIGHT_LANDED_LAGOS
CUSTOMS_CLEARED_LAGOS
IN_TRANSIT_TO_LAGOS_OFFICE
READY_FOR_PICKUP
PICKED_UP_COMPLETED
```

For sea shipments, after `WAREHOUSE_VERIFIED_PRICED`:

```
DISPATCHED_TO_ORIGIN_PORT
AT_ORIGIN_PORT
LOADED_ON_VESSEL
VESSEL_DEPARTED
VESSEL_ARRIVED_LAGOS_PORT
CUSTOMS_CLEARED_LAGOS
IN_TRANSIT_TO_LAGOS_OFFICE
READY_FOR_PICKUP
PICKED_UP_COMPLETED
```

Exception / override statuses (can be set at any point):

```
ON_HOLD
CANCELLED
RESTRICTED_ITEM_REJECTED
RESTRICTED_ITEM_OVERRIDE_APPROVED
```

**Response:** Updated order object.

**On invalid transition (400):**

```json
{
  "success": false,
  "message": "..."
}
```

---

### `POST /api/v1/orders/:id/warehouse-verify` (Staff+)

Verifies the physical shipment at the warehouse. Records actual package dimensions/weight, calculates the freight charge, and advances the order to `WAREHOUSE_VERIFIED_PRICED`. This is the most complex operation in the order flow.

**Auth:** Staff+ (authenticated)

**Important constraint:** Only `admin` or `superadmin` can set `restrictedOverrideApproved: true`. If staff tries to approve a restricted-item override, the request returns `403`.

**Body:**

```json
{
  "transportMode": "air",
  "packages": [
    {
      "description": "Electronics — laptop",
      "itemType": "electronics",
      "quantity": 1,
      "lengthCm": 40,
      "widthCm": 30,
      "heightCm": 5,
      "weightKg": 2.5,
      "cbm": 0.006,
      "isRestricted": false,
      "restrictedReason": null,
      "restrictedOverrideApproved": false,
      "restrictedOverrideReason": null
    }
  ],
  "manualFinalChargeUsd": 45.0,
  "manualAdjustmentReason": "Special rate agreed with customer"
}
```

`transportMode` accepts `"air"` or `"sea"`. Required.

`packages` is an array and must have at least one item. Package fields are all optional individually but `weightKg` or `cbm` should be provided for pricing to work correctly.

`manualFinalChargeUsd` and `manualAdjustmentReason` are optional — only needed when overriding the calculated rate.

**Response:** Updated order object with `calculatedChargeUsd`, `finalChargeUsd`, `pricingSource`, and package data attached.

---

### `DELETE /api/v1/orders/:id` (Admin+)

Soft-deletes an order.

**Auth:** Admin+

**Response:**

```json
{
  "success": true,
  "data": { "message": "Order deleted successfully" }
}
```

---

## Shipments Routes

### `GET /api/v1/shipments/`

A frontend-optimised shipment listing that returns the same data as `/orders/` but with pre-computed display fields like `statusLabel`, formatted dates, and decrypted recipient info. Prefer this over `/orders/` for rendering shipment lists in the UI.

**Auth:** Any authenticated

**Role behaviour:**

- `user`: only sees their own shipments
- `staff+`: sees all shipments, can filter by `senderId`

**Query params:**

- `page`, `limit`, `statusV2`, `senderId` (staff+ only)

**Response:** Paginated list with each item shaped for direct display.

---

## Payments Routes

### `POST /api/v1/payments/initialize`

Initializes a Paystack payment for an order. Call this when a customer is ready to pay online. Returns the Paystack `authorizationUrl` — redirect the user there to complete payment.

**Auth:** Any authenticated

**Body:**

```json
{
  "orderId": "uuid-of-order",
  "amount": 45000,
  "currency": "NGN",
  "callbackUrl": "https://yourapp.com/payment/callback"
}
```

`amount` is in the smallest currency unit (kobo for NGN — so `45000` = ₦450.00). `currency` defaults to `"NGN"`. `callbackUrl` is where Paystack redirects after payment.

**Response (201):**

```json
{
  "success": true,
  "data": {
    "authorizationUrl": "https://checkout.paystack.com/...",
    "accessCode": "xxx",
    "reference": "GEX-PAYREF-XXXX"
  }
}
```

Redirect the user to `authorizationUrl`.

---

### `POST /api/v1/payments/verify/:reference`

After Paystack redirects back to your `callbackUrl`, call this endpoint with the `reference` from the URL query param to verify and record the payment.

**Auth:** Any authenticated

**Example:** `POST /api/v1/payments/verify/GEX-PAYREF-XXXX`

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "orderId": "uuid",
    "userId": "uuid",
    "amount": "45000",
    "currency": "NGN",
    "paystackReference": "GEX-PAYREF-XXXX",
    "status": "successful",
    "paymentType": "online",
    "paidAt": "2026-02-26T10:00:00.000Z",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

If not found, returns `404`.

---

### `POST /api/v1/payments/webhook`

Paystack webhook endpoint. **Do not call this from the frontend.** It is for Paystack's servers only. Signature is verified via HMAC on the raw body.

---

### `GET /api/v1/payments/` (Admin+)

Lists all payments with pagination and optional filters.

**Auth:** Superadmin only

**Query params:**

- `page`, `limit`
- `userId` — filter by customer UUID
- `status` — `pending`, `successful`, `failed`, `abandoned`

**Response:** Paginated payment objects.

---

### `GET /api/v1/payments/:id` (Admin+)

Returns a single payment by UUID.

**Auth:** Superadmin only

---

### `POST /api/v1/payments/:orderId/record-offline` (Staff+)

Records a cash or bank transfer payment for an order. Use this when a customer pays in person or via bank transfer rather than Paystack.

**Auth:** Staff+

**Body:**

```json
{
  "userId": "uuid-of-customer",
  "amount": 45000,
  "paymentType": "transfer",
  "proofReference": "TRF-20260226-001",
  "note": "Customer paid at Lagos office"
}
```

`paymentType` accepts `"transfer"` or `"cash"`. `proofReference` and `note` are optional but recommended.

**Response (201):** Full payment object with `recordedBy` set to the staff member's UUID.

---

## Bulk Orders Routes

All bulk order routes require **Staff+** auth and are typically **IP-whitelisted**. Bulk orders are internal-facing operations — customers do not interact with these directly. A bulk order groups multiple individual shipment items under a single container/flight, each with their own tracking number.

---

### `POST /api/v1/bulk-orders/`

Creates a new bulk shipment with items.

**Auth:** Staff+ | IP-whitelisted

**Body:**

```json
{
  "origin": "Seoul, South Korea",
  "destination": "Lagos, Nigeria",
  "notes": "March batch — air freight",
  "items": [
    {
      "trackingNumber": "GEX-20260301-CUST01",
      "senderId": "uuid-of-customer",
      "recipientName": "Adeola Johnson",
      "recipientAddress": "5 Victoria Island",
      "recipientPhone": "+2348098765432",
      "origin": "Seoul, South Korea",
      "destination": "Lagos, Nigeria",
      "weight": "3.5",
      "description": "Electronics"
    }
  ]
}
```

Items can be provided at creation time or added later via the add-item endpoint.

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "trackingNumber": "BULK-20260301-001",
    "origin": "Seoul, South Korea",
    "destination": "Lagos, Nigeria",
    "statusV2": "WAREHOUSE_RECEIVED",
    "items": [ ...bulk item objects... ],
    "createdBy": "uuid",
    "createdAt": "..."
  }
}
```

---

### `GET /api/v1/bulk-orders/`

Lists all bulk orders.

**Auth:** Staff+ | IP-whitelisted

**Query params:** `page`, `limit`

---

### `GET /api/v1/bulk-orders/:id`

Returns a bulk order with all its items.

**Auth:** Staff+ | IP-whitelisted

---

### `PATCH /api/v1/bulk-orders/:id/status`

Updates the status of a bulk order. This propagates the status to all items in the bulk order automatically.

**Auth:** Staff+ | IP-whitelisted

**Body:**

```json
{
  "statusV2": "FLIGHT_DEPARTED"
}
```

Same valid status values as the solo order status update.

---

### `POST /api/v1/bulk-orders/:id/items`

Adds a single item to an existing bulk order.

**Auth:** Staff+ | IP-whitelisted

**Body:** Same shape as a single item in the create bulk order `items` array.

**Response (201):** The new bulk item object.

---

### `DELETE /api/v1/bulk-orders/:id/items/:itemId` (Admin+)

Removes an item from a bulk order.

**Auth:** Admin+ | IP-whitelisted

**Response:**

```json
{
  "success": true,
  "data": { "message": "Item removed from bulk order" }
}
```

---

### `DELETE /api/v1/bulk-orders/:id` (Admin+)

Soft-deletes a bulk order.

**Auth:** Admin+ | IP-whitelisted

---

## Dashboard Routes

All dashboard routes require authentication. Data is role-gated:

- **Customers** (`user`) see only their own orders and their own spending.
- **Staff / Admin** see global order counts and shipment data — no revenue figures.
- **Superadmin** sees everything including platform revenue.

### `GET /api/v1/dashboard/`

Combined dashboard endpoint. Returns stats, trends, and active deliveries in a single call. Prefer this over the three individual endpoints.

**Auth:** Any authenticated

**Query params:**

- `year` — integer, defaults to current year (used for trend data)

**Response — superadmin:**

```json
{
  "success": true,
  "data": {
    "stats": {
      "totalOrders": 152,
      "totalOrdersChange": { "value": 12.5, "direction": "up" },
      "activeShipments": 34,
      "activeShipmentsChange": { "value": 4.0, "direction": "up" },
      "pendingOrders": 18,
      "pendingOrdersChange": null,
      "deliveredToday": 3,
      "deliveredTotal": 210,
      "deliveredTotalChange": { "value": 8.2, "direction": "up" },
      "cancelled": 5,
      "revenueMtd": "4250000",
      "revenueMtdChange": { "value": 3.2, "direction": "down" }
    },
    "trends": [
      { "month": 1, "deliveredWeight": "320.50", "activeWeight": "140.00" },
      { "month": 2, "deliveredWeight": "415.00", "activeWeight": "200.50" }
    ],
    "activeDeliveries": [
      {
        "destination": "Lagos, Nigeria",
        "shipmentType": "air",
        "activeCount": 22,
        "nextEta": "2026-03-10T00:00:00.000Z",
        "status": "on_time"
      }
    ]
  }
}
```

**Response differences by role:**

- **Superadmin**: includes `revenueMtd` (all-time platform revenue) and `revenueMtdChange`
- **Staff / Admin**: `revenueMtd` and `revenueMtdChange` are **absent** from the response
- **Customer**: `revenueMtd` is **absent**; instead `totalSpent` (their own payment total) and `totalSpentChange` are included. `totalOrders` / `activeShipments` etc. are scoped to their own orders.

**Change fields** (`totalOrdersChange`, `activeShipmentsChange`, etc.) are `{ value: number, direction: "up" | "down" }` or `null` when no prior-period baseline exists (e.g. first 30 days of data).

**Trends `month`** is a number `1–12` (Jan–Dec). `deliveredWeight` and `activeWeight` are string decimals in kg.

**Active delivery `status`** values: `"on_time"` (ETA is future), `"delayed"` (ETA has passed), `"unknown"` (no ETA set).

---

### `GET /api/v1/dashboard/stats`

Stats only — same shape as the `stats` field in the combined endpoint above.

**Auth:** Any authenticated

---

### `GET /api/v1/dashboard/trends`

Monthly weight trends for the given year.

**Auth:** Any authenticated

**Query params:** `year`

---

### `GET /api/v1/dashboard/active-deliveries`

Active shipment counts grouped by destination.

**Auth:** Any authenticated

---

## Notifications Routes

Customer-facing notifications inbox. Each user has their own notification feed.

### `GET /api/v1/notifications/`

Returns the user's notification inbox including personal notifications and broadcasts.

**Auth:** Any authenticated

**Query params:** `page`, `limit`

**Response:**

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "uuid",
        "type": "status_update",
        "title": "Your shipment is on its way",
        "subtitle": "Order GEX-20260226-X7K9",
        "body": "Your package has departed Seoul and is en route to Lagos.",
        "metadata": { "orderId": "uuid", "trackingNumber": "GEX-..." },
        "isRead": false,
        "isSaved": false,
        "isBroadcast": false,
        "createdAt": "..."
      }
    ],
    "pagination": { ... }
  }
}
```

---

### `GET /api/v1/notifications/unread-count`

Returns the unread count for the notification badge.

**Auth:** Any authenticated

**Response:**

```json
{
  "success": true,
  "data": { "count": 3 }
}
```

---

### `PATCH /api/v1/notifications/:id/read`

Marks a notification as read. Only the owner can mark their own notifications.

**Auth:** Any authenticated

**Response:**

```json
{
  "success": true,
  "data": { "message": "Marked as read" }
}
```

---

### `PATCH /api/v1/notifications/:id/save`

Toggles the saved state of a notification (save/unsave).

**Auth:** Any authenticated

**Response:**

```json
{
  "success": true,
  "data": { "message": "Saved state toggled" }
}
```

---

### `POST /api/v1/notifications/broadcast` (Superadmin only)

Sends a broadcast notification to all users in the system. Because this reaches every customer simultaneously it is restricted to superadmin.

**Auth:** Superadmin only

**Body:**

```json
{
  "type": "announcement",
  "title": "System Maintenance",
  "subtitle": "Tonight from 11pm – 1am WAT",
  "body": "The platform will be briefly unavailable for scheduled maintenance.",
  "metadata": {}
}
```

`type` is a free string used for categorisation (e.g. `"announcement"`, `"promotion"`, `"status_update"`).

**Response (201):** The created broadcast notification object.

---

### `DELETE /api/v1/notifications/:id`

Removes a single notification from the user's inbox.

**Auth:** Any authenticated user (own notifications only)

- **Personal notifications** (order updates, payment events) are permanently deleted.
- **Broadcast notifications** are hidden only for the requesting user — other users are not affected.

**Response (200):**

```json
{ "success": true, "data": { "message": "Notification deleted" } }
```

**Response (404):** Notification not found or does not belong to this user.

---

### `DELETE /api/v1/notifications/` (Bulk delete)

Deletes multiple notifications by ID in one request.

**Auth:** Any authenticated user (own notifications only)

**Body:**

```json
{ "ids": ["uuid1", "uuid2", "uuid3"] }
```

`ids` — array of notification UUIDs to delete. Max 100 per request. IDs that do not belong to the user are silently skipped.

**Response (200):**

```json
{ "success": true, "data": { "deleted": 3 } }
```

`deleted` — count of notifications successfully removed.

---

## Internal Notifications Routes

Admin-facing notifications for system events (new orders, new signups, new staff accounts, etc.). Separate from the customer notification inbox.

### `GET /api/v1/internal/notifications`

Lists admin notifications.

**Auth:** Admin+ (authenticated)

**Query params:**

- `page`, `limit`
- `unreadOnly` — `"true"` to filter to unread only

**Response:**

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "uuid",
        "type": "new_order",
        "title": "New Order Created",
        "body": "Order GEX-20260226-X7K9 was created",
        "metadata": { "orderId": "uuid", "trackingNumber": "GEX-..." },
        "readAt": null,
        "createdAt": "..."
      }
    ],
    "pagination": { ... }
  }
}
```

---

### `GET /api/v1/internal/notifications/unread-count`

**Auth:** Admin+

**Response:**

```json
{
  "success": true,
  "data": { "count": 5 }
}
```

---

### `PATCH /api/v1/internal/notifications/read-all`

Marks all admin notifications as read.

**Auth:** Admin+

---

### `PATCH /api/v1/internal/notifications/:id/read`

Marks a single admin notification as read.

**Auth:** Admin+

**Response:** The updated notification object.

---

## Internal Auth & User Management Routes

### `POST /api/v1/internal/auth/login`

Internal operator login. See [Authentication Overview](#internal-operator-authentication-staff--admin--superadmin) above.

---

### `POST /api/v1/internal/users` (Admin+)

Creates a new internal staff, admin, or superadmin account. No Clerk account is created — credentials are managed internally.

**Auth:** Admin+ | IP-whitelisted

**Constraint:** Admins can only create `staff` accounts. Only superadmin can create `admin` or `superadmin`.

**Body:**

```json
{
  "email": "newstaff@company.com",
  "password": "securepassword",
  "role": "staff",
  "firstName": "Tunde",
  "lastName": "Bello"
}
```

`role` accepts `"staff"`, `"admin"`, or `"superadmin"`.

**Response (201):** The created user object (without password).

**409** if email already exists.

---

### `PATCH /api/v1/internal/users/:id/password` (Superadmin only)

Resets any internal user's password. Admin-initiated, no current-password check required.

**Auth:** Superadmin only | IP-whitelisted

**Body:**

```json
{
  "newPassword": "newpassword123"
}
```

---

### `PATCH /api/v1/internal/me/password` (Staff+)

An internal operator changing their own password. Requires current password verification.

**Auth:** Staff+ (authenticated)

**Body:**

```json
{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword123"
}
```

**401** if `currentPassword` is incorrect.

---

## Admin Clients Routes

Clients are customers managed from the admin panel. These routes support creating customer stubs (before they sign up) and viewing their activity.

### `GET /api/v1/admin/clients`

Lists all clients with order and payment aggregates.

**Auth:** Staff+

**Query params:**

- `page`, `limit`
- `isActive` — `"true"` or `"false"`

**Response:**

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "uuid",
        "email": "customer@email.com",
        "firstName": "Jane",
        "lastName": "Doe",
        "phone": "+2348012345678",
        "isActive": true,
        "totalOrders": 7,
        "totalPayments": "235000",
        "lastOrderAt": "2026-02-10T..."
      }
    ],
    "pagination": { ... }
  }
}
```

---

### `GET /api/v1/admin/clients/:id`

Returns a single client's profile with aggregates.

**Auth:** Staff+

---

### `GET /api/v1/admin/clients/:id/orders`

Lists orders belonging to a specific client.

**Auth:** Staff+

**Query params:** `page`, `limit`, `statusV2`

---

### `POST /api/v1/admin/clients`

Creates a customer stub account and immediately sends a Clerk invite email. The customer will complete signup via Clerk. On their first login, the backend links the Clerk account to the stub.

**Auth:** Staff+

**Body:**

```json
{
  "email": "newcustomer@email.com",
  "firstName": "Ngozi",
  "lastName": "Adeyemi",
  "businessName": null,
  "phone": "+2348056789012"
}
```

Only `email` is required. All other fields are optional.

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "newcustomer@email.com"
  }
}
```

**Error:** If the email already has a Clerk account, the invite will fail and the error will surface.

---

### `POST /api/v1/admin/clients/:id/send-invite`

Re-sends the Clerk signup invite to a client who hasn't accepted yet.

**Auth:** Staff+

**Response:**

```json
{
  "success": true,
  "data": { "message": "Invite sent successfully" }
}
```

---

## Team Routes

### `GET /api/v1/team/`

Lists internal team members (staff, admin, superadmin).

**Auth:** Admin+

**Query params (all optional):**

| Param | Description |
| --- | --- |
| `role` | Filter by role: `staff` \| `admin` \| `superadmin` |
| `isActive` | `true` = active members only, `false` = pending approval |
| `page` / `limit` | Pagination |

> **Pending approvals:** Use `?isActive=false` to show a list of accounts waiting for superadmin approval.

**Response:**

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "uuid",
        "firstName": "Tunde",
        "lastName": "Bello",
        "displayName": "Tunde Bello",
        "email": "tunde@company.com",
        "role": "staff",
        "isActive": true,
        "permissions": ["View Reports", "Manage Orders"]
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 5, "totalPages": 1 }
  }
}
```

`permissions` is a derived array of human-readable labels based on the role — use it to display permission badges in the UI.

---

### `PATCH /api/v1/team/:id/approve` (Superadmin only)

Activates a pending team member account so they can log in.

New operator accounts created via `POST /api/v1/internal/users` start with `isActive: false`. The account holder cannot log in until a superadmin approves the account.

**Auth:** Superadmin only

**Params:** `id` — UUID of the team member to approve

**Response (200):** The updated team member object (same shape as `GET /team/`).

**Response (404):** Team member not found.

---

### Permission toggle buttons → role changes

The Team page permission toggles map to role changes using `PATCH /api/v1/users/:id/role`:

| UI Toggle | Role to assign |
| --- | --- |
| Make as Admin | `{ "role": "admin" }` |
| Can transfer funds and view | `{ "role": "staff" }` |
| Can view only | `{ "role": "staff" }` |

> **Note:** There is no dedicated "view-only" role. "Can view only" and "Can transfer funds and view" both map to `staff`. The distinction is purely presentational in the UI.

---

## Uploads Routes

Image uploads use a two-step presigned URL flow. You never send the file to this backend — you upload directly to Cloudflare R2, then confirm the upload here.

### `POST /api/v1/uploads/presign` (Staff+)

Step 1: Get a presigned PUT URL for a warehouse image.

**Auth:** Staff+

**Body:**

```json
{
  "orderId": "uuid-of-order",
  "contentType": "image/jpeg"
}
```

`contentType` must be one of: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`.

**Response:**

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://r2.cloudflarestorage.com/bucket/orders/uuid/filename.jpg?X-Amz-...",
    "r2Key": "orders/uuid/filename.jpg"
  }
}
```

Use `uploadUrl` to `PUT` the raw file binary directly from the browser (no auth headers needed for the R2 request itself). Save the `r2Key` for step 2.

---

### `POST /api/v1/uploads/confirm` (Staff+)

Step 2: After the file is uploaded to R2, confirm it here to create the database record.

**Auth:** Staff+

**Body:**

```json
{
  "orderId": "uuid-of-order",
  "r2Key": "orders/uuid/filename.jpg"
}
```

**Response (201):**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "orderId": "uuid",
    "r2Key": "orders/uuid/filename.jpg",
    "url": "https://cdn.example.com/orders/uuid/filename.jpg",
    "uploadedBy": "uuid",
    "createdAt": "..."
  }
}
```

---

### `GET /api/v1/uploads/orders/:orderId/images`

Returns all images for a given order.

**Auth:** Any authenticated

**Response:** Array of image objects (same shape as the confirm response).

---

### `DELETE /api/v1/uploads/images/:imageId` (Admin+)

Deletes an image from both R2 and the database.

**Auth:** Admin+

---

## Reports Routes

Financial reports (`/summary`, `/revenue`) are **Superadmin only** and IP-whitelisted — they expose company revenue. The operational report (`/orders/by-status`) is **Admin+** and IP-whitelisted.

### `GET /api/v1/reports/summary`

Returns aggregate summary statistics: total orders, total users, total revenue.

**Auth:** Superadmin only | IP-whitelisted

**Response:**

```json
{
  "success": true,
  "data": {
    "totalOrders": 312,
    "totalUsers": 87,
    "totalRevenue": "12450000.00"
  }
}
```

---

### `GET /api/v1/reports/orders/by-status`

Returns order counts grouped by V2 status.

**Auth:** Admin+ | IP-whitelisted

**Response:**

```json
{
  "success": true,
  "data": [
    { "statusV2": "FLIGHT_DEPARTED", "count": 14 },
    { "statusV2": "WAREHOUSE_VERIFIED_PRICED", "count": 8 },
    { "statusV2": "PICKED_UP_COMPLETED", "count": 210 }
  ]
}
```

---

### `GET /api/v1/reports/revenue`

Returns daily revenue breakdown for a date range. Defaults to the last 30 days if no range is provided.

**Auth:** Superadmin only | IP-whitelisted

**Query params:**

- `from` — ISO 8601 datetime, e.g. `2026-01-01T00:00:00Z`
- `to` — ISO 8601 datetime, e.g. `2026-01-31T23:59:59Z`

**Response:**

```json
{
  "success": true,
  "data": [
    { "date": "2026-01-01", "revenue": "145000" },
    { "date": "2026-01-02", "revenue": "0" },
    ...
  ]
}
```

---

## Settings Routes

Settings access is split by operation type. **Read** (GET) endpoints are open to **Staff+** so warehouse staff can do their jobs. **Write** (PATCH) endpoints require **Admin+** or **Superadmin** depending on the sensitivity of the setting. IP-whitelisting applies to write endpoints only.

### `GET /api/v1/settings/logistics`

Returns logistics settings: the active shipping lane, office addresses (Korea and Lagos), and ETA notes.

**Auth:** Staff+

**Response:**

```json
{
  "success": true,
  "data": {
    "lane": {
      "originCountry": "South Korea",
      "originCity": "Seoul",
      "destinationCountry": "Nigeria",
      "destinationCity": "Lagos",
      "isLocked": false
    },
    "koreaOffice": {
      "nameEn": "Seoul Office",
      "nameKo": "서울 사무소",
      "addressEn": "123 Gangnam-gu, Seoul",
      "addressKo": "서울 강남구 123",
      "phone": "+82-2-1234-5678"
    },
    "lagosOffice": {
      "nameEn": "Lagos Office",
      "nameKo": "라고스 사무소",
      "addressEn": "5 Victoria Island, Lagos",
      "addressKo": "라고스 빅토리아 아일랜드 5",
      "phone": "+234-1-234-5678"
    },
    "etaNotes": {
      "airLeadTimeNote": "Typically 5-7 business days",
      "seaLeadTimeNote": "Typically 4-6 weeks"
    }
  }
}
```

---

### `PATCH /api/v1/settings/logistics`

Updates logistics settings. Only the fields you provide are changed.

**Auth:** Admin+ | IP-whitelisted

**Important:** Updating `koreaOffice` or `lagosOffice` requires **superadmin** role.

**Body:**

```json
{
  "lane": {
    "isLocked": true
  },
  "etaNotes": {
    "airLeadTimeNote": "Typically 5-7 business days"
  },
  "koreaOffice": {
    "addressEn": "456 New Address, Seoul"
  }
}
```

All top-level keys (`lane`, `koreaOffice`, `lagosOffice`, `etaNotes`) and all nested fields are optional.

---

### `GET /api/v1/settings/fx-rate`

Returns the current FX rate configuration (USD to NGN).

**Auth:** Staff+

**Response:**

```json
{
  "success": true,
  "data": {
    "mode": "manual",
    "manualRate": 1550,
    "effectiveRate": 1550
  }
}
```

`mode` is either `"live"` (fetch from external source) or `"manual"` (use `manualRate`). `effectiveRate` is the currently active rate regardless of mode, or `null` if unavailable.

---

### `PATCH /api/v1/settings/fx-rate`

Updates the FX rate mode or manual rate.

**Auth:** Superadmin only | IP-whitelisted

**Body:**

```json
{
  "mode": "manual",
  "manualRate": 1600
}
```

---

### `GET /api/v1/settings/templates`

Lists notification templates. Used to customise the content of automated emails and in-app notifications.

**Auth:** Admin+ | IP-whitelisted

**Query params:**

- `templateKey` — filter by key (e.g. `"status_update"`)
- `locale` — `"en"` or `"ko"`
- `channel` — `"email"` or `"in_app"`
- `includeInactive` — boolean, default `false`

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "templateKey": "status_update",
      "locale": "en",
      "channel": "email",
      "subject": "Your shipment status has been updated",
      "body": "Hello {{firstName}}, your order {{trackingNumber}} is now {{statusLabel}}.",
      "isActive": true,
      "updatedAt": "..."
    }
  ]
}
```

---

### `PATCH /api/v1/settings/templates/:id`

Updates a notification template.

**Auth:** Admin+ | IP-whitelisted

**Body:**

```json
{
  "subject": "Shipment Update — {{trackingNumber}}",
  "body": "Hi {{firstName}}, your order {{trackingNumber}} status is now: {{statusLabel}}.",
  "isActive": true
}
```

All fields optional. You can also update `templateKey`, `locale`, and `channel`.

---

### `GET /api/v1/settings/pricing`

Returns all pricing rules.

**Auth:** Staff+

**Query params:**

- `mode` — `"air"` or `"sea"`
- `customerId` — show customer-specific overrides for a customer UUID
- `includeInactive` — boolean, default `false`

**Response:**

```json
{
  "success": true,
  "data": {
    "defaultRules": [
      {
        "id": "uuid",
        "name": "Air Standard",
        "mode": "air",
        "minWeightKg": 0,
        "maxWeightKg": null,
        "rateUsdPerKg": 8.5,
        "flatRateUsdPerCbm": null,
        "isActive": true,
        "effectiveFrom": null,
        "effectiveTo": null
      }
    ],
    "customerOverrides": []
  }
}
```

---

### `PATCH /api/v1/settings/pricing`

Upserts and/or deletes pricing rules in a single operation.

**Auth:** Admin+ | IP-whitelisted

**Body:**

```json
{
  "defaultRules": [
    {
      "id": "existing-uuid",
      "name": "Air Standard",
      "mode": "air",
      "rateUsdPerKg": 9.0,
      "isActive": true
    },
    {
      "name": "Sea Freight",
      "mode": "sea",
      "flatRateUsdPerCbm": 120,
      "isActive": true
    }
  ],
  "customerOverrides": [
    {
      "customerId": "uuid-of-customer",
      "mode": "air",
      "rateUsdPerKg": 7.0,
      "startsAt": "2026-03-01",
      "endsAt": "2026-06-30",
      "notes": "Negotiated rate for bulk customer"
    }
  ],
  "deleteDefaultRuleIds": ["uuid-to-delete"],
  "deleteCustomerOverrideIds": []
}
```

Omit any key you don't want to use. Including `id` in a rule updates it; omitting `id` creates a new one.

**Response:** A summary of created/updated/deleted IDs plus the full updated pricing data.

---

### `GET /api/v1/settings/restricted-goods`

Lists the restricted goods catalog.

**Auth:** Staff+

**Query params:**

- `includeInactive` — boolean, default `false`

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "code": "lithium_batteries",
      "nameEn": "Lithium Batteries",
      "nameKo": "리튬 배터리",
      "description": "Restricted due to air freight regulations",
      "allowWithOverride": true,
      "isActive": true
    }
  ]
}
```

---

### `PATCH /api/v1/settings/restricted-goods`

Upserts and/or deletes restricted goods in a single operation.

**Auth:** Admin+ | IP-whitelisted

**Body:**

```json
{
  "items": [
    {
      "code": "lithium_batteries",
      "nameEn": "Lithium Batteries",
      "nameKo": "리튬 배터리",
      "description": "Restricted due to air freight regulations",
      "allowWithOverride": true,
      "isActive": true
    }
  ],
  "deleteIds": ["uuid-to-remove"]
}
```

**Response:** Summary of created/updated/deleted IDs plus full updated list.

---

## Webhooks

### `POST /webhooks/clerk`

Clerk user lifecycle webhook. Handles `user.created`, `user.updated`, `user.deleted` events from Clerk. **Do not call from the frontend.** Signature is verified via Svix.

---

## Error Handling

All errors follow the same shape:

```json
{
  "success": false,
  "message": "Human-readable error description"
}
```

Validation errors may include an `errors` array with field-level detail:

```json
{
  "success": false,
  "message": "Validation error",
  "errors": [{ "field": "email", "message": "Invalid email address" }]
}
```

Common HTTP status codes:

- `400` — bad request / validation failed / business rule violation
- `401` — missing or invalid token
- `403` — authenticated but not authorised (wrong role or IP)
- `404` — resource not found
- `409` — conflict (e.g. duplicate email)
- `422` — unprocessable entity (e.g. incomplete profile)
- `429` — rate limit exceeded

---

## V2 Status Reference

Every shipment has a `statusV2` field. The display-ready label for each value:

```
PREORDER_SUBMITTED          → "Pre-Order Submitted"
AWAITING_WAREHOUSE_RECEIPT  → "Awaiting Warehouse Receipt"
WAREHOUSE_RECEIVED          → "Received at Warehouse"
WAREHOUSE_VERIFIED_PRICED   → "Verified & Priced"
DISPATCHED_TO_ORIGIN_AIRPORT → "Dispatched to Airport"
AT_ORIGIN_AIRPORT           → "At Origin Airport"
BOARDED_ON_FLIGHT           → "Boarded on Flight"
FLIGHT_DEPARTED             → "Flight Departed"
FLIGHT_LANDED_LAGOS         → "Landed in Lagos"
DISPATCHED_TO_ORIGIN_PORT   → "Dispatched to Port"
AT_ORIGIN_PORT              → "At Origin Port"
LOADED_ON_VESSEL            → "Loaded on Vessel"
VESSEL_DEPARTED             → "Vessel Departed"
VESSEL_ARRIVED_LAGOS_PORT   → "Arrived at Lagos Port"
CUSTOMS_CLEARED_LAGOS       → "Customs Cleared"
IN_TRANSIT_TO_LAGOS_OFFICE  → "In Transit to Office"
READY_FOR_PICKUP            → "Ready for Pickup"
PICKED_UP_COMPLETED         → "Delivered"
ON_HOLD                     → "On Hold"
CANCELLED                   → "Cancelled"
RESTRICTED_ITEM_REJECTED    → "Restricted Item – Rejected"
RESTRICTED_ITEM_OVERRIDE_APPROVED → "Restricted Item – Override Approved"
```

These labels are also returned directly as `statusLabel` on tracking and shipment endpoints, so you should not need to maintain this mapping in the frontend.

---

## Support Routes

Real-time chat-style support tickets. Customers raise tickets; staff reply in real time via WebSocket.

---

### `POST /api/v1/support/tickets`

Create a support ticket with an opening message.

**Request body:**

```json
{
  "subject": "My package has not arrived",
  "category": "shipment_inquiry",
  "body": "My order GE-2026-0042 was supposed to arrive last week. Can you check?",
  "orderId": "uuid-of-order",
  "forUserId": "uuid-of-customer"
}
```

`subject` and `body` are required. `orderId` links the ticket to a specific order. `forUserId` is staff-only — creates the ticket on behalf of a customer.

**Categories:** `shipment_inquiry` · `payment_issue` · `damaged_goods` · `document_request` · `account_issue` · `general`

**Response (201):**

```json
{
  "success": true,
  "data": {
    "ticket": {
      "id": "uuid",
      "ticketNumber": "TKT-0001",
      "userId": "uuid",
      "orderId": "uuid or null",
      "category": "shipment_inquiry",
      "status": "open",
      "subject": "My package has not arrived",
      "assignedTo": null,
      "closedAt": null,
      "createdAt": "2026-02-26T10:00:00.000Z",
      "updatedAt": "2026-02-26T10:00:00.000Z"
    },
    "message": {
      "id": "uuid",
      "ticketId": "uuid",
      "authorId": "uuid",
      "authorName": "Chidi Okonkwo",
      "body": "My order GE-2026-0042 was supposed to arrive last week...",
      "isInternal": false,
      "createdAt": "2026-02-26T10:00:00.000Z"
    }
  }
}
```

All connected staff receive `{ type: "support:new_ticket", data: ticket }` via WebSocket.

---

### `GET /api/v1/support/tickets`

List support tickets (paginated).

**Query params:** `page`, `limit`, `status`, `category`, `assignedTo` (uuid), `userId` (staff-only customer filter)

Customers see only their own tickets. Staff see all.

---

### `GET /api/v1/support/tickets/:id`

Get a ticket with its full message thread.

**Response (200):**

```json
{
  "success": true,
  "data": {
    "ticket": { "...ticket fields..." },
    "messages": [
      {
        "id": "uuid",
        "ticketId": "uuid",
        "authorId": "uuid",
        "authorName": "Chidi Okonkwo",
        "body": "My order GE-2026-0042...",
        "isInternal": false,
        "createdAt": "2026-02-26T10:00:00.000Z"
      }
    ]
  }
}
```

Internal notes (`isInternal: true`) are never returned to customers — only staff/admin see them.

**After loading a ticket, the client should join the WebSocket room:**

```json
{ "type": "support:join", "ticketId": "uuid" }
```

**On navigate-away:**

```json
{ "type": "support:leave", "ticketId": "uuid" }
```

---

### `POST /api/v1/support/tickets/:id/messages`

Send a message in the ticket conversation.

**Request body:**

```json
{
  "body": "We are checking with the warehouse now.",
  "isInternal": false
}
```

`isInternal: true` is staff-only — creates a private note invisible to the customer.

Messaging a `closed` ticket returns **422**.

**Real-time delivery:** All users who have joined the ticket room via `support:join` receive:

```json
{
  "type": "support:message",
  "data": {
    "ticketId": "uuid",
    "message": { "...message fields..." }
  }
}
```

If the customer is offline (not in the room), they receive an in-app notification instead.

**Auto-status:** If the ticket was `open` and a staff member replies, it automatically advances to `in_progress`.

---

### `PATCH /api/v1/support/tickets/:id` (Staff+)

Update ticket status or assignment.

**Request body:**

```json
{
  "status": "resolved",
  "assignedTo": "uuid-of-staff-member"
}
```

**Status rules:**
- Staff: can set `open`, `in_progress`, `resolved`
- Admin+: can also set `closed` (permanent — customer cannot re-open)

**Assignment:** admin+ only. Pass `assignedTo: null` to unassign.

When set to `resolved`, the customer receives an in-app notification.

---

### WebSocket Protocol — Support Chat

| Direction | Event type | Payload | When |
|---|---|---|---|
| Client → Server | `support:join` | `{ "ticketId": "uuid" }` | User opens a ticket conversation |
| Client → Server | `support:leave` | `{ "ticketId": "uuid" }` | User closes/navigates away from ticket |
| Server → Client | `support:message` | `{ "ticketId", "message": {...} }` | Any participant sends a message |
| Server → Client | `support:new_ticket` | `{ "...ticket fields..." }` | New ticket created — received by all connected users (staff use this to show a badge/toast) |

**Usage pattern:**

```
1. Open ticket UI → GET /support/tickets/:id
2. Send { type: "support:join", ticketId } via WS
3. User types → POST /support/tickets/:id/messages
4. All room members receive support:message instantly
5. User closes ticket UI → Send { type: "support:leave", ticketId }
```

---

## IP Whitelisting

Several admin and settings endpoints require the request to come from a whitelisted IP address in addition to valid authentication. If you get a `403` on an admin endpoint despite having the right role and token, check whether the calling machine's IP is whitelisted. This applies to: all `/settings/` routes, all `/reports/` routes, all `/bulk-orders/` routes, and some `/internal/` routes.
