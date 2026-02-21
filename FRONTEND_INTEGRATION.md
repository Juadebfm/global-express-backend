# Frontend Integration Guide — Global Express Backend

**Base URL:** `https://your-app-name-snowy-waterfall-9062.fly.dev`
**API Prefix:** `/api/v1`
**Swagger Docs:** `https://your-app-name-snowy-waterfall-9062.fly.dev/docs`

---

## Auth Architecture

| User Type | Auth Method | Token Format |
|---|---|---|
| Customers | Clerk (custom signup form) | Clerk JWT |
| Staff / Admin / Superadmin | Internal (email + password) | Internal JWT |

---

## 1. Customer Registration

> **Do NOT use Clerk's prebuilt `<SignUp />` component.** Build a custom signup form using Clerk's `useSignUp()` hook. This gives you full control over the fields collected while Clerk still handles email verification and all notifications.

### Install Clerk

```bash
# React
npm install @clerk/clerk-react

# Next.js
npm install @clerk/nextjs
```

### Setup

```tsx
// main.tsx / _app.tsx
import { ClerkProvider } from '@clerk/clerk-react'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

<ClerkProvider publishableKey={PUBLISHABLE_KEY}>
  <App />
</ClerkProvider>
```

### Signup Form — Required Fields

The signup form must collect **all of the following** in one flow (not split into signup + "complete profile later"):

| Field | Required | Notes |
|---|---|---|
| `firstName` + `lastName` | Yes (or businessName) | For individual accounts |
| `businessName` | Yes (or firstName+lastName) | For business accounts |
| `email` | Yes | Used for Clerk auth |
| `password` | Yes | Used for Clerk auth |
| `phone` | Yes | Direct line (e.g. +2348012345678) |
| `whatsappNumber` | Yes | WhatsApp number (can be same as phone) |
| `addressStreet` | Yes | Flat field — not nested |
| `addressCity` | Yes | |
| `addressState` | Yes | |
| `addressCountry` | Yes | |
| `addressPostalCode` | Yes | |

### Multi-step Signup Implementation

```tsx
import { useSignUp } from '@clerk/clerk-react'
import { useState } from 'react'

function SignUpPage() {
  const { signUp, setActive } = useSignUp()
  const { authFetch } = useApi()

  const [step, setStep] = useState<'account' | 'verify' | 'details'>('account')
  const [verificationCode, setVerificationCode] = useState('')

  // Form state
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    businessName: '',        // leave empty for individual accounts
    email: '',
    password: '',
    phone: '',
    whatsappNumber: '',      // field name is whatsappNumber (not whatsapp)
    addressStreet: '',       // flat fields — NOT nested address object
    addressCity: '',
    addressState: '',
    addressCountry: 'Nigeria',
    addressPostalCode: '',
  })

  // Step 1 — Create Clerk account, trigger email verification
  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await signUp!.create({
      firstName: form.firstName,
      lastName: form.lastName,
      emailAddress: form.email,
      password: form.password,
    })
    // Clerk sends a verification email automatically
    await signUp!.prepareEmailAddressVerification({ strategy: 'email_code' })
    setStep('verify')
  }

  // Step 2 — Verify email with OTP code from email
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await signUp!.attemptEmailAddressVerification({
      code: verificationCode,
    })
    if (result.status === 'complete') {
      await setActive!({ session: result.createdSessionId })
      // Clerk webhook fires here → backend provisions the user
      // Move to collecting contact + address details
      setStep('details')
    }
  }

  // Step 3 — Save phone, whatsappNumber, and address to backend
  const handleDetailsSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await authFetch('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        businessName: form.businessName || undefined,
        phone: form.phone,
        whatsappNumber: form.whatsappNumber,  // note: whatsappNumber not whatsapp
        addressStreet: form.addressStreet,    // flat fields — not nested
        addressCity: form.addressCity,
        addressState: form.addressState,
        addressCountry: form.addressCountry,
        addressPostalCode: form.addressPostalCode,
      }),
    })
    // Registration complete — redirect to dashboard
    window.location.href = '/dashboard'
  }

  if (step === 'account') return (
    <form onSubmit={handleAccountSubmit}>
      <input placeholder="First Name" onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
      <input placeholder="Last Name" onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
      <input placeholder="Business Name (optional)" onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))} />
      <input type="email" placeholder="Email" onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
      <input type="password" placeholder="Password" onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
      <button type="submit">Continue</button>
    </form>
  )

  if (step === 'verify') return (
    <form onSubmit={handleVerify}>
      <p>Enter the 6-digit code sent to {form.email}</p>
      <input placeholder="Verification code" onChange={e => setVerificationCode(e.target.value)} />
      <button type="submit">Verify Email</button>
    </form>
  )

  if (step === 'details') return (
    <form onSubmit={handleDetailsSubmit}>
      <input placeholder="Direct Phone Line (e.g. +2348012345678)" onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
      <input placeholder="WhatsApp Number" onChange={e => setForm(f => ({ ...f, whatsappNumber: e.target.value }))} />
      <input placeholder="Street Address" onChange={e => setForm(f => ({ ...f, addressStreet: e.target.value }))} />
      <input placeholder="City" onChange={e => setForm(f => ({ ...f, addressCity: e.target.value }))} />
      <input placeholder="State" onChange={e => setForm(f => ({ ...f, addressState: e.target.value }))} />
      <input placeholder="Country" defaultValue="Nigeria" onChange={e => setForm(f => ({ ...f, addressCountry: e.target.value }))} />
      <input placeholder="Postal Code" onChange={e => setForm(f => ({ ...f, addressPostalCode: e.target.value }))} />
      <button type="submit">Complete Registration</button>
    </form>
  )
}
```

