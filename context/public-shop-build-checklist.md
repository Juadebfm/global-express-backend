# Public Shop Build Checklist

## Purpose

This document captures the agreed direction for the public `Shop` experience on the Global Express landing page and the backend support it needs.

The goal is to avoid treating every public listing the same.

We are intentionally splitting the public experience into distinct flows:

1. `Cars / Vehicles`
2. `Regular sale items`
3. `Anonymous package claims`

`Claim a Package` remains a separate ownership-recovery flow and should not be merged back into `Shop`.

---

## Research Summary

### What similar platforms do

#### Vehicle-export platforms

Examples reviewed:

- BE FORWARD
- SBT Japan

Common patterns:

- Strong inventory-first browsing
- Structured filters before deep engagement
- Clear stock state
- Public browsing without forced login
- Inquiry or reservation CTA near each vehicle
- Vehicle cards carry more structured data than normal product cards

### Forwarding / assisted-shopping platforms

Examples reviewed:

- MyUS
- Stackry

Common patterns:

- Clear intent separation
- Assisted-buy or inquiry flows instead of pretending to be full checkout
- Public trust-building first
- Login happens when the user wants to act, not just browse

### Key takeaway for Global Express

The public shop should not be one undifferentiated listing wall.

It should present:

- `Cars Available` as a public inquiry-first inventory surface
- `Shop Listings` as a lighter public catalog with sign-in-to-inquire
- `Claim a Package` as a separate recovery workflow

---

## Agreed UX Direction

### 1. Cars section

Public user can:

- See available vehicles
- See preview image
- See title, short description, price
- Submit a vehicle inquiry without creating an account first

This works because car interest is a lead-generation flow, not an instant checkout flow.

### 2. Regular sale items section

Public user can:

- Browse listings
- See preview image
- See title, short description, price

But to act, they should:

- Sign in to inquire

This keeps the workflow lighter and consistent with dashboard ownership of serious purchase handling.

### 3. Claim a Package page

Public user can:

- View visible anonymous package rows
- See masked tracking reference
- See preview image
- Sign in to claim if it looks like theirs

This should remain operationally separate from shopping.

---

## Copy Direction

### Core principle

Public CTA copy should match the real operational outcome.

We should avoid wording that sounds like ecommerce checkout if the action really creates a staff follow-up lead.

### Recommended copy standard

#### Vehicles

Preferred CTA direction:

- `Make an Inquiry`
- `Request This Vehicle`
- `Get Vehicle Details`

Only use stronger wording like:

- `Reserve This Car`
- `Request Reservation`

if the backend and staff workflow actually support reservation handling.

### Regular sale items

Preferred CTA direction:

- `Sign in to Inquire`
- `Sign in for Details`

These are clearer than implying an immediate self-serve purchase if fulfillment still depends on staff review or dashboard follow-up.

### Anonymous package claims

Preferred CTA direction:

- `Claim`
- `Sign in to Claim`

This is already aligned with the recovery workflow and should stay operational, not sales-oriented.

### Current wording note

`Express Interest` is understandable, but it is softer and less industry-specific than the patterns commonly used on vehicle-export and inquiry-driven commerce platforms.

The current direction is to replace it with more standard inquiry-led wording.

Best default:

- `Make an Inquiry`

Vehicle-specific alternative if we want slightly stronger product clarity without implying reservation:

- `Request This Vehicle`

---

## Copy Checklist

- [ ] Decide final CTA wording for vehicle cards
- [ ] Ensure vehicle CTA matches actual backend outcome
- [ ] Ensure regular item CTA does not imply instant checkout
- [ ] Ensure claim flow copy stays separate from shop language
- [ ] Run one consistency pass across nav, cards, modals, and success states

---

## Information Architecture

### Public navigation

- `Shop`
- `Claim a Package`

### Shop page structure

1. Hero / intro copy
2. `Cars Available`
3. `Shop Listings`
4. Support / next-step block

### Claim page structure

1. Intro copy
2. How-it-works block
3. Claim table
4. Sign-in path

---

## Backend / DB System Design

### Core principle

Public shop data should come from a dedicated shop subsystem, not from loosely reused gallery rows.

### Current intended shop entities

- `shop_listings`
- `shop_vehicle_details`
- `shop_item_details`
- `shop_interest_requests`
- `shop_holds`

### Listing types

- `vehicle`
- `general_item`

### Why this structure is correct

- Vehicle records need richer structured fields than generic items
- Interest requests need their own lifecycle
- Holds need explicit tracking
- Public display rules should be enforced centrally

---

## Backend Readiness Audit

### Current state

The backend contract is now centered on the dedicated shop subsystem for public shop reads and writes.

The remaining work is mostly workflow hardening, frontend adoption, and documentation cleanup.

### What is already ready

