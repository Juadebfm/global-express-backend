# Shipment Refactor Blueprint (Approved V2)

Last updated: February 25, 2026

Purpose:

- Translate approved business rules into an implementation-ready backend refactor plan.
- Keep existing order endpoints, while upgrading flow, pricing, statuses, payments, and localization.
- Migrate existing records into the new status/process model.

## 1. Locked Business Decisions

## 1.1 Lane and Offices

- Active lane is fixed to `South Korea -> Lagos` for this release.
- Korea office address (source office):
  - `GLOBAL EXPRESS`
  - `76-25 Daehwa-ro, Ilsanseo-gu, Goyang-si, Gyeonggi-do (Bldg. B)`
  - `+82-10-4710-5920`
- Lagos office address (pickup office):
  - `58B Awoniyi Elemo Street, Ajao Estate, Lagos`
- Office addresses must be stored in backend settings and editable by `superadmin`.

## 1.2 Transport and Pricing

- Currency for freight pricing is `USD`.
- Air pricing uses exact `actual weight` (kg), no rounding, no minimum.
- Sea pricing uses exact `cbm`, no rounding, no minimum.

Air tiers (USD per kg):

1. `1-100kg = 13.50`
2. `101-300kg = 11.50`
3. `301-600kg = 10.80`
4. `601-1000kg = 10.50`
5. `1001-1500kg = 10.00`
6. `1501+kg = 9.80`

Sea pricing:

- Flat `550 USD / cbm`
- Transit lead time target is approximately `3 months after boarding`

## 1.3 Special Customer Pricing

- Special prices override default pricing for that customer.
- Overrides can be set per mode (`air` and/or `sea`).
- Validity window is optional (`startAt`, `endAt`).
- Editable by `admin` and `superadmin`.
- Every create/update/delete must generate audit logs.

## 1.4 Pre-order and Warehouse Verification

- Customer can pre-order before goods arrive at Korea warehouse.
- Price is not shown at pre-order stage.
- Price is calculated only when warehouse staff verifies goods in Korea.
- Staff/agent flow at warehouse:
  - receive goods
  - upload photo(s)
  - capture package details (description, dimensions, type, weight/cbm)
  - select customer (or create customer and send Clerk invite)
  - auto-calculate freight
  - optionally apply manual adjustment with required reason
- Customer sees only final price (not internal calculation breakdown).

## 1.5 Status Workflow

- Status transitions are sequential.
- Air and sea use different status paths.
- Every status change records timestamp and actor.
- Internal status can be richer than customer-facing status.

Common intake statuses:

1. `PREORDER_SUBMITTED`
2. `AWAITING_WAREHOUSE_RECEIPT`
3. `WAREHOUSE_RECEIVED`
4. `WAREHOUSE_VERIFIED_PRICED`

Air statuses:

1. `DISPATCHED_TO_ORIGIN_AIRPORT`
2. `AT_ORIGIN_AIRPORT`
3. `BOARDED_ON_FLIGHT`
4. `FLIGHT_DEPARTED`
5. `FLIGHT_LANDED_LAGOS`
6. `CUSTOMS_CLEARED_LAGOS`
7. `IN_TRANSIT_TO_LAGOS_OFFICE`
8. `READY_FOR_PICKUP`
9. `PICKED_UP_COMPLETED`

Sea statuses:

1. `DISPATCHED_TO_ORIGIN_PORT`
2. `AT_ORIGIN_PORT`
3. `LOADED_ON_VESSEL`
4. `VESSEL_DEPARTED`
5. `VESSEL_ARRIVED_LAGOS_PORT`
6. `CUSTOMS_CLEARED_LAGOS`
7. `IN_TRANSIT_TO_LAGOS_OFFICE`
8. `READY_FOR_PICKUP`
9. `PICKED_UP_COMPLETED`

Exception statuses:

1. `ON_HOLD`
2. `CANCELLED`
3. `RESTRICTED_ITEM_REJECTED`
4. `RESTRICTED_ITEM_OVERRIDE_APPROVED`

## 1.6 Payments

- Customer may pay before departure or at pickup.
- Only full payment is allowed.
- Pickup release is blocked until full payment is confirmed.
- Supported payment methods:
  - card (gateway)
  - transfer (staff-recorded)
  - cash (staff-recorded)
