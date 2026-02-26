# Global Express — Operational Manual (V2)

Last updated: February 26, 2026

This is the single source of truth for the Global Express backend. It covers business rules,
architecture standards, the current state of the codebase, and the implementation checklist for
everything not yet built.

---

## Part I — Business Rules

These are locked and approved. Do not deviate without explicit business sign-off.

### 1. Lane and Offices

- Active lane is fixed to `South Korea → Lagos` for this release.
- Korea office (source):
  - GLOBAL EXPRESS, 76-25 Daehwa-ro, Ilsanseo-gu, Goyang-si, Gyeonggi-do (Bldg. B), +82-10-4710-5920
- Lagos office (pickup):
  - 58B Awoniyi Elemo Street, Ajao Estate, Lagos
- Office addresses are stored in `app_settings` and editable only by `superadmin`.

### 2. Transport and Pricing

- Freight currency: `USD`.
- Air: exact actual weight (kg), no rounding, no minimum.
- Sea: exact CBM, no rounding, no minimum.

Air tiers (USD/kg):

| Weight Range | Rate |
| --- | --- |
| 1–100 kg | $13.50/kg |
| 101–300 kg | $11.50/kg |
| 301–600 kg | $10.80/kg |
| 601–1,000 kg | $10.50/kg |
| 1,001–1,500 kg | $10.00/kg |
| 1,501+ kg | $9.80/kg |

Sea: flat **$550 USD/CBM**. Transit target: ~3 months after boarding.

### 3. Special Customer Pricing

- Per-customer overrides replace default pricing for that customer.
- Overrides are mode-specific (`air` and/or `sea`) with optional validity window (`startAt`, `endAt`).
- Editable by `admin` and `superadmin` only.
- Every create/update/delete must generate an audit log entry.

### 4. Pre-order and Warehouse Verification

- Customers may pre-order before goods arrive in Korea.
- Price is **not shown** at pre-order stage.
- Price is calculated only when warehouse staff verifies goods in Korea.
- Warehouse staff flow:
  1. Receive goods.
  2. Upload photo(s).
  3. Capture package details (description, dimensions, type, weight/CBM).
  4. Select customer (or create stub + send Clerk invite).
  5. Auto-calculate freight via pricing engine.
  6. Optionally apply manual adjustment with mandatory reason.
- Customer sees only the final adjusted price — no breakdown of internal calculation.

### 5. Status Workflow

- Transitions are sequential and mode-specific.
- Every status change records timestamp and actor.
- Internal `statusV2` is richer than customer-facing `customerStatusV2`.

**Common intake statuses (both modes):**

1. `PREORDER_SUBMITTED`
2. `AWAITING_WAREHOUSE_RECEIPT`
3. `WAREHOUSE_RECEIVED`
4. `WAREHOUSE_VERIFIED_PRICED`

**Air-specific statuses:**

1. `DISPATCHED_TO_ORIGIN_AIRPORT`
2. `AT_ORIGIN_AIRPORT`
3. `BOARDED_ON_FLIGHT`
4. `FLIGHT_DEPARTED`
5. `FLIGHT_LANDED_LAGOS`
6. `CUSTOMS_CLEARED_LAGOS`
7. `IN_TRANSIT_TO_LAGOS_OFFICE`
8. `READY_FOR_PICKUP`
9. `PICKED_UP_COMPLETED`

**Sea-specific statuses:**

1. `DISPATCHED_TO_ORIGIN_PORT`
2. `AT_ORIGIN_PORT`
3. `LOADED_ON_VESSEL`
4. `VESSEL_DEPARTED`
5. `VESSEL_ARRIVED_LAGOS_PORT`
6. `CUSTOMS_CLEARED_LAGOS`
7. `IN_TRANSIT_TO_LAGOS_OFFICE`
8. `READY_FOR_PICKUP`
9. `PICKED_UP_COMPLETED`

**Exception statuses (bypass sequential check):**

- `ON_HOLD`
- `CANCELLED`
- `RESTRICTED_ITEM_REJECTED`
- `RESTRICTED_ITEM_OVERRIDE_APPROVED`

