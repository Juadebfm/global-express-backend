# Build Plan

## Purpose

This is not a greenfield build anymore.

The backend already exists and is feature-rich, so this document tracks how we should continue evolving it without losing contract clarity or business correctness.

The core principle is:

1. Understand the existing domain behavior first
2. Update contracts and context before changing sensitive business logic
3. Implement in the correct layer
4. Verify with tests and docs

---

## Phase 1 - Context and Contract Alignment

### 1. Refresh `context/`

- Rewrite stale project context so it reflects the actual backend
- Keep summaries aligned with code, not with aspirational plans

### 2. Keep contract docs synchronized

- Treat `API_ENDPOINTS.md` as the human API reference
- Keep `FRONTEND_FLOW_GUIDE.md` aligned with current business flow
- Fix drift in older docs when code changes make them misleading

### 3. Preserve route-schema truthfulness

- Route Zod schemas, Swagger docs, and controller behavior must agree
- Any new endpoint or response field must be documented in the same change

---

## Phase 2 - Core Shipping Domain Stability

### 4. Orders and profile gating

- Preserve complete-profile enforcement for customer order creation
- Keep order creation behavior consistent across customer and staff flows

### 5. Warehouse verification and pricing

- Protect transport-mode pricing rules
- Keep package-level calculations auditable
- Maintain separation between calculated amounts, surcharges, and final charge

### 6. Shipment status transitions

- Respect V2 status machine rules
- Keep customer-facing status mapping separate from internal operational status
- Test edge cases for D2D, exceptions, and payment gates

---

## Phase 3 - Batching, Invoice, and Payment Hardening

### 7. Dispatch batches

- Keep master tracking internal-only
- Preserve customer-slot and grouped-shipment behavior
- Validate approval and permission rules around batch operations

### 8. Invoices and payment ownership

- Ensure invoice state changes remain tied to shipment progression
- Keep payment access checks strict for customers, suppliers, and staff
- Maintain idempotent behavior on create-like payment flows

### 9. Receipt and webhook processing

- Keep file receipt flows safe and traceable
- Preserve webhook verification, replay protection, and downstream updates

---

## Phase 4 - Public and Supplier Surfaces

### 10. Public calculator and D2D intake

- Keep public responses safe for anonymous use
- Maintain clear distinction between estimated pricing and intake-required flows

### 11. Gallery and claims

- Preserve public claim submission safety
- Keep approval flow capable of converting approved claims into shipments

### 12. Supplier portal

- Preserve supplier-only login and declaration workflows
- Keep declaration acceptance, rejection, and linking behavior explicit

---

## Phase 5 - Security, Observability, and Ops

### 13. Security controls

- Maintain PII encryption and log redaction
- Keep internal-vs-public auth separation intact
- Continue treating file scan, captcha, IP allowlist, and MFA as first-class concerns

### 14. Observability

- Maintain request IDs, metrics, audit logs, and security events
- Keep OpenTelemetry optional and environment-gated

### 15. Operational hygiene

- Keep migrations, scripts, and deployment docs in sync with production behavior
- Avoid undocumented one-off business rules

---

## Change Workflow

For any non-trivial feature or business-logic change:

1. Read the relevant service, route, schema, and docs
2. Confirm the current behavior from code
3. Update or create the spec in `docs/` if the change is business-critical
4. Implement in the correct layer
5. Add or update tests
6. Update API docs and any affected context docs

---

## Near-Term Priorities

- Keep the refreshed `context/` files aligned with code changes
- Reduce drift between legacy docs and the current API contract
- Keep shipment, batch, payment, and supplier flows clearly documented for future sessions
