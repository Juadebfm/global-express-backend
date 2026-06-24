# Architecture

## Stack

| Layer | Tool | Purpose |
| --- | --- | --- |
| Runtime | Node.js 20+ | Application runtime |
| Framework | Fastify 5 | HTTP server and plugin system |
| Validation + OpenAPI | Zod + fastify-type-provider-zod + Swagger | Request validation and API docs |
| Database | Postgres | Primary transactional store |
| ORM | Drizzle ORM + postgres-js | Typed schema access |
| Customer auth | Clerk | External customer identity |
| Internal auth | JWT + bcryptjs | Staff, superadmin, and supplier auth |
| Payments | Paystack | Hosted payment flow and webhooks |
| Storage | Cloudflare R2 | Upload targets and public asset URLs |
| Email | Resend | Transactional email |
| SMS / WhatsApp | Termii | Optional message delivery |
| Realtime | @fastify/websocket | Notifications and support events |
| Metrics | fastify-metrics | Prometheus metrics |
| Tracing | OpenTelemetry | Optional OTLP tracing |
| Testing | Vitest | Unit and integration tests |

---

## Runtime Shape

The service boots from:

- `src/server.ts`
- `src/app.ts`

Startup flow:

1. Load and validate environment variables
2. Initialize telemetry if configured
3. Build Fastify app with security, metrics, multipart, Swagger, and WebSocket plugins
4. Register HTTP routes and WebSocket handlers
5. Start listening on configured host and port

---

## Repository Structure

```text
src/
  app.ts
  server.ts
  config/
  controllers/
  domain/
  middleware/
  notifications/
  routes/
  services/
  types/
  utils/
  websocket/

drizzle/
  schema/
  migrations/

tests/
  unit/
  integration/

docs/
context/
scripts/
```

### Responsibility Boundaries

- `routes/`
  Fastify route registration, schemas, auth hooks, and endpoint-level contracts
- `controllers/`
  Thin request-to-service orchestration
- `services/`
  Business rules and data access
- `middleware/`
  Authentication, authorization, captcha, idempotency, IP allowlist, error handling
- `domain/`
  Shipment-state transition and labeling logic
- `utils/`
  Encryption, pagination, tracking, problem-details, audit helpers
- `websocket/`
  Realtime auth and broadcast helpers
- `drizzle/schema/`
  Database schema source of truth

---

## Request Lifecycle

Typical write flow:

```text
HTTP request
  -> Fastify route
  -> preHandler middleware
  -> controller
  -> service
  -> Drizzle / Postgres
  -> response envelope
  -> onSend / onResponse hooks
```

Important global hooks in `src/app.ts`:

- raw-body capture for signed webhooks
- cache-control stamping
- request ID propagation
- idempotency result persistence
- RFC 7807 error reshaping
- centralized error handling

---

## Authentication Model

### Customer Path

- Clerk issues JWT
- `authenticate` verifies Clerk token
- Backend provisions or links a `users` row via `/auth/sync`
- Internal roles are explicitly blocked from Clerk auth paths

### Internal Path

- Staff, superadmin, and supplier use email/password stored in backend DB
- Passwords are bcrypt-hashed
- Login returns internal JWT signed with `JWT_SECRET`
- Revoked token JTIs are persisted and checked on each request
- MFA challenge flow exists for internal operators

### Authorization

Role checks happen in middleware, not in controllers:

- `requireSuperAdmin`
- `requireAdminOrAbove`
- `requireStaffOrAbove`
- `requireSupplier`

Additional protection layers:

- ownership checks inside services
- optional IP allowlist on sensitive auth routes
- onboarding-state allowances for internal users

---

## Data Model

### Core Tables

- `users`
  Customer, internal, and supplier identities
- `orders`
  Shipment-level business record
- `order_packages`
  Package-level operational detail
- `order_status_events`
  Status timeline and auditability
- `shipment_measurements`
  Checkpoint-specific measurement records
- `dispatch_batches`
  Internal grouped movement units with master tracking numbers
- `invoices`
  Billing layer linked to shipments and batches
- `payments`
  Online and offline payment records

### Secondary Tables

