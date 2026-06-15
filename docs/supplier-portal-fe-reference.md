# Supplier Portal — Frontend Implementation Reference

**File path:** `docs/supplier-portal-fe-reference.md`
**Base URL (local):** `http://localhost:3000`
**Base URL (production):** `https://global-express-backend-1.onrender.com`
**Interactive docs:** `https://global-express-backend-1.onrender.com/docs`

---

## What the supplier portal is

Suppliers are business partners (e.g. a factory in South Korea) who ship physical goods to Global Express's warehouse on behalf of customers in Nigeria. Their entire workflow lives in a separate portal — they never see customer or staff screens.

**Supplier flow:**
1. Supplier logs in to the supplier portal
2. They fill in a goods declaration — what they're sending, who the recipient is, estimated weight, value, shipment type
3. GE staff review the declaration and either accept or reject it
4. If accepted: supplier receives a tracking number and brings goods to the warehouse
5. GE staff verify and price the goods at the warehouse — this triggers the normal shipment flow
6. The goods travel with the next batch and eventually reach the customer in Nigeria

---

## Authentication

Suppliers have their own login endpoint — **do not use the staff or customer login endpoints**.

### `POST /api/v1/supplier/auth/login`

No `Authorization` header needed. Rate limited to 5 attempts per minute.

**Body:**
```json
{
  "email": "supplier@example.com",
  "password": "their-password"
}
```

**Success response `200`:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "supplier@example.com",
      "firstName": "Park",
      "lastName": "Ji-yeon",
      "role": "supplier"
    },
    "tokens": {
      "accessToken": "eyJ..."
    }
  }
}
```

**Error responses:**
- `401` — wrong email or password (also returned if a non-supplier tries to log in here)
- `423` — account locked after too many failed attempts

**After login:**
- Store `accessToken` in memory (or a secure cookie — not localStorage)
- Attach it as `Authorization: Bearer <accessToken>` on every subsequent request
- Call `GET /api/v1/users/me` to get the full profile including `businessName`

---

## Full profile

### `GET /api/v1/users/me`
**Header:** `Authorization: Bearer <accessToken>`

Call this immediately after login to get businessName, phone, and other profile fields for the dashboard header.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "supplier@example.com",
    "firstName": "Park",
    "lastName": "Ji-yeon",
    "businessName": "Seoul Beauty Exports Co.",
    "phone": "+821012345678",
    "role": "supplier",
    "isActive": true,
    "mustCompleteProfile": false,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

## Pages to build

| Route | Page |
|---|---|
| `/supplier/login` | Login page |
| `/supplier/dashboard` | Declarations list (home screen) |
| `/supplier/declarations/new` | Submit a new goods declaration |
| `/supplier/declarations/:id` | Declaration detail — status, timeline, invoice |

On login, read `role` from the token response. If `role !== "supplier"`, reject and show an error. After a successful login, redirect to `/supplier/dashboard`.

---

## Declarations

A declaration is the supplier telling GE: "I'm about to send these goods to your warehouse." Staff review it, accept or reject it, and if accepted an order is created and a tracking number is issued.

### Declaration status flow

```
pending_review  →  accepted   (staff approved — tracking number issued)
                →  rejected   (staff rejected — reason provided, supplier can resubmit)
