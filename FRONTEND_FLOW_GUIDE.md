# Global Express — Frontend Integration Guide

> Base URL: `/api/v1`
> Auth: Bearer token in `Authorization` header (Clerk JWT for customers, internal JWT for staff/admin/superadmin)
> WebSocket: `ws://<host>/ws?token=<jwt>`

---

## Roles

| Role        | Code          | Description                                                  |
| ----------- | ------------- | ------------------------------------------------------------ |
| Customer    | `user`        | End user who owns shipments. Can pre-order, view own orders, pay, manage notifications. |
| Staff       | `staff`       | Warehouse/office staff. Can create orders on behalf of customers, verify packages, update statuses, record offline payments, upload images. |
| Admin       | `admin`       | Everything staff can do + delete orders, delete images, manage pricing/restricted goods/templates, manage logistics settings. |
| Superadmin  | `superadmin`  | Everything admin can do + manage FX rates, view all payments, send broadcast notifications, manage all settings. |

**Role hierarchy**: `superadmin` > `admin` > `staff` > `user`

---

## The Complete Shipment Flow

### PHASE 1: Order Creation

There are two entry points:

#### Path A — Customer Pre-order (customer dashboard)

The customer gives us a heads-up about goods coming to our Korea warehouse. They fill in basic info — recipient, description, weight estimate, shipment type preference.

**Who:** Customer (`user`)
**Endpoint:** `POST /api/v1/orders`
**Key fields:**
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

- `senderId` is ignored for customers — the backend auto-sets it to the authenticated user.
- `recipientAddress` defaults to the Lagos office address if omitted.
- Customer must have a complete profile (name/business name, phone, full address) or gets `422`.
- The backend sets `isPreorder: true` automatically when a customer creates it.

**Initial status:** `PREORDER_SUBMITTED`
**Notification:** None (customer created it themselves, they know).

---

#### Path B — Staff/Admin creates order on behalf of a customer

The customer calls us or their goods arrive at the warehouse. Staff/admin creates the order for them.

**Who:** Staff, Admin, Superadmin
**Endpoint:** `POST /api/v1/orders`
**Key fields:**
```json
{
  "senderId": "550e8400-e29b-41d4-a716-446655440000",
  "recipientName": "Adeola Johnson",
  "recipientAddress": "5 Victoria Island, Lagos",
  "recipientPhone": "+2348098765432",
  "shipmentType": "air"
}
```

- `senderId` is required — this is the UUID of the customer the order belongs to.
- `isPreorder` is `false` (staff-created).

**Initial status:** `AWAITING_WAREHOUSE_RECEIPT`
**Notification:** Customer gets an in-app notification: "A new shipment has been created for you."

---

### PHASE 2: Warehouse Verification & Pricing

Goods arrive at the Korea warehouse. Staff/admin physically inspects the packages, weighs them, measures dimensions, checks for restricted items, and applies special packaging if needed. This is where the actual price is calculated.

**Who:** Staff, Admin, Superadmin
**Endpoint:** `POST /api/v1/orders/:id/warehouse-verify`
**Request body:**
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

1. Validates all package data (positive weights, dimensions, quantities).
2. Auto-calculates CBM from dimensions if not provided: `(L x W x H) / 1,000,000`.
3. Looks up special packaging surcharges from `app_settings` (e.g., "liquid" = $X per unit).
4. Calculates freight using the pricing engine:
   - **Air**: USD per kg, tiered by weight brackets (from `pricing_rules` table or hardcoded defaults).
   - **Sea**: USD per CBM (from `pricing_rules` table or default $550/CBM).
   - Checks for **customer-specific overrides** first (set by superadmin in settings).
5. Adds special packaging surcharges on top of freight.
6. Sets `finalChargeUsd` = freight + surcharges (this is what the customer sees).
7. Computes ETA from departure date (air = +7 days, sea = +90 days).
8. Updates order status to `WAREHOUSE_VERIFIED_PRICED`.
9. Stores all package records in `order_packages` table.

