# Business Logic Change Specification

This document captures all requested business-logic changes before implementation.

## Workflow

1. Collect changes one-by-one in this file.
2. Clarify assumptions and edge cases for each change.
3. Freeze scope after your confirmation.
4. Implement in grouped phases.
5. Validate with tests and deployment checks.

## Current Build Baseline

- Date: 2026-04-19
- Branch: current working branch
- Status: Deployed build exists; pending new business-logic updates.

## Requested Changes (Draft)

### Change 1

- Status: `Implemented (local) — pending deploy`
- Decision Ref: `1B + 2B`
- Request:
  - Update freight billing calculation logic for `air` and `sea` warehouse verification and estimation flows.
- Why:
  - Ensure billing uses the correct chargeable basis from dimensions/weight by transport mode.
- Affected Areas:
  - `src/services/orders.service.ts` (warehouse verification + billable basis).
  - `src/services/pricing-v2.service.ts` (pricing input assumptions).
  - `src/controllers/orders.controller.ts` and `src/controllers/public.controller.ts` (estimate validation and payload handling).
  - `src/routes/orders.routes.ts` and `src/routes/public.routes.ts` (API contract/docs).
  - Unit/integration tests covering pricing and warehouse verification.
- Current Baseline Rates Observed (2026-04-19):
  - `pricing_rules` table count: `0`
  - `customer_pricing_overrides` table count: `0`
  - Active fallback defaults from code:
    - Air tiers (USD/kg):
      - `1-100kg: 13.5`
      - `101-300kg: 11.5`
      - `301-600kg: 10.8`
      - `601-1000kg: 10.5`
      - `1001-1500kg: 10.0`
      - `1501kg+: 9.8`
    - Sea flat rate (USD/CBM): `550`
- Proposed Rule(s):
  - Air-only billing basis:
    - Compute volumetric weight from dimensions using:
      - `volumeWeightKg = (lengthCm * widthCm * heightCm) / 6000`
    - Compare volumetric weight against measured/input actual weight.
    - Billable weight = `max(volumeWeightKg, actualWeightKg)`.
    - Final air freight charge should continue using the existing air rate logic against that selected billable weight.
  - Sea-only billing basis:
    - Compute volume using:
      - `cbm = (lengthCm * widthCm * heightCm) / 1,000,000`
    - Convert volume to equivalent kg for costing basis:
      - `equivalentKg = cbm * 550`
    - Use the resulting value as the basis for sea costing (pending final confirmation below).
- API/DB Impact:
  - Likely no schema migration needed for this change by default.
  - No DB schema migration required.
  - Pricing settings validation updated so sea rules now require `rateUsdPerKg` (not `flatRateUsdPerCbm`).
  - Pricing calculation internals and response metadata may need extension (e.g., store actual vs volumetric vs selected billable basis).
- Backward Compatibility Notes:
  - Existing clients that only send air `weightKg` without dimensions continue to work (fallback to actual weight only).
  - Legacy sea `flatRateUsdPerCbm` rules are still read by the pricing engine and converted internally to per-kg (`flatRateUsdPerCbm / 550`) for compatibility.
- Open Questions:
  - None for Change 1 (resolved by decision 1B + 2B).

### Change 1 Implementation Notes

- Implemented formulas:
  - Air:
    - Volumetric weight: `(lengthCm * widthCm * heightCm) / 6000`
    - Billable air weight: per package `max(actualWeightKg, volumetricWeightKg)` then summed.
    - If dimensions are unavailable, falls back to actual weight (2B).
  - Sea:
    - `cbm = (lengthCm * widthCm * heightCm) / 1,000,000` (or provided cbm).
    - `chargeableKg = cbm * 550`.
    - Sea pricing now applies sea `rateUsdPerKg` against `chargeableKg` (1B).

- Files updated:
  - `src/services/pricing-v2.service.ts`
  - `src/services/orders.service.ts`
  - `src/controllers/public.controller.ts`
  - `src/controllers/orders.controller.ts`
  - `src/routes/settings.routes.ts`
  - `src/routes/orders.routes.ts`
  - `tests/unit/pricing-v2.test.ts`

- Validation:
  - `npm run build` ✅
  - `npm test` ✅ (44/44 tests passed)

### Change 2

