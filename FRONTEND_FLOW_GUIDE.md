# Global Express — Frontend Integration Guide

> **Base URL:** `/api/v1`
> **Auth:** Bearer token in `Authorization` header — Clerk JWT for customers, internal JWT for staff/admin/superadmin
> **WebSocket:** `ws://<host>/ws?token=<jwt>`
> **Empty body:** PATCH/DELETE requests with no body are fine — no need to send `{}`.

---

## Roles

| Role | Code | Description |
|---|---|---|
| Customer | `user` | End user who owns shipments. Pre-orders, views own orders, pays, manages notifications. |
| Staff | `staff` | Warehouse/office. Creates orders for customers, verifies packages, updates statuses, records offline payments, uploads images. |
| Admin | `admin` | Everything staff can do + delete orders/images, manage pricing/restricted goods/templates/logistics. |
| Superadmin | `superadmin` | Everything admin can do + FX rates, all payments, broadcast notifications, all settings, team approval. |

**Hierarchy:** `superadmin` > `admin` > `staff` > `user`

---

## Authentication

### Customers (Clerk)

Clerk handles signup/login. After Clerk auth, the backend auto-provisions the user on first request.

| Action | Method | URL | Auth |
|---|---|---|---|
| Sync after signup | `POST` | `/api/v1/auth/sync` | Clerk JWT |
| Get profile | `GET` | `/api/v1/auth/me` | Clerk JWT |

### Staff / Admin / Superadmin (Internal)

| Action | Method | URL | Body |
|---|---|---|---|
| Login | `POST` | `/api/v1/internal/auth/login` | `{ "email", "password" }` |
| Change own password | `PATCH` | `/api/v1/internal/me/password` | `{ "currentPassword", "newPassword" }` |
| Get profile requirements | `GET` | `/api/v1/internal/me/profile-requirements` | — |
| Complete profile | `PATCH` | `/api/v1/internal/me/profile` | `{ "gender", "dateOfBirth", "phone", "addressStreet", ... }` |

**Onboarding flow for new staff:**
1. Superadmin/admin creates account → staff gets email with temp password
2. Staff logs in → response includes `mustChangePassword: true`
3. FE forces password change → `PATCH /internal/me/password`
4. Response includes `mustCompleteProfile: true`
5. FE shows profile form → `PATCH /internal/me/profile`
6. Staff is now fully active

---

## The Complete Shipment Flow

### PHASE 1: Order Creation

#### Path A — Customer Pre-order

**Who:** Customer (`user`)
**Endpoint:** `POST /api/v1/orders`

```json
{
  "recipientName": "Adeola Johnson",
  "recipientAddress": "5 Victoria Island, Lagos",
  "recipientPhone": "+2348098765432",
  "recipientEmail": "adeola@example.com",
  "orderDirection": "outbound",
  "weight": "3.2kg",
  "declaredValue": "45000",
  "description": "Electronics - laptop and accessories",
  "shipmentType": "air"
}
```

- `senderId` is auto-set to the authenticated user.
- Customer must have a complete profile or gets `422`. Check first: `GET /api/v1/users/me/completeness`.
- Backend sets `isPreorder: true` automatically.

**Initial status:** `PREORDER_SUBMITTED`

#### Path B — Staff/Admin creates on behalf of customer

**Who:** Staff+
**Endpoint:** `POST /api/v1/orders`

```json
{
  "senderId": "550e8400-e29b-41d4-a716-446655440000",
  "recipientName": "Adeola Johnson",
  "recipientAddress": "5 Victoria Island, Lagos",
  "recipientPhone": "+2348098765432",
  "shipmentType": "air"
}
```

- `senderId` is required — UUID of the customer.
- `isPreorder` is `false`.

**Initial status:** `AWAITING_WAREHOUSE_RECEIPT`
**Notification:** Customer gets in-app notification.

---

### PHASE 2: Warehouse Verification & Pricing

Goods arrive at Korea warehouse. Staff inspects, weighs, measures, checks restrictions, applies special packaging.

**Who:** Staff+
**Endpoint:** `POST /api/v1/orders/:id/warehouse-verify`