**Optional manual price override:**
```json
{
  "packages": [ ... ],
  "manualFinalChargeUsd": 250.00,
  "manualAdjustmentReason": "Loyal customer discount applied"
}
```
- `manualAdjustmentReason` is **required** when `manualFinalChargeUsd` is provided.

**Response includes:**
- `calculatedChargeUsd` — what the system calculated
- `specialPackagingSurchargeUsd` — total surcharge
- `finalChargeUsd` — what the customer will be charged
- `pricingSource` — `DEFAULT_RATE`, `CUSTOMER_OVERRIDE`, or `MANUAL_ADJUSTMENT`
- `amountDue` — equals `finalChargeUsd` until paid, then `null`

**Notification:** Customer gets milestone notification: "Your package has been verified at the warehouse and priced."

---

### PHASE 3: Payment

Before the shipment can be marked `READY_FOR_PICKUP`, payment must be collected in full. There are two payment methods:

#### Option A — Online Payment (Paystack)

**Who:** Customer (`user`)

**Step 1: Initialize payment**
`POST /api/v1/payments/initialize`
```json
{
  "orderId": "550e8400-e29b-41d4-a716-446655440000",
  "amount": 500000,
  "currency": "NGN",
  "callbackUrl": "https://yourapp.com/payment/callback"
}
```
- `amount` is in **kobo** (smallest unit). 500000 kobo = 5,000 NGN.
- Returns `authorizationUrl` — redirect customer to this Paystack page.

**Step 2: Customer pays on Paystack**
(handled entirely by Paystack's hosted page)

**Step 3: Verify payment after redirect**
`POST /api/v1/payments/verify/:reference`
- The `reference` comes from the initialize response.
- Paystack webhook (`POST /webhooks/paystack`) also auto-updates payment status.

**Step 4: View my payments**
`GET /api/v1/payments/me?page=1&limit=20&status=successful`

#### Option B — Offline Payment (cash/transfer)

**Who:** Staff, Admin, Superadmin
**Endpoint:** `POST /api/v1/payments/:orderId/record-offline`
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "amount": 45000,
  "paymentType": "transfer",
  "proofReference": "TRF-2024-00123",
  "note": "Customer transferred NGN 45,000 on Feb 26"
}
```
- Immediately sets `paymentCollectionStatus` to `PAID_IN_FULL`.

**Payment admin views (superadmin only):**
- `GET /api/v1/payments` — list all payments (filter by `userId`, `status`)
- `GET /api/v1/payments/:id` — get single payment

---

### PHASE 4: Status Updates (The Journey)

After warehouse verification, staff/admin manually advances the shipment status as the goods move through the logistics pipeline.

**Who:** Staff, Admin, Superadmin
**Endpoint:** `PATCH /api/v1/orders/:id/status`
```json
{
  "statusV2": "DISPATCHED_TO_ORIGIN_AIRPORT"
}
```

#### Air Shipment Flow (in order):
```
PREORDER_SUBMITTED
  -> AWAITING_WAREHOUSE_RECEIPT
  -> WAREHOUSE_RECEIVED
  -> WAREHOUSE_VERIFIED_PRICED        (set by warehouse-verify endpoint, not manually)
  -> DISPATCHED_TO_ORIGIN_AIRPORT
  -> AT_ORIGIN_AIRPORT
  -> BOARDED_ON_FLIGHT
  -> FLIGHT_DEPARTED
  -> FLIGHT_LANDED_LAGOS
  -> CUSTOMS_CLEARED_LAGOS
  -> IN_TRANSIT_TO_LAGOS_OFFICE
  -> READY_FOR_PICKUP                 (requires PAID_IN_FULL)
  -> PICKED_UP_COMPLETED