- For FX conversion (USD -> NGN), support:
  - live rate
  - manual rate override (manual overrides live while active)
- Customer dashboard must show `amount due` and `pay now` when unpaid.

## 1.7 Notifications

- Trigger channels: email + in-app (respect user channel preferences).
- Notify on milestones only:
  - `WAREHOUSE_VERIFIED_PRICED`
  - `BOARDED_ON_FLIGHT` or `LOADED_ON_VESSEL`
  - `FLIGHT_LANDED_LAGOS` or `VESSEL_ARRIVED_LAGOS_PORT`
  - `READY_FOR_PICKUP`
  - `PAID_IN_FULL`
- Notification templates must be editable by admin roles.

## 1.8 Restricted Goods

- Initial restricted list includes:
  - batteries
  - phones
  - laptops
- List must be backend-configurable.
- Restricted items can proceed only via admin override with mandatory reason + audit log.

## 1.9 Language

- Supported languages: `en` and `ko`.
- Default language: `en`.
- Language preference is persisted per user profile.
- Backend localizes dynamic content (notifications, emails, status labels, payment/pickup texts).
- Bilingual support applies to both customer and internal users.

## 2. API Strategy (Keep Existing Endpoints)

Existing endpoints remain primary:

- `POST /api/v1/orders`
- `PATCH /api/v1/orders/:id/status`
- `GET /api/v1/orders`, `GET /api/v1/orders/:id`, `GET /api/v1/orders/my-shipments`
- `POST /api/v1/payments/initialize`, `POST /api/v1/payments/verify/:reference`

Required endpoint behavior upgrades:

1. `POST /orders`
   - Accept pre-order creation with no visible price until warehouse verification.
   - Restrict lane to Korea -> Lagos.
2. `PATCH /orders/:id/status`
   - Enforce sequential transitions.
   - Validate status by transport mode (`air` vs `sea`).
   - Record status history (actor + timestamp).
3. `GET /orders*`
   - Return internal status plus mapped customer status label.
   - Return final payable amount and payment state.

Recommended new endpoints (additive):

1. `POST /api/v1/orders/:id/warehouse-verify`
   - Capture package verification details, compute price, apply optional manual adjustment reason.
2. `POST /api/v1/admin/clients`
   - Create customer profile stub by staff/admin, then issue Clerk invite.
3. `POST /api/v1/admin/clients/:id/send-invite`
   - Re-send Clerk claim/invite link.
4. `POST /api/v1/payments/:orderId/record-offline`
   - Record transfer/cash payment with proof metadata (staff+).
5. `GET /api/v1/settings/logistics`
6. `PATCH /api/v1/settings/logistics`
   - Offices, lane lock, transport ETA copy (superadmin for office updates).
7. `GET /api/v1/settings/pricing`
8. `PATCH /api/v1/settings/pricing`
   - Default air tiers, sea flat rate, per-customer overrides (admin+).
9. `GET /api/v1/settings/restricted-goods`
10. `PATCH /api/v1/settings/restricted-goods`
11. `GET /api/v1/settings/fx-rate`
12. `PATCH /api/v1/settings/fx-rate`
   - live/manual mode and manual value.
13. `GET /api/v1/settings/templates`
14. `PATCH /api/v1/settings/templates/:id`
   - localized notification/email template management.

## 3. Data Model Changes

Current gaps in schema:

- `orders.status` enum is legacy (`pending`, `in_transit`, etc.).
- no status history table
- no pricing rules tables
- no restricted goods catalog
- no configurable offices/settings table
- no user preferred language field
- `bulk_shipment_items.weight` is text; package detail model is limited

Proposed additions:

1. `orders` table
   - add `transportMode` (`air` | `sea`)
   - add `isPreorder` boolean
   - add `priceCalculatedAt`, `priceCalculatedBy`
   - add `calculatedChargeUsd`, `finalChargeUsd`, `pricingSource`, `priceAdjustmentReason`
   - add `customerStatus` (or derive via mapping function)
   - add `paymentCollectionStatus` (`UNPAID`, `PAYMENT_IN_PROGRESS`, `PAID_IN_FULL`)
