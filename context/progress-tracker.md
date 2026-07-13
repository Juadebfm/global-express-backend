# Progress Tracker

---

## 🟢 Current Sprint — Tracking Overhaul + Flow 1

> **Goal:** Ship unified customer-facing tracking numbers, sea carrier document support, and customer-initiated bookings with supplier notification.

```
Phase 1 — Schema migration          ████████████████████ 100%  ✅ done
Phase 2 — Tracking number logic     ████████████████████ 100%  ✅ done
Phase 3 — Sea carrier info + docs   ████████████████████ 100%  ✅ done
Phase 4 — Flow 1: customer booking  ████████████████████ 100%  ✅ done
Phase 5 — Code review fixes         ████████████████████ 100%  ✅ done
```

### Phase 1 — Schema ✅
- [x] `dispatch_batches` → added `bill_of_lading_number`, `vessel_name`
- [x] `orders` → added `sourcing_supplier_id`, `sourcing_supplier_name`, `sourcing_supplier_phone`, `sourcing_supplier_email`
- [x] New `batch_documents` table (MAWB / BL / container photo / vessel photo / other)
- [x] Migration file: `2026-06-24_tracking_overhaul_and_flow1.sql`

### Phase 2 — Tracking Number Logic ✅
- [x] `generateTrackingNumber()` → `YYYYMMDD-NNNN` (customer-facing and used on legitimate orders at creation)
- [x] `generateSlotTrackingNumber(batchCreatedAt, position)` → `YYYYMMDD-NNNN`
- [x] `generateMasterTrackingNumber(mode, batchCreatedAt, yearSeq)` → `AIR/SEA-YYYYMMDD-NNNN`
- [x] `nextMasterSequence(mode)` → count batches by mode + year for NNNN sequence
- [x] Slot creation → assign positional tracking on customer add
- [x] `maskTrackingNumber()` → handle new `YYYYMMDD-NNNN` format

### Phase 3 — Sea Carrier Info + Documents ✅
- [x] `updateBatchCarrierInfo` → accepts `billOfLadingNumber`, `vesselName`
- [x] Route schema (`PATCH /batches/:id/carrier-info`) → includes new sea fields
- [x] `mapBatch()` in both services → exposes `billOfLadingNumber`, `vesselName`
- [x] `POST /batches/:id/documents/presign` → R2 presigned PUT URL (staff+)
- [x] `POST /batches/:id/documents/confirm` → persist document record (staff+)
- [x] `GET /batches/:id/documents` → list batch documents (staff+)

### Phase 4 — Flow 1: Customer Booking with Supplier ✅
- [x] `POST /orders` body → optional `sourcingSupplier` object (`supplierId` | `name`/`phone`/`email`)
- [x] `createOrder()` → writes `sourcingSupplier*` fields to DB
- [x] Supplier notification (fire-and-forget): known GEX account → in-app + email + WhatsApp; external → email + WhatsApp
- [x] `sendSupplierBookingRequestEmail` + `sendSupplierBookingRequestWhatsApp` added to notification utilities
- [x] `getCustomerRequestsForSupplier(supplierId)` service method
- [x] `GET /supplier/orders/requests` → list orders where `sourcingSupplierId = me`
- [x] `orderResponseSchema` → exposes all four `sourcingSupplier*` fields

### Phase 5 — Code Review Fixes ✅
- [x] **#1 Race condition** — slot counter is now an atomic `UPDATE … SET slot_counter = slot_counter + 1 RETURNING` on `dispatch_batches`; unique constraint `(batch_id, primary_tracking_number)` added to `batch_customer_slots`
- [x] **#2 sourcingSupplier validation** — `superRefine` rejects `supplierId` + `name/phone/email` together; also rejects an empty object
- [x] **#3 Silent notification drop** — `console.error` logged when `sourcingSupplierId` user record not found
- [x] **#4 R2 path** — batch documents now use `batches/{batchId}/…` scope (was `orders/batches/{batchId}/…`)
- [x] **#5 Architecture violation** — document endpoints moved to `batchesController`; audit log written on confirm
- [x] **#6 Missing batch existence check** — `confirmBatchDocumentUpload` and `listBatchDocuments` return typed error codes instead of throwing FK errors
- [x] **#7 r2Key not bound to batch** — confirm validates `r2Key.startsWith('batches/{batchId}/')` before inserting
- [x] **#9 Tracking date timezone** — `getDate/Month/FullYear` → `getUTCDate/UTCMonth/UTCFullYear` in `tracking.ts`
- [x] **#10 Supplier PII leak** — `getCustomerRequestsForSupplier` returns a projection (no PII, no financials); route schema uses explicit Zod shape
- [x] **#10a nextMasterSequence duplicated** — removed from `batches.service.ts`, now imported from `dispatch-batches.service.ts`
- [x] Migration: `2026-06-24_review_fixes.sql`

---

## 📐 Decisions Locked In