```

#### Sea Shipment Flow (in order):
```
PREORDER_SUBMITTED
  -> AWAITING_WAREHOUSE_RECEIPT
  -> WAREHOUSE_RECEIVED
  -> WAREHOUSE_VERIFIED_PRICED        (set by warehouse-verify endpoint, not manually)
  -> DISPATCHED_TO_ORIGIN_PORT
  -> AT_ORIGIN_PORT
  -> LOADED_ON_VESSEL
  -> VESSEL_DEPARTED
  -> VESSEL_ARRIVED_LAGOS_PORT
  -> CUSTOMS_CLEARED_LAGOS
  -> IN_TRANSIT_TO_LAGOS_OFFICE
  -> READY_FOR_PICKUP                 (requires PAID_IN_FULL)
  -> PICKED_UP_COMPLETED
```

#### Exception Statuses (can be set at any stage):
- `ON_HOLD` — shipment paused, needs attention
- `CANCELLED` — shipment cancelled
- `RESTRICTED_ITEM_REJECTED` — item rejected due to restriction
- `RESTRICTED_ITEM_OVERRIDE_APPROVED` — restricted item approved with override

#### Rules enforced by backend:
1. **Sequential only** — you cannot skip statuses. Must go in order.
2. **Payment gate** — `READY_FOR_PICKUP` requires `paymentCollectionStatus === 'PAID_IN_FULL'`.
3. **Transport mode required** — mode-specific statuses (airport/port) require transport mode to be set first (via warehouse verification).

#### What happens on each status update:
1. Status is saved to the order.
2. A status event is recorded in `order_status_events` (audit trail — who changed it and when).
3. Real-time WebSocket push to the customer:
   ```json
   { "type": "order_status_updated", "data": { "orderId": "...", "trackingNumber": "...", "statusV2": "FLIGHT_DEPARTED", "updatedAt": "..." } }
   ```
4. For milestone statuses — in-app notification created + email + WhatsApp (if enabled).

---

### PHASE 5: Customer Views Their Shipments & Notifications

#### My Shipments (unified view)

**Who:** Customer (`user`)
**Endpoint:** `GET /api/v1/orders/my-shipments?page=1&limit=20`

Returns all packages belonging to the customer — both solo orders and bulk shipment items combined into one list, sorted newest first. Each item has a `type` field: `"solo"` or `"bulk_item"`.

#### Order Detail

**Who:** Customer (own orders only), Staff+ (any order)
**Endpoint:** `GET /api/v1/orders/:id`

Returns full order details including pricing, payment status, and `amountDue`.

#### Status Timeline (progress tracker)

**Who:** Customer (own orders only), Staff+ (any order)
**Endpoint:** `GET /api/v1/orders/:id/timeline`

Returns chronological list of every status change the shipment has been through. Use this to render a step-by-step progress tracker.

```json
{
  "orderId": "...",
  "trackingNumber": "GE-2026-AB12",
  "currentStatus": "FLIGHT_DEPARTED",
  "currentStatusLabel": "Flight Departed",
  "timeline": [
    { "status": "AWAITING_WAREHOUSE_RECEIPT", "statusLabel": "Awaiting Warehouse Receipt", "timestamp": "2026-03-07T10:00:00Z" },
    { "status": "WAREHOUSE_VERIFIED_PRICED", "statusLabel": "Verified & Priced", "timestamp": "2026-03-08T14:30:00Z" },
    { "status": "DISPATCHED_TO_ORIGIN_AIRPORT", "statusLabel": "Dispatched to Airport", "timestamp": "2026-03-10T09:00:00Z" },
    { "status": "FLIGHT_DEPARTED", "statusLabel": "Flight Departed", "timestamp": "2026-03-12T16:45:00Z" }
  ]
}
```

#### Public Tracking (no auth)

**Who:** Anyone
**Endpoint:** `GET /api/v1/orders/track/:trackingNumber`

Works for both solo orders and bulk items. Returns status, timeline, origin/destination, and last location.

#### Notifications Inbox

**Who:** Any authenticated user
| Action | Endpoint | Method |
| --- | --- | --- |
| List notifications | `/api/v1/notifications?page=1&limit=20` | `GET` |
| Unread count | `/api/v1/notifications/unread-count` | `GET` |
| Mark as read | `/api/v1/notifications/:id/read` | `PATCH` |
| Toggle saved | `/api/v1/notifications/:id/save` | `PATCH` |
| Delete one | `/api/v1/notifications/:id` | `DELETE` |
| Bulk delete | `/api/v1/notifications` | `DELETE` (body: `{ "ids": [...] }`) |

Notifications include both **personal** (order updates, payment events) and **broadcast** (system announcements). Each has `isRead` and `isSaved` state per-user.

#### Real-time WebSocket

Connect: `ws://<host>/ws?token=<jwt>`