### What happens during signup

1. **Step 1** — User fills email + password + name → Clerk creates account, sends verification email
2. **Step 2** — User enters OTP code from email → Clerk verifies, creates session
3. (Clerk webhook fires in the background → backend auto-creates the user record)
4. **Step 3** — User fills phone, WhatsApp, address → frontend calls `PATCH /api/v1/users/me` → profile saved
5. **Done** — User is fully registered with complete profile, redirect to dashboard

> **Important:** Step 3 must complete before the user can place orders. If they close the browser after step 2, they will be prompted to complete their details on next login (see section 3 below).

---

## 2. Customer Login

```tsx
import { SignIn } from '@clerk/clerk-react'

// Login page — prebuilt component is fine here
<SignIn routing="path" path="/sign-in" />
```

Or use `useSignIn()` hook for a fully custom login form.

---

## 3. Guard: Incomplete Profile After Login

On login, call `GET /api/v1/users/me` and compute profile completeness from the returned fields.
The API does **not** return an `isProfileComplete` flag — compute it yourself:

```tsx
import { useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'

// Mirror the same logic the backend uses in usersService.isProfileComplete()
function isProfileComplete(user: any): boolean {
  const hasName = (user.firstName && user.lastName) || user.businessName
  const hasPhone = !!user.phone
  const hasAddress =
    !!user.addressStreet &&
    !!user.addressCity &&
    !!user.addressState &&
    !!user.addressCountry &&
    !!user.addressPostalCode
  return !!(hasName && hasPhone && hasAddress)
}

function AppGuard({ children }) {
  const { isSignedIn } = useAuth()
  const { authFetch } = useApi()

  useEffect(() => {
    if (!isSignedIn) return
    authFetch('/users/me').then(res => {
      if (res.success && !isProfileComplete(res.data)) {
        window.location.href = '/complete-profile'
      }
    })
  }, [isSignedIn])

  return children
}
```

---

## 4. Making Authenticated API Calls

All protected endpoints require an `Authorization: Bearer <token>` header.

### Getting the Clerk JWT (React)

