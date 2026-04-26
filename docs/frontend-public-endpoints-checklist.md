# Frontend Public Endpoints Consumption Checklist

Date: 2026-04-25

This guide is the FE checklist for consuming all public/no-auth endpoints in this backend.

## 1) Global Integration Checklist

- [ ] Use backend base URL + `/api/v1` prefix.
- [ ] Send `Content-Type: application/json` for JSON requests.
- [ ] Do not send auth headers for endpoints listed as public.
- [ ] For gallery UIs, render `trackingNumberMasked` in UI and keep raw `trackingNumber` only for API actions.
- [ ] Handle both response envelopes:
  - Success: `{ "success": true, "data": ... }`
  - Error: `{ "success": false, "message": "..." }`
- [ ] Handle validation errors:
  - `{ "success": false, "message": "Validation failed", "errors": [...] }`

## 2) Public Routes (`/api/v1/public/*`)

### 2.1 `GET /api/v1/public/shipment-types`

- [ ] Call on calculator page load to build shipment type dropdown dynamically.
- [ ] Use returned `key` as the value for `POST /calculator/estimate`.

Response (`200`):

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "key": "air",
        "label": "Air Freight",
        "coreShipmentType": "air",
        "estimatorMode": "CALCULATED",
        "intake": null
      },
      {
        "key": "d2d",
        "label": "Door-to-Door",
        "coreShipmentType": "d2d",
        "estimatorMode": "INTAKE",
        "intake": {
          "title": "Door-to-Door Intake",
          "description": "Submit details for tailored pricing",
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
          "nextStep": "Our team will review and contact you."
        }
      }
    ],
    "updatedAt": "2026-04-25T08:30:00.000Z"
  }
}
```

### 2.2 `GET /api/v1/public/calculator/rates`

- [ ] Use to render public rate cards/table.

Response (`200`):

```json
{
  "success": true,
  "data": {
    "air": {
      "unit": "USD per kg",
      "tiers": [
        { "minKg": 0, "maxKg": 5, "rateUsdPerKg": 12.5 },
        { "minKg": 5, "maxKg": 20, "rateUsdPerKg": 10.5 }
      ]
    },
    "sea": {
      "unit": "USD per CBM",
      "flatRateUsdPerCbm": 550
    }
  }
}
```

### 2.3 `POST /api/v1/public/calculator/estimate`

- [ ] Send `shipmentType` using key from shipment-types endpoint.
- [ ] For air-like calculated type: send `weightKg` (required).
- [ ] For ocean-like calculated type: send `cbm` OR (`lengthCm`, `widthCm`, `heightCm`).
- [ ] For intake mode type (for example `d2d`): expect `estimatedCostUsd: null` and intake guidance.

Request body:

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

Calculated-mode response (`200`):

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
    "disclaimer": "This is an estimate based on standard rates.",
    "estimateDetails": {
      "input": {
        "shipmentType": "air",
        "weightKgInput": 12.5,
        "lengthCmInput": 40,
        "widthCmInput": 35,
        "heightCmInput": 30,
        "cbmInput": 0.042
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
          "minKg": 5,
          "maxKg": 20,
          "rateUsdPerKg": 13.5
        }
      }
    }
  }
}
```

Intake-mode response (`200`):

```json
{
  "success": true,
  "data": {
    "shipmentType": "d2d",
    "mode": null,
    "weightKg": null,
    "cbm": null,
    "estimatedCostUsd": null,
    "departureFrequency": null,
    "estimatedTransitDays": null,
    "disclaimer": "Door-to-door pricing is customized after intake review.",
    "intake": {
      "title": "Door-to-Door Intake",
      "description": "Submit your details and our team will review.",
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
      "nextStep": "Submit your details and wait for contact."
    },
    "d2dIntake": {
      "title": "Door-to-Door Intake",
      "description": "Submit your details and our team will review.",
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
      "nextStep": "Submit your details and wait for contact."
    }
  }
}
```

Common error (`400`) examples:

```json
{ "success": false, "message": "Unsupported shipmentType \"xyz\". Available types: air, ocean, d2d" }
```

```json
{ "success": false, "message": "weightKg is required and must be positive for air shipments" }
```

### 2.4 `POST /api/v1/public/newsletter/subscribe`

- [ ] Submit email from website newsletter form.
- [ ] Treat "already subscribed" as successful UX state.

Request body:

```json
{ "email": "person@example.com" }
```

Response (`200`):

```json
{
  "success": true,
  "data": {
    "message": "Successfully subscribed to the newsletter."
  }
}
```

Or duplicate email (`200`):

```json
{
  "success": true,
  "data": {
    "message": "You are already subscribed."
  }
}
```

### 2.5 `GET /api/v1/public/gallery`

- [ ] Use for full gallery page sections.
- [ ] Optional query: `limitPerSection` (default `20`, min `1`, max `100`).

Response (`200`) shape:

```json
{
  "success": true,
  "data": {
    "anonymousGoods": [
      {
        "id": "uuid",
        "trackingNumber": "GEX-20260425-A3F9C21B",
        "trackingNumberMasked": "GEX-20260425-****C21B",
        "itemType": "anonymous_goods",
        "title": "Unclaimed Mobile Accessories Carton",
        "description": "string|null",
        "previewImageUrl": "string|null",
        "mediaUrls": ["https://..."],
        "ctaUrl": "string|null",
        "startsAt": "iso|null",
        "endsAt": "iso|null",
        "status": "published",
        "isPublished": true,
        "carPriceNgn": null,
        "priceCurrency": "NGN",
        "createdAt": "iso",
        "updatedAt": "iso"
      }
    ],
    "cars": [],
    "adverts": []
  }
}
```

### 2.6 `GET /api/v1/public/gallery/adverts`

- [ ] Use for lightweight adverts-only widgets.
- [ ] Optional query: `limit` (default `20`, min `1`, max `100`).

Response (`200`):

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "trackingNumber": "GEX-20260425-B90D7712",
      "trackingNumberMasked": "GEX-20260425-****7712",
      "itemType": "advert",
      "title": "Need Fast Air Freight from Korea?",
      "description": "string|null",
      "previewImageUrl": "string|null",
      "mediaUrls": ["https://..."],
      "ctaUrl": "https://global-express.vercel.app/services/air-freight",
      "startsAt": "iso|null",
      "endsAt": "iso|null",
      "status": "published",
      "isPublished": true,
      "carPriceNgn": null,
      "priceCurrency": "NGN",
      "createdAt": "iso",
      "updatedAt": "iso"
    }
  ]
}
```

### 2.7 `POST /api/v1/public/gallery/claims/presign`

- [ ] Step 1 for anonymous goods claim proof upload.
- [ ] Save both `uploadToken` and each returned `r2Key`.
- [ ] Upload file directly to `uploadUrl` using HTTP `PUT` with same content type.

Request body:

```json
{
  "contentType": "image/jpeg",
  "originalFileName": "proof.jpg",
  "uploadToken": "optional-existing-token"
}
```

Response (`200`):

```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://...",
    "r2Key": "gallery-claims/<uploadToken>/<uuid>-proof.jpg",
    "publicUrl": "https://<r2-public>/gallery-claims/<uploadToken>/<uuid>-proof.jpg",
    "expiresInSeconds": 300,
    "uploadToken": "<uploadToken>"
  }
}
```

### 2.8 `POST /api/v1/public/gallery/anonymous/:trackingNumber/claim`

- [ ] Step 2 after uploading proof files.
- [ ] `proofR2Keys` must come from presign step and match prefix `gallery-claims/<uploadToken>/`.
- [ ] Min 1 and max 5 proof keys.

Request body:

```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+2348012345678",
  "city": "Lagos",
  "country": "Nigeria",
  "message": "This package belongs to me.",
  "uploadToken": "<uploadToken-from-presign>",
  "proofR2Keys": [
    "gallery-claims/<uploadToken>/<uuid>-proof.jpg"
  ]
}
```

Response (`201`) shape:

```json
{
  "success": true,
  "data": {
    "item": {
      "id": "uuid",
      "trackingNumber": "GEX-20260425-A3F9C21B",
      "trackingNumberMasked": "GEX-20260425-****C21B",
      "itemType": "anonymous_goods",
      "title": "string",
      "description": "string|null",
      "previewImageUrl": "string|null",
      "mediaUrls": ["https://..."],
      "ctaUrl": "string|null",
      "startsAt": "iso|null",
      "endsAt": "iso|null",
      "status": "claim_pending",
      "isPublished": false,
      "carPriceNgn": null,
      "priceCurrency": "NGN",
      "createdAt": "iso",
      "updatedAt": "iso"
    },
    "claim": {
      "id": "uuid",
      "itemId": "uuid",
      "itemTrackingNumber": "GEX-20260425-A3F9C21B",
      "itemType": "anonymous_goods",
      "itemTitle": "string",
      "claimType": "ownership",
      "status": "pending",
      "claimantUserId": "uuid|null",
      "claimantFullName": "Jane Doe",
      "claimantEmail": "jane@example.com",
      "claimantPhone": "+2348012345678",
      "message": "string|null",
      "uploadToken": "<uploadToken>",
      "proofUrls": ["https://<r2-public>/gallery-claims/..."],
      "supportTicketId": "uuid|null",
      "reviewNote": null,
      "reviewedBy": null,
      "reviewedAt": null,
      "createdAt": "iso",
      "updatedAt": "iso"
    },
    "ticket": {
      "id": "uuid",
      "ticketNumber": "TKT-XXXXXX",
      "userId": "uuid",
      "orderId": null,
      "category": "shipment_inquiry",
      "status": "open",
      "subject": "Anonymous goods claim - ...",
      "assignedTo": null,
      "closedAt": null,
      "createdAt": "iso",
      "updatedAt": "iso"
    }
  }
}
```

### 2.9 `POST /api/v1/public/gallery/cars/:trackingNumber/purchase-attempt`

- [ ] Submit car attempt without proof upload flow.

Request body:

```json
{
  "fullName": "John Doe",
  "email": "john@example.com",
  "phone": "+2348098765432",
  "city": "Abuja",
  "country": "Nigeria",
  "message": "I want to reserve this car."
}
```

Response (`201`) shape:

```json
{
  "success": true,
  "data": {
    "item": { "id": "uuid", "itemType": "car", "trackingNumber": "string", "title": "string", "status": "car_reserved", "isPublished": false, "description": "string|null", "previewImageUrl": "string|null", "mediaUrls": [], "ctaUrl": "string|null", "startsAt": "iso|null", "endsAt": "iso|null", "carPriceNgn": "string|null", "priceCurrency": "NGN", "createdAt": "iso", "updatedAt": "iso" },
    "claim": { "id": "uuid", "claimType": "car_purchase", "status": "pending", "supportTicketId": "uuid|null", "createdAt": "iso", "updatedAt": "iso", "itemId": "uuid", "itemTrackingNumber": "string", "itemType": "car", "itemTitle": "string", "claimantUserId": "uuid|null", "claimantFullName": "John Doe", "claimantEmail": "john@example.com", "claimantPhone": "+2348098765432", "message": "string|null", "uploadToken": null, "proofUrls": [], "reviewNote": null, "reviewedBy": null, "reviewedAt": null },
    "ticket": { "id": "uuid", "ticketNumber": "TKT-XXXXXX", "userId": "uuid", "orderId": null, "category": "shipment_inquiry", "status": "open", "subject": "Car purchase attempt - ...", "assignedTo": null, "closedAt": null, "createdAt": "iso", "updatedAt": "iso" }
  }
}
```

### 2.10 `POST /api/v1/public/d2d/intake`

- [ ] Use for unauthenticated door-to-door intake.
- [ ] `consentAcknowledgement` must be `true`.
- [ ] Optional delivery fields can be omitted or empty-string from FE (empty string becomes optional null/undefined).

Request body:

```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+2348012345678",
  "city": "Lagos",
  "country": "Nigeria",
  "goodsDescription": "3 cartons of clothing and accessories.",
  "deliveryPhone": "+2348099999999",
  "deliveryAddressLine1": "12 Admiralty Way",
  "deliveryState": "Lagos",
  "deliveryCity": "Lekki",
  "deliveryPostalCode": "106104",
  "deliveryLandmark": "Near Circle Mall",
  "wantsAccount": true,
  "consentAcknowledgement": true,
  "estimatedWeightKg": 35.2,
  "estimatedCbm": 0.88
}
```

Response (`201`) shape:

```json
{
  "success": true,
  "data": {
    "ticket": {
      "id": "uuid",
      "ticketNumber": "TKT-XXXXXX",
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
      "registerIntent": true
    },
    "intakeRequest": {
      "fullName": "Jane Doe",
      "email": "jane@example.com",
      "phone": "+2348012345678",
      "city": "Lagos",
      "country": "Nigeria",
      "goodsDescription": "3 cartons of clothing and accessories.",
      "wantsAccount": true,
      "estimatedWeightKg": 35.2,
      "estimatedCbm": 0.88,
      "delivery": {
        "phone": "+2348099999999",
        "addressLine1": "12 Admiralty Way",
        "country": "Nigeria",
        "state": "Lagos",
        "city": "Lekki",
        "postalCode": "106104",
        "landmark": "Near Circle Mall"
      }
    }
  }
}
```

Possible conflict response (`409`):

```json
{
  "success": false,
  "message": "This email belongs to an internal account and cannot be used for public D2D intake."
}
```

## 3) Other Public/No-Auth Routes Outside `/public`

### 3.1 `GET /api/v1/orders/track/:trackingNumber`

- [ ] Use on shipment tracking page.
- [ ] Do not send internal master batch numbers (`GEX-MASTER-*`) from FE input.

Response (`200`) shape:

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

Not found (`404`):

```json
{
  "success": false,
  "message": "Order not found"
}
```

### 3.2 `GET /health`

- [ ] Use only for uptime checks, not business UI.

Response (`200`):

```json
{
  "status": "ok",
  "timestamp": "2026-04-25T09:00:00.000Z"
}
```

## 4) End-to-End FE Flow Checklist (Anonymous Goods Claim)

- [ ] Call `GET /api/v1/public/gallery` and render `anonymousGoods`.
- [ ] User selects an item; FE collects contact data + proof files.
- [ ] For each file, call `POST /api/v1/public/gallery/claims/presign`.
- [ ] Upload each file with `PUT` to `uploadUrl`.
- [ ] Submit `POST /api/v1/public/gallery/anonymous/:trackingNumber/claim` with:
  - `uploadToken` returned by presign
  - `proofR2Keys` returned by presign
- [ ] Show claim + ticket number from response.