Events pushed to clients:
| Event | When |
| --- | --- |
| `order_status_updated` | Staff updates a shipment status |
| `notification:new` | New personal notification created |
| `notification:broadcast` | System-wide announcement |

---

## Supporting Endpoints

### Package Images (warehouse photos)

| Action | Endpoint | Method | Role |
| --- | --- | --- | --- |
| Get presigned upload URL | `/api/v1/uploads/presign` | `POST` | Staff+ |
| Confirm upload | `/api/v1/uploads/confirm` | `POST` | Staff+ |
| View order images | `/api/v1/orders/:id/images` | `GET` | Any auth |
| View order images (alt) | `/api/v1/uploads/orders/:orderId/images` | `GET` | Any auth |
| Delete image | `/api/v1/uploads/images/:imageId` | `DELETE` | Admin+ |

**Upload flow:**
1. `POST /uploads/presign` with `{ orderId, contentType }` -> get `uploadUrl` + `r2Key`
2. `PUT` the file to `uploadUrl` (direct to Cloudflare R2)
3. `POST /uploads/confirm` with `{ orderId, r2Key }` -> image record saved

### Shipping Cost Estimate

| Action | Endpoint | Method | Role |
| --- | --- | --- | --- |
| Estimate (authenticated) | `/api/v1/orders/estimate` | `POST` | Any auth |
| Estimate (public) | `/api/v1/public/calculator/estimate` | `POST` | None |

The authenticated version uses customer-specific pricing overrides if they exist.

### Pickup Representative

**Who:** Customer (own orders), Staff+ (any order)
**Endpoint:** `PATCH /api/v1/orders/:id/pickup-rep`
```json
{
  "pickupRepName": "Emeka Nwosu",
  "pickupRepPhone": "+2348034567890"
}
```
Designate someone else to collect the package at the Lagos office.

---

## Admin/Settings Endpoints

### Shipments List (admin dashboard view)

**Who:** Staff+ (all orders), Customer (own only)
**Endpoint:** `GET /api/v1/shipments?page=1&limit=20&statusV2=FLIGHT_DEPARTED&senderId=<uuid>`

FE-friendly shape with `statusLabel`, `senderName`, `packageCount`.

### Pricing Rules

| Action | Endpoint | Method | Role |
| --- | --- | --- | --- |
| List rules + overrides | `GET /api/v1/settings/pricing` | `GET` | Staff+ |
| Upsert/delete rules | `PATCH /api/v1/settings/pricing` | `PATCH` | Admin+ |

Default rules = rates that apply to all customers.
Customer overrides = per-customer special rates (e.g., loyalty discount).

### Restricted Goods Catalog

| Action | Endpoint | Method | Role |
| --- | --- | --- | --- |
| List restricted goods | `GET /api/v1/settings/restricted-goods` | `GET` | Staff+ |
| Upsert/delete | `PATCH /api/v1/settings/restricted-goods` | `PATCH` | Admin+ |

