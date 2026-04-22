# Public Website API Endpoint Changes

Date: 2026-04-22

This document includes:

1. Endpoint mapping from what your current public website calls to the current backend routes.
2. The exact payloads those endpoints now expect (params/query/body), auth requirement, and response shape.
3. Newly added public endpoints and their payload contracts.

## Base URL and Route Prefix

- Canonical backend endpoints are under `/api/v1/...`.
- If FE `baseURL` already includes `/api/v1`, FE calls like `/auth/login` map to `/api/v1/auth/login`.

## Mapping: Current FE Usage -> Current Backend

| Current FE Call | Canonical Backend Route | Current State |
| --- | --- | --- |
| `GET /api/v1/public/calculator/rates` | `GET /api/v1/public/calculator/rates` | Active |
| `POST /api/v1/public/calculator/estimate` | `POST /api/v1/public/calculator/estimate` | Active (enhanced for D2D intake mode) |
| `GET /api/v1/orders/track/:trackingNumber` | `GET /api/v1/orders/track/:trackingNumber` | Active (richer response now) |
| `POST /auth/login` | `POST /api/v1/auth/login` | Active (internal operator login only) |
| `POST /auth/register` | `POST /api/v1/auth/register` | Active (informational Clerk helper only) |
| `GET /users/me` | `GET /api/v1/users/me` | Active (auth required) |
| `PUT /users/:userId` | `PATCH /api/v1/users/:id` | Changed (method is `PATCH`, not `PUT`) |
| `POST /auth/logout` | `POST /api/v1/auth/logout` | Active (auth required) |

## Payload Contracts: Existing FE Endpoints

### `GET /api/v1/public/calculator/rates`

- Auth: None
- Params: None
- Query: None
- Body: None
- Success response (`200`):

```json
{
  "success": true,
  "data": {
    "air": {
      "unit": "kg",
      "tiers": [
        { "minKg": 1, "maxKg": 100, "rateUsdPerKg": 13.5 }
      ]
    },
    "sea": {
      "unit": "cbm",
      "flatRateUsdPerCbm": 550
    }
  }
}
```

### `POST /api/v1/public/calculator/estimate`

- Auth: None
- Params: None
- Query: None
- Body:

```json
{
  "shipmentType": "air",
  "weightKg": 12.5,
  "lengthCm": 40,
  "widthCm": 35,
  "heightCm": 30,
  "cbm": 0.042
}
```

- Notes:
  - `shipmentType` accepts configured public keys (not only `air/ocean`; includes `d2d`).
  - For `d2d`, backend may return intake guidance and `estimatedCostUsd: null`.
- Success response (`200`) shape:

```json
{
  "success": true,
  "data": {
    "shipmentType": "air",
    "mode": "air",
    "weightKg": 12.5,
    "cbm": 0.042,
    "estimatedCostUsd": 168.75,
    "departureFrequency": "Event-driven (based on warehouse movement)",
    "estimatedTransitDays": 7,
    "disclaimer": "string",
    "intake": {
      "title": "string",
      "description": "string",
      "submitEndpoint": "/api/v1/public/d2d/intake",
      "requiredFields": [
        "fullName",
        "email",
        "phone",
        "city",
        "country",
        "goodsDescription",
        "deliveryPhone",
        "deliveryAddressLine1",
        "consentAcknowledgement",
        "wantsAccount"
      ],
      "nextStep": "string"
    },
    "d2dIntake": {
      "title": "string",
      "description": "string",
      "submitEndpoint": "/api/v1/public/d2d/intake",
      "requiredFields": [
        "fullName",
        "email",
        "phone",
        "city",
        "country",
        "goodsDescription",
        "deliveryPhone",
        "deliveryAddressLine1",
        "consentAcknowledgement",
        "wantsAccount"
      ],
      "nextStep": "string"
    },
    "estimateDetails": {
      "input": {
        "shipmentType": "air",
        "weightKgInput": 12.5,
        "lengthCmInput": 40,
        "widthCmInput": 35,
        "heightCmInput": 30,
        "cbmInput": null
      },
      "calculation": {
        "chargeBasis": "actual_weight",
        "actualWeightKg": 12.5,
        "volumetricWeightKg": 7,
        "chargeableWeightKg": 12.5,
        "cbmUsed": 0.042
      },
      "pricing": {
        "estimatedCostUsd": 168.75,
        "unitRateUsd": 13.5,
        "currency": "USD",
        "airTier": {
          "minKg": 1,
          "maxKg": 100,
          "rateUsdPerKg": 13.5
        }
      }
    }
  }
}
```

### `GET /api/v1/orders/track/:trackingNumber`

- Auth: None
- Params:

```json
{ "trackingNumber": "GEX-20260422-1E05BF68" }
```