- Public shop listings are backed by `shop_listings`
- General sale-item inquiry is backed by `shop_interest_requests`
- Public shop aggregation now pulls sale data from the shop subsystem
- Shop holds and shop interest tables already exist in schema and migration

### What is still being aligned

#### Workflow and frontend adoption

- frontend still needs to consume the new dedicated public shop endpoints everywhere
- CTA copy still needs one final consistency pass
- docs still need one full stale-reference cleanup pass
- staff-side hold / qualification progression still needs explicit implementation coverage

#### General sale items

These are better aligned already.

Authenticated inquiry goes through the dedicated shop service and creates:

- inbound lead
- `shop_interest_requests` row
- staff notification

This is consistent with a CTA like:

- `Sign in to Inquire`

#### Anonymous goods

These remain correctly separated in the ownership-claim flow and should stay outside the public shop subsystem.

---

## Frontend Build Checklist

### Claim a Package

- [x] Use standard `page-shell` page padding
- [x] Use standard `page-frame` width
- [x] Show loading skeleton instead of blank wait state
- [ ] Re-verify skeleton visibility in browser
- [ ] Re-test table on mobile widths

### Public Shop

- [x] Split page into `Cars Available` and `Shop Listings`
- [x] Keep `Claim a Package` out of the shop page
- [x] Add resilient fallback card behavior for broken images
- [ ] Add skeleton loading state for shop sections
- [ ] Confirm 4-column desktop layout behavior
- [ ] Confirm tablet collapse behavior
- [ ] Confirm mobile single-column behavior
- [ ] Confirm copy hierarchy and CTA clarity

### Cars UX

- [x] Public vehicle inquiry action exists
- [ ] Confirm success state after submission
- [ ] Confirm backend persistence of interest requests
- [ ] Confirm anti-spam / captcha behavior
- [ ] Add stronger structured vehicle metadata if needed
- [ ] Finalize vehicle CTA copy

### Regular Sale Items UX

- [x] Public browse is available
- [x] Sign-in-to-inquire CTA exists
- [ ] Confirm exact post-sign-in destination
- [ ] Confirm inquiry lands in dashboard workflow cleanly

---

## Backend Checklist

- [x] Public gallery sales feed uses shop subsystem
- [x] Public shop endpoint returns live data
- [x] Public sales endpoint returns combined public sale listings
- [x] General sale-item inquiry uses dedicated shop interest flow
- [~] Vehicle flow still uses legacy gallery claim / reservation flow
- [ ] Confirm all preview images resolve correctly from seeded data
- [ ] Confirm image fallback strategy is permanent, not cosmetic only
- [ ] Decide whether vehicle public action is `inquiry` or `reservation`
- [ ] Refactor vehicle action into dedicated shop subsystem if we choose inquiry-first UX
- [ ] Confirm car action submission persists in the correct table/service
- [ ] Confirm sale-item inquiry path is fully wired end to endok 
- [ ] Confirm anonymous goods masking rules are correct

---

## Visual Tracker

Legend:

- `[x]` done
- `[~]` in progress / needs verification
- `[ ]` not done

### Track A: Claim Flow

- `[x]` layout width aligned to site standard
- `[x]` table loading skeleton added
- `[~]` skeleton visibility re-check in live browser
- `[ ]` mobile QA pass

### Track B: Shop Surface

- `[x]` cars separated from general sale items
- `[x]` anonymous goods separated from shop
- `[x]` broken-image fallback added
- `[ ]` shop loading skeleton polish
- `[ ]` responsive QA pass
- `[ ]` CTA flow QA pass
- `[ ]` copy consistency pass

### Track C: Backend Integrity

- `[x]` public gallery aggregation corrected
- `[x]` public shop feed corrected
- `[~]` vehicle action still needs architectural alignment
- `[ ]` image source integrity audit
- `[ ]` car interest persistence audit
- `[ ]` general inquiry flow audit

---

## Recommended Next Build Order

1. Re-verify claim-table skeleton visually
2. Add and verify shop-page loading skeletons
3. Verify broken-image handling across all public listings
4. Test car interest submission end to end
5. Test sign-in-to-inquire flow end to end
6. Run desktop, tablet, and mobile QA pass
7. Tighten copy and CTA labels after behavior is confirmed

---

## Implementation Workstreams

### Workstream A — Backend Contract Split

Goal:

Move public shop reads and writes fully into the dedicated shop subsystem and stop relying on legacy gallery shop behavior.

Checklist:

- [x] Add `GET /public/shop/vehicles`
- [x] Add `GET /public/shop/items`
- [x] Add public vehicle inquiry endpoint in shop domain
- [x] Keep authenticated general-item inquiry in shop domain
- [x] Return only active published listings in public shop endpoints
- [x] Define shared base DTO plus `vehicleDetails` / `itemDetails`
- [x] Align Zod schemas, handlers, controllers, and Swagger
- [x] Remove legacy public-shop vehicle write path from `gallery`

Definition of done:

- Landing page can fetch vehicles and items without using `gallery/sales`
- New public vehicle inquiries no longer write to legacy `gallery_claims`

### Workstream B — Backend Workflow Alignment

Goal:

Make shop semantics truthful: inquiry first, staff-controlled holds, delayed operational escalation.

Checklist:

- [x] Public vehicle inquiry writes to `inbound_leads`
- [x] Public vehicle inquiry writes to `shop_interest_requests`
- [x] Authenticated general-item inquiry writes to `shop_interest_requests`
- [x] No public inquiry auto-creates `shop_holds`
- [x] No public inquiry auto-creates support ticket
- [x] Staff notification is sent on inquiry creation
- [ ] Staff workflow supports status progression:
  - `new`
  - `contacted`
  - `qualified`
  - `hold_offered`
  - `converted`
  - `closed`
- [ ] Support ticket creation moves to staff qualification stage

Definition of done:

- Inquiry, hold, and ticket behavior match the words used in the UI

### Workstream C — Legacy Cleanup

Goal:

Delete pre-live legacy shop semantics so the production system is clean before launch.

Checklist:

- [x] Delete legacy vehicle public purchase/claim write flow from `gallery`
- [x] Delete legacy compatibility routes that are no longer needed
- [ ] Remove FE dependencies on `GET /public/gallery/sales`
- [ ] Keep only true anonymous-goods claim behavior in `gallery`
- [x] Verify no internal code path still expects legacy vehicle purchase claims
- [ ] Remove outdated docs and stale references to old public shop behavior

Definition of done:

- `gallery` only owns claims/adverts/anonymous-goods concerns
- `shop` owns public inventory and inquiries

### Workstream D — Landing Page Shop UI

Goal:

Make the public shop UI match the new backend contract and industry-standard behavior.

Checklist:

- [ ] Replace `getGallerySales()` dependency with dedicated shop endpoints
- [ ] Load `Cars Available` from vehicles endpoint
- [ ] Load `Shop Listings` from items endpoint
- [ ] Update car CTA copy from `Express Interest` to final agreed wording
- [ ] Keep general-item CTA as sign-in-driven inquiry
- [ ] Keep `Claim a Package` separate from `Shop`
- [ ] Keep resilient image fallback for missing/broken media
- [ ] Add skeleton loading state per shop section
- [ ] Confirm 4-column desktop grid behavior
- [ ] Confirm tablet and mobile collapse behavior
- [ ] Confirm empty states remain clear

Definition of done:

- The public shop page reflects the new domain split in both data and UI

### Workstream E — Claim Flow UI Polish

Goal:

Bring the claim page into the same layout and loading standards as the rest of the site.

Checklist:

- [x] Align claim page width and padding with shared page system
- [x] Add claim-table skeleton state
- [ ] Re-check skeleton visibility in live browser
- [ ] Confirm claim table on tablet widths
- [ ] Confirm claim table on mobile widths

Definition of done:

- The claim page feels visually consistent with the rest of the landing site

### Workstream F — Copy System

Goal:

Make CTA and status language match actual workflow semantics.

Checklist:

- [ ] Finalize vehicle CTA wording
- [ ] Finalize vehicle modal heading and success-state copy
- [ ] Confirm general-item CTA wording
- [ ] Confirm sign-in wording across shop and claim surfaces
- [ ] Remove any language that implies checkout when only inquiry exists
- [ ] Run one copy-consistency pass across nav, sections, cards, modals, and notices

Definition of done:

- Every CTA accurately describes what will happen next

### Workstream G — Verification And QA

Goal:

Verify that the new system is truthful end to end before we continue layering UI polish.

Checklist:

- [x] Typecheck backend
- [x] Validate route/schema/Swagger alignment
- [x] Add backend controller coverage for public vehicle inquiry and authenticated item inquiry
- [ ] Verify seeded shop images resolve correctly
- [ ] Test public vehicle inquiry end to end
- [ ] Test authenticated general-item inquiry end to end
- [ ] Test staff notification on inquiry creation
- [ ] Test hold creation only from staff workflow
- [ ] Test absence of immediate support ticket creation
- [ ] Test desktop responsive layout
- [ ] Test tablet responsive layout
- [ ] Test mobile responsive layout

Definition of done:

- The system behaves exactly as designed in both UI and backend workflow

---

## Suggested Execution Order

1. Workstream A — Backend Contract Split
2. Workstream B — Backend Workflow Alignment
3. Workstream C — Legacy Cleanup
4. Workstream D — Landing Page Shop UI
5. Workstream E — Claim Flow UI Polish
6. Workstream F — Copy System
7. Workstream G — Verification And QA

---

## Notes

- Cars should feel like inventory.
- General sale items should feel like catalog + assisted inquiry.
- Anonymous package claims should feel operational, not commercial.
- We should keep one source of truth for public shop behavior in this document as implementation continues.