- Status: `Implemented (local) — pending deploy`
- Request:
  - Add `shippingMark` to customer-facing registration and profile flows.
- Business Rules:
  - Registration:
    - `shippingMark` is optional.
    - Missing `shippingMark` must never block registration.
  - Profile update:
    - User can add `shippingMark` only when it is currently empty/null.
    - User cannot edit/replace `shippingMark` once it has been set.
  - Change management after initial set:
    - If user needs to change `shippingMark`, they must raise a support ticket.
    - A super admin reviews and approves the change through support/ticketing admin flow.
- Affected Areas (expected):
  - Customer auth/profile flows (`authenticate` auto-provision + profile update endpoint/service).
  - Super admin user-creation flow (optional `shippingMark` input when creating a user).
  - Validation schemas + API docs for registration/profile/admin-create endpoints.
  - DB schema/user model (if `shippingMark` column does not yet exist).
  - Tests for registration, profile update immutability, and admin-create behavior.
- Open Questions:
  - None (resolved in implementation notes and decisions log).

### Change 2 Implementation Notes

- Data model:
  - Added `users.shipping_mark` column.
  - `shippingMark` is encrypted at rest, consistent with sensitive user profile fields.
- Registration + Clerk sync:
  - `shippingMark` is read from Clerk metadata (`shippingMark`, `shipping_mark`, `shippingmark`) during auto-provision/linking in `authenticate`.
  - Missing `shippingMark` never blocks registration/provisioning.
- Self-service profile update (`PATCH /users/me`):
  - Add-only enforcement implemented:
    - If current `shippingMark` is empty: user may add it.
    - If current `shippingMark` is already set: user cannot change/replace it from self-service profile.
  - Attempted post-set change returns a clear support-ticket message.
- Admin/superadmin update flows:
  - `shippingMark` is available on admin user update payloads.
  - Only `SUPER_ADMIN` can set/change `shippingMark` through admin update routes.
  - In superadmin edit flow, clearing/removing `shippingMark` is allowed (admin-controlled change path).
- Superadmin create-user path:
  - Added optional `shippingMark` input to staff-created client stub flow.
  - Guardrail: only superadmin can set `shippingMark` at creation time.
- API contract updates:
  - Added `shippingMark` to user response schemas and relevant request schemas (`auth/sync`, `users`, `admin/clients`).
- Validation:
  - `npm run build` ✅
  - `npm test` ✅ (45/45 tests passed)

### Change 3

- Status: `Implemented (local) — pending deploy`
- Request:
  - Overhaul role system to exactly four roles:
    - `SUPER_ADMIN`
    - `STAFF`
    - `USER`
    - `SUPPLIER`
- Business Rule:
  - Super admins can create users and may optionally set `shippingMark` at creation time.
- Affected Areas (expected):
  - `UserRole` enum/type + authorization guards.
  - Existing admin/staff route protections and policy checks.
  - Seed data, tests, and any role-based query filters.
  - Potential DB enum migration and backfill/mapping for existing role values.
- Open Questions:
  - None (resolved in implementation notes and decisions log).

### Change 3 Implementation Notes

- Canonical role set implemented in app enum:
  - `SUPER_ADMIN`, `STAFF`, `USER`, `SUPPLIER`.
- Legacy `ADMIN` role removed from app-layer role enum and authorization checks.
- DB migration added:
  - Rebuilds `user_role` enum to `('superadmin', 'staff', 'user', 'supplier')`.
  - Maps legacy `admin` values to `staff` for:
    - `users.role`
    - `notifications.target_role`
- Permission/guard alignment:
  - `requireAdminOrAbove` now maps to `STAFF` + `SUPER_ADMIN`.
  - `requireStaffOrAbove` now maps to `STAFF` + `SUPER_ADMIN`.
  - Superadmin-only checks preserved where required (e.g., sensitive updates).
- Team/internal flows:
  - Internal user creation now supports only internal roles (`STAFF`, `SUPER_ADMIN`).
  - Team listing excludes `USER` and `SUPPLIER`.
  - Role guard unit tests updated for the new four-role model.
- Notification role routing:
  - Replaced old linear role hierarchy with explicit audience/visibility mapping that supports `SUPPLIER`.
- Validation:
  - `npm run build` ✅
  - `npm test` ✅ (45/45 tests passed)