- `notifications`, `admin_notifications`, `push_subscriptions`
- `support_tickets`
- `gallery_items`, `gallery_claims`
- `supplier_declarations`
- `user_suppliers`, `supplier_update_requests`
- `pricing_rules`, `customer_pricing_overrides`
- `app_settings`, `notification_templates`, `restricted_goods`
- `idempotency_keys`, `processed_webhook_events`, `security_events`, `file_scans`, `revoked_tokens`

---

## Sensitive Data Handling

Column-level encrypted fields are decrypted only in service layer when needed.

Examples:

- user email, names, phone, shipping mark, address street
- internal profile PII
- gallery claimant contact fields
- recipient contact fields on orders

Security patterns:

- AES-256-GCM for T2 data
- request body redaction in logger
- `Cache-Control: no-store, private` on authenticated/PII routes
- soft delete for important records

See:

- `docs/data-classification.md`
- `docs/threat-model.md`

---

## Shipment Domain Model

The shipment domain uses a V2 status system.

Shared early stages:

- `PREORDER_SUBMITTED`
- `AWAITING_WAREHOUSE_RECEIPT`
- `WAREHOUSE_RECEIVED`
- `CLAIM_APPROVED_PENDING_BULK_PROCESSING`
- `WAREHOUSE_VERIFIED_PRICED`

Air and sea diverge after pricing.

D2D extends with additional last-mile statuses:

- `IN_EXTRA_TRUCK_MOVEMENT_LAGOS`
- `LOCAL_COURIER_ASSIGNED`
- `IN_TRANSIT_TO_DESTINATION_CITY`
- `OUT_FOR_DELIVERY_DESTINATION_CITY`
- `DELIVERED_TO_RECIPIENT`

Rules live in:

- `src/domain/shipment-v2/status-transitions.ts`
- `src/domain/shipment-v2/status-mapping.ts`
- `src/domain/shipment-v2/status-labels.ts`

---

## Main Route Groups

Mounted groups:

- `/api/v1/auth`
- `/api/v1/users`
- `/api/v1/orders`
- `/api/v1/payments`
- `/api/v1/uploads`
- `/api/v1/reports`
- `/api/v1/internal`
- `/api/v1/dashboard`
- `/api/v1/notifications`
- `/api/v1/shipments`
- `/api/v1/team`
- `/api/v1/admin`
- `/api/v1/settings`
- `/api/v1/support`
- `/api/v1/public`
- `/api/v1/gallery`
- `/api/v1/batches`
- `/api/v1/supplier`
- `/webhooks/*`
- `/ws`

Canonical reference:

- `API_ENDPOINTS.md`

---

## Outbound Integrations

### Clerk

- customer token verification
- user lookup during sync flow
- webhook ingestion

### Paystack

- payment initialization
- verification
- webhook events

### Cloudflare R2

- presigned upload flows
- package images
- payment receipts
- gallery media
- claim proofs

### Resend / Termii

- order, payment, support, and operational notifications

### Optional Controls

- Cloudflare Turnstile for public mutation endpoints
- VirusTotal for file scanning
- OpenTelemetry exporter for tracing

---

## Realtime Architecture

WebSocket auth mirrors HTTP auth:

- Clerk JWT for customers
- internal JWT for staff and superadmin

Capabilities:

- user-targeted broadcasts
- global broadcasts
- support ticket room subscriptions

WebSocket handlers enforce ownership for support rooms to prevent cross-ticket access.

---

## API Conventions

- Success envelope: `{ success: true, data }`
- Error format: RFC 7807 Problem Details
- Select POST routes support `Idempotency-Key`
- Public catalog GETs may be cacheable
- Authenticated and PII routes are `no-store`
- Swagger is available at `/docs`
- Raw OpenAPI spec is available at `/openapi.json`

---

## Operational Invariants

- Internal roles must never authenticate through Clerk
- Suppliers are first-class users, not a special customer subtype
- Status transitions must respect the V2 state machine
- Payment ownership checks must be enforced server-side
- Public routes must never leak encrypted or internal-only fields
- Deleted records are generally soft-deleted, not physically removed
- Route schemas and docs should match actual service behavior