```tsx
import { useAuth } from '@clerk/clerk-react'

function useApi() {
  const { getToken } = useAuth()

  const authFetch = async (path: string, options: RequestInit = {}) => {
    const token = await getToken()
    const res = await fetch(`https://your-app-name-snowy-waterfall-9062.fly.dev/api/v1${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    })
    return res.json()
  }

  return { authFetch }
}
```

### Response shape

```json
// Success
{ "success": true, "data": { ... } }

// Error
{ "success": false, "message": "Reason for failure" }
```

---

## 5. Orders

### Create an order

```
POST /api/v1/orders
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "recipientName": "Jane Smith",
  "recipientAddress": "45 Marina Road, Abuja",
  "recipientPhone": "+2347098765432",
  "recipientEmail": "jane@example.com",
  "origin": "Lagos",
  "destination": "Abuja",
  "orderDirection": "outbound",
  "weight": "2.5kg",
  "declaredValue": "15000",
  "description": "Electronics"
}
```

Returns `201` with the created order including `trackingNumber`.

**Error responses:**
- `422` — Profile not complete. Redirect to `/complete-profile`.
- `401` — Token missing or invalid.

### List own orders

```
GET /api/v1/orders/my-shipments?page=1&limit=20
Authorization: Bearer <token>
```

### Track a shipment (public — no auth required)

```
GET /api/v1/orders/track/:trackingNumber
```

### Order status values

| Status | Meaning |
|---|---|
| `pending` | Order received, not yet processed |
| `processing` | Being prepared |
| `in_transit` | On the way |
| `out_for_delivery` | With delivery agent |
| `delivered` | Successfully delivered |
| `failed_delivery` | Delivery attempt failed |
| `returned` | Returned to sender |
| `cancelled` | Cancelled |

---

## 6. Real-time Order Status Updates (WebSocket)

Customers receive live status updates when staff updates their shipment.

```ts
function useOrderUpdates(onUpdate: (data: any) => void) {
  const { getToken } = useAuth()

  useEffect(() => {
    let ws: WebSocket

    const connect = async () => {
      const token = await getToken()
      ws = new WebSocket(
        `wss://your-app-name-snowy-waterfall-9062.fly.dev/ws?token=${token}`
      )
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === 'order_status_updated') {
          onUpdate(msg.data)
          // msg.data = { orderId, trackingNumber, status, updatedAt }
        }
      }
      ws.onclose = () => setTimeout(connect, 3000)
    }

    connect()
    return () => ws?.close()
  }, [])
}
```

---

## 7. Payments (Paystack)

### Initialize payment

```
POST /api/v1/payments/initialize
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "orderId": "order-uuid",
  "amount": 500000,
  "currency": "NGN"
}
```

> `amount` is in **kobo** — ₦5,000 = `500000`

Returns `{ authorizationUrl, reference }` — redirect user to `authorizationUrl`.

### Verify after redirect

```
GET /api/v1/payments/verify/:reference
Authorization: Bearer <token>
```

---

## 8. Full Registration Flow

```
Landing Page
  └─ Sign Up
       ├─ Step 1: Email + Password + Name  (Clerk creates account)
       ├─ Step 2: Email OTP verification   (Clerk sends code)
       └─ Step 3: Phone + WhatsApp + Address  (PATCH /api/v1/users/me)
            └─ Dashboard
                 ├─ My Shipments  (GET /orders/my-shipments)
                 ├─ Track Shipment  (GET /orders/track/:trackingNumber)
                 ├─ Create Order  (POST /orders)
                 │    └─ Pay  (POST /payments/initialize → redirect → verify)
                 └─ Account Settings  (PATCH /users/me)
```

---

## 9. Environment Variables (Frontend)

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_API_BASE_URL=https://your-app-name-snowy-waterfall-9062.fly.dev/api/v1
VITE_WS_URL=wss://your-app-name-snowy-waterfall-9062.fly.dev/ws
```