### Change 4

- Status: `Implemented (local) — pending deploy`
- Request:
  - Enforce strict separation so internal roles (`STAFF`, `SUPER_ADMIN`) can never authenticate through Clerk token paths.
- Implemented Rule(s):
  - API auth middleware rejects Clerk token authentication when the resolved DB role is internal (`STAFF`, `SUPER_ADMIN`).
  - WebSocket auth does the same for Clerk token branch to prevent bypass on real-time channels.
- Files updated:
  - `src/middleware/authenticate.ts`
  - `src/websocket/handlers.ts`
- Validation:
  - `npm run build` ✅
  - `npm test` ✅ (45/45 tests passed)

### Change 5

- Status: `Configured (Clerk Dashboard) + FE Follow-up Needed`
- Request:
  - Enable passkeys for external-user sign-in to reduce repeated OTP friction.
- Scope:
  - External users (`USER`/`SUPPLIER`) on Clerk auth flows only.
  - Internal roles remain internal-auth only (`STAFF`/`SUPER_ADMIN`).
- Why this is needed now:
  - Current external sign-in flow relies heavily on email verification code, which can feel repetitive.
  - Passkey enables faster repeat sign-in on the same trusted device while preserving strong security.
- Backend impact:
  - No mandatory backend API/schema changes required.
  - Existing backend auth already validates Clerk session JWTs regardless of first-factor method.
- Frontend note (required):
  - FE must expose passkey option in the Clerk sign-in UI/custom flow and ensure users can choose it.
  - FE should still call backend sync/protected routes with the Clerk bearer token after successful sign-in.
  - Without FE wiring, enabling passkey in Clerk dashboard alone may not materially change user login UX.
- Validation (recommended smoke checks):
  - Sign in with passkey from FE.
  - Call `POST /api/v1/auth/sync`.
  - Call `GET /api/v1/users/me` with returned Clerk session token.

### Change 6

- Status: `Scope Frozen — ready for implementation`
- Request:
  - Implement shipment aggregation and tracking refactor for customer-cycle accumulation and GEX dispatch batching.
- Core Decisions Confirmed:
  - Bulk module deprecation:
    - Remove/retire `bulk_*` operational flow from active business process.
    - Internal consolidated shipment/batch flow from GEX perspective remains required.
  - Supplier handling:
    - Supplier remains a first-class role (`SUPPLIER`).
    - FE should be able to fetch/select suppliers when adding shipments for customers.
    - Customers may have reusable "regular supplier" picks in future supplier UX.
  - Invoice lifecycle:
    - First invoice is created as `draft`.
    - Invoice is finalized when shipment reaches transit milestone (staff/admin status move to in-transit stage, including airport/port departure milestones).
    - Payment should be linked to invoice (not order-level only).
  - Tracking separation:
    - Internal GEX batch has master tracking number (staff/superadmin only).
    - Each customer gets their own customer-scoped tracking number for their own goods.
    - Internal master tracking number must not resolve on public/customer tracking endpoints.
  - Public/user tracking expansion:
    - Keep public tracking endpoint.
    - Add richer response data for customer tracking:
      - payment state (`pending`/`completed`)
      - shipment cost
      - expected arrival time
      - vendor count
      - breakdown of individual goods in that customer shipment
    - Add/keep separate internal tracking lane with full internal details.
  - Dispatch behavior:
    - Auto + manual dispatch flow both required.
    - Staff-triggered dispatch requires superadmin approval.
    - Superadmin-triggered dispatch can proceed directly.
    - Late arrivals auto-roll into the next batch/cycle.
    - Dispatch/cycle close should be tied to actual movement updates (event-driven), not fixed weekday/month cutoff assumptions.
  - Shipment append rule:
    - Enforce one open customer shipment per `customer + transport mode + active dispatch batch`.
    - New goods arrivals append to that open shipment until dispatch close.
  - Currency/pricing display:
    - Staff can view item-level costing (optional for UI prominence, but supported).
    - Invoice/tracking financial display should support both USD and NGN.
    - Superadmin can set operational FX rates; official fallback rate must exist.
  - Data migration scope:
    - New model should apply across existing and future shipments (not future-only).
