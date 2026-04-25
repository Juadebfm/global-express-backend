# Anonymous Claim Approval -> Shipping Implementation Checklist

## 1) Claim Review API Extension
- [x] Extend `PATCH /api/v1/gallery/claims/:id/review` request body:
  - [x] `postApprovalAction`: `create_shipment` | `approve_only`
  - [x] `shipmentType`: `air` | `ocean` | `d2d` (required when `create_shipment`)
  - [x] `d2dDispatchMode`: `air` | `sea` (required when `shipmentType=d2d`)
- [x] Keep existing `decision` and `note` support
- [x] Extend response payload with optional shipment details:
  - [x] `orderId`
  - [x] `orderTrackingNumber`
  - [x] `dispatchBatchId`
  - [x] `dispatchMasterTrackingNumber`

## 2) Approval -> Shipment Orchestration
- [x] Add dedicated gallery->ops orchestration method in service layer
- [x] Trigger shipment creation only for approved `ownership` claims
- [x] Use approved claimant as `orders.senderId`
- [x] Build created shipment package from gallery metadata:
  - [x] description
  - [x] weight
  - [x] dimensions
  - [x] cbm
  - [x] warehouse received date
  - [x] shipmentType
  - [x] optional supplierId
  - [x] image references
- [x] If metadata supplier is missing/invalid, create shipment with `order_packages.supplier_id = null`
- [x] Batch routing:
  - [x] `air` -> next open air batch
  - [x] `ocean` -> next open sea batch
  - [x] `d2d` -> reviewer-selected mode (`air`/`sea`) batch
- [x] Enforce all-or-nothing transaction for:
  - [x] claim update
  - [x] gallery item update
  - [x] shipment + package creation
  - [x] batch linkage

## 3) New Shipment Status
- [x] Add `CLAIM_APPROVED_PENDING_BULK_PROCESSING` to DB enum migration (`shipment_status_v2`)
- [x] Add same status to TypeScript enum(s)
- [x] Add status label mapping
- [x] Add customer tracking mapping
- [x] Update status transition flow to allow progression into normal lifecycle

## 4) Seed & Metadata Readiness
- [x] Update anonymous goods seeding to 24 items total
  - [x] 8 air
  - [x] 8 ocean
  - [x] 8 d2d
- [x] Ensure seeded anonymous metadata includes operational fields needed for auto-shipment
- [x] Include supplierId on subset and no supplierId on others

## 5) Verification
- [x] Manual/API check: approve with `create_shipment` for air creates shipment + links air batch
- [x] Manual/API check: approve with `create_shipment` for ocean creates shipment + links sea batch
- [x] Manual/API check: approve with `create_shipment` for d2d requires `d2dDispatchMode` and links chosen batch
- [x] Manual/API check: missing supplier metadata still creates shipment
- [x] Manual/API check: failure path rolls back approval changes
- [x] Manual/API check: `approve_only` does not create shipment
- [x] Run typecheck/tests and capture any follow-up fixes