### 6. Payments

- Only full payment is accepted.
- Customer may pay before departure or at pickup.
- `READY_FOR_PICKUP → PICKED_UP_COMPLETED` transition is blocked until `paymentCollectionStatus = PAID_IN_FULL`.
- Supported methods:
  - `online` — Paystack card gateway
  - `transfer` — staff-recorded bank transfer
  - `cash` — staff-recorded cash payment
- FX (USD → NGN): live rate or manual override. Manual overrides live while active.
- Customer dashboard shows `amount due` + `pay now` when unpaid.

### 7. Notifications

- Channels: email + in-app (respect user `preferredLanguage` and channel preferences).
- Trigger only on milestones:
  - `WAREHOUSE_VERIFIED_PRICED`
  - `BOARDED_ON_FLIGHT` or `LOADED_ON_VESSEL`
  - `FLIGHT_LANDED_LAGOS` or `VESSEL_ARRIVED_LAGOS_PORT`
  - `READY_FOR_PICKUP`
  - `PAID_IN_FULL`
- Templates are editable by admin roles via `PATCH /api/v1/settings/templates/:id`.

### 8. Restricted Goods

- Default restricted items: batteries, phones, laptops.
- List is backend-configurable via `restricted_goods` table.
- Restricted items can proceed only via admin+ override with mandatory reason + audit log.

### 9. Language

- Supported: `en` (default), `ko`.
- Language preference stored per user in `users.preferredLanguage`.
- Backend localizes all dynamic content (notifications, emails, status labels) using `notification_templates` table keyed by `templateKey + locale`.
- Applies to both customers and internal users.

---

## Part II — Architecture & Standards

These rules apply to every change in the codebase without exception.

### 10. Security Rules

1. Never log secrets, tokens, or PII.
2. Encrypt sensitive PII fields at rest.
3. Never store passwords, card data, CVV, or tokens in plaintext.
4. Keep payment card details out of backend storage (PCI boundary is Paystack).
5. Keep webhook signature verification intact for all signed webhook flows.
6. Rate-limit sensitive endpoints (auth, password reset, high-risk writes).
7. Preserve soft-delete behavior on all user deletion flows.
8. Audit-log all admin-impacting actions; never store PII in audit metadata.
9. Never leak stack traces to clients in production error responses.

### 11. Architecture Rules

- Fastify layering: `routes → controllers → services → db/schema`. No exceptions.
- Use `zod` for every request and response contract on new or modified routes.
- Success shape: `{ success: true, data: ... }`.
- Error shape: `{ success: false, message: "...", errors?: [...] }`.
- Auth belongs in `authenticate` middleware — never inside services.
- Role checks belong in `requireRole` variants — never inside services.
- Apply `ipWhitelist` to all admin/superadmin-only endpoints.
- Pagination shape: `{ data: [...], pagination: { page, limit, total } }`.
- Centralize business logic in services; no route-level business logic duplication.

---

## Part III — Current System State

The sections below document what is **confirmed live in the codebase** as of the last audit (February 26, 2026).

### 12. Database Schema

#### 12.1 `orders` table — V2 columns (all confirmed)

| Column | Type | Notes |
| --- | --- | --- |
| `transportMode` | `transport_mode` enum | `air \| sea` |
| `isPreorder` | `boolean` | default `false` |
| `statusV2` | `shipment_status_v2` enum | internal operational status |
| `customerStatusV2` | `shipment_status_v2` enum | customer-facing mapped status |
| `priceCalculatedAt` | `timestamp` | set at warehouse verification |
| `priceCalculatedBy` | `uuid` FK → users | actor who ran the calculation |
| `calculatedChargeUsd` | `numeric(12,2)` | raw computed freight amount |
| `finalChargeUsd` | `numeric(12,2)` | after manual adjustment |
| `pricingSource` | `pricing_source` enum | `DEFAULT_RATE \| CUSTOMER_OVERRIDE \| MANUAL_ADJUSTMENT \| MIGRATED_UNVERIFIED` |
| `priceAdjustmentReason` | `text` | required when source is `MANUAL_ADJUSTMENT` |
| `paymentCollectionStatus` | `payment_collection_status` enum | `UNPAID \| PAYMENT_IN_PROGRESS \| PAID_IN_FULL`, default `UNPAID` |
| `flaggedForAdminReview` | `boolean` | default `false` — set by backfill script when `transportMode` is missing and status cannot be deterministically mapped |

