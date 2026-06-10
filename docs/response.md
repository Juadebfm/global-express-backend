# Operator order detail view — backend clarifications

## 1. Overview panel fields on GET /orders/:id

`senderId`, `declaredValue`, and `pricingSource` are all on the order response. `billableWeight` does **not exist** anywhere in the schema — not on orders, not on packages. The closest fields are `weightKg` and `cbm` per package in `order_packages`. If "billable weight" means max(actual kg, volumetric kg), the FE needs to compute it from the package records, or we need to add it as a stored field. Flag this before building.

## 2. Pricing source

It's a real column on the order. Three possible values:

- `DEFAULT_RATE` — standard rate table applied
- `CUSTOMER_OVERRIDE` — customer has a negotiated pricing override
- `MIGRATED_UNVERIFIED` — order predates the pricing engine, not verified against current rules

It's set during the warehouse-verify step. It will be `null` for orders that haven't been warehouse-verified yet.

## 3. The 5-stage model

The backend has no 5-stage concept. It has a flat sequence of `statusV2` values. The FE owns the grouping. Here's a sensible mapping based on the actual flow:

- Stage 1 — Intake: `PREORDER_SUBMITTED`, `AWAITING_WAREHOUSE_RECEIPT`, `WAREHOUSE_RECEIVED`, `CLAIM_APPROVED_PENDING_BULK_PROCESSING`
- Stage 2 — Warehouse: `WAREHOUSE_VERIFIED_PRICED`
- Stage 3 — In Transit: `DISPATCHED_TO_ORIGIN_AIRPORT/PORT` through `FLIGHT_LANDED_LAGOS` / `VESSEL_ARRIVED_LAGOS_PORT`
- Stage 4 — Customs & Clearance: `CUSTOMS_CLEARED_LAGOS`, `IN_TRANSIT_TO_LAGOS_OFFICE`, `IN_EXTRA_TRUCK_MOVEMENT_LAGOS`
- Stage 5 — Delivery: `READY_FOR_PICKUP`, `PICKED_UP_COMPLETED`, `LOCAL_COURIER_ASSIGNED`, `IN_TRANSIT_TO_DESTINATION_CITY`, `OUT_FOR_DELIVERY_DESTINATION_CITY`, `DELIVERED_TO_RECIPIENT`

Exception statuses (`ON_HOLD`, `CANCELLED`, `RESTRICTED_ITEM_REJECTED`, `RESTRICTED_ITEM_OVERRIDE_APPROVED`) sit outside the stage model.

## 4. Advance button — next label

Fully deterministic from `statusV2 + transportMode + shipmentType`. The flow arrays in `status-transitions.ts` define exact order. Next status = `flow[flow.indexOf(currentStatusV2) + 1]`. The human label for any status is in `STATUS_LABELS` (e.g. `WAREHOUSE_VERIFIED_PRICED` → `"Verified & Priced"`). The FE can precompute the full mapping from those two files.

## 5. Advance button role gate

`PATCH /orders/:id/status` requires staff or superadmin. No `canManageShipmentBatches` flag involved — that permission only gates dispatch batch operations. One hard backend gate: transitioning to `READY_FOR_PICKUP` is blocked if `paymentCollectionStatus !== PAID_IN_FULL`.

## 6. Overflow menu actions and gating

| Action | Required role |
|---|---|
| Edit order fields | staff+ |
| Advance status | staff+ |
| Warehouse verify | staff+ |
| Set pickup rep | any authenticated (staff can set on any order) |
| Delete order (soft) | staff+ (there is no separate admin tier below superadmin in this system) |

No separate "disabled vs hidden" logic comes from the backend — the API returns 403 if the role doesn't qualify.

## 7. Staff vs superadmin menu

Same set of actions. The only things exclusively superadmin are: approve/reject receipt submissions, list all payments globally, and get a payment by ID. Everything else staff can do too.

## 8. Warehouse verify gating

`POST /orders/:id/warehouse-verify` requires staff+. No extra permission flag.

## 9. Package badge states

Packages themselves have no verification status field. The state comes from the order's `statusV2`:

- **Pending verify**: order is at `WAREHOUSE_RECEIVED` or `CLAIM_APPROVED_PENDING_BULK_PROCESSING`
- **Verified**: order is at `WAREHOUSE_VERIFIED_PRICED` or beyond
- Before the order arrives at warehouse (`PREORDER_SUBMITTED`, `AWAITING_WAREHOUSE_RECEIPT`), there is nothing to verify yet

## 10. Advance button blocked until warehouse verified

The block is purely sequential — the status flow enforces that `WAREHOUSE_VERIFIED_PRICED` must come before any transit status. There is no separate boolean flag. The backend returns 400/409 if you try to skip. An additional hard gate: `READY_FOR_PICKUP` is blocked until `paymentCollectionStatus = PAID_IN_FULL`.

## 11. Record offline payment — role

Staff+ (`requireStaffOrAbove`). Not superadmin-only.

## 12. "Mark as paid in full" checkbox

This is not a field in the payload — it is the default behavior. Every `POST /orders/:orderId/record-offline` call immediately sets the order to `PAID_IN_FULL`. There is no partial payment concept in the offline path. The checkbox the FE is showing is redundant — it is always effectively ticked. No backend change needed.

## 13. Receipt approval

It is at `POST /api/v1/payments/:paymentId/verify` with `{ decision: "approve" | "reject", note?: string }`. Superadmin only. The payment object includes `status: "pending"` and `proofReference` (the receipt URL) so the FE has everything needed to render an approve/reject UI on the Payment tab for superadmins.

## 14. Payment tab visibility

No payment-specific permission flag exists. `GET /payments/` (list all) and `GET /payments/:id` are superadmin-only. Recording offline payments is staff+. There is currently no staff-facing "list payments for this order" endpoint. If the Payment tab needs to show the order's payment history to staff, that endpoint needs to be added — raise it with the backend.

## 15. Final charge / Amount due / Declared value

All returned in the same order object to everyone who can access the order. No role-based field filtering on the backend. `amountDue` is computed: equals `finalChargeUsd` when `paymentCollectionStatus !== PAID_IN_FULL`, otherwise `null`.

## 16. Verify and Unpaid badges

- **Verify badge**: order is at `WAREHOUSE_RECEIVED` or `CLAIM_APPROVED_PENDING_BULK_PROCESSING` (arrived at warehouse, verification pending)
- **Unpaid badge**: `paymentCollectionStatus` is `UNPAID` or `PAYMENT_IN_PROGRESS` (i.e. not `PAID_IN_FULL`)

These are not API-returned badge fields — the FE derives them from `statusV2` and `paymentCollectionStatus`.

## 17. "Needs action" filter

There is no dedicated `needsAction` field or endpoint. The FE would need to define it as a combination of: orders with `flaggedForAdminReview = true` OR orders with a pending receipt submission (payment status `PAYMENT_IN_PROGRESS`) OR orders awaiting warehouse verify. The backend can filter on all of these but there is no single flag — define exactly which conditions should count and we can add a dedicated query param if needed.

## 18. Images — upload and delete roles

- Upload (presign + confirm): staff+ (`requireStaffOrAbove`)
- Delete: staff+ as well (`requireAdminOrAbove` = STAFF + SUPER_ADMIN in this system; there is no separate admin tier). If delete should be restricted to superadmin only, that is a one-line backend change — raise it.
