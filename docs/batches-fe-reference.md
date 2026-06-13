# Batch Management — Frontend Implementation Reference

**Base URL:** `https://global-express-backend-1.onrender.com`
**Interactive docs:** `https://global-express-backend-1.onrender.com/docs`
**All batch endpoints require:** `Authorization: Bearer <token>` (staff or superadmin)

---

## What a batch is

A batch is a physical shipment container. All verified customer goods are grouped into a batch and travel together. When the batch moves — clears customs, lands in Lagos, is ready for pickup — every customer's goods inside it move at the same time.

There are always two types of batches running simultaneously:
- **Air batch** — for air freight and door-to-door (D2D) goods
- **Sea batch** — for ocean freight

They are completely separate. One air batch and one sea batch are always open at any given time.

---

## The tracking number rule

This is the most important concept to get right on the FE.

Every order in the system has its own internal tracking number (e.g. `GEX-ABC`, `GEX-DEF`, `GEX-XYZ`). These exist so warehouse staff can identify and act on individual packages — weigh them, flag issues, pull one out without affecting the others.

**The customer never needs to see individual order tracking numbers once a batch is involved.**

When a customer's first verified order is added to a batch, a **batch slot** is created for them. The slot stores one tracking number — the first order's tracking number — as their single reference for the entire batch. Every subsequent order from the same customer in the same batch is linked to that slot.

From the customer's perspective:
- They have **one tracking number** for the batch: e.g. `GEX-ABC`
- All their goods — whether 1 item or 10 — move under that number
- Status updates and notifications always reference `GEX-ABC`

From staff's perspective:
- They see all individual orders (`GEX-ABC`, `GEX-DEF`, `GEX-XYZ`) for warehouse operations
- They can pull individual order details if one package has an issue (wrong weight, damaged, held separately)
- The batch roster shows both the customer's batch tracking number and all their individual orders

**Do not display individual order tracking numbers to customers on the batch tracking screen.** Use `batchTrackingNumber` from the roster response.

---

## Batch lifecycle

```
open  →  closed  →  (movement statuses applied one by one as the shipment progresses)
```

- **open** — accepting new verified goods. Staff add orders here.
- **closed** — sealed. No more orders can be added or removed. Invoices are finalised. Customers are notified of their payment amount. Status updates now cascade from the batch level.

There is no manual "seal" step. A superadmin closes the batch directly when all goods are priced.

When a batch is closed, a new open batch of the same transport mode is created **automatically**. There is always an open batch ready to receive incoming goods.

---

## Batch eligibility rule

An order can only be added to a batch when its status is exactly **`WAREHOUSE_VERIFIED_PRICED`**.

No other status qualifies. Payment is not a condition. The batch is about physical goods being received, verified, and priced at the warehouse — not about the customer having paid.

---

## D2D and air batches

Door-to-door (D2D) goods have `shipmentType: "d2d"`. They always go into the **air batch**, not a separate D2D batch. They travel on the same flight as air freight.

They diverge after customs clearance in Lagos:
- Air freight → office pickup (`READY_FOR_PICKUP`)
- D2D → local courier assigned → delivered to recipient (`LOCAL_COURIER_ASSIGNED` → `DELIVERED_TO_RECIPIENT`)

On the FE, when displaying batch contents, you can use `shipmentType` on each order to label goods correctly. The batch roster returns `shipmentTypeLabel` (plain English) for each order so you don't need to map it yourself.

---

## Endpoints

### `POST /api/v1/batches`
**Who:** admin+
**Purpose:** Open a new batch manually (only needed if no open batch exists for that transport mode — normally they auto-create on close).

**Body:**
```json
{ "transportMode": "air" }
```
`transportMode` is either `"air"` or `"sea"`. For D2D goods, use `"air"`.

**Response:** the new batch object (see batch shape below).

---

### `GET /api/v1/batches`
**Who:** admin+
**Purpose:** List all batches for the batches overview page.

**Query params:**
| Param | Type | Description |
|---|---|---|
| `status` | `open \| cutoff_pending_approval \| closed` | Filter by batch status |
| `transportMode` | `air \| sea` | Filter by transport mode |
| `page` | number | Defaults to 1 |
| `limit` | number | Defaults to 20, max 100 |