Legacy `status` column (original enum: `pending \| picked_up \| in_transit \| out_for_delivery \| delivered \| cancelled \| returned`) still exists for backward compat during migration.

#### 12.2 Supporting tables (all confirmed)

| Table | Purpose |
| --- | --- |
| `order_status_events` | History of every V2 status change with `orderId`, `status`, `actorId`, `createdAt` |
| `order_packages` | Per-package details: `description`, `itemType`, `lengthCm`, `widthCm`, `heightCm`, `weightKg`, `cbm`, `isRestricted`, `restrictedOverride*` |
| `pricing_rules` | Default air tiers and sea flat rate; supports `effectiveFrom/To` date windows |
| `customer_pricing_overrides` | Per-customer mode-specific overrides with optional `startsAt/endsAt` validity |
| `restricted_goods` | Configurable catalog: `code`, `nameEn`, `nameKo`, `allowWithOverride`, `isActive` |
| `app_settings` | Key-value JSONB store for logistics settings, FX rate config |
| `notification_templates` | `templateKey + locale (en\|ko) + channel (email\|in_app)` → `subject + body` |
| `bulk_shipments` | Includes `statusV2`, `transportMode`, full V2 pricing fields |
| `bulk_shipment_items` | Includes `statusV2`, `customerStatusV2`, `transportMode`, `paymentCollectionStatus` |

`users.preferredLanguage` — confirmed: `preferred_language` enum (`en | ko`), default `en`.

#### 12.3 V2 status enum — full value set (confirmed)

```text
PREORDER_SUBMITTED | AWAITING_WAREHOUSE_RECEIPT | WAREHOUSE_RECEIVED |
WAREHOUSE_VERIFIED_PRICED | DISPATCHED_TO_ORIGIN_AIRPORT | AT_ORIGIN_AIRPORT |
BOARDED_ON_FLIGHT | FLIGHT_DEPARTED | FLIGHT_LANDED_LAGOS |
DISPATCHED_TO_ORIGIN_PORT | AT_ORIGIN_PORT | LOADED_ON_VESSEL |
VESSEL_DEPARTED | VESSEL_ARRIVED_LAGOS_PORT | CUSTOMS_CLEARED_LAGOS |
IN_TRANSIT_TO_LAGOS_OFFICE | READY_FOR_PICKUP | PICKED_UP_COMPLETED |
ON_HOLD | CANCELLED | RESTRICTED_ITEM_REJECTED | RESTRICTED_ITEM_OVERRIDE_APPROVED
```

### 13. Live Endpoint Inventory

All endpoints below are confirmed implemented and deployed.

#### 13.1 Customer Endpoints

| Capability | Endpoint(s) |
| --- | --- |
| Sync Clerk account to backend user | `POST /api/v1/auth/sync` |
| Get own profile | `GET /api/v1/users/me` |
| Check profile completeness | `GET /api/v1/users/me/completeness` |
| Update own profile, contact, address | `PATCH /api/v1/users/me` |
| Notification preferences | `GET /api/v1/users/me/notification-preferences`, `PATCH /api/v1/users/me/notification-preferences` |
| Export own data | `GET /api/v1/users/me/export` |
| Delete own account (soft delete) | `DELETE /api/v1/users/me` |
| Public shipment tracking | `GET /api/v1/orders/track/:trackingNumber` |
| Create shipment order | `POST /api/v1/orders` |
| Own unified shipment list | `GET /api/v1/orders/my-shipments` |
| Own order list and detail | `GET /api/v1/orders`, `GET /api/v1/orders/:id` |
| View order images | `GET /api/v1/orders/:id/images`, `GET /api/v1/uploads/orders/:orderId/images` |
| Payment (online, Paystack) | `POST /api/v1/payments/initialize`, `POST /api/v1/payments/verify/:reference` |
| Notification inbox | `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`, `PATCH /api/v1/notifications/:id/read`, `PATCH /api/v1/notifications/:id/save` |
| Dashboard | `GET /api/v1/dashboard`, `GET /api/v1/dashboard/stats`, `GET /api/v1/dashboard/trends`, `GET /api/v1/dashboard/active-deliveries` |
| Real-time push | `GET /ws?token=<jwt>` (WebSocket — auth via query param) |

