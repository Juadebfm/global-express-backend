# Memory — Tracking Overhaul + Flow 1 + FE UX Overhaul

Last updated: 2026-06-24

## What was built

### Backend (complete — already committed and pushed)

- `drizzle/migrations/2026-06-24_tracking_overhaul_and_flow1.sql` — added `bill_of_lading_number`, `vessel_name` to `dispatch_batches`; created `batch_documents` table and enum; added `sourcing_supplier_*` columns to `orders`
- `drizzle/migrations/2026-06-24_review_fixes.sql` — atomic `slot_counter` column on `dispatch_batches`; unique constraint on `batch_customer_slots(batch_id, primary_tracking_number)`
- `drizzle/schema/batch-documents.ts` — new schema file
- `src/utils/tracking.ts` — rewritten: `generateTrackingNumber()` → `TEMP-{16hex}`, `generateSlotTrackingNumber()` → `YYYYMMDD-NNNN`, `generateMasterTrackingNumber()` → `AIR/SEA-YYYYMMDD-NNNN`
- `src/services/batches.service.ts` — atomic slot counter, imports `nextMasterSequence` from dispatch-batches.service (no duplicate)
- `src/services/dispatch-batches.service.ts` — `nextMasterSequence` exported, `updateBatchCarrierInfo` accepts `billOfLadingNumber` + `vesselName`
- `src/services/uploads.service.ts` — `generateBatchDocumentPresignedUrl`, `confirmBatchDocumentUpload`, `listBatchDocuments`
- `src/services/orders.service.ts` — `createOrder()` writes `sourcingSupplier*` fields, fires `notifySupplierOfBookingRequest`; `getCustomerRequestsForSupplier()` returns safe projection
- `src/controllers/batches.controller.ts` — `presignBatchDocument`, `confirmBatchDocument`, `listBatchDocuments` with audit log
- `src/routes/batches.routes.ts` — three document endpoints delegating to controller; `billOfLadingNumber` + `vesselName` in batch schema
- `src/routes/orders.routes.ts` — `sourcingSupplier` object with `superRefine` validation
- `src/routes/supplier.routes.ts` — `GET /supplier/orders/requests` endpoint
- `src/notifications/email.ts` — `sendSupplierBookingRequestEmail`
- `src/notifications/whatsapp.ts` — `sendSupplierBookingRequestWhatsApp`
- `context/progress-tracker.md` — updated with all 5 phases complete

Last BE commit: `80d5362` — `fix(review): address all post-review issues from tracking+flow1 feature`
All BE work pushed to `origin/main`.

### Frontend (documents written — no code built yet)

- `/Users/macbookpro/Documents/GitHub/global-express-dashboard/docs/FE_SYNC_AND_UX.md` — initial sync notes (superseded by FE_REBUILD_SPEC.md)
- `/Users/macbookpro/Documents/GitHub/global-express-dashboard/docs/FE_REBUILD_SPEC.md` — full 4-layer rebuild specification (the primary FE document)
- `/Users/macbookpro/Documents/GitHub/global-express-dashboard/ui-registry.md` — UI consistency baseline established via `/imprint audit`

## Decisions made

- **Pre-launch = clean slate.** No live users, no backwards-compatibility constraints. Build it right.
- **4-layer rebuild order:** Foundation (types/routes/services) → Customer experience → Staff pipeline → Supplier portal
- **Customer nav collapses to 3 items:** My Shipments, Payments, Notifications. Removes: Orders, Delivery Schedule.
- **Staff nav collapses: "Operations" replaces Shipments + Batches** as primary staff view. Admin dashboard removed pre-launch.
- **Tracking display rule:** `TEMP-*` and `GEX-*` are internal — render as "Awaiting assignment." Customer-facing is `YYYYMMDD-NNNN` (slot) or `AIR/SEA-YYYYMMDD-NNNN` (batch master).
- **Input radius stays `rounded-lg`** — intentionally softer than card's `rounded-xl`. Documented in ui-registry, not a bug.
- **Language:** "pre-order" / "preorder" → "booking" (before warehouse) or "shipment" (after intake) everywhere in UI.
- **No Co-Authored-By trailer** in any commit in this repo.
- **Carrier info form is mode-aware:** Air → MAWB + flight. Sea → ocean tracking + voyage + BL number + vessel name. Shared → carrier name + ETD/ETA + notes.

## Problems solved

- **Slot counter race condition** — fixed with atomic `UPDATE … SET slot_counter = slot_counter + 1 RETURNING` instead of SELECT COUNT.
- **`nextMasterSequence` duplicated** — removed from `batches.service.ts`, now imported from `dispatch-batches.service.ts`.
- **Supplier PII leak** — `getCustomerRequestsForSupplier` returns a projection only (no customer name, address, financials).
- **R2 key binding** — confirm endpoint validates `r2Key.startsWith('batches/{batchId}/')` before insert.
- **Architecture violation** — batch document endpoints moved from inline route handlers to `batchesController` with audit log.
- **ActiveDeliveries.tsx hardcoded hex** — flagged in ui-registry as "fix immediately": `bg-[#0000FF]`, `bg-[#FF0000]`, `bg-[#008000]`, `bg-[#F4EBFF]` → replace with Tailwind semantic classes.

## Current state

- Backend: 100% complete, committed, pushed, ready for testing.
- FE specification: Written in full. No FE code has been built yet.
- UI registry: Baseline established. No components imprinted post-build yet.
- `ui-registry.md` established but will need updating as new components are built (run `/imprint [filepath]` after each new component).

## Next session starts with

Open `docs/FE_REBUILD_SPEC.md` in the FE repo. Start Layer 1:
1. Replace `src/types/order.types.ts` with the full updated types from the spec
2. Add `BatchDocument`, `BatchDocumentType`, updated `Batch` interface to `src/types/shipmentOps.types.ts`
3. Add `SupplierOrderRequest` to `src/types/supplierPortal.types.ts`
4. Create `src/lib/trackingUtils.ts`
5. Add `BOOKINGS_NEW` and `SUPPLIER_REQUESTS` to `src/constants/routes.ts`
6. Update services: `ordersService`, `batchesService`, `supplierPortalService`
7. Create hooks: `useBatchDocuments.ts`, `useUploadBatchDocument` (in same file), `useSupplierOrderRequests.ts`

Run `/remember restore` at the start of the next session, then open the spec doc.

## Open questions

None — all resolved.

Previously open, now closed:
- CAPTCHA on booking form: **No.** `POST /orders` uses `[authenticate, checkIdempotencyKey]` — no `requireCaptcha`. Customer must be logged in to book.
- Operations nav icon: **`'layers'` (Layers from lucide-react).** Not yet in Sidebar iconMap — spec updated with exact import and iconMap entry to add.
- Today's Arrivals filter: **Calendar day (UTC).** `createdAt >= today 00:00:00 UTC`. Pass as `?createdAfter=YYYY-MM-DD` or filter client-side if the endpoint doesn't support it yet.
