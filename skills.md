# Settings Implementation Checklist (Execution Plan)

## 1. Non-Negotiable Security Rules

Follow this exact order for every relevant change:

1. Keep log redaction intact; never log secrets or tokens.
2. Keep encryption-at-rest for sensitive PII fields.
3. Never introduce plaintext storage for passwords, card data, CVV, or tokens.
4. Keep payment card details out of backend storage (PCI boundary remains external).
5. Keep webhook signature verification unchanged for signed webhook flows.
6. Apply rate limits to sensitive endpoints (auth, password, high-risk writes).
7. Preserve soft-delete behavior for user deletion flows.
8. Preserve audit logging for admin-impacting actions; do not store PII in audit metadata.
9. Preserve production-safe error responses; never leak stack traces to clients.

This is the source of truth for implementing user Settings features in this codebase.

Rules:

- Follow this checklist in order.
- Do not skip security or architecture gates.
- Mark each item only after code, tests, and docs for that item are complete.
- Exclude active Billing implementation in this execution cycle.
- Keep Billing in tentative backlog only.

## 2. Scope Lock

- [ ] Implement Settings modules now: `Profile & Security`, `Notifications`, `Privacy/Data Controls`.
- [ ] Exclude active implementation now: `Billing/Payments UI + user billing settings`.
- [ ] Keep Billing tasks documented as deferred backlog in section 10.
- [ ] Keep all endpoints backward compatible unless versioned migration is explicitly planned.

## 3. Non-Negotiable BE/API/Architecture Rules

- [ ] Keep Fastify layering: `routes -> controllers -> services -> db/schema`.
- [ ] Use `zod` for every request/response contract on new or changed routes.
- [ ] Return API success payloads through `{ success: true, data }` shape.
- [ ] Return API error payloads through `{ success: false, message, errors? }` shape.
- [ ] Keep auth in middleware (`authenticate`), never inside services.
- [ ] Keep role checks in middleware (`requireRole` variants), never inside services.
- [ ] Apply `ipWhitelist` to admin/superadmin-only endpoints.
- [ ] Keep pagination shape consistent with existing `data + pagination`.
- [ ] Avoid route-level business logic duplication; centralize in services.
- [ ] Add/keep route docs (summary/description/examples) aligned with behavior.

## 4. Baseline Alignment Tasks

- [x] Confirm and document canonical customer settings capabilities from current API:
- [x] `GET/PATCH/DELETE /api/v1/users/me`
- [x] `GET /api/v1/users/me/export`
- [x] `GET /api/v1/notifications`
- [x] `GET /api/v1/notifications/unread-count`
- [x] `PATCH /api/v1/notifications/:id/read`
- [x] `PATCH /api/v1/notifications/:id/save`
- [x] Decide and document canonical profile completeness rule (whatsapp required or optional) to remove doc/code drift.
- [x] Freeze response contracts for frontend consumption before implementation starts.

## 5. Module A: Profile & Security (Now)

- [x] Profile fields: verify/update support for identity, phone, WhatsApp, full address, marketing consent.
- [x] Ensure profile update validation remains explicit and strict in `zod`.
- [x] Add/confirm API examples for individual and business account updates.
- [x] Add a clear API-level completeness helper contract for frontend (if introduced, keep backward compatible).
- [x] Ensure account deletion remains soft delete + safe response.
- [x] Ensure data export remains available and complete.

Security sub-track:

- [x] Keep customer password/2FA ownership with Clerk (no duplicate password store in backend).
- [x] Document exact frontend integration path for customer security actions (Clerk managed).
- [x] Keep internal-only password routes scoped to internal roles and not exposed as customer settings endpoints.

## 6. Module B: Notifications (Now)

- [ ] Keep inbox retrieval stable for personal + broadcast notifications.
- [ ] Keep read/unread/saved behavior correct for personal and broadcast records.
- [ ] Ensure unread badge endpoint remains accurate after read/save toggles.
- [x] Add notification preferences model and APIs if required by product scope (email/SMS/in-app toggles).
- [x] If preferences are introduced, enforce them in notification send pipelines (email and WhatsApp/SMS paths).
- [x] Add migration + indexes for any new notification preference fields.
- [x] Add route docs and examples for preference update/read flows.

## 7. Module C: Privacy & Data Controls (Now)

- [x] Keep `Export my data` path in settings UX and API flow.
- [x] Keep `Delete my account` path in settings UX and API flow.
- [x] Add explicit confirmation UX/API note for destructive action semantics (soft delete).
- [x] Validate behavior for deleted users on subsequent auth attempts.

## 8. Testing & Quality Gates (Required Per Step)

- [x] Unit tests for changed service logic.
- [ ] Integration tests for changed routes and auth/role protections.
- [ ] Regression tests for existing settings endpoints.
- [x] Negative tests for unauthorized/forbidden access paths.
- [ ] Validation tests for malformed payloads.
- [ ] Verify no breaking changes in OpenAPI/Swagger output.
- [ ] Verify lint/typecheck/tests all pass before marking checklist items done.

## 9. Delivery Sequence (Step-by-Step Execution Order)

- [ ] Step 1: Lock scope + rules (sections 1-3).
- [x] Step 2: Baseline alignment and contract freeze (section 4).
- [x] Step 3: Implement and validate Profile & Security (section 5).
- [ ] Step 4: Implement and validate Notifications (section 6).
- [x] Step 5: Implement and validate Privacy controls (section 7).
- [ ] Step 6: Complete all quality gates (section 8).
- [ ] Step 7: Update integration docs and changelog notes for frontend.

## 10. Billing/Payments (Tentative Backlog, Later)

- [ ] Add customer-scoped payment history endpoint(s) (`/payments/me` style) with pagination/filtering.
- [ ] Add billing summary endpoint for settings dashboard card.
- [ ] Add invoice/receipt data model and retrieval API (if product confirms invoice requirements).
- [ ] Add webhook-safe reconciliation fields for billing timeline UX.
- [ ] Keep card data out of backend storage (continue Paystack-hosted flow).
- [ ] Add role and ownership checks so users only access their own billing records.
- [ ] Add full test coverage for billing settings APIs when this track starts.
- [ ] Do not execute these items in current cycle unless scope is explicitly reopened.

## 11. Definition of Done

- [ ] Every completed item is checked in this file.
- [ ] All mandatory architecture/security gates remain satisfied.
- [ ] Tests pass and no regression is introduced.
- [ ] Frontend integration docs reflect final contracts.
- [ ] Deferred Billing remains backlog-only and unimplemented in this cycle.
