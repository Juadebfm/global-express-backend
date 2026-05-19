# Threat Model

Captures the trust boundaries, adversaries, and attack scenarios for the Global Express backend so the team and reviewers have a shared baseline.

Updated when the architecture changes (new external service, new auth path, new exposed endpoint).

## System overview

The backend is a Node.js/Fastify API serving:
- **Customers** (Korea → Nigeria shippers): web frontend on Vercel, authenticated via Clerk.
- **Staff / Superadmin:** internal dashboard on Vercel, authenticated via in-house JWT (no Clerk).
- **Anonymous traffic:** public tracking, public calculator, gallery browsing, D2D intake.

External dependencies:
- **Clerk** — customer auth + identity webhooks.
- **Paystack** — Naira payments + transaction webhooks.
- **Cloudflare R2** — file storage (receipts, gallery media, claim proofs, package images).
- **Resend** — transactional email.
- **Termii** — SMS / WhatsApp.
- **Postgres (Neon / Render Postgres)** — primary store.
- **Render** — backend hosting (Fly.io is the failover, being phased out).

## Trust boundaries

```
[Public internet]
       │
       │  TLS / HSTS
       ▼
[Cloudflare / Render edge]
       │
       │  Render-internal network
       ▼
[Backend (Fastify)] ──── [Postgres]
       │
       ├── [Clerk]      (mTLS / API tokens)
       ├── [Paystack]   (API tokens; HMAC-SHA512 inbound webhooks)
       ├── [R2]         (S3-compatible API + presigned URLs)
       ├── [Resend]     (API token)
       └── [Termii]     (API token)
```

Authentication boundaries:
- **Public ↔ Backend:** no auth; rate-limited; only `/health`, `/api/v1/public/*`, `/api/v1/orders/track/:trackingNumber`, webhooks.
- **Customer ↔ Backend:** Clerk JWT. Validated per request via `@clerk/backend`.
- **Staff ↔ Backend:** in-house JWT signed with `JWT_SECRET`. JTI revocation on logout.

## Assets

| Asset | Tier | Why it matters |
|---|---|---|
| Customer PII (T2) | High | NDPR/GDPR/PIPA exposure; reputational |
| Payment data + Paystack secret (T1) | Critical | Direct financial loss |
| Staff credentials (T1) | Critical | Lateral admin access |
| Encryption key (T1) | Critical | Decrypts ALL stored PII |
| Order/shipment records (T3) | Medium | Business operations, audit |
| R2 contents (T2 mixed) | High | Contains scanned IDs, receipts |
| Audit logs (T3) | Medium | Tampering hides attacks |

## Adversaries

1. **Opportunistic internet attackers** — scan for known CVEs, exposed secrets, default creds.
2. **Targeted attackers** — competitors, fraudsters seeking to manipulate shipments or refunds.
3. **Malicious customer** — abuses authenticated endpoints (BOLA, fee abuse, free orders).
4. **Compromised staff account** — phishing, credential reuse → admin-level access.
5. **Insider** — disgruntled staff exfiltrating customer data.
6. **Supply chain** — malicious npm package, compromised GitHub Action.
7. **Sub-processor compromise** — Clerk/Paystack/R2 breach.

## STRIDE per component

### `authenticate` middleware
- **S**poofing: forged JWTs blocked by signature check + JTI revocation.
- **R**epudiation: JTI + audit logs tie actions to a user; logout invalidates.
- **E**levation: role check via `requireRole` middleware; mass-assignment blocked by explicit Zod schemas.

### Payments (init + webhook)
- **T**ampering: webhook HMAC-SHA512 verified before parsing.
- **R**eplay: idempotency by `paystackTransactionId` (V11.1.4 fix). Webhook + verify path both protected.
- **I**nformation disclosure: callback URL restricted to CORS_ORIGINS to prevent open-redirect / phishing.

### Uploads (R2 presign)
- **T**ampering: content-type allowlist enforced server-side; size capped at 10MB.
- **I**nformation disclosure: presigned URLs expire in 5 min; keys include `randomUUID()` to prevent enumeration.
- **DoS:** rate limit applies.

### Support tickets + WebSocket
- **I**nformation disclosure: BOLA enforced on HTTP routes and on WebSocket `support:join` (V4.2.1 fix). Customers cannot read others' tickets or join others' rooms.

### Admin / staff endpoints
- **E**levation: optional `ADMIN_IP_WHITELIST` enforced on login routes.
- **R**epudiation: every 403 logged to `auditLogs` (V4.1.5 fix).
- **DoS:** per-account login lockout after 5 fails (V2.2.3).

### Gallery claim review
- **R**ace condition: row-locked inside transaction (V11.1.4 fix). Two concurrent reviewers cannot double-approve.

## Top risks (residual after current controls)

1. **Compromised staff JWT_SECRET** → forge any internal JWT. Mitigation: rotation runbook, MFA (not yet implemented). **Open.**
2. **Compromised ENCRYPTION_KEY** → decrypt every PII column. Mitigation: rotation runbook, secrets-manager-only storage. **Open.**
3. **Compromised Clerk session secret** → impersonate customers. Mitigation: rotate in Clerk, redeploy. Detection requires Clerk alerts.
4. **Supply-chain attack on npm** → backdoor in dependency. Mitigation: `npm audit --audit-level=high` + Dependabot + CodeQL in CI; majors held for manual review.
5. **Self-hosted GitHub runner compromise** → can deploy malicious code. Mitigation: runner is currently used only for fly-deploy + render-keepalive; the security CI runs on GitHub-hosted runners. **Lock down runner host or move to ephemeral.**
6. **Malicious file upload** → R2 hosts user-uploaded files (receipts, IDs). Currently no AV scanning. **Open — V12.4.1.**
7. **MFA not enforced** for staff → password compromise gives full admin. **Open — V4.3.1.**

## Out of scope (delegated)

- DDoS at L3/L4: Cloudflare / Render edge.
- TLS termination: Render.
- Browser-side input sanitization: Vercel frontend.
- Card data handling: Paystack (SAQ-A scope; we never see PANs).

## Update history

- 2026-05-17 — initial document, after ASVS L2 self-assessment pass.