```

Once accepted, the underlying order progresses through the normal shipment status flow (visible via the order tracking number).

---

### `POST /api/v1/supplier/declarations`
**Who:** supplier (authenticated)
**Purpose:** Submit a new goods declaration.

**Body:**
```json
{
  "recipientName": "Adaobi Nwachukwu",
  "recipientPhone": "+2348012345678",
  "recipientEmail": "adaobi@example.com",
  "recipientAddress": "12 Akin Adesola Street, Victoria Island, Lagos",
  "description": "500 pieces eyeliner, 200 pieces eyeshadow palette",
  "quantity": 700,
  "declaredValueUsd": 4200.00,
  "estimatedWeightKg": 38.5,
  "shipmentType": "air",
  "specialPackagingNotes": "Fragile — palettes must stay upright",
  "supplierNotes": "Order ref: INV-20260610-A",
  "estimatedArrivalAt": "2026-06-25"
}
```

**Required fields:** `recipientName`, `recipientPhone`, `description`, `declaredValueUsd`, `shipmentType`

**Optional fields:** `recipientEmail`, `recipientAddress`, `quantity`, `estimatedWeightKg`, `specialPackagingNotes`, `supplierNotes`, `estimatedArrivalAt`

**`shipmentType` values:**
| Value | Meaning |
|---|---|
| `"air"` | Air freight — faster, good for smaller/lighter goods |
| `"ocean"` | Ocean freight — slower, better for large or heavy goods |
| `"d2d"` | Door-to-door — delivered directly to the recipient's address in Nigeria |

**Success response `201`:**
```json
{
  "success": true,
  "data": { ...declarationObject }
}
```

---

### `GET /api/v1/supplier/declarations`
**Who:** supplier (authenticated)
**Purpose:** List the supplier's own declarations. Use this for the dashboard.

**Query params:**
| Param | Type | Description |
|---|---|---|
| `status` | `pending_review \| accepted \| rejected` | Filter by status (optional) |
| `page` | number | Defaults to 1 |
| `limit` | number | Defaults to 20, max 100 |

**Response `200`:**
```json
{
  "success": true,
  "data": [ ...declarationObjects ]
}
```

---

### `GET /api/v1/supplier/declarations/:id`
**Who:** supplier (authenticated)
**Purpose:** Full detail for a single declaration. Use this for the declaration detail page.

**Response `200`:**
```json
{
  "success": true,
  "data": { ...declarationObject }
}
```

Returns `404` if the declaration doesn't exist or belongs to a different supplier.

---

## Declaration object shape

```json
{
  "id": "uuid",
  "supplierId": "uuid",

  "recipientName": "Adaobi Nwachukwu",
  "recipientPhone": "+2348012345678",
  "recipientEmail": "adaobi@example.com",
  "recipientAddress": "12 Akin Adesola Street, Victoria Island, Lagos",

  "description": "500 pieces eyeliner, 200 pieces eyeshadow palette",
  "quantity": 700,
  "declaredValueUsd": "4200.00",
  "estimatedWeightKg": "38.500",
  "shipmentType": "air",
  "specialPackagingNotes": "Fragile — palettes must stay upright",
  "supplierNotes": "Order ref: INV-20260610-A",
  "estimatedArrivalAt": "2026-06-25",

  "status": "pending_review",
  "rejectionReason": null,

  "reviewedBy": null,
  "reviewedAt": null,

  "orderId": null,
  "linkedCustomerId": null,
  "linkedBy": null,
  "linkedAt": null,

  "createdAt": "2026-06-14T10:00:00.000Z",
  "updatedAt": "2026-06-14T10:00:00.000Z"
}
```

**Key fields to drive the UI:**

| Field | When to use |
|---|---|
| `status` | Main badge on each declaration card |
| `rejectionReason` | Show this when `status === "rejected"` so the supplier knows what to fix |
| `orderId` | When not null, a tracking number has been issued — show a link to track the order |
| `estimatedArrivalAt` | Show as "Expected arrival at warehouse" |

---

## What to show per status

### `pending_review`
- Badge: "Waiting for review"
- Message: "Your declaration has been received. Our team is reviewing it and will get back to you shortly."
- No action needed from the supplier

### `accepted`
- Badge: "Accepted"
- Message: "Your declaration has been approved. Bring your goods to our warehouse."
- Show the tracking number from `GET /api/v1/orders/:orderId` — fetch it using `orderId` from the declaration
- The tracking number is what the supplier quotes when dropping off goods

### `rejected`
- Badge: "Not accepted"
- Show `rejectionReason` prominently — this is what they need to fix
- Message: "Please review the reason below and submit a new declaration with the corrected details."
- Show a "Submit new declaration" button (do not auto-populate — let them start fresh)

---

## Notifications

Suppliers receive in-app notifications when:
- Their declaration is accepted (includes tracking number)
- Their declaration is rejected (includes reason)

Fetch notifications using the standard endpoint:

### `GET /api/v1/notifications`
**Header:** `Authorization: Bearer <accessToken>`

Suppliers only see their own notifications — the backend scopes this automatically based on the token.

---

## Test credentials

Use these to test the supplier portal locally:

| Field | Value |
|---|---|
| Email | `test-supplier@globalexpress.dev` |
| Password | `TestSupplier123!` |
| Role | `supplier` |
| Business name | `Seoul Beauty Exports Co.` |

---

## Edge cases to handle

### 1. Token expiry
If any authenticated request returns `401`, clear the stored token and redirect to `/supplier/login`.

### 2. Empty declaration list
First-time login — show a clear call to action: "You have not submitted any declarations yet. Submit your first declaration to get started."

### 3. Multiple rejected declarations
A supplier can have several declarations in various states at once. On the dashboard list, sort by `createdAt` descending (newest first — this is the default from the API). Show a status badge on each card.

### 4. Accepted declaration — order not yet verified
After acceptance, `orderId` is set but the order is still `PREORDER_SUBMITTED`. The tracking number exists but the goods haven't arrived at the warehouse yet. Show: "Your goods are expected — bring them to our warehouse quoting tracking number GEX-XXXX."

### 5. `declaredValueUsd` and `estimatedWeightKg` come back as strings
These are numeric strings from the database (e.g. `"4200.00"`, `"38.500"`). Parse with `parseFloat()` before doing any arithmetic or formatting.

### 6. `recipientAddress` is optional at submission time
Staff may not always need it for air/ocean — it's required for D2D. If `shipmentType` is `"d2d"`, make `recipientAddress` required on the submission form. For `"air"` and `"ocean"`, it is optional.

### 7. Staff may link the declaration to a GE customer account
`linkedCustomerId` will be set by staff if they find the recipient in the GE database. This is handled entirely on the staff side — the supplier does not need to do anything for this. You can safely ignore this field in the supplier portal UI.
