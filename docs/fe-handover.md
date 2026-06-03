# Backend integration handover

The backend has shipped a REST standards + ASVS L2 pass that introduces 8 changes the FE needs to absorb before launch. None of them are subtle — most are breaking shape changes — but each is small in isolation. Estimated total FE effort: **1–2 dev-days** spread across one engineer.

The backend is live and verified at **https://global-express-backend-1.onrender.com**. Smoke checks pass; the contract is stable.

---

## Resources you'll use

| Resource | URL | Use |
|---|---|---|
| Full API reference | [`API_ENDPOINTS.md`](../API_ENDPOINTS.md) | Per-endpoint payloads, responses, headers, errors |
| OpenAPI 3 spec (live) | `https://global-express-backend-1.onrender.com/openapi.json` | Auto-generate a TypeScript client |
| Interactive explorer | `https://global-express-backend-1.onrender.com/docs` | Click-through endpoint testing |
| Conventions doc | [`API_ENDPOINTS.md#conventions`](../API_ENDPOINTS.md#conventions) | Headers, envelopes, error format |

**To generate a typed client:**
```bash
npx openapi-typescript https://global-express-backend-1.onrender.com/openapi.json \
  -o src/api/schema.ts
```
or with `openapi-generator-cli`:
```bash
openapi-generator-cli generate \
  -i https://global-express-backend-1.onrender.com/openapi.json \
  -g typescript-fetch -o src/api
```

---

## The 9 changes

### 1 — Error responses are now RFC 7807 Problem Details

**Where:** every endpoint, every error status code (400, 401, 403, 404, 409, 422, 423, 429, 500, 503).

**Old shape (no longer sent):**
```json
{ "success": false, "message": "Invalid email or password" }
```

**New shape:**
```json
{
  "type": "/problems/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "Invalid email or password",
  "instance": "/api/v1/auth/login",
  "requestId": "req-2y"
}
```

The `Content-Type` header is `application/problem+json; charset=utf-8` (not `application/json`).

**Validation errors** additionally carry an `errors[]` array with per-field paths:
```json
{
  "type": "/problems/validation",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more request fields failed validation.",
  "instance": "/api/v1/payments/initialize",
  "requestId": "req-21",
  "errors": [
    { "path": ["amount"], "message": "Invalid input: expected number, received undefined", "code": "invalid_type" }
  ]
}
```

**FE action — write one error parser and use it everywhere:**

> **Important:** every successful response is wrapped in `{ success: true, data: T }`. The helper below auto-unwraps `.data` so `result.data` holds the real payload — but this means the type parameter `T` should be the **inner** type (e.g. `{ user, tokens }`), NOT the envelope.

```ts
export interface Problem {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  requestId: string
  errors?: Array<{ path: (string | number)[]; message: string; code?: string }>
  // Extension fields appear at the top level (not nested), e.g.
  //   `code: "captcha_failed"` on 422 CAPTCHA failures
  //   `lockedUntil: "<ISO 8601>"` on 423 account lockouts
  [extension: string]: unknown
}

interface Envelope<T> {
  success: true
  data: T
}

export async function callApi<T>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; problem: Problem }> {
  const res = await fetch(url, init)
  const body = await res.json()
  if (!res.ok) {
    return { ok: false, problem: body as Problem }
  }
  // Every success response uses { success: true, data: T }; auto-unwrap.
  return { ok: true, data: (body as Envelope<T>).data }
}

// Usage in a component
type LoginResponse =
  | { user: Operator; tokens: { accessToken: string } }
  | { mfaRequired: true; mfaToken: string; userId: string }

const result = await callApi<LoginResponse>('/api/v1/auth/login', { ... })
if (!result.ok) {
  showError(result.problem.detail)               // human-readable message
  showSupportRef(result.problem.requestId)       // "ref: req-2y" in the UI
  if (result.problem.type === '/problems/validation') {
    setFieldErrors(result.problem.errors!)       // per-field highlight
  }
  if (result.problem.type === '/problems/locked') {
    showLockoutCountdown(result.problem.lockedUntil as string)
  }
  return
}
// Success: result.data is the INNER payload (already unwrapped).
if ('mfaRequired' in result.data) {
  // → MFA challenge flow
} else {
  const { user, tokens } = result.data
}
```

**Known `type` URIs you can switch on:**

| `type` | Status | When |
|---|---|---|
| `/problems/validation` | 400 | Zod schema rejected the body — `errors[]` is populated |
| `/problems/unauthorized` | 401 | Missing/invalid token, bad credentials |
| `/problems/forbidden` | 403 | Wrong role, BOLA, IP allowlist |
| `/problems/not-found` | 404 | Resource not found |
| `/problems/conflict` | 409 | State conflict, duplicate, already-used key |
| `/problems/unprocessable` | 422 | Semantic — profile incomplete, CAPTCHA failed, callback URL not allowed |
| `/problems/locked` | 423 | Login lockout — extension field `lockedUntil` is an ISO timestamp |
| `/problems/rate-limited` | 429 | Per-route or global rate limit |
| `/problems/internal` | 500 | Unhandled — generic message in prod |
| `/problems/service-unavailable` | 503 | Webhook secret unset, DB down |

**Acceptance:**
- [ ] No FE code references `response.message` directly — all paths read `problem.detail` (or `problem.errors[].message` for fields)
- [ ] Error UI shows `problem.requestId` so users can quote it in support tickets

---

### 2 — `/auth/*` endpoints now use the standard envelope

**Where:** all 9 routes under `/api/v1/auth/*`.

These used to return flat shapes; they now wrap in `{ success: true, data: ... }` like every other endpoint.

| Endpoint | Old shape (top-level) | New shape (inside `data`) |
|---|---|---|
| `POST /auth/login` (no MFA) | `{ user, tokens }` | `{ user, tokens }` |
| `POST /auth/login` (MFA) | `{ mfaRequired, mfaToken, userId }` | `{ mfaRequired, mfaToken, userId }` |
| `POST /auth/mfa/verify` | `{ user, tokens }` | `{ user, tokens }` |
| `POST /auth/mfa/recovery` | `{ user, tokens, remainingRecoveryCodes }` | `{ user, tokens, remainingRecoveryCodes }` |
| `GET /auth/me` | `<operator>` | `<operator>` |
| `POST /auth/logout` | `{ message }` | `{ message }` |
| `POST /auth/forgot-password/send-otp` | `{ message }` | `{ message }` |
| `POST /auth/forgot-password/verify-otp` | `{ message }` | `{ message }` |
| `POST /auth/forgot-password/reset` | `{ message }` | `{ message }` |
| `POST /auth/sync` | already `{ success, data }` | unchanged |
| `POST /auth/register` | `{ message, clerkSignUpUrl }` | `{ message, clerkSignUpUrl }` |

**FE action:** if you use the `callApi` helper above (which auto-unwraps), no extra work — `result.data` is the inner payload. If you parse responses directly, remember to access `body.data` instead of `body` (one extra hop).

```ts
// Before
const { user, tokens } = await fetch('/api/v1/auth/login', ...).then(r => r.json())

// After (with the helper)
const result = await callApi<{ user: Operator; tokens: { accessToken: string } }>('/api/v1/auth/login', ...)
if (!result.ok) { /* handle problem */ return }
const { user, tokens } = result.data

// After (without the helper)
const body = await fetch('/api/v1/auth/login', ...).then(r => r.json())
const { user, tokens } = body.data
```

**Acceptance:**
- [ ] All 9 `/auth/*` callers unwrap `.data`
- [ ] Login still completes end-to-end (test both MFA and non-MFA users)

---

### 3 — `Idempotency-Key` header on payment / order / ticket creation

**Where:** 3 POST endpoints.

| Endpoint | Why it matters |
|---|---|
| `POST /api/v1/payments/initialize` | **Critical.** Without it, a network failure or double-click could create two pending Paystack transactions |
| `POST /api/v1/orders` | Customer double-submitting the order wizard |
| `POST /api/v1/support/tickets` | Customer double-submitting the "open ticket" form |

**FE action:** generate a UUID per logical submit click and attach it as a header. Reuse the same key on retries (network failures, page reloads mid-submit). Use a fresh key for a fresh user action.

```ts
const idempotencyKey = crypto.randomUUID()

await fetch('/api/v1/payments/initialize', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Idempotency-Key': idempotencyKey,
  },
  body: JSON.stringify({ orderId, amount, callbackUrl }),
})
```

**Server behaviour:**
- First call with a given key → handler runs normally, response is persisted for 24h
- Retry with **same key + same body** → returns the cached response, with header `Idempotent-Replayed: true`
- Retry with **same key + different body** → returns 422 (`detail: "Idempotency-Key has already been used with a different request"`)

**Key format:** `[A-Za-z0-9_-]{8,255}`. UUID v4 (36 chars) fits.

**Acceptance:**
- [ ] All 3 endpoints attach `Idempotency-Key` from `crypto.randomUUID()`
- [ ] Hard refresh during a payment-init does NOT create a duplicate Paystack transaction

---

### 4 — Cloudflare Turnstile CAPTCHA on public mutation endpoints

**Where:** 5 unauthenticated POST endpoints.

| Endpoint | What it is |
|---|---|
| `POST /api/v1/public/newsletter/subscribe` | Newsletter form |
| `POST /api/v1/public/gallery/claims/presign` | Anonymous claim — proof upload presign |
| `POST /api/v1/public/gallery/anonymous/:trackingNumber/claim` | Submit anonymous ownership claim |
| `POST /api/v1/public/gallery/cars/:trackingNumber/purchase-attempt` | Anonymous car interest |
| `POST /api/v1/public/d2d/intake` | Unauthenticated D2D intake form |

The CAPTCHA token goes in the header `cf-turnstile-response`.

**Getting the site key:**
The site key is already provisioned at Cloudflare → dashboard → Turnstile. Ask whoever set it up (or check `1Password` if you store keys there) — there's a public **site key** (safe to commit to FE code) and a separate **secret key** (already wired into the backend env on Render).

The site key looks like `0x4AAAAAAA...`. You can also generate test keys (always-pass / always-fail) at https://developers.cloudflare.com/turnstile/troubleshooting/testing/ for local dev.

**FE action:** install the widget and attach the token.

```bash
npm install @marsidev/react-turnstile
```

```tsx
import { Turnstile } from '@marsidev/react-turnstile'

export function NewsletterForm() {
  const [token, setToken] = useState<string>('')
  const turnstileRef = useRef<TurnstileInstance | null>(null)

  async function submit(email: string) {
    const result = await callApi<{ message: string }>('/api/v1/public/newsletter/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-turnstile-response': token,
      },
      body: JSON.stringify({ email }),
    })
    if (!result.ok) {
      // CAPTCHA failed/expired: reset the widget and ask the user to try again
      if (
        result.problem.type === '/problems/unprocessable' &&
        (result.problem.code === 'captcha_failed' || result.problem.code === 'captcha_missing')
      ) {
        turnstileRef.current?.reset()
        showError('Please complete the verification and try again')
        return
      }
      showError(result.problem.detail)
      return
    }
    // success
  }

  return (
    <form>
      {/* ... email field ... */}
      <Turnstile
        ref={turnstileRef}
        siteKey="0x4AAAAAAA..." // from Cloudflare dashboard
        onSuccess={setToken}
      />
      <button disabled={!token} onClick={() => submit(email)}>Subscribe</button>
    </form>
  )
}
```

**Notes:**
- Tokens are single-use and expire after 5 minutes
- On any failure, call `turnstileRef.current?.reset()` to get a fresh token
- Dev: if `TURNSTILE_SECRET_KEY` isn't set on the backend (typical for localhost), the middleware no-ops — local dev "just works" without setup

**Acceptance:**
- [ ] All 5 public forms render the Turnstile widget
- [ ] The `cf-turnstile-response` header is attached on submit
- [ ] On 422 with `code: "captcha_failed"`, widget resets and user can retry

---

### 5 — Show `X-Request-ID` in error UIs

**Where:** every response carries `X-Request-ID: req-<n>`. It's exposed via CORS — readable from `fetch().headers.get('x-request-id')`.

**FE action:** put it in your error component as "support reference" text. When customers report bugs, you can quote it back and we can search server logs instantly.

```tsx
function ErrorDisplay({ problem }: { problem: Problem }) {
  return (
    <div className="error">
      <p>{problem.detail}</p>
      <p className="ref">If you contact support, reference <code>{problem.requestId}</code></p>
    </div>
  )
}
```

You can also pull it from the response header directly if you've stored it before parsing:

```ts
const requestId = res.headers.get('x-request-id')
```

Both work; `problem.requestId` is set on every error response, so just using that is simpler.

**Acceptance:**
- [ ] Error toasts / error pages show `requestId` somewhere visible

---

### 6 — File-scan gating before opening uploaded files

**Where:** staff dashboard — anywhere the FE displays / lets staff open a user-uploaded file. That includes:
- Payment receipts (review queue)
- Anonymous gallery claim proofs
- Invoice attachments (task invoices, regulatory docs)
- Package images

Every uploaded file is now AV-scanned via VirusTotal. The FE must check the scan verdict before exposing the file.

**FE action:** before showing/opening any uploaded file, call:

```ts
const status = await callApi<{
  r2Key: string
  status: 'pending' | 'clean' | 'malicious' | 'error' | 'skipped'
  scannedAt: string | null
}>(`/api/v1/internal/file-scans/status?r2Key=${encodeURIComponent(r2Key)}`, {
  headers: { Authorization: `Bearer ${staffToken}` },
})
```

UI behaviour by status:

| Status | UI |
|---|---|
| `pending` | "Scan in progress — refresh in a moment" — do NOT show file |
| `clean` | Show file normally |
| `malicious` | "This file was flagged and removed" with a red warning — file is also deleted from R2 |
| `error` | "Scan failed — admin can retry" — treat as untrusted; do NOT show |
| `skipped` | "Not scanned (VT didn't recognise the hash)" — show with a small caveat (e.g. amber dot). Common on legit but unique files. |

Recommended pattern: render a small status pill next to each file in the list and only open the file viewer when status is `clean`. Poll every 10s for `pending` rows until they resolve.

**Acceptance:**
- [ ] No staff UI page opens a user-uploaded file without first checking scan status
- [ ] `malicious` status shows a red warning instead of the file
- [ ] `pending` status is handled gracefully (placeholder + auto-refresh)

---

### 7 — MFA branches in the login flow

**Where:** operator dashboard login.

The login response now has TWO success shapes depending on whether the user has MFA enrolled. The FE must branch:

```ts
type LoginNoMfa = {
  user: Operator
  tokens: { accessToken: string }
}

type LoginMfaChallenge = {
  mfaRequired: true
  mfaToken: string
  userId: string
}

const result = await callApi<LoginNoMfa | LoginMfaChallenge>('/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
})

if (!result.ok) {
  // lockout? validation? show problem.detail
  return
}

// Branch on the response shape
if ('mfaRequired' in result.data) {
  // → push to MFA verify screen
  navigate('/mfa-verify', { state: { mfaToken: result.data.mfaToken } })
  return
}

// No MFA — fully logged in
const { user, tokens } = result.data
storeToken(tokens.accessToken)

// But the user might still need to enroll MFA (policy requires it for superadmin)
if (user.mustEnrollMfa) {
  navigate('/mfa-enroll')
} else if (user.mustChangePassword) {
  navigate('/change-password')
} else if (user.mustCompleteProfile) {
  navigate('/complete-profile')
} else {
  navigate('/dashboard')
}
```

**MFA verify screen** sends the `mfaToken` + 6-digit TOTP code to `POST /api/v1/auth/mfa/verify`. On success the response is the same `{ data: { user, tokens } }` shape as a no-MFA login.

**MFA recovery** (lost authenticator) goes to `POST /api/v1/auth/mfa/recovery` with a single-use recovery code. Response includes `data.remainingRecoveryCodes` — warn the user if it drops to 2 or below.

**MFA enrollment** (only when `user.mustEnrollMfa === true`):
1. `POST /api/v1/internal/me/mfa/enroll` → returns `{ data: { secret, otpauthUri } }`. Render `otpauthUri` as a QR code (e.g. `qrcode` package), show `secret` as a copy-paste fallback.
2. User scans into authenticator app, types the first 6-digit code.
3. `POST /api/v1/internal/me/mfa/verify-enrollment` with `{ code }` → returns `{ data: { recoveryCodes, warning } }`. **Show all 10 codes and force the user to confirm they've saved them** (download-as-text + "I've saved them" checkbox). They can't be retrieved later.

**Acceptance:**
- [ ] Operator can log in with no MFA → reaches dashboard
- [ ] Superadmin first-login hits enrollment screen, scans QR, sees recovery codes (and is forced to acknowledge saving them)
- [ ] Operator with MFA can log in via TOTP
- [ ] Operator can use a recovery code if they lose their authenticator

---

### 8 — `?sort=` query parameter (not yet wired — informational only)

**Status:** the `parseSortQuery` utility is implemented on the server, but **no list endpoint has adopted it yet**. Sending `?sort=…` today does nothing — the parameter is silently ignored and the endpoint's default ordering is used.

When the FE has a screen that needs sortable columns, raise it with the backend so we wire it into that specific endpoint with an explicit allowlist of sortable fields. Once wired, the contract will be:

- `?sort=field` — ascending
- `?sort=-field` — descending
- `?sort=-status,createdAt` — multi-field with commas (primary desc, tiebreak asc)

Allowed fields will be server-enforced per endpoint; unknown field names will be silently dropped.

**Acceptance:**
- [ ] Not currently actionable — flag in standup if/when a sortable list UI is queued.

---

### 9 — Shipping mark UX

**Where:** customer profile screen.

The backend auto-generates a shipping mark for every new customer at signup (e.g., Julius Adebowale → `julade`, Pluralcode business → `plural`). Customers can replace it **once** via `PATCH /api/v1/users/me` to use their actual preferred alias. After that, the mark locks from the customer side — only staff can change it.

A shipping mark is **not** a tracking number — we already have tracking numbers (`GEX-…`). It's a personal alias the customer hand-writes on physical boxes during consolidation, so the Korean warehouse and Lagos receiving office can match cargo to the right person at a glance. Common industry conventions: short (3–10 chars), customer-chosen, often nicknames. Examples: `jay`, `juadeb`, `hayomz`, `queen24`, `plural99`.

**Format:** 3–20 chars, lowercase letters + digits, must start with a letter. Regex: `^[a-z][a-z0-9]{2,19}$`. The server normalises uppercase input — `JUADEB` becomes `juadeb` — so don't strict-error on case in the FE.

**FE action:**

1. **Read the lock state from `data.shippingMarkUserEditedAt`:**

   ```ts
   const profile = (await callApi<User>('/api/v1/users/me')).data
   const canEditShippingMark = profile.shippingMarkUserEditedAt === null
   ```

2. **When `canEditShippingMark` is true** → show an editable input pre-filled with `profile.shippingMark`. On submit, normalise to lowercase and validate the format client-side to avoid the 400 round-trip:

   ```ts
   const SHIPPING_MARK_REGEX = /^[a-z][a-z0-9]{2,19}$/
   const input = rawInput.trim().toLowerCase()
   if (!SHIPPING_MARK_REGEX.test(input)) {
     showError('Use 3–20 lowercase letters and digits, starting with a letter')
     return
   }
   await callApi<User>('/api/v1/users/me', {
     method: 'PATCH',
     body: JSON.stringify({ shippingMark: input }),
   })
   ```

3. **When `canEditShippingMark` is false** → render the mark as read-only with a short explanation and a path to support:

   > "Your shipping mark `juadeb` is locked. Contact support to change it."

4. **Error handling:** if the API returns 409 with `type: "/problems/conflict"`, the customer's already used their edit. Refresh `GET /users/me` to pick up the new `shippingMarkUserEditedAt` and re-render the locked UI.

```tsx
function ShippingMarkField({ profile }: { profile: User }) {
  const locked = profile.shippingMarkUserEditedAt !== null
  if (locked) {
    return (
      <div>
        <label>Shipping mark</label>
        <code>{profile.shippingMark}</code>
        <p>Locked. <a href="/support/new">Contact support</a> to change it.</p>
      </div>
    )
  }
  return <EditableShippingMarkForm initial={profile.shippingMark} />
}
```

**Acceptance:**
- [ ] Profile screen shows `data.shippingMark` (no more "Not provided yet" for that field)
- [ ] Customers whose `shippingMarkUserEditedAt === null` see an editable field
- [ ] After submitting a valid edit, the field becomes read-only and reflects the new mark
- [ ] 409 response triggers a re-fetch and the locked UI
- [ ] Format errors (400) surface `problem.detail` to the user

---

## Test checklist before declaring "FE integrated"

| Test | Expected |
|---|---|
| Submit login form with bad password | Banner shows `problem.detail`, ref code visible |
| Submit login form with empty password | Field-level error from `problem.errors[].path` |
| Login after 5 bad attempts | 423 — countdown to `problem.lockedUntil` |
| Submit newsletter without solving Turnstile | Turnstile widget alerts user, no API call made |
| Submit newsletter with stale Turnstile token | 422, widget resets, user can retry |
| Initialize payment, kill network mid-request, retry | Single Paystack transaction created (`Idempotent-Replayed: true` on retry) |
| Staff opens unscanned receipt | Sees "scan pending" placeholder, not the file |
| Staff opens malicious receipt | Red warning, file not displayed |
| Superadmin first-login | Forced through MFA enrollment, sees 10 recovery codes |
| Superadmin logs in with TOTP | Lands on dashboard |
| Superadmin logs in with recovery code | Lands on dashboard, sees "9 codes left" warning |
| Customer profile shows pre-populated address + shipping mark | All fields rendered from `data.*`, no "Not provided yet" |
| Customer with `shippingMarkUserEditedAt === null` edits shipping mark to `jay` | 200, field becomes read-only, `data.shippingMarkUserEditedAt` is now non-null |
| Same customer tries to edit again | 409 `conflict`, FE re-fetches profile and shows the locked UI |
| Customer types shipping mark with invalid format (`A1`, `1abc`, `with space`) | 400 with `problem.detail` describing the format |
| Any error response in DevTools | Content-Type is `application/problem+json`, body has `type/title/status/detail/instance/requestId` |

---

## Questions or unclear shapes?

Check `API_ENDPOINTS.md` first (single source of truth). If you can't find what you need, the OpenAPI spec at `/openapi.json` is auto-generated from the source schemas so it can't be out of sync.