#### 13.2 Internal Endpoints (Staff / Admin / Superadmin)

| Capability | Endpoint(s) |
| --- | --- |
| Operator login, restore, logout | `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout` |
| Operator password reset | `POST /api/v1/auth/forgot-password/send-otp`, `.../verify-otp`, `.../reset` |
| Internal login | `POST /api/v1/internal/auth/login` |
| Change own internal password | `PATCH /api/v1/internal/me/password` |
| Create internal users | `POST /api/v1/internal/users` |
| Reset internal user password (superadmin) | `PATCH /api/v1/internal/users/:id/password` |
| Manage platform users | `GET /api/v1/users`, `GET /api/v1/users/:id`, `PATCH /api/v1/users/:id`, `PATCH /api/v1/users/:id/role`, `DELETE /api/v1/users/:id` |
| Team directory (admin+) | `GET /api/v1/team` |
| Client management (staff+) | `GET /api/v1/admin/clients`, `GET /api/v1/admin/clients/:id`, `GET /api/v1/admin/clients/:id/orders` |
| Warehouse verification + pricing | `POST /api/v1/orders/:id/warehouse-verify` |
| Update shipment status (staff+) | `PATCH /api/v1/orders/:id/status` |
| Delete order (admin+) | `DELETE /api/v1/orders/:id` |
| All shipments (staff+) | `GET /api/v1/shipments` |
| Bulk shipment lifecycle | `POST /api/v1/bulk-orders`, `GET /api/v1/bulk-orders`, `GET /api/v1/bulk-orders/:id`, `PATCH /api/v1/bulk-orders/:id/status`, `POST /api/v1/bulk-orders/:id/items`, `DELETE /api/v1/bulk-orders/:id/items/:itemId`, `DELETE /api/v1/bulk-orders/:id` |
| Upload images (staff+) | `POST /api/v1/uploads/presign`, `POST /api/v1/uploads/confirm` |
| Delete image (admin+) | `DELETE /api/v1/uploads/images/:imageId` |
| Payment records (admin) | `GET /api/v1/payments`, `GET /api/v1/payments/:id` |
| Reports (admin+, IP-gated) | `GET /api/v1/reports/summary`, `GET /api/v1/reports/orders/by-status`, `GET /api/v1/reports/revenue` |
| Internal notifications inbox | `GET /api/v1/internal/notifications`, `GET /api/v1/internal/notifications/unread-count`, `PATCH /api/v1/internal/notifications/read-all`, `PATCH /api/v1/internal/notifications/:id/read` |
| Broadcast notification (admin+) | `POST /api/v1/notifications/broadcast` |
| Settings — logistics | `GET /api/v1/settings/logistics`, `PATCH /api/v1/settings/logistics` |
| Settings — pricing | `GET /api/v1/settings/pricing`, `PATCH /api/v1/settings/pricing` |
| Settings — restricted goods | `GET /api/v1/settings/restricted-goods`, `PATCH /api/v1/settings/restricted-goods` |
| Settings — FX rate | `GET /api/v1/settings/fx-rate`, `PATCH /api/v1/settings/fx-rate` |
| Settings — templates | `GET /api/v1/settings/templates`, `PATCH /api/v1/settings/templates/:id` |

Note: Status changes are driven by explicit API calls only — no automatic scheduler or worker.

#### 13.3 Live Services and Domain Logic