### Logistics Settings (lane, offices, ETA notes)

| Action | Endpoint | Method | Role |
| --- | --- | --- | --- |
| View | `GET /api/v1/settings/logistics` | `GET` | Staff+ |
| Update | `PATCH /api/v1/settings/logistics` | `PATCH` | Admin+ |

### FX Rate (USD to NGN)

| Action | Endpoint | Method | Role |
| --- | --- | --- | --- |
| View | `GET /api/v1/settings/fx-rate` | `GET` | Staff+ |
| Update | `PATCH /api/v1/settings/fx-rate` | `PATCH` | Superadmin |

### Notification Templates

| Action | Endpoint | Method | Role |
| --- | --- | --- | --- |
| List | `GET /api/v1/settings/templates` | `GET` | Admin+ |
| Update | `PATCH /api/v1/settings/templates/:id` | `PATCH` | Admin+ |

### Broadcast Notifications

**Who:** Superadmin only
**Endpoint:** `POST /api/v1/notifications/broadcast`
```json
{
  "type": "system_announcement",
  "title": "Scheduled Maintenance",
  "body": "The system will be down for maintenance on March 15."
}
```

### Order Deletion

**Who:** Admin, Superadmin
**Endpoint:** `DELETE /api/v1/orders/:id`
Soft-delete only — sets `deletedAt`, order disappears from listings.

---

## Quick Reference — Role Permissions Matrix

| Action | Customer | Staff | Admin | Superadmin |
| --- | --- | --- | --- | --- |
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
| View notifications | Yes | Yes | Yes | Yes |
| Send broadcast notification | - | - | - | Yes |
| Manage pricing rules | - | - | Yes | Yes |
| Manage customer overrides | - | - | Yes | Yes |
| Manage restricted goods | - | - | Yes | Yes |
| View logistics/FX settings | - | Yes | Yes | Yes |
| Update logistics settings | - | - | Yes | Yes |
| Update FX rate | - | - | - | Yes |
| Manage notification templates | - | - | Yes | Yes |
| Public tracking | Yes | Yes | Yes | Yes |
| Public cost estimate | Yes | Yes | Yes | Yes |

---

## Status to Notification Mapping

These statuses trigger customer notifications (in-app + email + WhatsApp):

| Status | Notification Title |
| --- | --- |
| `WAREHOUSE_VERIFIED_PRICED` | Package Verified & Priced |
| `DISPATCHED_TO_ORIGIN_AIRPORT` | Dispatched to Airport |
| `DISPATCHED_TO_ORIGIN_PORT` | Dispatched to Port |
| `FLIGHT_DEPARTED` | Flight Departed |
| `VESSEL_DEPARTED` | Vessel Departed |
| `FLIGHT_LANDED_LAGOS` | Landed in Lagos |
| `VESSEL_ARRIVED_LAGOS_PORT` | Arrived at Lagos Port |
| `CUSTOMS_CLEARED_LAGOS` | Customs Cleared |
| `IN_TRANSIT_TO_LAGOS_OFFICE` | In Transit to Office |
| `READY_FOR_PICKUP` | Ready for Pickup |
| `PICKED_UP_COMPLETED` | Pickup Completed |
| `ON_HOLD` | Shipment On Hold |
| `CANCELLED` | Shipment Cancelled |
| `RESTRICTED_ITEM_REJECTED` | Item Rejected - Restricted |
| `RESTRICTED_ITEM_OVERRIDE_APPROVED` | Restricted Item Override Approved |

---

## Payment States

| `paymentCollectionStatus` | Meaning |
| --- | --- |
| `UNPAID` | No payment received yet |
| `PAYMENT_IN_PROGRESS` | Paystack transaction initiated but not confirmed |
| `PAID_IN_FULL` | Payment confirmed (online or offline) |

The `amountDue` field on an order equals `finalChargeUsd` when unpaid, and `null` when paid or not yet priced.
