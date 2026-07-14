# GEX System Fix Tracker (Archived)

> Historical completion record. It is not an active work queue; use the current API, route schemas, and cross-repository reference for present work.

**42 / 42 resolved** — run `/review` once all boxes are checked.

Progress: `████████████████████` 100%

> Update the progress bar manually as phases complete, or check boxes in VS Code / GitHub.

---

## Phase 1 — Security
> Fix first. These affect live traffic and all three systems.

- [x] **[Critical · Backend]** `requireCaptcha` never applied — applied to `POST /newsletter/subscribe`, `/d2d/intake`, `/cars/:id/purchase-attempt` in `public.routes.ts`.
- [x] **[Critical · Landing]** Zero Turnstile CAPTCHA on landing page forms — `TurnstileWidget.jsx` added; token wired to D2D form (`ShipmentCalculator.jsx`) and newsletter (`Footer.jsx`); `publicApi.js` passes `cf-turnstile-response` header.
- [x] **[Important · Backend]** Public R2 presign endpoint had no auth and no CAPTCHA — `requireCaptcha` now applied to `POST /gallery/claims/presign`.
- [x] **[Important · Backend]** Internal login missing per-route rate limit — added `config: { rateLimit: { max: 5, timeWindow: '1 minute' } }` to `/auth/login` in `internal.routes.ts`.
- [x] **[Important · Backend]** Prometheus `/metrics` publicly accessible — protected by `x-metrics-token` header check in `app.ts`; `METRICS_TOKEN` env var added to `env.ts`.
- [x] **[Important · Dashboard]** JWT stored in `localStorage` — all occurrences replaced with `sessionStorage` in `AuthContext.tsx`.
- [x] **[Important · Dashboard]** Supplier session is memory-only — `persist` middleware with `createJSONStorage(() => sessionStorage)` added to `supplierAuth.store.ts`.

**Phase 1 progress: 7 / 7 ✓**

---

## Phase 2 — Missing Features
> Backend is built. Frontend has no entry point. These flows are completely dead.

- [x] **[Critical · Dashboard]** No leads management page — `LeadsPage` added with type/status filters, expandable rows, inline status dropdown, mark-converted, and delete. Accessible to staff, admin, superadmin.
- [x] **[Critical · Dashboard]** No newsletter subscriber admin — `NewsletterSubscribersPage` added with active/inactive filter, deactivate, delete, and CSV export. Accessible to superadmin only.
- [x] **[Critical · Dashboard]** Gallery shop section has no inquiry action — `ShopInquiryModal` wired into `GalleryPage` sales section. Backend `POST /leads/shop-inquiry` endpoint added.
- [x] **[Critical · Dashboard]** Customers cannot open shipment detail — `ROUTES.SHIPMENT_DETAIL` `allowedRoles` updated to include `'user'`.
- [x] **[Important · Dashboard]** No authenticated D2D intake path — `D2DMyRequestsPage` added with intake modal. Nav entry added to `CUSTOMER_NAV`. Leads linked to the authenticated user via `useAuthToken()`.
- [x] **[Critical · Landing]** Track and gallery pages show `UnavailableFeaturePage` — `TrackYourShipments.jsx` now re-exports the real `Track` component. `PublicGallery.jsx` replaced with full gallery: cars (purchase + Turnstile modal), sales (login-to-inquire), anonymous goods (login-to-claim).
- [x] **[Critical · Landing]** `/get-a-quote` `handleSubmit` is `console.log` only — wired to `publicApi.estimateShipment`, renders live cost estimate with transit time and disclaimer.

**Phase 2 progress: 7 / 7 ✓**

---

## Phase 3 — Dashboard Navigation & UX
> Pages are built but unreachable or incomplete for certain roles.

- [x] **[Important · Dashboard]** Batches and AdminGallery missing from all sidebar nav configs — added to `STAFF_NAV`, `ADMIN_NAV`, `SUPERADMIN_NAV` with `boxes` and `image` icons.
- [x] **[Important · Dashboard]** Delivery Schedule not in `CUSTOMER_NAV` — added with `calendar` icon.
- [x] **[Important · Dashboard]** Staff cannot browse the client list — `ROUTES.CLIENTS` `allowedRoles` updated to include `staff`.
- [x] **[Minor · Dashboard]** OperationsPage hard-coded at 100 orders — raised to 250, stale warning removed.
- [x] **[Minor · Dashboard]** `StaffOnboardingPage` missing `ProtectedRoute` wrapper — wrapped with `allowedRoles: ['staff', 'admin', 'superadmin']`.
- [x] **[Minor · Dashboard]** Settings reachable only from footer — added to `STAFF_NAV`, `ADMIN_NAV`, `SUPERADMIN_NAV` main nav.
- [x] **[Minor · Dashboard]** Gallery modals have no focus trap, no Escape key, no `aria-modal` — `AdminGalleryPage` shared `Modal` component and `GalleryPage` `ShopInquiryModal` both get Escape key, focus trap, auto-focus, backdrop click, and ARIA attributes.
- [x] **[Minor · Dashboard]** Supplier declarations capped at 50 — `SupplierDashboardPage` adds `limit` state with load-more button (increments by 50); button shown only when page is full.

**Phase 3 progress: 8 / 8 ✓**

---

## Phase 4 — Backend Correctness & Performance
> Error handling gaps and slow query patterns.

