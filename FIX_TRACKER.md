# GEX System Fix Tracker

**7 / 42 resolved** — run `/review` once all boxes are checked.

Progress: `███░░░░░░░░░░░░░░░░░` 17%

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

- [ ] **[Critical · Dashboard]** No leads management page — every D2D intake and shop inquiry lead lands in the DB but staff have no UI to view, filter, assign, or act on it. `GET/PATCH /api/v1/leads` are live with no dashboard.
- [ ] **[Critical · Dashboard]** No newsletter subscriber admin — superadmin cannot view, export, deactivate, or delete subscribers. The subscribe form works; the resulting list is unmanageable.
- [ ] **[Critical · Dashboard]** Gallery shop section has no inquiry action — `GalleryPage` renders the `sales` section with no `renderActions` prop. The entire Phase 5 `shop_inquiry` lead type has no frontend entry point.
- [ ] **[Critical · Dashboard]** Customers cannot open shipment detail — `ROUTES.SHIPMENT_DETAIL` blocks the `user` role. Customers see a list but cannot view photos, measurements, payment status, or a per-shipment timeline.
- [ ] **[Important · Dashboard]** No authenticated D2D intake path — logged-in customers who use the public form create unlinked leads with no account association and no "My D2D requests" section in their dashboard.
- [ ] **[Critical · Landing]** Track and gallery pages show `UnavailableFeaturePage` — a fully working `Track.jsx` (calls backend, renders timeline, handles 404) sits unused. All gallery endpoints are integrated in `publicApi.js` but the page is disabled.
- [ ] **[Critical · Landing]** `/get-a-quote` `handleSubmit` is `console.log` only — the primary CTA on the Services page submits silently and does nothing.

**Phase 2 progress: 0 / 7**

---

## Phase 3 — Dashboard Navigation & UX
> Pages are built but unreachable or incomplete for certain roles.

- [ ] **[Important · Dashboard]** Batches and AdminGallery missing from all sidebar nav configs — neither `STAFF_NAV`, `ADMIN_NAV` nor `SUPERADMIN_NAV` list these routes. Staff must know the URL.
- [ ] **[Important · Dashboard]** Delivery Schedule not in `CUSTOMER_NAV` — the page has the correct guard but is absent from the sidebar. Customers must know the direct URL to reach it.
- [ ] **[Important · Dashboard]** Staff cannot browse the client list — `ROUTES.CLIENTS` is blocked for staff role. Staff can only reach a workbench via inline links; they cannot search or paginate clients independently.
- [ ] **[Minor · Dashboard]** OperationsPage hard-coded at 100 orders with no pagination — `useOrders(1, 100)` with a "Showing first 100" warning. Orders beyond position 100 are silently missed.
- [ ] **[Minor · Dashboard]** `StaffOnboardingPage` missing `ProtectedRoute` wrapper — relies on an internal effect redirect instead of the consistent guard used by every other protected page.
- [ ] **[Minor · Dashboard]** Settings reachable only from footer — should appear in the main sidebar nav for operator roles, not just the footer.
- [ ] **[Minor · Dashboard]** Gallery modals have no focus trap, no Escape key, no `aria-modal` — not keyboard or screen-reader accessible. Affects both `GalleryPage` and `AdminGalleryPage`.
- [ ] **[Minor · Dashboard]** Supplier declarations capped at 50 with no pagination — `useSupplierDeclarations({ limit: 50 })`, no load-more. Older records are silently hidden.

**Phase 3 progress: 0 / 8**

---

## Phase 4 — Backend Correctness & Performance
> Error handling gaps and slow query patterns.