- Query: None
- Body: None
- Important:
  - Internal master tracking (`GEX-MASTER-*`) intentionally returns `404`.
- Success response (`200`) shape:

```json
{
  "success": true,
  "data": {
    "trackingNumber": "GEX-20260422-1E05BF68",
    "status": "PROCESSING_AT_ORIGIN",
    "statusLabel": "Processing at Origin",
    "origin": "South Korea",
    "destination": "Lagos, Nigeria",
    "estimatedDelivery": null,
    "lastUpdate": "Apr 22, 2026 · 10:14 AM",
    "lastLocation": "South Korea",
    "paymentStatus": "pending",
    "shipmentCost": {
      "usd": "0.00",
      "ngn": "0.00",
      "invoiceStatus": "draft"
    },
    "vendorCount": 0,
    "cargoMetrics": {
      "packageCount": 0,
      "totalWeightKg": "0.000",
      "totalCbm": "0.000000"
    },
    "timeline": [
      {
        "status": "PROCESSING_AT_ORIGIN",
        "statusLabel": "Processing at Origin",
        "timestamp": "2026-04-22T10:14:42.809Z"
      }
    ]
  }
}
```

### `POST /api/v1/auth/login`

- Auth: None
- Params: None
- Query: None
- Body:

```json
{
  "email": "staff@example.com",
  "password": "yourPassword"
}
```

- Success response (`200`):

```json
{
  "user": {
    "id": "uuid",
    "email": "staff@example.com",
    "firstName": "string|null",
    "lastName": "string|null",
    "role": "staff|superadmin",
    "mustChangePassword": false,
    "mustCompleteProfile": false,
    "createdAt": "iso",
    "updatedAt": "iso"
  },
  "tokens": {
    "accessToken": "jwt"
  }
}
```

### `POST /api/v1/auth/register`

- Auth: None
- Params: None
- Query: None
- Body: empty object `{}` (or no payload)
- Success response (`200`):

```json
{
  "message": "Registration is handled by Clerk...",
  "clerkSignUpUrl": "https://clerk.com/docs/references/javascript/sign-up"
}
```

### `GET /api/v1/users/me`

- Auth: Required (`Authorization: Bearer <token>`)
- Params: None
- Query: None
- Body: None
- Success response (`200`) includes:
  - identity/contact/address fields,
  - `role`, `isActive`,
  - new permission flags:
    - `canProvisionClientLogin`
    - `canManageShipmentBatches`
  - notification/language prefs and timestamps.

### `POST /api/v1/auth/sync` (new customer auth sync step)

- Auth: Required (Clerk Bearer token)
- Params: None
- Query: None
- Body: None
- Purpose: Provision/sync Clerk-authenticated customer into backend user record.
- Success response (`200`): `{ success: true, data: <full user profile> }`
- Common failure: `409` if role/account conflict requires admin handling.

### `PATCH /api/v1/users/:id` (replaces old `PUT /users/:userId`)

- Auth: Required (`admin/staff/superadmin` path; role-gated)
- Params:

```json
{ "id": "user-uuid" }
```

- Query: None
- Body (all optional):

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "businessName": null,
  "phone": "+2348012345678",
  "whatsappNumber": "+2348012345678",
  "addressStreet": "22 Allen Avenue",
  "addressCity": "Ikeja",
  "addressState": "Lagos",
  "addressCountry": "Nigeria",
  "addressPostalCode": "100271",
  "shippingMark": "GEX-JD-01",
  "isActive": true,
  "preferredLanguage": "en"
}
```

- Success response (`200`): `{ success: true, data: <full user profile> }`

### `POST /api/v1/auth/logout`

- Auth: Required (`Authorization: Bearer <token>`)
- Params: None
- Query: None
- Body: None
- Success response (`200`):

```json
{ "message": "Logged out successfully" }
```

## New Public Endpoints + Payloads

### `GET /api/v1/public/shipment-types`

- Auth: None
- Params: None
- Query: None
- Body: None
- Success response (`200`) shape:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "key": "d2d",
        "label": "Door-to-Door (D2D)",
        "coreShipmentType": "d2d",
        "estimatorMode": "INTAKE",
        "intake": {
          "title": "Door-to-Door (D2D) Shipment",
          "description": "string|null",
          "submitEndpoint": "/api/v1/public/d2d/intake",
          "requiredFields": [
            "fullName",
            "email",
            "phone",
            "city",
            "country",
            "goodsDescription",
            "deliveryPhone",
            "deliveryAddressLine1",
            "consentAcknowledgement",
            "wantsAccount"
          ],
          "nextStep": "string|null"
        }
      }
    ],
    "updatedAt": "iso|null"
  }
}
```

### `POST /api/v1/public/d2d/intake`

