# Code Standards

Implementation rules for this backend codebase. These standards are meant to preserve contract clarity, security, and business-logic correctness.

---

## Engineering Mindset

- Read the actual code path before changing behavior
- Trust code and route schemas over stale narrative docs
- Preserve business rules unless the change explicitly updates them
- Favor explicitness over clever abstractions
- Keep controllers thin and services authoritative
- Treat security and data handling as product behavior, not incidental plumbing

---

## Source-of-Truth Order

When something conflicts, trust this order:

1. `drizzle/schema/*`
2. `src/routes/*`
3. `src/controllers/*`
4. `src/services/*`
5. `API_ENDPOINTS.md`
6. `FRONTEND_FLOW_GUIDE.md`
7. `context/*`

---

## TypeScript

- Strict typing is required
- Prefer `type` aliases for payloads and response shapes
- Avoid `any`; use it only when a library boundary truly requires it
- Add explicit input and return types on exported functions and service methods when helpful
- Keep numeric-string behavior explicit when working with Postgres numeric columns

---

## Layering Rules

### Routes

- Define endpoint schemas, summaries, tags, and preHandlers
- Keep route files focused on HTTP contract and registration
- Do not place business logic directly in route handlers when a controller/service already exists

### Controllers

- Parse request intent
- Call services
- Shape reply objects
- Stay thin

### Services

- Own business rules
- Own DB queries and record assembly
- Own authorization decisions that depend on resource ownership or domain state
- Decrypt sensitive fields only when needed for a valid caller

### Domain / Utils

- Put reusable status-machine or mapping rules in `src/domain`
- Put cross-cutting helpers in `src/utils`

---

## Fastify Conventions

- Use `withTypeProvider<ZodTypeProvider>()` in route modules
- Use Zod schemas for params, query, body, and response where practical
- Keep auth and role checks in `preHandler`
- Reuse existing middleware for:
  - `authenticate`
  - role guards
  - captcha enforcement
  - idempotency
  - IP allowlist

Do not move these concerns into ad hoc controller logic.

---

## Response Contracts

- Successful application responses use `{ success: true, data: ... }`
- Error responses should flow through the centralized Problem Details behavior
- Do not introduce one-off response shapes unless there is a deliberate exception and the route docs explain it
- Keep Swagger response schemas aligned with the real payload

---

## Authentication and Authorization

- Never allow internal roles to authenticate through Clerk paths
- Never bypass `requireRole` because a controller "already knows" the actor role
- Keep ownership checks server-side even if the frontend already filters visible data
- Supplier access rules are distinct from customer rules; do not treat suppliers as customers

---

## Data and Security

- Any new T2 field must be encrypted at rest
- Any new public response must be reviewed for data leakage
- Respect soft-delete conventions by filtering on `deletedAt`
- Never log raw secrets, tokens, OTPs, or decrypted PII
- Preserve `Cache-Control: no-store` behavior for authenticated and PII routes
- Do not weaken webhook verification, idempotency, captcha, or file-scan gates casually

See:

- `docs/data-classification.md`
- `docs/threat-model.md`
- `SECURITY_CHECKLIST.md`

---

## Database and Drizzle

- Schema changes begin in `drizzle/schema/*`
- Add migrations for behavior that changes persisted structure
- Keep enum changes synchronized across:
  - schema files
  - TypeScript enums
  - route validation
  - business docs
- Use transactions for multi-record state changes where partial success would corrupt workflow

---

## Business-Logic Standards

### Orders and shipments

- Respect the V2 state machine
- Keep customer-facing status mapping distinct from operational status
- Keep shipment payer, supplier billing, and dispatch-batch behavior explicit

### Pricing

- Pricing calculations must remain auditable
- Keep transport-mode assumptions explicit
- Preserve separation between:
  - calculated charge
  - surcharges
  - final charge
  - payment state

### Payments

- Preserve ownership checks on payment actions
- Validate callback URLs and uploaded receipt keys
- Maintain idempotency support where already implemented

### Support and notifications

- Customers must never gain access to another user's support data
- WebSocket room joins must enforce ownership
- Notification audience logic must remain role-aware

---

## Outbound Integrations

- Use shared configured clients where they already exist
- Add retries only where safe and intentional
- Keep provider-specific security checks close to the integration
- When changing a webhook or third-party flow, update the corresponding docs

---

## Testing Expectations

- Add or update tests when changing business logic
- Favor unit tests for:
  - status transitions
  - pricing behavior
  - auth helpers
  - encryption / recovery / MFA helpers
- Add integration coverage for high-risk request flows when behavior spans multiple layers

If you cannot test something, document the gap clearly.

---

## Documentation Standards

- Update `API_ENDPOINTS.md` when contracts change
- Update `FRONTEND_FLOW_GUIDE.md` when frontend flow assumptions change
- Update `context/*` when repo-level orientation changes
- Do not leave obviously outdated docs in place if your change makes them more misleading

---

## Dependency Standards

- Prefer existing dependencies and utilities over adding new ones
- Add a new package only when the current stack does not already solve the problem well
- Security-sensitive dependencies deserve extra scrutiny