- Affected Areas (expected high level):
  - Shipment domain model (customer shipment, cycle, internal batch, tracking identifiers).
  - Order/goods intake flow for append-to-existing-shipment behavior.
  - Supplier association model + supplier listing endpoints for FE selectors.
  - Invoice model and payment linkage (`invoiceId`-centric settlement).
  - Tracking endpoints (public/customer scoped vs internal full-detail).
  - Dispatch automation + approval workflow (staff->superadmin gate).
  - Migration/backfill for existing shipments/payments.
- Open Questions:
  - None (resolved: Option B cutoff policy confirmed).

### Change 7

- Status: `Scope Frozen — ready for implementation`
- Request:
  - Introduce `D2D` (Door-to-Door) as a new shipment type with its own operational flow, pricing/payer rules, verification checkpoints, and external visibility behavior.
- Business Context:
  - D2D is primarily for expedited/sensitive goods (e.g., collagen, medicament, regulated, cosmetic, medical items).
  - Suppliers are often the source of shipment details and may sometimes be the paying party instead of the end user.
- Core Decisions Confirmed:
  - Shipment type and lane model:
    - Add `D2D` as a new `shipmentType`.
    - D2D usually follows air movement, but remains a distinct product flow.
  - User/supplier linkage:
    - Shipment can be linked to both customer user and supplier.
    - GEX operationally can handle multiple customers and multiple suppliers across arrangements.
  - Payer model:
    - Exactly one payer per shipment: either `USER` or `SUPPLIER`.
    - If payer is `SUPPLIER`, shipment must be single-supplier (multiple suppliers are not allowed on that shipment).
  - Verification checkpoints:
    - SK warehouse verification is required.
    - At SK warehouse, both weight and volume must be captured.
    - Airport measurements are recorded as provided by airport staff (may differ from warehouse values).
    - Nigeria office performs final verification/check; this is not a process blocker.
  - Measurement variance control:
    - Record measurement differences across SK warehouse, airport, and Nigeria checkpoints for reconciliation/audit.
    - Variance does not block movement/status updates and does not trigger post-payment customer re-pricing.
  - Regulated-document handling:
    - Allow document upload for regulated goods from either supplier portal or SK warehouse staff.
  - Media capture:
    - Goods images are required in warehouse intake flow for D2D.
  - Invoicing and visibility:
    - When supplier is payer, supplier-facing task invoice is required and should be uploadable by staff/superadmin.
    - User-facing side should expose payment status only (not full supplier invoice details).
    - Supplier should see only their own shipments/invoices and only limited linked-user details.
    - Supplier-payer flow: supplier must provide the recipient user details; shipment is recorded as one shipment for that linked user.
  - Status/timeline:
    - D2D needs its own status flow; journey extends beyond Nigeria office to last-mile city delivery via local courier.
  - D2D lane scope:
    - D2D is not restricted to air-only in V1 (air and sea can be supported).
  - Pricing controls:
    - Use normal rate cards when user pays directly.
    - Maintain separate supplier rate cards when supplier pays.
    - Superadmin can configure supplier and user rates independently.
    - User-payer consolidation: user is charged for the full set of goods received for that user at that intake point/cycle, including goods from same supplier at different times/values and from different suppliers.
  - Data starting point:
    - Treat this as fresh rollout baseline; remove any legacy/open setup artifacts if present.
- Recommended Technical Direction (Efficiency):
  - Reuse existing `invoices` foundation (most efficient) and extend it with payer/audience metadata, instead of creating a separate parallel invoice system.
  - Add a dedicated invoice-attachment model for uploaded supplier task invoices (PDF/images), linked to invoice records.
  - Keep payments invoice-centric (`invoiceId`) as already established.
- Expected Affected Areas (high-level):
  - Enums/types:
    - Add `D2D` shipment type and D2D-specific status set.
    - Add payer model enum (e.g., `USER`, `SUPPLIER`).
  - Order/shipment domain:
    - User+supplier linkage model.
    - D2D checkpoint measurement history (SK, airport, Nigeria) and variance tracking.
  - Pricing:
    - Split rate selection by payer type for D2D (user-rate-card vs supplier-rate-card).
  - Invoicing:
    - Invoice audience/payer metadata + supplier task-invoice attachments.
  - External/internal APIs:
    - Supplier portal views, customer-limited views, internal staff/superadmin operations.
  - Notifications:
    - Internal reconciliation visibility for recorded measurement differences.
  - Uploads:
    - Regulated documents + goods images + supplier invoice files (optimized size handling).