```json
{
  "transportMode": "air",
  "departureDate": "2026-03-15T00:00:00.000Z",
  "packages": [
    {
      "description": "Laptop",
      "itemType": "electronics",
      "quantity": 1,
      "lengthCm": 40,
      "widthCm": 30,
      "heightCm": 10,
      "weightKg": 3.2,
      "isRestricted": false
    },
    {
      "description": "Perfume bottles",
      "itemType": "liquid",
      "quantity": 3,
      "weightKg": 1.5,
      "specialPackagingType": "liquid",
      "isRestricted": true,
      "restrictedReason": "Liquid goods",
      "restrictedOverrideApproved": true,
      "restrictedOverrideReason": "Customer provided MSDS documentation"
    }
  ]
}
```

**What the backend does:**
1. Validates packages, auto-calculates CBM from dimensions
2. Looks up special packaging surcharges from settings
3. Calculates freight (air: USD/kg tiered; sea: USD/CBM)
4. Checks for customer-specific pricing overrides
5. Sets `finalChargeUsd` = freight + surcharges (system-generated; no manual override)
6. Updates status to `WAREHOUSE_VERIFIED_PRICED`
7. Stores packages in `order_packages`

**Response includes:** `calculatedChargeUsd`, `specialPackagingSurchargeUsd`, `finalChargeUsd`, `pricingSource`, `amountDue`

**To get special packaging types for the form:**
`GET /api/v1/internal/settings/special-packaging` (Staff+)

---

### PHASE 3: Payment

#### Option A — Online Payment (Paystack)

**Who:** Customer

```
1. POST /api/v1/payments/initialize  →  { "orderId", "amount" (kobo), "currency": "NGN", "callbackUrl" }
   ← returns authorizationUrl → redirect customer there

2. Customer pays on Paystack hosted page

3. POST /api/v1/payments/verify/:reference  →  confirms payment
   (Paystack webhook also auto-updates)
```

**View payments:** `GET /api/v1/payments/me?page=1&limit=20&status=successful`

#### Option B — Offline Payment (cash/transfer)