- [ ] **[Important · Backend]** `escalateOrder` missing try/catch — service throws `Error('Only ON_HOLD orders...')` which propagates as 500 instead of 400. `orders.controller.ts:562`.
- [ ] **[Important · Backend]** `resendPickupPin` missing try/catch — service throws `Error('Order not found')` which becomes 500 instead of 404. Route declares a 404 schema that can never fire. `orders.controller.ts:696`.
- [ ] **[Important · Backend]** `getMyShipments` loads full order history before JS-paginating — SQL query at `orders.service.ts:1276` has no `LIMIT` or `OFFSET`. All rows fetched and decrypted in memory on every page request.
- [ ] **[Important · Backend]** `updateBatchStatus` N+1 per order — one sequential `updateOrderStatus` call per order row (250–400 DB roundtrips for a 50-order batch). `orders.service.ts:624`.
- [ ] **[Important · Backend]** CSV bulk import N+1 per row — one `SELECT` per row to check existing email hashes. Should use a single `WHERE email_hash = ANY(...)`. `bulk-import.service.ts:297`.
- [ ] **[Minor · Backend]** `gallery_claims.claimant_user_id` FK column has no index — sequential scan on every "my claims" query as the table grows.
- [ ] **[Minor · Backend]** `users.role` column has no index — frequent `WHERE role = 'staff'` filters do full table scans across multiple services.
- [ ] **[Minor · Backend]** Gallery claims list endpoint has no cursor pagination — hard max of 200 results with no page/offset param. No path to retrieve older claims.

**Phase 4 progress: 0 / 8**

---

## Phase 5 — Landing Page Content
> Publicly visible issues that damage credibility or break user flows.

- [ ] **[Important · Landing]** Blog shows 30 generic placeholder posts — titles like "Migrating to Linear 101" are publicly visible and damage credibility for a logistics company.
- [ ] **[Important · Landing]** All 5 social media links are `"#"` — YouTube, Facebook, Twitter, Instagram, LinkedIn in the footer all navigate to the top of the current page.
- [ ] **[Important · Landing]** No contact form on the contact page — `GetInTouch.jsx` shows addresses and a mailto link only. Primary B2B enquiry path is missing.
- [ ] **[Important · Landing]** D2D intake form depends on `countriesnow.space` — a free community API with no uptime guarantee. When it's down, delivery state/city dropdowns fail. The 36 Nigerian states should be a static constant.
- [ ] **[Important · Landing]** Hero images hotlinked from Pexels/Unsplash — large unoptimised JPEGs from third-party CDNs with no fallback. If rate-limited or removed, the hero is blank.

**Phase 5 progress: 0 / 5**

---

## Phase 6 — Landing Page Performance
> Bundle size, image weight, and load-time optimisations.

- [ ] **[Important · Landing]** 397KB single JS bundle — `vite.config.js` has no `React.lazy`, no `manualChunks`. Every home page visitor downloads the full D2D form, calculator, and gallery components.
- [ ] **[Important · Landing]** 3 uncompressed PNG assets over 1MB each — `store.png` (1.2MB), `service.png` (1.1MB), `HeroAbout.png` (1.1MB). WebP conversion at equivalent quality would cut each under 300KB.
- [ ] **[Minor · Landing]** Dead `AuthContext.jsx` included in the bundle — `AuthProvider` is never mounted in `App.jsx`. `userApi.js` is also unreferenced. Both add to bundle weight unnecessarily.
- [ ] **[Minor · Landing]** `/customer.png` loaded from `/public`, bypassing Vite content hashing — cache is never busted on update. Should be imported as a module.
- [ ] **[Minor · Landing]** `DASHBOARD_URL` hardcodes production URL as a source-code fallback — `siteData.js:1`. Missing env var silently resolves to prod instead of throwing at build time.
- [ ] **[Minor · Landing]** `ShipmentCalculator.jsx` is 1616 lines — form state, location API, rate display, toast system, and result rendering all in one file.
- [ ] **[Minor · Landing]** Below-fold images missing `loading="lazy"` — `service.png`, `HeroAbout.png`, and blog thumbnails are downloaded immediately on page load.

**Phase 6 progress: 0 / 7**

---

## Summary

| Phase | Area | Items | Done |
|---|---|---|---|
| 1 | Security | 7 | 7 ✓ |
| 2 | Missing Features | 7 | 0 |
| 3 | Dashboard Nav & UX | 8 | 0 |
| 4 | Backend Correctness & Performance | 8 | 0 |
| 5 | Landing Page Content | 5 | 0 |
| 6 | Landing Page Performance | 7 | 0 |
| **Total** | | **42** | **7** |