| Service / Module | Location | Status |
| --- | --- | --- |
| Pricing engine (air tiers + sea flat rate + customer overrides) | `src/services/pricing-v2.service.ts` | Live |
| Status transition graph (AIR_FLOW and SEA_FLOW sequences defined) | `src/domain/shipment-v2/status-transitions.ts` | Defined but **not enforced** — never called from any controller |
| FX rate management (live/manual mode, stored in `app_settings`) | `src/services/settings-fx-rate.service.ts` | Live — live mode fetches from `open.er-api.com/v6/latest/USD`, 5-min in-memory cache |
| Notification templates (editable via API, stored in DB) | `src/services/settings-templates.service.ts` | Live — email and in-app send pipeline looks up template by `templateKey + locale + channel`, falls back to hardcoded strings |
| Auth middleware (Clerk JWT + internal JWT, auto-provision) | `src/middleware/authenticate.ts` | Live |
| Role middleware (`requireSuperAdmin`, `requireAdminOrAbove`, `requireStaffOrAbove`) | `src/middleware/requireRole.ts` | Live |
| IP whitelist middleware | `src/middleware/ipWhitelist.ts` | Live |
| WebSocket (Clerk + internal JWT via `?token=`) | `src/websocket/handlers.ts` | Live |

---

## Part IV — Implementation Checklist

Each item is either confirmed done `[x]` or pending `[ ]`. Work in phase order.

---

### Phase 1 — Schema and Enums

- [x] V2 `shipmentStatusV2` enum — all 22 statuses defined in schema.
- [x] `orders.transportMode` column.
- [x] `orders.isPreorder` column.
- [x] `orders.statusV2` + `orders.customerStatusV2` columns.
- [x] `orders.priceCalculatedAt`, `priceCalculatedBy`, `calculatedChargeUsd`, `finalChargeUsd`, `pricingSource`, `priceAdjustmentReason` columns.
- [x] `orders.paymentCollectionStatus` column (`UNPAID | PAYMENT_IN_PROGRESS | PAID_IN_FULL`).
- [x] `order_status_events` table.
- [x] `order_packages` table (full field set including restricted override fields).
- [x] `pricing_rules` table.
- [x] `customer_pricing_overrides` table.
- [x] `restricted_goods` table.
- [x] `app_settings` table (JSONB key-value store).
- [x] `notification_templates` table (`templateKey + locale + channel → subject + body`).
- [x] `users.preferredLanguage` column (`en | ko`, default `en`).
- [x] Add `paymentType` column to `payments` table — `online | transfer | cash` (required for offline payment recording in Phase 4).
- [x] Remove legacy `orders.status`, `bulk_shipments.status`, `bulk_shipment_items.status` columns and the `order_status` pg enum — dropped in Phase 6. Columns and indexes removed from both schema and DB.

---

### Phase 2 — Pricing Engine and Warehouse Verification

- [x] `POST /api/v1/orders/:id/warehouse-verify` — captures package details, computes freight, stores packages.
- [x] Pricing engine (`pricing-v2.service.ts`) — air tiers, sea flat rate, customer override lookup, manual adjustment.
- [x] `GET/PATCH /api/v1/settings/pricing` — default rules and per-customer overrides editable.
- [x] `GET/PATCH /api/v1/settings/restricted-goods` — catalog editable by admin+.
- [x] `GET/PATCH /api/v1/settings/logistics` — offices and lane config.
- [x] `GET/PATCH /api/v1/settings/fx-rate` — live/manual mode toggle and manual rate value.
- [x] `GET/PATCH /api/v1/settings/templates/:id` — localized template management.
- [x] `POST /api/v1/admin/clients` — create customer profile stub and issue Clerk invite. (staff+)
- [x] `POST /api/v1/admin/clients/:id/send-invite` — re-send Clerk claim/invite link. (staff+)

---

### Phase 3 — Status Workflow Engine

