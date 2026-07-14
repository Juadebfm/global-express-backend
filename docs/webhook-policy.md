# Webhook Policy

Covers the **inbound** webhook endpoints this backend exposes: their authentication, the retry semantics our upstream providers (Paystack, Clerk) use, our idempotency guarantees, and the response-time SLO we commit to.

Last updated: 2026-06-01.

---

## Endpoints

| Path | Sender | Auth | Idempotency key |
|---|---|---|---|
| `POST /webhooks/clerk` | Clerk → Svix delivery | Svix signature (`svix-id`, `svix-timestamp`, `svix-signature`) | `svix-id` |
| `POST /api/v1/payments/webhook` | Paystack | HMAC-SHA512 in `x-paystack-signature` | Transaction id (`data.id`) |

Both endpoints are rate-limited generously (50–200/min) and bypass user-level authentication.

---

## Authentication

### Paystack
- **Signature:** HMAC-SHA512 of the raw request body, using `PAYSTACK_SECRET_KEY` as the HMAC key.
- **Header:** `x-paystack-signature`.
- **Verify before parsing:** the raw body is captured by a `preParsing` Fastify hook ([src/app.ts](../src/app.ts)) and signature-verified inside the handler before any side effect.
- **Failure:** 400 with RFC 7807 `{"type":"...","title":"...","detail":"Invalid webhook signature","status":400,...}`.

### Clerk (via Svix)
- **Signature:** Svix-standard. We delegate verification to the `svix` npm package.
- **Headers required:** `svix-id`, `svix-timestamp`, `svix-signature`.
- **Replay window:** enforced by Svix (default 5 min around `svix-timestamp`).
- **Failure:** 400 with Problem Details.
- **Misconfiguration:** if `CLERK_WEBHOOK_SECRET` is unset, we return 503 fast — the provider's retry queue will keep trying until the secret is configured.

---

## Idempotency guarantees

Both providers retry deliveries on transient failures. Both endpoints are designed so that a duplicate delivery is a safe no-op:

- **Paystack** — for `charge.success` events we check the payment record by `paystackReference`. If it is already `SUCCESSFUL` with the same `paystackTransactionId`, we return `{ processed: false, paymentId, reason: "duplicate_event" }` without re-firing downstream effects (notification, batch invoice mark-paid, etc.).
- **Clerk** — the `svix-id` of the delivery is inserted into the `processed_webhook_events` table on a unique `(provider, event_id)` primary key. On a duplicate, the insert fails (caught) and we acknowledge with `{ received: true }` without re-running the user sync.

Both checks happen **after** signature verification, so unsigned or malformed retries cannot poison the dedup table.

---

## Retry behavior of upstream providers

We do not control retries — these are documented externally by the providers and reproduced here for incident response.

### Paystack
- Retries on 4xx and 5xx, including 401/403 (do not return 401/403 unless you mean "stop retrying").
- Schedule: roughly **5 retries over ~72 hours** with backoff; exact intervals not published.
- A delivery is marked "successful" by Paystack on **any 200 OK response**.
- Inspect delivery history at **Paystack Dashboard → Webhooks → Delivery Attempts**.

### Clerk (Svix)
- Standard Svix retry schedule: **5 attempts over ~24 hours** (`immediate, 5s, 5m, 30m, 2h, 5h, 10h, ~24h`).
- Marked successful on any 2xx response within the timeout.
- Manually re-deliverable from Clerk Dashboard → Webhooks → Logs.

---

## Response-time SLO

To stay well within provider timeouts (Paystack ~10s, Clerk/Svix ~15s):

| Metric | Target | Notes |
|---|---|---|
| `POST /webhooks/clerk` p99 | < 2s | Idempotency insert + signature verify + user sync. |
| `POST /api/v1/payments/webhook` p99 | < 3s | Signature verify + payment update + invoice sync + fire-and-forget notification. |
| Both, signature-only path | < 500ms | When the event is a no-op or duplicate. |

Side-effect work that does not need to complete before the ACK (notifications, audit-log inserts, push delivery) is fire-and-forget and prefixed with `void` so it never extends the response.

If you ever see provider retry storms in the logs, the most likely cause is a downstream call (DB, R2, Clerk syncFromClerk) blocking the handler past the provider's timeout — drop it onto a job queue rather than awaiting it inline.

---

## What returns to the provider

| Status | When | Body |
|---|---|---|
| 200 | Successful processing OR duplicate event (idempotent ack) | `{ "received": true }` (Clerk) or `{ "success": true }` (Paystack) |
| 400 | Missing/invalid signature, malformed payload, missing required headers | RFC 7807 Problem Details |
| 503 | `CLERK_WEBHOOK_SECRET` not configured | Problem Details — signals "retry me later" |

We never return 4xx for "I don't recognise this event type" — unknown event types are 200-ack'd and silently ignored. This avoids retry-storms when a provider rolls out a new event type before our handler is updated.

---

## Standard Webhooks (webhooks.fyi)

Both providers use their own header conventions (`x-paystack-signature`, `svix-id/svix-timestamp/svix-signature`). The Standard Webhooks spec recommends `webhook-id` / `webhook-timestamp` / `webhook-signature`, but we cannot rewrite the headers without breaking signature verification with the provider's library.

The functional guarantees the spec defines (signature, timestamp, replay protection, idempotency) are all in place via the provider conventions. If we ever start **sending** outbound webhooks to third-party consumers, we will adopt the Standard Webhooks headers for those outbound deliveries.

---

## Related

- [SECURITY.md](../SECURITY.md) — vulnerability reporting
- [Archived REST standards self-assessment](archive/REST_API_AUDIT.md) — historical assessment status
- [docs/threat-model.md](threat-model.md) — webhook attack scenarios
- Inbound webhook handlers: [src/routes/webhooks.routes.ts](../src/routes/webhooks.routes.ts), [src/services/payments.service.ts](../src/services/payments.service.ts) (`handleWebhookEvent`)