| # | Decision | Outcome |
|---|---|---|
| 1 | Individual tracking format | `YYYYMMDD-NNNN` — customer-facing across orders and public gallery items |
| 2 | When tracking is assigned | At record creation for legitimate orders; slot tracking also stays `YYYYMMDD-NNNN` |
| 3 | Master batch tracking | `AIR-YYYYMMDD-NNNN` / `SEA-YYYYMMDD-NNNN` — sequential per mode per calendar year |
| 4 | Batch date in tracking | Batch creation date |
| 5 | Year counter reset | Resets every January 1st |
| 6 | Existing tracking numbers | Backfilled via migration into `YYYYMMDD-NNNN` where needed |
| 7 | Carrier info visibility | Internal only — customers never see MAWB, container number, flight, vessel |
| 8 | Supplier on booking | Known (GEX account) → FK; New → inline name/phone/email |
| 9 | Supplier notification | Notification only, no confirmation/accept required |
| 10 | User-facing term | "Shipment" replaces "pre-order" in all user-facing surfaces |

---

## 🗺️ Domain Research (Completed)

```
Sea freight (LCL) domain model      ████████████████████ done ✅
Air freight consolidation model     ████████████████████ done ✅
```

**Key findings locked in:**
- GEX is the NVOCC / consolidator — issues HBL/HAWB to customers, receives MBL/MAWB from carrier
- Three valid intake flows: customer-led (primary), supplier-led, walk-in
- `c/o` on manifest = supplier shipped goods on behalf of customer
- Nigerian customs (PAAR, Form M) is handled externally — out of scope for this software
- Air and sea follow the same software domain model — just different mode flags and document names

---

## ✅ Platform Coverage (Stable)

### Core API
| Feature | Status |
|---|---|
| Fastify bootstrap + Zod validation | ✅ |
| Swagger / OpenAPI | ✅ |
| Problem Details errors (RFC 7807) | ✅ |
| WebSocket support | ✅ |
| Metrics + optional tracing | ✅ |

### Auth & Access
| Feature | Status |
|---|---|
| Clerk customer auth | ✅ |
| Internal JWT (staff/admin/supplier) | ✅ |
| MFA for internal operators | ✅ |
| Role-based route guards | ✅ |
| IP allowlist for admin routes | ✅ |
| JWT revocation | ✅ |

### Shipping Operations
| Feature | Status |
|---|---|
| Order creation (staff + customer) | ✅ |
| Public tracking | ✅ |
| Warehouse verification | ✅ |
| V2 status machine (28 statuses) | ✅ |
| Package-level data capture | ✅ |
| Milestone customer notifications | ✅ |

### Dispatch & Batches
| Feature | Status |
|---|---|
| Batch creation + reuse | ✅ |
| Customer slot management | ✅ |
| Batch approval / cutoff flows | ✅ |
| Move goods between batches | ✅ |
| Batch manifest download | ✅ |
| Sequential tracking numbers | ✅ |
| Sea carrier document uploads | ✅ |

### Pricing & Payments
| Feature | Status |
|---|---|
| Pricing engine (air tiers + sea CBM) | ✅ |
| Customer overrides + DB rules | ✅ |
| Draft / final invoice lifecycle | ✅ |
| Paystack online payments | ✅ |
| Offline bank transfer receipts | ✅ |
| Idempotency on create endpoints | ✅ |

### Supplier & Flow 1
| Feature | Status |
|---|---|
| Supplier declarations (Flow 2) | ✅ |
| Staff review + accept / reject | ✅ |
| Declaration → order conversion | ✅ |
| Customer-initiated booking (Flow 1) | ✅ |
| Supplier notification on booking | ✅ |
| Supplier: view customer requests | ✅ |

### Notifications & Support
| Feature | Status |
|---|---|
| In-app notifications (personal + broadcast) | ✅ |
| Browser push (VAPID) | ✅ |
| Email via Resend | ✅ |
| WhatsApp via Termii | ✅ |
| Support tickets + messages | ✅ |

### Security
| Feature | Status |
|---|---|
| AES-256-GCM column encryption | ✅ |
| CAPTCHA (Cloudflare Turnstile) | ✅ |
| Webhook signature verification | ✅ |
| Security event logging | ✅ |
| Login lockout + rate limiting | ✅ |
| Optional AV scanning | ✅ |

---

## ⚠️ Known Drift / Risks

- Some older docs outside `context/` still reference legacy response envelopes and a 3-role model
- `context/` stays summary-level — code + route schemas are always source of truth
- Batch counter for new tracking format needs a DB query by mode + year — must be atomic to avoid race conditions on concurrent batch creation

---

## 📌 Session Notes

- Start new sessions by reading: `context/project-overview.md`, `context/code-standards.md`, relevant `src/routes/*` + `src/services/*` + `drizzle/schema/*`
- Docker local dev: `docker compose up --build` → `http://localhost:3000`
- Swagger docs: `http://localhost:3000/docs`
- No `Co-Authored-By` trailers in commits
