# Global Express Cross-Repository Reference

Last updated: 2026-07-14

This document is the shared handover reference for the Global Express backend, customer dashboard, and public website. It records the current implemented direction and verified local integration state. It intentionally contains no credentials or environment values.

## Repositories and Ownership

| Repository | Local path | Owns |
| --- | --- | --- |
| Backend | `/Users/macbookpro/Documents/GitHub/global-express-backend` | API, database, authentication, operational workflows, public contracts |
| Dashboard | `/Users/macbookpro/Documents/GitHub/global-express-dashboard` | Customer, supplier, staff, and superadmin application |
| Public website | `/Users/macbookpro/Documents/GitHub/global-express-landing-page` | Marketing pages, calculator, public shop, and anonymous package-claim entry point |

The backend is the contract and data source of truth. Route schemas, services, and Drizzle schema take precedence if this document ever drifts from implementation.

## System Shape

```text
Public website                 Customer / supplier / staff dashboard
       |                                      |
       +----------- REST API / WebSocket -----+
                              |
                         Backend + Postgres
                              |
           Orders, packages, batches, invoices, payments,
          shop listings, gallery claims, leads, notifications
```

The public site is intentionally not a second dashboard. It provides public-safe browsing, estimation, tracking, public intake, and limited inquiry forms. Identity-sensitive and operational actions continue in the dashboard.

## Locked Business Decisions

### Tracking numbers

- Every legitimate order receives an individual tracking number at creation: `YYYYMMDD-NNNN`.
- Dispatch batches use master numbers: `AIR-YYYYMMDD-NNNN` or `SEA-YYYYMMDD-NNNN`.
- Public anonymous-package and shop references use the same individual tracking-number convention, masked where public disclosure is required.
- `TEMP-*` is not the normal format for legitimate orders.

### Access and roles

- Customers authenticate through Clerk.
- Staff, superadmins, and suppliers authenticate with the backend internal JWT flow.
- Public routes expose only deliberately public-safe fields.
- Internal routes retain role checks and ownership checks; a customer cannot obtain staff or supplier capabilities by navigating to a route.

### Public shop and package claims

- `Shop` and `Claim a Package` are separate user journeys.
- Vehicles are public, inquiry-first listings. Submitting a vehicle inquiry is not a reservation, purchase, hold, support ticket, or shipment creation.
- Regular sale items are public to browse, but a signed-in dashboard user submits the inquiry.
- Anonymous package claims remain an ownership-recovery workflow, separate from sales.
- Public calls-to-action use truthful language: `Make an Inquiry` for vehicles, `Sign in to Inquire` for regular items, and `Claim` / `Sign in to Claim` for anonymous goods.

## Public Shop Contract

### Backend endpoints used by the public website

| Purpose | Endpoint | Auth | Result |
| --- | --- | --- | --- |
| List vehicles | `GET /api/v1/public/shop/vehicles` | Public | Published, currently available vehicle listings |
| List general items | `GET /api/v1/public/shop/items` | Public | Published, currently available general-item listings |
| Vehicle inquiry | `POST /api/v1/public/shop/vehicles/:listingId/inquiries` | Public + Turnstile | Creates an inbound lead and shop-interest record; staff are notified |
| General-item inquiry | `POST /api/v1/shop/items/:listingId/inquiries` | Customer auth | Creates a shop-interest record; staff are notified |
| Anonymous goods list | `GET /api/v1/public/gallery` | Public | Includes public-safe anonymous-goods rows for the claim page |
| Anonymous ownership claim | `POST /api/v1/gallery/anonymous/:trackingNumber/claim` | Customer auth | Creates an ownership claim for staff review |

The public site must use the dedicated `/public/shop/*` endpoints for Shop. Do not reintroduce legacy gallery sales feeds or car-purchase claim endpoints into the new Shop flow.

### Database model

- `shop_listings` is the canonical public-shop listing record.
- `shop_vehicle_details` and `shop_item_details` hold type-specific fields.
- `shop_interest_requests` records inquiry lifecycle: `new`, `contacted`, `qualified`, `hold_offered`, `converted`, or `closed`.
- `shop_holds` represents staff-controlled holds only. A public inquiry does not automatically create one.
- `inbound_leads` captures public vehicle-contact intake and is linked to the related shop interest request.
- `gallery_items` and `gallery_claims` remain the canonical model for anonymous ownership claims.

## Current Frontend Behavior

### Public website