- [x] **[Important · Backend]** `escalateOrder` missing try/catch — try/catch added; validation errors now return 400. `orders.controller.ts`.
- [x] **[Important · Backend]** `resendPickupPin` missing try/catch — try/catch added; "Order not found" returns 404, other errors return 400. `orders.controller.ts`.
- [x] **[Important · Backend]** `getMyShipments` loads full order history before JS-paginating — replaced with a COUNT query + SQL `LIMIT`/`OFFSET`; JS slice removed. `orders.service.ts`.
- [x] **[Important · Backend]** `updateBatchStatus` N+1 per order — sequential `for` loop replaced with `Promise.allSettled`; all `updateOrderStatus` calls now run in parallel. `orders.service.ts`.
- [x] **[Important · Backend]** CSV bulk import N+1 per row — pre-fetch all email hashes with a single `inArray` query before the loop; per-row `await db.select()` removed. `bulk-import.service.ts`.
- [x] **[Minor · Backend]** `gallery_claims.claimant_user_id` FK column has no index — index added to schema and migration `2026-07-05_add_missing_indexes.sql`.
- [x] **[Minor · Backend]** `users.role` column has no index — index added to schema and migration `2026-07-05_add_missing_indexes.sql`.
- [x] **[Minor · Backend]** Gallery claims list endpoint has no cursor pagination — `page` param added; response now returns `{ data, total, page, totalPages }`. Dashboard types, service, hook, and ClaimsTab updated.

**Phase 4 progress: 8 / 8 ✓**

---

## Phase 5 — Landing Page Content
> Publicly visible issues that damage credibility or break user flows.

- [x] **[Important · Landing]** Blog shows 30 generic placeholder posts — `blogData.js` replaced with 12 logistics-relevant posts (air freight, sea freight, customs, CBM, D2D, etc.). `Blogs.jsx` home preview updated to match.
- [x] **[Important · Landing]** All 5 social media links are `"#"` — `SOCIAL_LINKS` values set to `""` in `siteData.js`; footer now conditionally renders icons only when the URL is set.
- [x] **[Important · Landing]** No contact form on the contact page — `GetInTouch.jsx` now has a name/email/phone/message form with Turnstile and success state. Backend: `'general_inquiry'` added to `inbound_lead_type` enum, migration `2026-07-05_add_general_inquiry_lead_type.sql`, `leadsService.submitGeneralInquiry`, `POST /public/contact` route. `publicApi.submitContactInquiry` wired in the landing page.
- [x] **[Important · Landing]** D2D intake form depends on `countriesnow.space` — `NIGERIA_STATES` static constant added; states `useState` initialised with the static list; the API fetch `useEffect` for states removed. Cities still use the API (less critical).
- [x] **[Important · Landing]** Hero images hotlinked from Pexels/Unsplash — `backgroundColor: "#0d1f35"` fallback added to all `backgroundImage` slides in `HomeHero.jsx`, `AboutHero.jsx`, `Clients.jsx`, `HoverCards.jsx`; `onError` hide added to `HomeAbout.jsx` `<img>`.

**Phase 5 progress: 5 / 5 ✓**

---

## Phase 6 — Landing Page Performance
> Bundle size, image weight, and load-time optimisations.

- [x] **[Important · Landing]** 397KB single JS bundle — `vite.config.js` now has `manualChunks` for `react-vendor`, `router`, `icons`; all 10 non-home routes converted to `React.lazy` + `<Suspense>` in `App.jsx`. Each route is now a separate JS chunk.
- [x] **[Important · Landing]** 3 uncompressed PNG assets over 1MB each — `store.png` and `HeroAbout.png` deleted (confirmed orphaned). `service.png` and `customer.png` converted to WebP via `sharp-cli`: `service.webp` 34KB (from 1.1MB, -97%), `customer.webp` 66KB (from 1.8MB, -96%). `ServiceHero.jsx` and `GetInTouch.jsx` imports updated.
- [x] **[Minor · Landing]** Dead `AuthContext.jsx` included in the bundle — `AuthContext.jsx`, `auth-context.js`, `userApi.js` all deleted (confirmed no imports anywhere).
- [x] **[Minor · Landing]** `/customer.png` loaded from `/public`, bypassing Vite content hashing — moved to `src/assets/customer.png`, `GetInTouch.jsx` now imports it as a module.
- [x] **[Minor · Landing]** `DASHBOARD_URL` hardcodes production URL as a source-code fallback — `vite.config.js` now throws at build time when `VITE_DASHBOARD_URL` is unset in production mode.
- [x] **[Minor · Landing]** `ShipmentCalculator.jsx` is 1616 lines — refactored into `src/pages/ShipmentCalculator/` directory: `utils.js` (constants + pure helpers), `EstimateResult.jsx`, `IntakeResult.jsx`, `D2DIntakeForm.jsx`, `ErrorToast.jsx`, `index.jsx` (~320 lines). All behaviour preserved; production build verified.
- [x] **[Minor · Landing]** Below-fold images missing `loading="lazy"` — added to `Blogs.jsx` (ship1–4), `BlogPosts.jsx` (post thumbnails), `Quote.jsx` (calculate.png), `HomeAbout.jsx` (achievement image). `service.png` is a CSS `backgroundImage` and does not support the attribute.

**Phase 6 progress: 7 / 7 ✓**

---

## Summary

| Phase | Area | Items | Done |
|---|---|---|---|
| 1 | Security | 7 | 7 ✓ |
| 2 | Missing Features | 7 | 7 ✓ |
| 3 | Dashboard Nav & UX | 8 | 8 ✓ |
| 4 | Backend Correctness & Performance | 8 | 8 ✓ |
| 5 | Landing Page Content | 5 | 5 ✓ |
| 6 | Landing Page Performance | 7 | 7 ✓ |
| **Total** | | **42** | **42** |