**Response:**
```json
{
  "success": true,
  "data": {
    "batches": [
      {
        "id": "...",
        "masterTrackingNumber": "GEX-MASTER-AIR-20260613-A1B2C3",
        "transportMode": "air",
        "transportLabel": "Air Freight",
        "status": "open",
        "statusLabel": "Accepting goods",
        "customerCount": 4,
        "orderCount": 11,
        "totalWeightKg": "143.500",
        ...
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 }
  }
}
```

---

### `GET /api/v1/batches/:batchId`
**Who:** admin+
**Purpose:** Single batch summary (no roster). Use this for a batch detail header.

---

### `GET /api/v1/batches/:batchId/roster`
**Who:** admin+
**Purpose:** Full breakdown of every customer and their goods in the batch. This is the main view for the batch detail page.

**Response shape:**
```json
{
  "success": true,
  "data": {
    "batch": { ...batchObject },
    "customers": [
      {
        "slotId": "...",
        "customerId": "...",
        "customerName": "Adaobi Nwachukwu",
        "shippingMark": "GE-AN-X7K4",
        "batchTrackingNumber": "GEX-20260601-AB12CD34",
        "orderCount": 3,
        "totalWeightKg": "14.200",
        "allVerified": true,
        "orders": [
          {
            "id": "...",
            "trackingNumber": "GEX-20260601-AB12CD34",
            "status": "WAREHOUSE_VERIFIED_PRICED",
            "statusLabel": "Verified and priced",
            "description": "Electronics",
            "weightKg": "4.500",
            "shipmentType": "air",
            "shipmentTypeLabel": "Air freight",
            "declaredValueUsd": "320.00",
            "createdAt": "2026-06-01T10:00:00.000Z"
          },
          ...
        ]
      }
    ],
    "summary": {
      "totalCustomers": 4,
      "totalOrders": 11,
      "totalWeightKg": "143.500",
      "unverifiedOrders": 0,
      "canClose": true,
      "shipmentTypeBreakdown": { "air": 9, "d2d": 2 },
      "goodsTypeBreakdown": { "air": 9, "d2d": 2 }
    }
  }
}
```

**Key fields to use:**
- `batchTrackingNumber` — what to show the customer. Do not show individual `trackingNumber` fields from the orders array to customers.
- `allVerified` — per-customer flag. If `false` for any customer, the batch cannot be closed.
- `summary.canClose` — use this to enable/disable the Close Batch button. It is `true` only when every order in the batch is verified and priced and there is at least one order.
- `summary.unverifiedOrders` — show as a warning: "X orders still need verification before this batch can be closed."

---

### `POST /api/v1/batches/:batchId/orders`
**Who:** admin+
**Purpose:** Add a verified order to the batch.

**Body:**
```json
{ "orderId": "uuid-of-the-order" }
```

**What happens internally:**
1. Order status is checked — must be `WAREHOUSE_VERIFIED_PRICED`. Anything else returns 422.
2. The order's transport mode is checked to confirm it belongs in this batch (air vs sea).
3. If the customer already has a slot in this batch, the order is added to their existing slot. Their `batchTrackingNumber` does not change.
4. If the customer has no slot yet, one is created and this order's tracking number becomes their `batchTrackingNumber` for the batch.

**Response:**
```json
{
  "success": true,
  "data": {
    "ok": true,
    "batchId": "...",
    "masterTrackingNumber": "GEX-MASTER-AIR-20260613-A1B2C3",
    "batchTrackingNumber": "GEX-20260601-AB12CD34",
    "isNewSlot": false
  }
}
```

`isNewSlot: true` means this was the customer's first order in this batch.

**Errors:**
- `422` — order not yet verified and priced
- `422` — order already in a batch
- `422` — batch is not open (already closed)
- `404` — order not found

---

### `DELETE /api/v1/batches/:batchId/orders/:orderId`
**Who:** admin+
**Purpose:** Remove an order from an open batch (e.g. a mistake, or the package needs to be re-inspected).