2. `order_status_events`
   - `orderId`, `status`, `actorId`, `createdAt`
3. `order_packages`
   - support exact weight/cbm and dimensions per package
   - `orderId`, `description`, `itemType`, `lengthCm`, `widthCm`, `heightCm`, `weightKg`, `cbm`, `isRestricted`, `restrictedOverride*`
4. `pricing_rules`
   - default air tiers + sea flat rate
5. `customer_pricing_overrides`
   - per-customer mode-specific overrides, optional validity windows, actor/audit metadata
6. `restricted_goods`
   - configurable prohibited catalog
7. `app_settings` (or scoped settings tables)
   - lane, offices, FX mode/value, ETA labels
8. `notification_templates`
   - template key + locale + subject/body
9. `users`
   - add `preferredLanguage` (`en` default, `ko`)

## 4. Migration Plan (Existing Records Must Be Migrated)

Migration requirement: existing records move into new model.

## 4.1 Enum/status migration approach

1. Add new status enum and new status column (temporary dual-write period).
2. Backfill new status from legacy value using deterministic mapping.
3. Switch reads to new status column.
4. Remove legacy status references after verification.

Default status backfill map:

- `pending` -> `WAREHOUSE_VERIFIED_PRICED`
- `picked_up` -> `DISPATCHED_TO_ORIGIN_AIRPORT` (air) or `DISPATCHED_TO_ORIGIN_PORT` (sea)
- `in_transit` -> `FLIGHT_DEPARTED` (air) or `VESSEL_DEPARTED` (sea)
- `out_for_delivery` -> `IN_TRANSIT_TO_LAGOS_OFFICE`
- `delivered` -> `PICKED_UP_COMPLETED`
- `cancelled` -> `CANCELLED`
- `returned` -> `CANCELLED`

Records with missing/unknown transport mode go to an admin review queue before final backfill.

## 4.2 Pricing backfill

- If existing orders have no trusted computed freight amount, mark as `pricingSource = MIGRATED_UNVERIFIED`.
- Require admin restatement for operationally active shipments.

## 4.3 Bulk shipment parity

- Apply the same status model and payment/price visibility rules to `bulk_shipment_items`.
- Ensure customer dashboard unified list continues to work unchanged.

## 5. Validation Rules

1. Lane must be Korea -> Lagos only (for V2 release).
2. No customer-visible price before `WAREHOUSE_VERIFIED_PRICED`.
3. Status transitions must be sequential by mode.
4. `READY_FOR_PICKUP` cannot move to `PICKED_UP_COMPLETED` until `PAID_IN_FULL`.
5. Manual price changes require non-empty reason and actor log.
6. Restricted item override requires admin+ role, reason, and audit entry.
7. Manual FX override supersedes live FX until disabled/expired.

## 6. Delivery Phases

## Phase 1 - Schema and enums

- Add new enums/tables/columns and migration scaffolding.
- Keep API responses backward compatible where possible.

## Phase 2 - Pricing engine + warehouse verify

- Implement exact weight/cbm pricing logic.
- Add customer override evaluation and manual adjustment flow.

## Phase 3 - Status workflow engine

- Implement transition graph validators for air/sea.
- Add status event writer and customer status mapper.
- Trigger milestone-only notifications.

## Phase 4 - Payment release controls

- Add offline payment recording endpoints.
- Enforce full payment for pickup completion.
- Expose dashboard amount due state.

## Phase 5 - Settings + localization

- Add editable logistics/pricing/restricted-goods/fx/template settings.
- Add language preference and localized dynamic content.

## Phase 6 - Data migration + hardening

- Run legacy-to-v2 backfill.
- Validate reports/dashboard compatibility.
- Complete regression tests and role/permission tests.

## 7. Definition of Done

- All approved statuses implemented and enforced sequentially.
- Pricing uses approved USD tiers and sea flat cbm rate.
- Customer-specific overrides and audit trail active.
- Price hidden until Korea warehouse verification.
- Pickup blocked until full payment (card/transfer/cash supported).
- Milestone notifications and template management active.
- Restricted-goods configuration and override workflow active.
- `en`/`ko` dynamic backend localization active for internal + customer flows.
- Existing records migrated and verified.
