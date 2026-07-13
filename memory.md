# Memory — ShipmentCalculator Estimator Result Card

Last updated: 2026-07-06

## What was built

### Backend — `/public/calculator/estimate` endpoint

- `src/controllers/public.controller.ts` — wired `settingsFxRateService.getEffectiveRate()` into `calculateEstimate`; added `estimatedCostNgn` and `fxRateUsdNgn` to the success response. FX lookup is wrapped in try/catch — if unavailable, both fields are `null` (graceful degradation).
- `src/routes/public.routes.ts` — Zod response schema extended with `estimatedCostNgn: z.number().nullable()` and `fxRateUsdNgn: z.number().nullable()`.

### Landing page — ShipmentCalculator

- `src/pages/ShipmentCalculator/index.jsx` — removed the Air/Sea rate preview cards block (was showing flat-rate cards that cluttered the page before the user even submitted).
- `src/pages/ShipmentCalculator/EstimateResult.jsx` — full rewrite to industry-standard result card. Structure:
  - **Header:** mode icon (orange plane for air, blue ship for sea) + shipment label + "LCL" badge for sea + "Based on X kg / X CBM" subtitle; transit pill (orange border, clock icon) on the right
  - **Price block:** "ESTIMATED COST" label, large `≈ $X` integer price, NGN equivalent `≈ ₦X` below
  - **Line item breakdown:** 3 rows derived from total — Air: base air freight (85%) + fuel & handling (12%) + customs (remainder); Sea: ocean freight LCL (79%) + port & documentation (17%) + customs (remainder). Always sums to total exactly.
  - **Total row:** divider + "Estimated total" / `$X`
  - **Tags:** static per mode — Air & Sea both: "Customs included · Live tracking · Insured"
  - **Disclaimer:** info icon + mode-specific text (air: "confirmed at pickup"; sea: "confirmed at port intake")
  - **CTAs:** full-width orange "Request a Shipment" → `/get-a-quote`; "Start a new estimate" text link below

## Decisions made

- **Line items derived on frontend** — backend returns a single total; breakdown is approximated proportionally. No insurance line item (removed at user request).
- **D2D stays as INTAKE** — the D2D estimator mode shows the intake form, not a calculated card. The card design only applies to AIR and SEA calculated modes.
- **Integers only for prices** — `Math.round()` used for both USD and NGN display. No decimal places — signals "estimate" clearly.
- **₦ symbol hardcoded** — `Intl.NumberFormat` with `currency: "NGN"` outputs "NGN" text (not the symbol) on most systems. Fixed by prepending `₦` manually.
- **Card border uses opacity** — `rgba(35,35,35,0.15)` instead of the `--border` variable (`#232323`) for the card border. Full `--border` is too heavy for a card.
- **"Request a Shipment" CTA** links to `/get-a-quote` (existing route on the landing page).

## Problems solved

- **`chargeBasis` case mismatch** — backend sends lowercase (`"volumetric_weight"`, `"actual_weight"`, `"cbm_converted_to_kg"`); the old frontend checked uppercase (`"VOLUMETRIC_WEIGHT"` etc.). Justification line never rendered. Fixed by switching to lowercase in all comparisons.
- **NGN symbol** — `Intl.NumberFormat` with `currency: "NGN"` shows "NGN" text on most locales instead of ₦. Fixed by manual formatting.
- **CORS during local dev** — landing page `.env.local` (gitignored) sets `VITE_API_BASE_URL=http://localhost:3000/api/v1` to override production backend URL.

## Current state

- **Backend:** Changes in working tree, not yet committed. `settingsFxRateService` already existed (live USD→NGN from open.er-api.com, 5-min cache, manual rate fallback from DB) — only wiring into the estimate endpoint was new.
- **Landing page:** `EstimateResult.jsx` rewritten, `index.jsx` rate cards removed. Changes not yet committed.
- **Vercel deployment:** Failing because `VITE_DASHBOARD_URL` is not set. User needs to add `VITE_DASHBOARD_URL=https://app.globalexpress.kr` in Vercel project settings for the landing page (NOT the dashboard project).

## Next session starts with

1. Check git status across both repos (`global-express-backend` and `global-express-landing-page`).
2. Commit backend changes (`src/controllers/public.controller.ts` + `src/routes/public.routes.ts`).
3. Commit landing page changes (`EstimateResult.jsx` + `index.jsx`).
4. Push both.
5. Remind user to set `VITE_DASHBOARD_URL=https://app.globalexpress.kr` in Vercel → landing page project settings → Environment Variables.

## Open questions

- **Vercel env var** — `VITE_DASHBOARD_URL=https://app.globalexpress.kr` must be set manually in the Vercel dashboard by the user before the landing page production build will succeed.
- **FX rate in production** — `settingsFxRateService` falls back to a manual rate stored in the DB if the external API is unavailable. Ensure the DB has a rate seeded or the external API key is set, otherwise `estimatedCostNgn` will be `null` in production.

## Carry-over context (previous session — not worked on this session)

The FE dashboard rebuild spec exists at:
`/Users/macbookpro/Documents/GitHub/global-express-dashboard/docs/FE_REBUILD_SPEC.md`

Backend tracking overhaul is 100% complete and pushed to main (commit `80d5362`).
FE rebuild Layer 1 (types → services → hooks) has not been started.
When returning to that work, run `/remember restore` and open the spec doc.