- Auth: None
- Params: None
- Query: None
- Notes:
  - This is now a ticket-only intake flow.
  - No shipment order or tracking number is created at this stage.
- Body:

```json
{
  "fullName": "Jane User",
  "email": "jane@example.com",
  "phone": "+2348012345678",
  "city": "Lagos",
  "country": "Nigeria",
  "goodsDescription": "Detailed goods description...",
  "deliveryPhone": "+2348098765432",
  "deliveryAddressLine1": "15 Admiralty Way, Lekki Phase 1",
  "deliveryState": "Lagos",
  "deliveryCity": "Lagos",
  "deliveryPostalCode": "106104",
  "deliveryLandmark": "Near Lekki Phase 1 Gate",
  "wantsAccount": false,
  "consentAcknowledgement": true,
  "estimatedWeightKg": 4.5,
  "estimatedCbm": 0.03
}
```

- Success response (`201`) shape:

```json
{
  "success": true,
  "data": {
    "ticket": {
      "id": "uuid",
      "ticketNumber": "TKT-0001",
      "userId": "uuid",
      "orderId": null,
      "category": "shipment_inquiry",
      "status": "open",
      "subject": "Public D2D intake request",
      "assignedTo": null,
      "closedAt": null,
      "createdAt": "iso",
      "updatedAt": "iso"
    },
    "contact": {
      "userId": "uuid",
      "role": "user",
      "email": "jane@example.com",
      "accountLinked": false,
      "isActive": false,
      "registerIntent": false
    },
    "intakeRequest": {
      "fullName": "Jane User",
      "email": "jane@example.com",
      "phone": "+2348012345678",
      "city": "Lagos",
      "country": "Nigeria",
      "goodsDescription": "Detailed goods description...",
      "wantsAccount": false,
      "estimatedWeightKg": 4.5,
      "estimatedCbm": 0.03,
      "delivery": {
        "phone": "+2348098765432",
        "addressLine1": "15 Admiralty Way, Lekki Phase 1",
        "country": "Nigeria",
        "state": "Lagos",
        "city": "Lagos",
        "postalCode": "106104",
        "landmark": "Near Lekki Phase 1 Gate"
      }
    }
  }
}
```

### `POST /api/v1/public/newsletter/subscribe`

- Auth: None
- Body:

```json
{ "email": "user@example.com" }
```

- Success response (`200`):

```json
{
  "success": true,
  "data": { "message": "string" }
}
```

### `GET /api/v1/public/gallery`

- Auth: None
- Query:

```json
{ "limitPerSection": 20 }
```

- Success response (`200`): `{ success, data: { anonymousGoods: [], cars: [], adverts: [] } }`

### `GET /api/v1/public/gallery/adverts`

- Auth: None
- Query:

```json
{ "limit": 20 }
```

- Success response (`200`): `{ success, data: [ ...adverts ] }`

### `POST /api/v1/public/gallery/claims/presign`

- Auth: None
- Body:

```json
{
  "uploadToken": "optional-existing-token",
  "contentType": "image/jpeg",
  "originalFileName": "proof.jpg"
}
```

- Success response (`200`):

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://...",
    "r2Key": "string",
    "publicUrl": "https://...",
    "expiresInSeconds": 900,
    "uploadToken": "string"
  }
}
```

### `POST /api/v1/public/gallery/anonymous/:trackingNumber/claim`

- Auth: None
- Params:

```json
{ "trackingNumber": "GEX-..." }
```

- Body:

```json
{
  "fullName": "Jane User",
  "email": "jane@example.com",
  "phone": "+2348012345678",
  "city": "Lagos",
  "country": "Nigeria",
  "message": "I am the owner of these goods.",
  "uploadToken": "token-from-presign",
  "proofR2Keys": ["claims/proof-1.jpg"]
}
```

- Success response (`201`): `{ success, data: { item, claim, ticket } }`

### `POST /api/v1/public/gallery/cars/:trackingNumber/purchase-attempt`

- Auth: None
- Params:

```json
{ "trackingNumber": "GEX-..." }
```

- Body:

```json
{
  "fullName": "Buyer Name",
  "email": "buyer@example.com",
  "phone": "+2348012345678",
  "city": "Lagos",
  "country": "Nigeria",
  "message": "Interested in purchase"
}
```

- Success response (`201`): `{ success, data: { item, claim, ticket } }`

## Auth Flow Update (Customer Side)

Customer signup/login is now Clerk-first:

1. FE uses Clerk for sign-up/sign-in.
2. FE calls `POST /api/v1/auth/sync` with Clerk bearer token.
3. FE then calls authenticated endpoints (for example `GET /api/v1/users/me`).

`/api/v1/auth/login` and `/api/v1/auth/logout` remain internal operator auth endpoints.