**Rules:**
- Only works on **open** batches. Cannot remove orders from a closed batch.
- If this was the customer's only order in the batch, their slot is also deleted (their `batchTrackingNumber` is released).
- If the customer has other orders in the batch, their slot remains and their `batchTrackingNumber` is unchanged.

**Errors:**
- `422` — batch is not open

---

### `PATCH /api/v1/batches/:batchId/status`
**Who:** admin+
**Purpose:** Update the batch's movement stage as the shipment progresses. This is the main action after closing.

**Rules:**
- Only works on **closed** batches.
- Applies the new status to **every order** inside the batch in one operation.
- Sends **one notification per customer** (not per order). Customers receive a plain-English update.

**Body:**
```json
{ "status": "FLIGHT_DEPARTED" }
```

**Valid statuses for this endpoint** (post-close movement only):

| Status | Plain English label |
|---|---|
| `DISPATCHED_TO_ORIGIN_AIRPORT` | Sent to the airport |
| `AT_ORIGIN_AIRPORT` | At the airport |
| `BOARDED_ON_FLIGHT` | Loaded onto the flight |
| `FLIGHT_DEPARTED` | Flight has departed |
| `FLIGHT_LANDED_LAGOS` | Landed in Lagos |
| `DISPATCHED_TO_ORIGIN_PORT` | Sent to the port |
| `AT_ORIGIN_PORT` | At the port |
| `LOADED_ON_VESSEL` | Loaded onto the ship |
| `VESSEL_DEPARTED` | Ship has departed |
| `VESSEL_ARRIVED_LAGOS_PORT` | Ship arrived in Lagos |
| `CUSTOMS_CLEARED_LAGOS` | Cleared customs in Lagos |
| `IN_TRANSIT_TO_LAGOS_OFFICE` | On the way to our Lagos office |
| `IN_EXTRA_TRUCK_MOVEMENT_LAGOS` | On an extra truck movement in Lagos |
| `READY_FOR_PICKUP` | Ready for pickup at our office |
| `PICKED_UP_COMPLETED` | Picked up — complete |
| `LOCAL_COURIER_ASSIGNED` | Local courier assigned (D2D) |
| `IN_TRANSIT_TO_DESTINATION_CITY` | On the way to your city |
| `OUT_FOR_DELIVERY_DESTINATION_CITY` | Out for delivery |
| `DELIVERED_TO_RECIPIENT` | Delivered |
| `ON_HOLD` | On hold |

Use `GET /api/v1/batches/status-labels` to get this list dynamically with full descriptions.

**Response:**
```json
{
  "success": true,
  "data": {
    "ok": true,
    "updatedOrderCount": 11,
    "newStatus": "FLIGHT_DEPARTED",
    "statusLabel": "Flight has departed"
  }
}
```

---

### `POST /api/v1/batches/:batchId/close`
**Who:** superadmin only
**Purpose:** Seal the batch, finalise invoices, notify customers, and open the next batch.

**Pre-conditions (enforced server-side — will 422 if not met):**
- The batch must not already be closed.
- Every order in the batch must be `WAREHOUSE_VERIFIED_PRICED`. The response on failure names the unverified orders so staff can act on them.
- The batch must not be empty.

**What happens on a successful close:**
1. Batch status set to `closed`.
2. Invoices finalised for every order in the batch.
3. A new **open** batch of the same transport mode is created automatically.
4. Every customer in the batch receives a payment notification: *"Your goods (tracking: GEX-ABC) have been sealed into a batch and are ready to ship. Your total balance is $X. Please log in to make your payment."*

**Response:**
```json
{
  "success": true,
  "data": {
    "ok": true,
    "closedBatch": { ...batchObject },
    "nextBatch": { ...batchObject },
    "customersNotified": 4
  }
}
```

**Errors:**
```json
{
  "success": false,
  "message": "3 order(s) in this batch have not been verified and priced yet. All goods must be verified and priced before the batch can be closed.",
  "unverifiedOrders": ["GEX-20260601-AB12CD34", "GEX-20260601-CD34EF56", "GEX-20260601-EF56GH78"]
}
```
Use `unverifiedOrders` to display which specific orders are blocking the close.