### Change 8

- Status: `Implemented (local) — pending deploy`
- Request:
  - Remove manual-adjustment pricing inputs/labels end-to-end.
  - Enforce superadmin-only permissions for pricing-rule changes.
- Implemented Rules:
  - Warehouse verification no longer accepts manual final-charge override fields.
  - `finalChargeUsd` is always derived from calculated pricing + special packaging surcharge.
  - Manual-adjustment pricing source/reason fields are removed from active API and app schema contracts.
  - `PATCH /api/v1/settings/pricing` is now superadmin-only.
- Files updated:
  - `src/routes/orders.routes.ts`
  - `src/controllers/orders.controller.ts`
  - `src/services/orders.service.ts`
  - `src/routes/settings.routes.ts`
  - `src/types/enums.ts`
  - `drizzle/schema/orders.ts`
  - `drizzle/schema/bulk-shipment-items.ts`
  - `drizzle/migrations/2026-04-20_remove_manual_adjustment_pricing.sql`
  - `docs/frontend-api-manual.md`
  - `docs/business-process-refactor-blueprint.md`

### Change 9

- Status: `Implemented (local) — pending deploy`
- Request:
  - Fully retire bulk-order artifacts across API, app code, schema exports, and docs for all actors (`staff`, `user`, `supplier`, `superadmin`).
- Implemented Rules:
  - Removed dormant bulk-order route/controller/service modules from active codebase.
  - Removed bulk schema artifacts from active Drizzle schema and package-image/package-package linkage models.
  - Added cleanup migration to remove `bulk_*` tables and `bulk_item_id` references.
  - Removed bulk-order API documentation sections and bulk endpoint mentions from manuals.
- Files updated:
  - `src/routes/bulk-orders.routes.ts` (deleted)
  - `src/controllers/bulk-orders.controller.ts` (deleted)
  - `src/services/bulk-orders.service.ts` (deleted)
  - `drizzle/schema/bulk-shipments.ts` (deleted)
  - `drizzle/schema/bulk-shipment-items.ts` (deleted)
  - `drizzle/schema/index.ts`
  - `drizzle/schema/package-images.ts`
  - `drizzle/schema/order-packages.ts`
  - `src/services/uploads.service.ts`
  - `src/routes/orders.routes.ts`
  - `drizzle/migrations/2026-04-20_remove_bulk_orders_artifacts.sql`
  - `docs/frontend-api-manual.md`
  - `docs/business-process-refactor-blueprint.md`

## Decisions Log

- 2026-04-19: Captured Change 1 scope and formulas from stakeholder request; implementation deferred pending full change list and open-question resolution.
- 2026-04-19: Resolved pricing decisions for Change 1:
  - Sea model: `1B` (convert cbm to chargeable kg via `*550`, then apply sea USD/kg rate).
  - Air missing dimensions behavior: `2B` (fallback to actual weight).
- 2026-04-19: Implemented Change 1 locally and validated via build + tests.
- 2026-04-19: Captured Change 2 `shippingMark` rules:
  - Registration optional and non-blocking.
  - User self-service profile flow allows add-only when empty; no direct edits after set.
  - Post-set changes require support-ticket flow and super admin approval.
- 2026-04-19: Captured Change 3 role-system overhaul scope with four roles and sequencing before Change 2 implementation.
- 2026-04-19: Resolved Change 3 role naming decision:
  - Supplier role canonicalized as `SUPPLIER`.
- 2026-04-19: Implemented Change 3 locally:
  - Replaced app role enum with 4-role model.
  - Added migration mapping legacy `admin` to `staff` and adding `supplier`.
- 2026-04-19: Resolved Change 2 storage/approval decisions:
  - `shippingMark` is encrypted at rest.
  - Self-service is add-only; post-set changes are blocked in profile update.
  - Superadmin admin-flow can set/change/clear as approved path.
- 2026-04-19: Implemented Change 2 locally across registration sync, profile update, and superadmin create/edit flows.
- 2026-04-19: Implemented Change 4 locally:
  - Internal roles are explicitly rejected on Clerk token auth paths (API + WebSocket).
