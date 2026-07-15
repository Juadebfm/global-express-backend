# Security Policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in this project, please report it privately. **Do not open a public GitHub issue.**

- **Email:** security@globalexpress.kr (or `coopaaronic@gmail.com` as fallback)
- **Subject line:** `[SECURITY] <short description>`
- **What to include:**
  - A description of the issue and its impact
  - Steps to reproduce (proof-of-concept if possible)
  - Affected endpoints, versions, or commits
  - Your contact details so we can follow up
- **PGP:** not currently published — if you need encrypted comms, request a key over the channel above and we'll provide one.

We aim to:

- Acknowledge your report within **2 business days**
- Provide an initial assessment within **7 days**
- Coordinate disclosure once a fix is shipped

## Supported versions

This is a private SaaS deployment. Only the `main` branch is supported; the production deployment tracks `main`. There are no LTS or backport branches.

## Scope

In scope:
- The HTTP API hosted at `globalexpress.kr` and the Render-hosted backend service
- The WebSocket endpoint at `/ws`
- The webhook endpoints at `/webhooks/*` and `/api/v1/payments/webhook`
- Authentication and authorization logic
- Data-at-rest encryption of PII

Out of scope:
- The Vercel-hosted frontend (report frontend issues separately)
- Clerk-managed authentication infrastructure (report to Clerk)
- Paystack-managed payment infrastructure (report to Paystack)
- Cloudflare R2 storage internals (report to Cloudflare)
- Social-engineering attacks against staff
- Denial-of-service via volumetric traffic (this is handled at the CDN layer)

## Safe-harbor

We will not pursue legal action against researchers who:
- Make a good-faith effort to avoid privacy violations, destruction of data, or interruption of service
- Only interact with accounts they own or have explicit permission to access
- Report vulnerabilities privately and give us reasonable time to remediate
- Do not exfiltrate data beyond what is necessary to demonstrate the issue

## Engagement testing

We periodically engage external security testers under signed agreements. If you are an authorized tester, your scope is defined in the engagement contract — this `SECURITY.md` does not grant additional permissions.

## Related docs

- [Archived ASVS L2 self-assessment](docs/archive/SECURITY_CHECKLIST.md) — historical assessment status
- [API_ENDPOINTS.md](API_ENDPOINTS.md) — full endpoint reference (auth requirements per route)