- [x] `canTransitionSequentially(mode, currentStatus, nextStatus)` defined in `src/domain/shipment-v2/status-transitions.ts` with full AIR_FLOW and SEA_FLOW sequences.
- [x] `order_status_events` table ready to record history.
- [x] Wire `canTransitionSequentially()` into `PATCH /api/v1/orders/:id/status` — reject invalid transitions with 400.
- [x] Enforce mode-specific validation: derive mode from order's `transportMode` field before checking transition.
- [x] Write a status history event to `order_status_events` on every successful status transition.
- [x] Switch `GET /api/v1/orders` list and filter queries to use `statusV2` as the primary status field.
- [x] Map `customerStatusV2` from `statusV2` on every order read — expose both in API responses.
- [x] Verify `POST /api/v1/orders` sets `isPreorder = true` for customer-created orders.
- [x] Enforce lane restriction to Korea → Lagos — `origin`/`destination` removed from request body, hardcoded as `"South Korea"` / `"Lagos, Nigeria"` in service.
- [x] Verify no customer-visible price is returned before `WAREHOUSE_VERIFIED_PRICED` status (`finalChargeUsd` is null until warehouse verify).
- [x] Trigger milestone notifications on correct V2 status transitions (see Section 7 for milestone list).

---

### Phase 4 — Payment Release Controls

- [x] `orders.paymentCollectionStatus` column exists with `UNPAID | PAYMENT_IN_PROGRESS | PAID_IN_FULL`.
- [x] `bulk_shipment_items.paymentCollectionStatus` column exists.
- [x] Add `paymentType` column to `payments` table (`online | transfer | cash`) — schema migration required.
- [x] `POST /api/v1/payments/:orderId/record-offline` — record transfer or cash payment with proof metadata; set `paymentCollectionStatus = PAID_IN_FULL` on the order. (staff+)
- [x] On successful Paystack `verify/:reference`, update `orders.paymentCollectionStatus` to `PAID_IN_FULL`.
- [x] Block `READY_FOR_PICKUP → PICKED_UP_COMPLETED` transition when `paymentCollectionStatus ≠ PAID_IN_FULL` (enforce inside Phase 3 status transition logic).
- [x] Return `amountDue` (derived from `finalChargeUsd`) and `paymentCollectionStatus` in order responses visible to customers.

---

### Phase 5 — Settings and Localization

- [x] `users.preferredLanguage` stored and patchable via `PATCH /api/v1/users/me`.
- [x] `notification_templates` table populated and API-editable.
- [x] FX rate mode/value stored and API-editable.
- [x] Replace hardcoded English strings in `src/notifications/email.ts` with template lookups from `notification_templates` table using the recipient's `preferredLanguage`.
- [x] Apply same localization to in-app notification content.
- [x] Implement live FX rate fetching from an external API — called when `fxRate.mode = 'live'` to convert `finalChargeUsd` to NGN for payment display and recording.

---

### Phase 6 — Data Migration and Hardening

- [x] Write backfill script: legacy `orders.status` → `orders.statusV2` using the deterministic mapping below. (`scripts/backfill-status-v2.ts`, run via `npm run backfill:status-v2`)
- [x] Handle records with missing/unknown `transportMode` — place in admin review queue before final backfill. (`flaggedForAdminReview = true` set on orders with mode-dependent status and no `transportMode`)
- [x] Mark existing orders with no trusted freight amount as `pricingSource = MIGRATED_UNVERIFIED`; flag for admin restatement. (backfill script sets `MIGRATED_UNVERIFIED` when `finalChargeUsd` is null)
- [x] `flagged_for_admin_review` boolean column added to `orders` and `bulk_shipment_items` tables and applied to DB.
- [x] Verify `bulk_shipment_items` unified dashboard list still works after V2 status migration. (dashboard and `getMyShipments` now read `statusV2` from both `orders` and `bulk_shipment_items`)
- [x] Complete regression tests and role/permission tests. (`tests/unit/backfill-logic.test.ts` — full legacy→V2 decision table; `tests/unit/status-labels.test.ts` — all 22 V2 values covered; 43 tests passing)
- [x] Switch all reads (list, filter, dashboard, reports) to use `statusV2` as primary — retire legacy `status` reads. (dashboard, reports, shipments, orders, bulk-orders all updated)
- [x] Drop legacy `orders.status`, `bulk_shipments.status`, `bulk_shipment_items.status` columns and `order_status` pg enum — completed. Ran backfill → resolved 32 flagged orders → dropped all legacy columns, indexes, and enum from both Drizzle schema and Neon DB.