- 2026-04-19: Passkey decision captured for external users:
  - Passkey enabled in Clerk Dashboard.
  - No BE change required for token verification path.
  - FE implementation is required to surface and use passkey sign-in flow.
- 2026-04-19: Captured Change 6 shipment aggregation direction:
  - Bulk module to be retired from business flow.
  - Internal consolidated dispatch batch remains.
  - Supplier remains a role and should be list-selectable in shipment intake flows.
  - Invoice lifecycle set to draft->finalized on transit milestone; payments move to invoice-based linkage.
  - Internal master tracking is isolated from public/customer lanes.
  - Public tracking to include payment/cost/ETA/vendor-count/goods breakdown for customer-scoped shipment.
  - Dispatch supports both automation and manual trigger; staff dispatch requires superadmin approval.
  - Late arrivals roll into next cycle.
  - Both USD and NGN display required with superadmin-managed FX and fallback official rate.
  - Migration intent applies to old and new shipments.
- 2026-04-19: Refined Change 6 with additional confirmations:
  - Dispatch cycle boundaries are event-driven from actual movement updates (not fixed weekday/quarter schedule).
  - Sea "3 months" is transit expectation, not dispatch cycle cadence.
  - Draft invoice finalization triggers confirmed:
    - Air: `FLIGHT_DEPARTED`
    - Sea: `VESSEL_DEPARTED`
  - Append behavior confirmed:
    - One open customer shipment per customer+mode+active batch; new goods append there.
- 2026-04-19: Change 6 cutoff policy confirmed:
  - Option B adopted.
  - Staff-triggered movement transitions batch to `CUTOFF_PENDING_APPROVAL`.
  - Superadmin approval closes batch.
  - Superadmin-triggered dispatch can close directly.
- 2026-04-20: Captured Change 7 D2D decisions:
  - New `shipmentType = D2D` with separate flow and status journey.
  - Single payer per shipment (`USER` or `SUPPLIER`), with user+supplier linkage supported.
  - SK warehouse requires both weight and volume capture; airport and Nigeria checkpoints recorded for reconciliation/final check.
  - Measurement differences are recorded for reconciliation; they do not block operations and do not force post-payment re-pricing.
  - Supplier task invoices can be uploaded by staff/superadmin; user side sees payment status only.
  - Separate rate-card controls required for user-paid vs supplier-paid D2D shipments.
  - Preferred implementation approach: extend existing invoice model rather than introducing a parallel invoice subsystem.
- 2026-04-20: Refined Change 7 confirmations:
  - D2D V1 is not air-only.
  - Upload constraints confirmed: PDF max 5MB, image uploads accepted up to 12MB with compression before storage, max 10 files per upload group.
- 2026-04-20: Finalized Change 7 payer/consolidation rules:
  - Supplier-payer shipments must be single-supplier; multi-supplier attachment is not allowed.
  - Supplier-payer shipments are recorded against one linked user provided by the supplier.
  - User-payer shipments are consolidated and billed for all goods received for that user at that intake point/cycle, even across suppliers and timing differences.
- 2026-04-20: Implemented Change 8 locally:
  - Removed warehouse manual pricing override inputs and manual-adjustment reason flow.
  - Final charge now always uses computed pricing + configured surcharges.
  - Pricing rules mutation endpoint (`PATCH /settings/pricing`) changed to superadmin-only.
- 2026-04-20: Implemented Change 9 locally:
  - Retired bulk-order code modules and removed bulk schema exports.
  - Added migration to drop `bulk_shipments`, `bulk_shipment_items`, and `bulk_item_id` references from related tables.
  - Updated docs to remove `/bulk-orders` endpoint references.

## Implementation Plan (To Be Filled After Scope Freeze)

- Change 1: Implemented (local), validated.
- Change 3: Implemented (local), validated.
- Change 2: Implemented (local), validated.
- Change 4: Implemented (local), validated.
- Change 5: Configured (Clerk) + FE follow-up required.
- Change 6: Scope frozen; implement event-driven cutoff with Option B approval gate.
- Change 7: Scope frozen; ready for implementation.
- Change 8: Implemented (local), validated.
- Change 9: Implemented (local), validated.
- Deployment pending.
