# Frontend — User Registration & Onboarding Flow

## Overview

Registration is a **two-phase flow**:

1. **Clerk signup** — handles identity (email, password, verification)
2. **Profile completion** — collects logistics-specific info required before placing an order

---

## Phase 1 — Clerk Signup

### Step 1: Create account

Call Clerk's `signUp.create()` with email and password.

```ts
const result = await signUp.create({
  emailAddress: 'user@example.com',
  password: 'securePassword123',
})
```

### Step 2: Send email verification code

```ts
await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
// → Clerk sends a 6-digit OTP to the email
```

### Step 3: Verify the OTP

```ts
const result = await signUp.attemptEmailAddressVerification({ code: '123456' })

if (result.status === 'complete') {
  await setActive({ session: result.createdSessionId })
  // → User is now logged in with a valid Clerk session
}
```

---

## Phase 2 — Backend Sync

Immediately after `setActive()`, call the backend sync endpoint to provision the user in the database and get their profile.

### Request

```
POST /api/v1/auth/sync
Authorization: Bearer <clerk_session_jwt>
```

No body required.

### How to get the JWT

```ts
const token = await getToken()  // from useAuth() hook
```

### Response

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "clerkId": "user_xxx",
    "email": "user@example.com",
    "firstName": "John",       // from Clerk, may be null
    "lastName": "Doe",         // from Clerk, may be null
    "businessName": null,
    "phone": null,
    "whatsappNumber": null,
    "addressStreet": null,
    "addressCity": null,
    "addressState": null,
    "addressCountry": null,
    "addressPostalCode": null,
    "role": "user",
    "isActive": true,
    "consentMarketing": false,
    "createdAt": "2026-02-21T...",
    "updatedAt": "2026-02-21T..."
  }
}
```

**After sync:** call `GET /api/v1/users/me/completeness`. If `isComplete` is false, redirect to the profile completion screen.

---

## Phase 3 — Profile Completion

This screen is shown after signup **and** whenever a user tries to place an order with an incomplete profile.

### What "complete profile" means

The backend requires **all of the following** before a customer can place an order:

| Field | Rule |
|-------|------|
| Name | Either (`firstName` + `lastName`) **or** `businessName` — at least one set |
| `phone` | Required |
| `whatsappNumber` | Optional (can be same as phone) |
| `addressStreet` | Required |
| `addressCity` | Required |
| `addressState` | Required |
| `addressCountry` | Required |
| `addressPostalCode` | Required |

### Profile completeness endpoint

```http
GET /api/v1/users/me/completeness
Authorization: Bearer <clerk_session_jwt>
```

```json
{
  "success": true,
  "data": {
    "isComplete": false,
    "missingFields": ["addressStreet", "addressCity", "addressState"]
  }
}
```

### Profile completion request

```
PATCH /api/v1/users/me
Authorization: Bearer <clerk_session_jwt>
Content-Type: application/json
```

**Body — individual customer:**

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+2348012345678",
  "whatsappNumber": "+2348012345678",
  "addressStreet": "12 Allen Avenue",
  "addressCity": "Lagos",
  "addressState": "Lagos",
  "addressCountry": "Nigeria",
  "addressPostalCode": "100001"
}
```

**Body — business account:**

```json
{
  "businessName": "Acme Imports Ltd",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+2348012345678",
  "whatsappNumber": "+2349087654321",
  "addressStreet": "5 Industrial Road",
  "addressCity": "Kano",
  "addressState": "Kano",
  "addressCountry": "Nigeria",
  "addressPostalCode": "700001"
}
```

> `firstName`/`lastName` are optional if `businessName` is provided, but you can collect both.
> `whatsappNumber` can be the same value as `phone` and is optional for profile completeness.

### Response

Same user object as the sync response, with all fields populated.

---

## Complete Signup Flow (code sketch)

```ts
async function handleSignup(form: SignupForm) {
  // 1. Create Clerk account
  const signUpResult = await signUp.create({
    emailAddress: form.email,
    password: form.password,
  })

  // 2. Send OTP
  await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
  // → show OTP input screen
}

async function handleOtpVerification(code: string) {
  // 3. Verify OTP
  const result = await signUp.attemptEmailAddressVerification({ code })

  if (result.status !== 'complete') return  // show error

  await setActive({ session: result.createdSessionId })

  // 4. Sync to backend
  const token = await getToken()
  await apiFetch('/api/v1/auth/sync', {
    method: 'POST',
    token,
  })

  // 5. Redirect based on profile completeness
  const { data: completeness } = await apiFetch('/api/v1/users/me/completeness', {
    token,
  })
  if (completeness.isComplete) {
    navigate('/dashboard')
  } else {
    navigate('/complete-profile')
  }
}

async function handleProfileCompletion(form: ProfileForm) {
  // 6. Save profile
  const token = await getToken()
  await apiFetch('/api/v1/users/me', {
    method: 'PATCH',
    token,
    body: form,
  })

  navigate('/dashboard')
}
```

---

## UX Notes

- **WhatsApp field**: Show a checkbox "My WhatsApp number is the same as my phone number". If checked, copy the phone value into `whatsappNumber` before submitting. `whatsappNumber` remains optional for profile completeness.
- **Business toggle**: Show a toggle "I'm registering as a business". If on, show `businessName` field (required) + optional `firstName`/`lastName`. If off, show `firstName` + `lastName` (both required).
- **Profile completion banner**: On the dashboard, call `/api/v1/users/me/completeness`. If `isComplete` is false, show a persistent banner prompting the user to finish profile fields. Block the "New Order" button until complete.
- **Order creation 422**: If the backend returns `422` on `POST /api/v1/orders`, redirect the user to the profile completion screen.


