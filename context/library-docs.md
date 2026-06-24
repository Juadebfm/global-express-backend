# Library Docs

Project-specific notes for the real libraries used in this backend.

This file is not meant to replace official docs. It explains how this repository uses each library and where mistakes usually happen.

---

## Before Using Any Library

Read in this order:

1. Existing code in the relevant service, route, and schema
2. `API_ENDPOINTS.md` if the change affects request or response contract
3. This file for repository-specific conventions
4. Official docs for current API details

---

## Fastify

Used for the HTTP server, plugins, hooks, and route registration.

Project patterns:

- App-wide behavior lives in `src/app.ts`
- Route groups live in `src/routes/*`
- Global hooks handle:
  - request IDs
  - cache-control
  - raw webhook body buffering
  - idempotency capture/persist
  - error reshaping
- WebSocket support is registered centrally

Use Fastify plugins and hooks instead of inventing local middleware patterns.

---

## Zod and fastify-type-provider-zod

Used for request validation, response schemas, and OpenAPI generation.

Project patterns:

- Route files should describe params, query, body, and main responses with Zod
- `errorResponseSchema` is used for documented error responses
- Keep schemas close to the endpoint that owns them
- Be careful with `Date` serialization; this repo already has serializer handling in `src/app.ts`

---

## Drizzle ORM and postgres-js

Used for schema definition and SQL access.

Project patterns:

- Schema source of truth lives in `drizzle/schema/*`
- DB client lives in `src/config/db.ts`
- Cloud-hosted DB URLs force SSL
- Soft deletes are common; remember `isNull(table.deletedAt)`
- Postgres `numeric` fields often come back as strings

When changing business behavior, confirm both the TypeScript enums and database enums still align.

---

## Clerk

Used only for customer authentication and identity lookup.

Project patterns:

- Clerk JWTs are verified in `authenticate`
- `/api/v1/auth/sync` is the customer provisioning/linking entrypoint
- Internal roles must never use Clerk auth branches
- Clerk webhook handling is mounted under `/webhooks`

Do not use Clerk patterns for staff or supplier login flows.

---

## jsonwebtoken and bcryptjs

Used for internal auth.

Project patterns:

- Internal JWTs carry `type: "internal"`
- Revocation is enforced through stored JTI checks
- Passwords are bcrypt-hashed
- Login lockout behavior is part of the service, not just the route

If you change auth behavior, review:

- `src/services/internal-auth.service.ts`
- `src/middleware/authenticate.ts`
- `src/websocket/handlers.ts`

---

## Axios and axios-retry

Used for outbound HTTP integration clients.

Project patterns:

- Shared outbound clients live in `src/config/http-clients.ts`
- Paystack requests already use retry behavior for safe retry classes
- Optional services such as Turnstile and VirusTotal also use guarded retry patterns

Do not create scattered one-off HTTP clients if a shared one already exists.

---

## Paystack

Used for payment initialization, verification, and webhook handling.

Project patterns:

- Initialize hosted transactions server-side
- Validate callback URLs against allowed origins
- Persist pending payments before redirect completion
- Webhooks rely on raw-body signature verification
- Payment ownership must be enforced server-side

Reference:

- `src/services/payments.service.ts`
- `docs/webhook-policy.md`

---

## Cloudflare R2 and AWS SDK

Used for presigned upload URLs and asset storage.

Project patterns:

- Upload flows are mediated through `uploads.service`
- Keys are structured by domain area such as payments, orders, gallery, or claims
- Public URL composition uses `R2_PUBLIC_URL`
- File handling may be paired with optional AV scan records

Do not trust uploaded file metadata alone; preserve content-type and key validation.

---

## WebSocket

Used for realtime notifications and support flows.

Project patterns:

- Auth mirrors HTTP auth
- Customer and internal auth paths are both supported
- Support ticket room membership must enforce ownership
- Broadcast helpers live in `src/websocket/handlers.ts`

Avoid adding ad hoc socket message types without documenting who may emit and receive them.

---

## OpenTelemetry and fastify-metrics

Used for optional tracing and always-on Prometheus-style metrics.

Project patterns:

- Telemetry is environment-gated
- Metrics are exposed at `/metrics`
- Tracing must initialize before app construction

If you change startup flow, preserve the early telemetry bootstrap ordering.

---

## Resend and Termii

Used for customer and operational notifications.

Project patterns:

- Email templates and send helpers live in `src/notifications/email.ts`
- SMS / WhatsApp helpers live in `src/notifications/whatsapp.ts`
- Notification services decide audience and event timing

Do not bury notification side effects in unrelated controllers when a service already owns the event.

---

## Web Push

Used for internal browser push subscriptions.

Project patterns:

- VAPID config is optional
- Subscription lifecycle is handled in service layer
- Push is additive to in-app notification storage, not a replacement

---

## PDFKit

Used for generated PDF exports, such as user data export and manifest-style outputs.

Project patterns:

- PDF generation stays server-side
- Keep export content aligned with authorization and privacy rules

---

## Turnstile

Used on public mutation routes when configured.

Project patterns:

- Token comes from `cf-turnstile-response`
- Verification is environment-sensitive
- Missing or failed verification should produce contract-consistent errors

Do not silently bypass protection in production behavior.

---

## VirusTotal

Used optionally for file scan scheduling and lookup.

Project patterns:

- Upload success does not automatically mean a file is safe to open
- UI and API consumers may need to respect scan status before rendering file access

---

## Vitest

Used for unit and integration testing.

Project patterns:

- Core domain helpers already have tests around status mapping, pricing, MFA, encryption, and pagination
- Add tests near existing patterns rather than inventing new testing styles

---

## Documentation Reminder

Any library-level change that affects runtime behavior should also trigger review of:

- `API_ENDPOINTS.md`
- `FRONTEND_FLOW_GUIDE.md`
- relevant `docs/*`