- `/shop` is split into `Cars Available` and `Shop Listings`.
- Vehicle cards show a public inquiry form with Turnstile and an in-place success state after a successful submission.
- General item cards direct a visitor to dashboard sign-in before inquiry.
- Listing cards provide a usable fallback when an image is absent or fails to load.
- Shop section skeletons and the claim-table skeleton are present; the claim skeleton uses darker gray placeholders and a short minimum display interval so it is visible during normal local loading.
- `/claim-a-package` uses the same site page frame and horizontal spacing as the standard public pages. It is a compact table with image, package, masked tracking, and action columns.
- The claim action redirects the visitor to dashboard sign-in; ownership claims are submitted only from the authenticated dashboard flow.

### Dashboard

- Unauthenticated visitors are redirected to sign-in.
- Customer admins can access their dashboard and create a booking.
- Supplier users can access the goods-notice flow.
- A staff user is correctly denied restricted reports without the needed permission.
- Batch and dashboard data now load after the dispatch-batch schema reconciliation.
- The supplier address-book page currently preloads the supplier-only validation-request query even for customers. The backend returns an empty paginated read result for non-suppliers to keep the page stable; the cleaner future dashboard change is to fetch that query only on the supplier-only tab / for supplier users.

## Recent Backend Reconciliation

The following backend reconciliation shipped in commit `e144a63` (`fix: reconcile dashboard backend integration`):

- `drizzle/migrations/2026-07-14_orders_schema_reconciliation.sql` reconciles expected order and warehouse schema fields in databases that missed earlier migrations.
- `drizzle/migrations/2026-07-14_dispatch_batches_schema_reconciliation.sql` adds the missing actual-journey fields on `dispatch_batches` with idempotent `IF NOT EXISTS` statements.
- `src/controllers/users.controller.ts` safely returns an empty validation-request list to a non-supplier read, while supplier-only mutation remains protected.
- `src/app.ts` includes local-development CORS support for localhost dashboard and public-site origins.

The dispatch-batch reconciliation fixed the staff dashboard error caused by a database missing `actual_departure_at`.

## Verified Local Integration State

Verified on 2026-07-14 against the local backend:

- Backend typecheck passes: `npm run typecheck`.
- Staff dashboard, orders, shipments, notifications, and open-batches API reads returned `200`.
- Customer supplier-validation read returned `200` with an empty paginated result instead of a spurious `403`.
- Browser smoke checks confirmed unauthenticated redirect, customer dashboard access, staff permission denial, customer booking form, and supplier goods-notice form.
- Backend WebSocket authentication connected successfully in container logs.

This confirms the tested paths are working locally. It is not a substitute for a final mobile/responsive visual QA pass or a production deployment check.

## Local Startup Reference

1. Start the backend from the backend repository with Docker Compose, then apply committed database migrations.
2. Set each frontend's `VITE_API_BASE_URL` to the local backend API URL ending in `/api/v1`.
3. Set the public website's `VITE_DASHBOARD_URL` to the dashboard origin.
4. Set the dashboard's `VITE_PUBLIC_APP_URL` to the public-site origin when generating public links.
5. Start the dashboard and public website in separate terminals. Both are Vite apps and default to port `5173`, so one must use a different port when they run concurrently.

Never copy values from `.env` files into documentation or source control. Use the corresponding `.env.example` files as the setup template.

## Remaining Work

- Add dashboard UI/endpoint coverage for progressing shop interest statuses and for staff-controlled holds. The data model exists; the dedicated operational workflow is not yet exposed as a complete staff shop-management surface.
- Update the dashboard supplier page so supplier-only validation data is fetched only when relevant, rather than relying on the backend compatibility empty state.
- Complete responsive visual QA for the public Shop and Claim pages at desktop, tablet, and mobile widths.
- Run a production-style smoke test after deployment: public vehicle inquiry with a real Turnstile token, signed-in general-item inquiry, anonymous package claim, and staff lead/claim review.

## Useful Source Documents

- Backend API reference: `API_ENDPOINTS.md`
- Archived public website migration notes: `docs/archive/public-website-api-endpoint-changes.md`
- Backend tracking and overall progress: `context/progress-tracker.md`
- Backend public-shop design history: `context/public-shop-build-checklist.md`
- Dashboard rebuild specification: `docs/FE_REBUILD_SPEC.md` in the dashboard repository
- Public website migration history: `docs/public-website-api-migration-checklist.md` in the public-website repository (historical; verify against the backend API reference)