---

### `GET /api/v1/batches/status-labels`
**Who:** admin+
**Purpose:** Returns every possible shipment status with a plain-English label and description. Cache this on app load and use it anywhere you need to display a status to staff or customers.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "status": "WAREHOUSE_VERIFIED_PRICED",
      "label": "Verified and priced",
      "description": "Your goods have been inspected and priced. They are ready to be shipped."
    },
    {
      "status": "FLIGHT_DEPARTED",
      "label": "Flight has departed",
      "description": "The flight carrying your goods has taken off and is on its way."
    },
    ...
  ]
}
```

---

## Batch object shape (common across all endpoints)

```json
{
  "id": "uuid",
  "masterTrackingNumber": "GEX-MASTER-AIR-20260613-A1B2C3",
  "transportMode": "air",
  "transportLabel": "Air Freight",
  "status": "open",
  "statusLabel": "Accepting goods",
  "carrierName": null,
  "airlineTrackingNumber": null,
  "oceanTrackingNumber": null,
  "d2dTrackingNumber": null,
  "voyageOrFlightNumber": null,
  "estimatedDepartureAt": null,
  "estimatedArrivalAt": null,
  "closedAt": null,
  "notes": null,
  "createdAt": "2026-06-13T08:00:00.000Z",
  "updatedAt": "2026-06-13T08:00:00.000Z"
}
```

---

## Edge cases to handle on the FE

### 1. Batch is empty — Close button disabled
If `summary.canClose` is `false` and `summary.totalOrders === 0`, the batch has no goods yet. Show "No goods have been added to this batch yet" rather than a generic disabled state.

### 2. Some orders not yet verified — Close button disabled with detail
If `summary.canClose` is `false` and `summary.unverifiedOrders > 0`, show which customers have unverified goods. Use `allVerified: false` on each customer row to highlight them. Show: *"X orders still need to be verified and priced before this batch can be closed."*

### 3. Customer has multiple goods — show one tracking number
On any customer-facing screen, only show `batchTrackingNumber` from the roster. Never expose individual order tracking numbers on the customer-facing batch view. Individual tracking numbers are internal staff references for per-package operations (e.g. resolving a dispute on one item).

### 4. D2D goods in an air batch
D2D orders appear in the air batch alongside regular air freight. On the roster, each order has `shipmentType` (`"air"` or `"d2d"`) and `shipmentTypeLabel` (`"Air freight"` or `"Door-to-door"`). Display a visual indicator so staff can see at a glance which goods are D2D — they'll need a local courier assigned after Lagos customs clearance, while air freight customers come to the office.

### 5. Status updates — not all statuses apply to all batches
Air batch statuses go through airport/flight stages. Sea batch statuses go through port/vessel stages. The endpoint accepts all valid post-close statuses but staff should only see the ones relevant to the batch's transport mode. Use `transportMode` on the batch object to filter the status dropdown:
- `"air"` → show airport and flight statuses + shared Lagos statuses
- `"sea"` → show port and vessel statuses + shared Lagos statuses

### 6. Closing creates the next batch automatically
After a successful close, `nextBatch` in the response is the new open batch that's immediately ready to receive goods. You can use this to redirect staff to the new batch or update your batch list without a refetch.

### 7. Removing an order from a closed batch — not allowed
The remove order button should be hidden or disabled for closed batches. The API will return 422 if attempted.

### 8. Adding an order that's already in a batch
If a staff member tries to add an order that's already been assigned to another batch, the API returns 422: *"This order is already in a batch."* Show this error directly — it means someone already processed the order.

---

## Staff permission flags

Two per-user permission flags control access to batch operations. Check these on the authenticated staff user object (`GET /api/v1/users/me`):

| Flag | What it gates |
|---|---|
| `canManageShipmentBatches` | Add/remove orders, update batch status, view roster |
| Superadmin role only | Close a batch |

Staff without `canManageShipmentBatches` should see batches in read-only mode. Only superadmins get the Close Batch action.