**Legacy → V2 status backfill map:**

| Legacy | V2 (air) | V2 (sea) |
| --- | --- | --- |
| `pending` | `WAREHOUSE_VERIFIED_PRICED` | `WAREHOUSE_VERIFIED_PRICED` |
| `picked_up` | `DISPATCHED_TO_ORIGIN_AIRPORT` | `DISPATCHED_TO_ORIGIN_PORT` |
| `in_transit` | `FLIGHT_DEPARTED` | `VESSEL_DEPARTED` |
| `out_for_delivery` | `IN_TRANSIT_TO_LAGOS_OFFICE` | `IN_TRANSIT_TO_LAGOS_OFFICE` |
| `delivered` | `PICKED_UP_COMPLETED` | `PICKED_UP_COMPLETED` |
| `cancelled` | `CANCELLED` | `CANCELLED` |
| `returned` | `CANCELLED` | `CANCELLED` |

---

## Part V — Technical Reference

### 14. New Endpoint Contracts (to be built)

#### 14.1 `POST /api/v1/admin/clients`

Role: staff+, IP-gated.

Request body:

```json
{
  "email": "customer@example.com",
  "firstName": "Jane",
  "lastName": "Doe",
  "businessName": null,
  "phone": "+2348012345678",
  "whatsappNumber": "+2348012345678",
  "addressStreet": "12 Allen Ave",
  "addressCity": "Lagos",
  "addressState": "Lagos",
  "addressCountry": "Nigeria",
  "addressPostalCode": "100001"
}
```

Behavior: creates user record in DB, issues a Clerk invitation email to the provided address.
Response: created user profile + invite status.

#### 14.2 `POST /api/v1/admin/clients/:id/send-invite`

Role: staff+, IP-gated.
No body. Re-sends the Clerk claim/invite link to the client's email.

#### 14.3 `POST /api/v1/payments/:orderId/record-offline`

Role: staff+.

Request body:

```json
{
  "paymentType": "transfer",
  "amountNgn": 750000,
  "proofReference": "TXN-REF-123456",
  "note": "Bank transfer confirmed by Amaka"
}
```

Behavior:

- Creates a `payments` record with `paymentType = transfer | cash`.
- Sets `orders.paymentCollectionStatus = PAID_IN_FULL`.
- Triggers `PAID_IN_FULL` milestone notification if configured.

Response: `{ success: true, data: { paymentId, orderId, paymentCollectionStatus } }`

### 15. Frontend Integration Reference

#### 15.1 Connection Details

- Base URL: `https://your-app-name-snowy-waterfall-9062.fly.dev`
- API prefix: `/api/v1`
- Swagger docs: `<base-url>/docs`
- WebSocket: `wss://<host>/ws?token=<clerk-jwt>` (auth via query param, not Authorization header)

#### 15.2 Auth Architecture

| User Type | Auth Method | Token Format |
| --- | --- | --- |
| Customers | Clerk (custom signup form) | Clerk JWT |
| Staff / Admin / Superadmin | Internal (email + password) | Internal JWT |

All protected endpoints require: `Authorization: Bearer <token>`

#### 15.3 Customer Registration Flow (3-Phase)

Do **not** use Clerk's prebuilt `<SignUp />` component. Use `useSignUp()` hook for a custom form.

Phase 1 — Clerk signup:

1. `signUp.create({ emailAddress, password, firstName, lastName })` — Clerk creates account
2. `signUp.prepareEmailAddressVerification({ strategy: 'email_code' })` — Clerk sends OTP
3. `signUp.attemptEmailAddressVerification({ code })` → `setActive({ session })`

Phase 2 — Backend sync (immediately after `setActive`):

- `POST /api/v1/auth/sync` — no body, Bearer JWT — provisions user record in DB
- Response: full user profile object (null for unpopulated fields)

Phase 3 — Profile completion:

- `GET /api/v1/users/me/completeness` — returns `{ isComplete, missingFields[] }`
- If incomplete, redirect to profile completion screen
- `PATCH /api/v1/users/me` — save phone, address, optional WhatsApp