**Who:** Staff+
**Endpoint:** `POST /api/v1/payments/:orderId/record-offline`

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "amount": 45000,
  "paymentType": "transfer",
  "proofReference": "TRF-2024-00123",
  "note": "Customer transferred NGN 45,000"
}
```

Immediately sets `paymentCollectionStatus` to `PAID_IN_FULL`.

**Superadmin views:**
- `GET /api/v1/payments` — all payments
- `GET /api/v1/payments/:id` — single payment

---

### PHASE 4: Status Updates

Staff/admin manually advances shipment status as goods move.

**Who:** Staff+
**Endpoint:** `PATCH /api/v1/orders/:id/status`

```json
{ "statusV2": "DISPATCHED_TO_ORIGIN_AIRPORT" }
```

#### Air Flow:
```
PREORDER_SUBMITTED → AWAITING_WAREHOUSE_RECEIPT → WAREHOUSE_RECEIVED
→ WAREHOUSE_VERIFIED_PRICED (set by warehouse-verify, not manually)
→ DISPATCHED_TO_ORIGIN_AIRPORT → AT_ORIGIN_AIRPORT → BOARDED_ON_FLIGHT
→ FLIGHT_DEPARTED → FLIGHT_LANDED_LAGOS → CUSTOMS_CLEARED_LAGOS
→ IN_TRANSIT_TO_LAGOS_OFFICE → READY_FOR_PICKUP (requires PAID_IN_FULL)
→ PICKED_UP_COMPLETED
```

#### Sea Flow:
```
PREORDER_SUBMITTED → AWAITING_WAREHOUSE_RECEIPT → WAREHOUSE_RECEIVED
→ WAREHOUSE_VERIFIED_PRICED (set by warehouse-verify, not manually)
→ DISPATCHED_TO_ORIGIN_PORT → AT_ORIGIN_PORT → LOADED_ON_VESSEL
→ VESSEL_DEPARTED → VESSEL_ARRIVED_LAGOS_PORT → CUSTOMS_CLEARED_LAGOS
→ IN_TRANSIT_TO_LAGOS_OFFICE → READY_FOR_PICKUP (requires PAID_IN_FULL)
→ PICKED_UP_COMPLETED
```

#### Exception Statuses (any stage):
`ON_HOLD`, `CANCELLED`, `RESTRICTED_ITEM_REJECTED`, `RESTRICTED_ITEM_OVERRIDE_APPROVED`

#### Rules:
1. **Sequential only** — cannot skip statuses
2. **Payment gate** — `READY_FOR_PICKUP` requires `PAID_IN_FULL`
3. **Transport mode required** — mode-specific statuses need transport mode set first

#### On each status update:
1. Status saved + audit event recorded
2. WebSocket push: `{ "type": "order_status_updated", "data": { "orderId", "trackingNumber", "statusV2", "updatedAt" } }`
3. Pre-order pickup: when `PREORDER_SUBMITTED` → `AWAITING_WAREHOUSE_RECEIPT`, customer gets in-app + email + WhatsApp ("Your Pre-Order Is Being Processed")
4. For milestone statuses: in-app notification + email + WhatsApp (see Status → Notification Mapping below)

---

### PHASE 5: Customer Views

#### My Shipments
`GET /api/v1/orders/my-shipments?page=1&limit=20`
Unified view — solo orders + bulk items combined, sorted newest first.

#### Order Detail
`GET /api/v1/orders/:id`
Full order with pricing, payment status, `amountDue`.

#### Status Timeline
`GET /api/v1/orders/:id/timeline`

```json
{
  "orderId": "...",
  "trackingNumber": "GE-2026-AB12",
  "currentStatus": "FLIGHT_DEPARTED",
  "currentStatusLabel": "Flight Departed",
  "timeline": [
    { "status": "AWAITING_WAREHOUSE_RECEIPT", "statusLabel": "...", "timestamp": "..." },
    { "status": "WAREHOUSE_VERIFIED_PRICED", "statusLabel": "...", "timestamp": "..." }
  ]
}
```

#### Public Tracking (no auth)
`GET /api/v1/orders/track/:trackingNumber`

---

## Notifications (Unified — All Roles)

**One set of endpoints for all roles.** The backend automatically filters by the authenticated user's role.

### What each role sees

| Role | Sees |
|---|---|
| Customer | Personal notifications (order updates, payment events) + system broadcasts |
| Staff | Same as customer + staff-targeted notifications |
| Admin | Same as staff + admin-targeted (new orders, new customers, payment events) |
| Superadmin | Everything |

Each user has **independent** read/saved/deleted state.

### Endpoints

| Action | Method | URL | Body |
|---|---|---|---|
| List inbox | `GET` | `/api/v1/notifications?page=1&limit=20` | — |
| Unread count | `GET` | `/api/v1/notifications/unread-count` | — |
| Mark one read | `PATCH` | `/api/v1/notifications/:id/read` | — |
| Mark all read | `PATCH` | `/api/v1/notifications/read-all` | — |
| Toggle saved | `PATCH` | `/api/v1/notifications/:id/save` | — |
| Delete one | `DELETE` | `/api/v1/notifications/:id` | — |
| Bulk delete | `DELETE` | `/api/v1/notifications` | `{ "ids": ["uuid1", "uuid2"] }` |
| Broadcast | `POST` | `/api/v1/notifications/broadcast` | `{ "type", "title", "body" }` (superadmin) |

### Response shape

```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "uuid",
        "userId": "uuid | null",
        "orderId": "uuid | null",
        "type": "new_order",
        "title": "New Order Created",
        "subtitle": null,
        "body": "Order GX-2026-AB12 was created",
        "metadata": { "orderId": "...", "trackingNumber": "..." },
        "isBroadcast": false,
        "isRead": false,
        "isSaved": false,
        "createdBy": "uuid | null",
        "createdAt": "2026-03-08T12:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 5, "totalPages": 1 }
  }
}
```

### Notification types

| Type | Triggered when | Visible to |
|---|---|---|
| `order_status_update` | Order status changes | Customer (personal) |
| `payment_event` | Payment confirmed/failed | Customer (personal) |
| `system_announcement` | Superadmin sends broadcast | Everyone |
| `admin_alert` | Superadmin sends alert | Everyone |
| `new_customer` | New customer signs up | Admin + Superadmin |
| `new_order` | New order created | Admin + Superadmin |
| `payment_received` | Paystack payment succeeds | Admin + Superadmin |
| `payment_failed` | Paystack payment fails | Admin + Superadmin |
| `new_staff_account` | New staff account created | Admin + Superadmin |
| `staff_onboarding_complete` | Staff finishes onboarding | Admin + Superadmin |

### WebSocket events

| Event | When | Payload |
|---|---|---|
| `notification:new` | New personal or role-targeted notification | Full notification object |
| `notification:broadcast` | System-wide announcement | Full notification object |
| `order_status_updated` | Staff updates a shipment status | `{ orderId, trackingNumber, statusV2, updatedAt }` |

### IMPORTANT: No more `/internal/notifications`

The old `/api/v1/internal/notifications/...` endpoints are **removed**. All roles use `/api/v1/notifications/...`.

---

## User Profile

### Customer profile (self-service)

| Action | Method | URL |
|---|---|---|
| Get profile | `GET` | `/api/v1/users/me` |
| Update profile | `PATCH` | `/api/v1/users/me` |
| Profile completeness check | `GET` | `/api/v1/users/me/completeness` |
| Notification preferences | `GET` | `/api/v1/users/me/notification-preferences` |
| Update notification prefs | `PATCH` | `/api/v1/users/me/notification-preferences` |
| Delete account (GDPR) | `DELETE` | `/api/v1/users/me` |
| Export data (GDPR PDF) | `GET` | `/api/v1/users/me/export` |

**Update profile body (all fields optional):**
```json
{
  "firstName": "Chidi",
  "lastName": "Okonkwo",
  "phone": "+2348012345678",
  "whatsappNumber": "+2348012345678",
  "addressStreet": "14 Broad Street",
  "addressCity": "Lagos",
  "addressState": "Lagos",
  "addressCountry": "Nigeria",
  "addressPostalCode": "100001",
  "consentMarketing": true,
  "preferredLanguage": "en"
}
```

No Clerk involved — profile updates go directly to our backend.

### Admin user management

| Action | Method | URL | Role |
|---|---|---|---|
| List all users | `GET` | `/api/v1/users?role=user&isActive=true&page=1` | Admin+ |
| Get user by ID | `GET` | `/api/v1/users/:id` | Admin+ |
| Update any user | `PATCH` | `/api/v1/users/:id` | Admin+ |
| Change user role | `PATCH` | `/api/v1/users/:id/role` | Admin+ |
| Delete user | `DELETE` | `/api/v1/users/:id` | Superadmin |

---

## Client Management (Admin Panel)

Staff+ can manage customer accounts from the admin panel.

| Action | Method | URL | Role |
|---|---|---|---|
| Create client + send invite | `POST` | `/api/v1/admin/clients` | Staff+ |
| Re-send invite | `POST` | `/api/v1/admin/clients/:id/send-invite` | Staff+ |
| List all clients | `GET` | `/api/v1/admin/clients?page=1&limit=20` | Staff+ |
| Get client detail | `GET` | `/api/v1/admin/clients/:id` | Staff+ |
| Client's orders | `GET` | `/api/v1/admin/clients/:id/orders` | Staff+ |

Client list includes aggregated stats: total orders, total spent, last order date.

---

## Team Management (Internal Staff)

| Action | Method | URL | Role |
|---|---|---|---|
| Create staff account | `POST` | `/api/v1/internal/users` | Admin+ |
| List team members | `GET` | `/api/v1/team?page=1&limit=20` | Admin+ |
| Approve team member | `PATCH` | `/api/v1/team/:id/approve` | Superadmin |
| Reset password | `PATCH` | `/api/v1/internal/users/:id/password` | Superadmin |

---

## Package Images

| Action | Method | URL | Role |
|---|---|---|---|
| Get presigned upload URL | `POST` | `/api/v1/uploads/presign` | Staff+ |
| Confirm upload | `POST` | `/api/v1/uploads/confirm` | Staff+ |
| View order images | `GET` | `/api/v1/orders/:id/images` | Any auth |
| View order images (alt) | `GET` | `/api/v1/uploads/orders/:orderId/images` | Any auth |
| Delete image | `DELETE` | `/api/v1/uploads/images/:imageId` | Admin+ |

**Upload flow:**
1. `POST /uploads/presign` with `{ orderId, contentType }` → get `uploadUrl` + `r2Key`
2. `PUT` the file to `uploadUrl` (direct to Cloudflare R2)
3. `POST /uploads/confirm` with `{ orderId, r2Key }` → image saved

---

## Bulk Orders

| Action | Method | URL | Role |
|---|---|---|---|
| Create bulk shipment | `POST` | `/api/v1/bulk-orders` | Staff+ |
| List bulk orders | `GET` | `/api/v1/bulk-orders` | Staff+ |
| Get bulk order | `GET` | `/api/v1/bulk-orders/:id` | Staff+ |
| Update bulk status | `PATCH` | `/api/v1/bulk-orders/:id/status` | Staff+ |
| Add item | `POST` | `/api/v1/bulk-orders/:id/items` | Staff+ |
| Remove item | `DELETE` | `/api/v1/bulk-orders/:id/items/:itemId` | Admin+ |
| Delete bulk order | `DELETE` | `/api/v1/bulk-orders/:id` | Admin+ |

---

## Shipments List (Admin Dashboard)

`GET /api/v1/shipments?page=1&limit=20&statusV2=FLIGHT_DEPARTED&senderId=<uuid>`

FE-friendly shape with `statusLabel`, `senderName`, `packageCount`. Staff+ sees all; customer sees own only.

---

## Dashboard KPIs

| Action | Method | URL | Role |
|---|---|---|---|
| Full dashboard | `GET` | `/api/v1/dashboard` | Any auth |
| Stats only | `GET` | `/api/v1/dashboard/stats` | Any auth |
| Monthly trends | `GET` | `/api/v1/dashboard/trends` | Any auth |
| Active deliveries | `GET` | `/api/v1/dashboard/active-deliveries` | Any auth |

---

## Reports (Admin)

| Action | Method | URL | Role |
|---|---|---|---|
| Summary | `GET` | `/api/v1/reports/summary` | Superadmin |
| Orders by status | `GET` | `/api/v1/reports/orders/by-status` | Admin+ |
| Revenue analytics | `GET` | `/api/v1/reports/revenue` | Superadmin |
| Shipment volume | `GET` | `/api/v1/reports/shipment-volume` | Admin+ |
| Top customers | `GET` | `/api/v1/reports/top-customers` | Admin+ |
| Delivery performance | `GET` | `/api/v1/reports/delivery-performance` | Admin+ |
| Status pipeline | `GET` | `/api/v1/reports/status-pipeline` | Admin+ |
| Payment breakdown | `GET` | `/api/v1/reports/payment-breakdown` | Superadmin |
| Air vs sea comparison | `GET` | `/api/v1/reports/shipment-comparison` | Admin+ |

---

## Support Tickets

| Action | Method | URL | Role |
|---|---|---|---|
| Create ticket | `POST` | `/api/v1/support/tickets` | Any auth |
| List tickets | `GET` | `/api/v1/support/tickets` | Any auth (role-gated) |
| Get ticket + messages | `GET` | `/api/v1/support/tickets/:id` | Any auth |
| Send message | `POST` | `/api/v1/support/tickets/:id/messages` | Any auth |
| Update ticket status | `PATCH` | `/api/v1/support/tickets/:id` | Staff+ |

---

## Settings (Admin)

| Section | GET | PATCH/PUT | Read Role | Write Role |
|---|---|---|---|---|
| Pricing rules | `/api/v1/settings/pricing` | `/api/v1/settings/pricing` | Staff+ | Admin+ |
| Restricted goods | `/api/v1/settings/restricted-goods` | `/api/v1/settings/restricted-goods` | Staff+ | Admin+ |
| Logistics | `/api/v1/settings/logistics` | `/api/v1/settings/logistics` | Staff+ | Admin+ |
| FX rate | `/api/v1/settings/fx-rate` | `/api/v1/settings/fx-rate` | Staff+ | Superadmin |
| Notification templates | `/api/v1/settings/templates` | `/api/v1/settings/templates/:id` | Admin+ | Admin+ |
| Special packaging | `/api/v1/internal/settings/special-packaging` | `PUT /api/v1/internal/settings/special-packaging` | Staff+ | Superadmin |
| National ID toggle | `/api/v1/internal/settings/require-national-id` | `/api/v1/internal/settings/require-national-id` | Superadmin | Superadmin |

---

## Public Endpoints (No Auth)

| Action | Method | URL |
|---|---|---|
| Estimate shipping cost | `POST` | `/api/v1/public/calculator/estimate` |
| View rate tiers | `GET` | `/api/v1/public/calculator/rates` |
| Subscribe newsletter | `POST` | `/api/v1/public/newsletter/subscribe` |
| Track shipment | `GET` | `/api/v1/orders/track/:trackingNumber` |
| Health check | `GET` | `/health` |

---

## Pickup Representative

**Who:** Customer (own orders), Staff+ (any)
**Endpoint:** `PATCH /api/v1/orders/:id/pickup-rep`

```json
{
  "pickupRepName": "Emeka Nwosu",
  "pickupRepPhone": "+2348034567890"
}
```

---

## Push Notifications (Browser — Internal Only)

| Action | Method | URL | Role |
|---|---|---|---|
| Get VAPID key | `GET` | `/api/v1/internal/push/vapid-key` | Staff+ |
| Subscribe | `POST` | `/api/v1/internal/push/subscribe` | Staff+ |
| Unsubscribe | `POST` | `/api/v1/internal/push/unsubscribe` | Staff+ |

---

## Payment States

| `paymentCollectionStatus` | Meaning |
|---|---|
| `UNPAID` | No payment received |
| `PAYMENT_IN_PROGRESS` | Paystack initiated but not confirmed |
| `PAID_IN_FULL` | Payment confirmed (online or offline) |

`amountDue` = `finalChargeUsd` when unpaid, `null` when paid or not yet priced.

---

## Status → Notification Mapping

These statuses trigger customer notifications (in-app + email + WhatsApp):

| Status | Notification Title |
|---|---|
| `PREORDER_SUBMITTED` → `AWAITING_WAREHOUSE_RECEIPT` | Your Pre-Order Is Being Processed |
| `WAREHOUSE_VERIFIED_PRICED` | Package Verified & Priced |
| `FLIGHT_DEPARTED` | Flight Departed |
| `VESSEL_DEPARTED` | Vessel Departed |
| `FLIGHT_LANDED_LAGOS` | Landed in Lagos |
| `VESSEL_ARRIVED_LAGOS_PORT` | Arrived at Lagos Port |
| `CUSTOMS_CLEARED_LAGOS` | Customs Cleared |
| `READY_FOR_PICKUP` | Ready for Pickup |
| `ON_HOLD` | Shipment On Hold |
| `CANCELLED` | Shipment Cancelled |
| `RESTRICTED_ITEM_REJECTED` | Item Rejected - Restricted |

---

## Role Permissions Matrix

| Action | Customer | Staff | Admin | Superadmin |
|---|---|---|---|---|
| Create order (own) | Yes | - | - | - |
| Create order (on behalf) | - | Yes | Yes | Yes |
| View own orders | Yes | Yes | Yes | Yes |
| View all orders | - | Yes | Yes | Yes |
| Warehouse verify + price | - | Yes | Yes | Yes |
| Update shipment status | - | Yes | Yes | Yes |
| Upload package images | - | Yes | Yes | Yes |
| Delete package images | - | - | Yes | Yes |
| Soft-delete orders | - | - | Yes | Yes |
| Record offline payment | - | Yes | Yes | Yes |
| Initialize online payment | Yes | - | - | - |
| View own payments | Yes | Yes | Yes | Yes |
| View all payments | - | - | - | Yes |
| Set pickup representative | Yes (own) | Yes | Yes | Yes |
| View notifications | Yes (own + broadcasts) | + staff-targeted | + admin-targeted | All |
| Delete/read notifications | Yes | Yes | Yes | Yes |
| Send broadcast | - | - | - | Yes |
| Manage clients | - | Yes | Yes | Yes |
| Create staff accounts | - | - | Yes | Yes |
| Approve team members | - | - | - | Yes |
| Manage pricing rules | - | - | Yes | Yes |
| Manage restricted goods | - | - | Yes | Yes |
| View logistics/FX settings | - | Yes | Yes | Yes |
| Update logistics settings | - | - | Yes | Yes |
| Update FX rate | - | - | - | Yes |
| Manage notification templates | - | - | Yes | Yes |
| Reports — summary/revenue/payments | - | - | - | Yes |
| Reports — other analytics | - | - | Yes | Yes |
| Support tickets | Yes (own) | Yes (all) | Yes (all) | Yes (all) |
| Public tracking | Yes | Yes | Yes | Yes |
| Public cost estimate | Yes | Yes | Yes | Yes |

---

## Standard Response Shape

All endpoints return:

**Success:**
```json
{ "success": true, "data": { ... } }
```

**Error:**
```json
{ "success": false, "message": "Human-readable error" }
```

**Paginated:**
```json
{
  "success": true,
  "data": {
    "data": [ ... ],
    "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
  }
}
```