**Profile completeness requirements** (all must be satisfied before order creation):

| Field | Rule |
| --- | --- |
| Name | Either (`firstName` + `lastName`) **or** `businessName` — at least one set |
| `phone` | Required |
| `whatsappNumber` | Optional |
| `addressStreet` | Required |
| `addressCity` | Required |
| `addressState` | Required |
| `addressCountry` | Required |
| `addressPostalCode` | Required |

`missingFields` possible values: `name`, `phone`, `addressStreet`, `addressCity`, `addressState`, `addressCountry`, `addressPostalCode`

UX rules:

- WhatsApp checkbox: "Same as phone" — copies phone value into `whatsappNumber`.
- Business toggle: `businessName` required if on; `firstName` + `lastName` required if off.
- Show persistent banner on dashboard + block "New Order" if `isComplete = false`.
- `POST /orders` returning `422` → redirect to profile completion screen.
- If user closes browser after Phase 2, prompt on next login to finish profile.

#### 15.4 Frontend Environment Variables

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_API_BASE_URL=https://your-app-name-snowy-waterfall-9062.fly.dev/api/v1
VITE_WS_URL=wss://your-app-name-snowy-waterfall-9062.fly.dev/ws
```

#### 15.5 Authenticated API Calls

```tsx
import { useAuth } from '@clerk/clerk-react'

function useApi() {
  const { getToken } = useAuth()
  const authFetch = async (path: string, options: RequestInit = {}) => {
    const token = await getToken()
    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    })
    return res.json()
  }
  return { authFetch }
}
```

Response shape:

```json
{ "success": true, "data": { } }
{ "success": false, "message": "Reason" }
```

#### 15.6 Real-time WebSocket

```ts
const ws = new WebSocket(`${VITE_WS_URL}?token=${token}`)
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  // msg.type === 'order_status_updated'
  // msg.data === { orderId, trackingNumber, status, updatedAt }
}
ws.onclose = () => setTimeout(connect, 3000) // auto-reconnect
```

#### 15.7 Payments (Paystack)

Initialize:

```http
POST /api/v1/payments/initialize
Content-Type: application/json

{ "orderId": "uuid", "amount": 500000, "currency": "NGN" }
```

`amount` is in **kobo** — ₦5,000 = `500000`. Returns `{ authorizationUrl, reference }` — redirect user to `authorizationUrl`.

Verify after redirect:

```http
GET /api/v1/payments/verify/:reference
```

#### 15.8 Notification Preferences

```http
GET  /api/v1/users/me/notification-preferences
PATCH /api/v1/users/me/notification-preferences
```

PATCH fields (all optional): `notifyEmailAlerts`, `notifySmsAlerts`, `notifyInAppAlerts`, `consentMarketing`

#### 15.9 Account Security Ownership

- Customer password/2FA/session: managed by Clerk — do not call backend endpoints.
- `PATCH /api/v1/internal/me/password` is restricted to internal roles only.

#### 15.10 Clerk Webhook Setup

Backend endpoint: `POST /webhooks/clerk`
Subscribe to: `user.updated`, `user.deleted`
Add to `.env`: `CLERK_WEBHOOK_SECRET=whsec_...`
Local dev: `npx @clerk/agent tunnel --port 3000`

#### 15.11 `GET /api/v1/users/me` Response Fields

`id`, `clerkId`, `email`, `firstName`, `lastName`, `businessName`, `phone`, `whatsappNumber`,
`addressStreet`, `addressCity`, `addressState`, `addressCountry`, `addressPostalCode`,
`role`, `isActive`, `consentMarketing`, `notifyEmailAlerts`, `notifySmsAlerts`, `notifyInAppAlerts`,
`preferredLanguage`, `deletedAt`, `createdAt`, `updatedAt`

Account deletion (`DELETE /api/v1/users/me`): soft delete. Subsequent requests for the same identity return `403` — not auto-reprovisioned.

Data export (`GET /api/v1/users/me/export`): full decrypted profile in same shape as `GET /users/me`.
