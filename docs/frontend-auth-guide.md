# Frontend Authentication Guide — Global Express

This guide covers how to implement all auth flows on the frontend using **Clerk**.
The backend does **not** expose its own auth endpoints — Clerk handles all of it.

---

## 1. Setup

Install the Clerk SDK for your framework:

```bash
# React / Next.js
npm install @clerk/clerk-react        # React
npm install @clerk/nextjs             # Next.js

# Vue / Nuxt
npm install @clerk/vue                # Vue 3
npm install @clerk/nuxtjs             # Nuxt

# Vanilla JS / other
npm install @clerk/clerk-js
```

Add your publishable key to the frontend `.env`:

```env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...   # Vite / React
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...  # Next.js
```

Wrap your app with `<ClerkProvider>`:

```tsx
// React example (main.tsx / App.tsx)
import { ClerkProvider } from '@clerk/clerk-react'

<ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
  <App />
</ClerkProvider>
```

---

## 2. Sign Up (Registration)

Use Clerk's pre-built `<SignUp />` component or Clerk's `useSignUp()` hook.

### Option A — Pre-built component (recommended)

```tsx
import { SignUp } from '@clerk/clerk-react'

export function RegisterPage() {
  return (
    <SignUp
      routing="path"
      path="/register"
      afterSignUpUrl="/dashboard"   // redirect after successful signup
    />
  )
}
```

Clerk handles:
- Email + password validation
- Email verification (OTP)
- Duplicate email checks
- Error messaging

### Option B — Custom UI with `useSignUp()`

```tsx
import { useSignUp } from '@clerk/clerk-react'

export function RegisterPage() {
  const { signUp, setActive } = useSignUp()

  async function handleSubmit(email: string, password: string, firstName: string, lastName: string) {
    try {
      const result = await signUp.create({
        emailAddress: email,
        password,
        firstName,
        lastName,
      })

      // Send email verification code
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })

      // Then prompt user to enter the code...
    } catch (err) {
      // err.errors[0].message contains the human-readable error
      console.error(err)
    }
  }

  async function verifyEmail(code: string) {
    const result = await signUp.attemptEmailAddressVerification({ code })
    if (result.status === 'complete') {
      await setActive({ session: result.createdSessionId })
      // Redirect to dashboard
    }
  }
}
```

> **Note:** After the user signs up and gets a session, your backend auto-provisions their
> account on the first authenticated API call via the `authenticate` middleware.
> No separate registration call to the backend is needed.

---

## 3. Sign In (Login)

### Option A — Pre-built component

```tsx
import { SignIn } from '@clerk/clerk-react'

export function LoginPage() {
  return (
    <SignIn
      routing="path"
      path="/login"
      afterSignInUrl="/dashboard"
    />
  )
}
```

### Option B — Custom UI with `useSignIn()`

```tsx
import { useSignIn } from '@clerk/clerk-react'

export function LoginPage() {
  const { signIn, setActive } = useSignIn()

  async function handleLogin(email: string, password: string) {
    try {
      const result = await signIn.create({
        identifier: email,
        password,
      })

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId })
        // Redirect to dashboard
      }
    } catch (err) {
      // err.errors[0].message — e.g., "Incorrect password"
      console.error(err)
    }
  }
}
```

---

## 4. Forgot Password

```tsx
import { useSignIn } from '@clerk/clerk-react'

export function ForgotPasswordPage() {
  const { signIn } = useSignIn()

  async function requestReset(email: string) {
    try {
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier: email,
      })
      // Tell user to check their email
    } catch (err) {
      console.error(err)
    }
  }
}
```

---

## 5. Reset Password

```tsx
import { useSignIn } from '@clerk/clerk-react'

export function ResetPasswordPage() {
  const { signIn, setActive } = useSignIn()

  async function resetPassword(code: string, newPassword: string) {
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code,
        password: newPassword,
      })

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId })
        // Redirect to dashboard — user is now logged in
      }
    } catch (err) {
      // err.errors[0].message — e.g., "Code expired" or "Password too short"
      console.error(err)
    }
  }
}
```

---

## 6. Making Authenticated API Calls

After login, get the JWT from Clerk and attach it to every backend request:

```tsx
import { useAuth } from '@clerk/clerk-react'

export function useApi() {
  const { getToken } = useAuth()

  async function apiFetch(path: string, options: RequestInit = {}) {
    const token = await getToken()           // Clerk session JWT

    const response = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,    // ← required on all protected routes
        ...options.headers,
      },
    })

    return response.json()
  }

  return { apiFetch }
}
```

Usage:

```tsx
const { apiFetch } = useApi()

// Get current user
const me = await apiFetch('/api/v1/auth/me')

// Create an order
const order = await apiFetch('/api/v1/orders', {
  method: 'POST',
  body: JSON.stringify({ ... }),
})
```

> The backend's `authenticate` middleware verifies the JWT on every request and
> auto-provisions the user in the database if they don't exist yet.

---

## 7. Sign Out

```tsx
import { useClerk } from '@clerk/clerk-react'

export function LogoutButton() {
  const { signOut } = useClerk()

  return (
    <button onClick={() => signOut({ redirectUrl: '/login' })}>
      Sign Out
    </button>
  )
}
```

---

## 8. Protecting Routes (Frontend)

```tsx
import { useAuth } from '@clerk/clerk-react'
import { Navigate } from 'react-router-dom'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth()

  if (!isLoaded) return <div>Loading...</div>
  if (!isSignedIn) return <Navigate to="/login" replace />

  return <>{children}</>
}
```

---

## 9. Clerk Webhook — Backend Sync

The backend has a webhook endpoint at `POST /webhooks/clerk` that Clerk calls
whenever a user updates their profile or deletes their account. This keeps the
local database in sync with Clerk.

**One-time setup in Clerk Dashboard:**

1. Go to **Clerk Dashboard → Webhooks → Add Endpoint**
2. Set the URL to `https://your-production-domain.com/webhooks/clerk`
3. Subscribe to events: `user.updated`, `user.deleted`
4. Copy the **Signing Secret** and add it to your backend `.env`:
   ```env
   CLERK_WEBHOOK_SECRET=whsec_...
   ```
5. Restart the server

For local development, use [ngrok](https://ngrok.com) or [Clerk's CLI tunnel](https://clerk.com/docs/webhooks/overview#testing-webhooks-locally):

```bash
npx @clerk/agent tunnel --port 3000
```

---

## Summary

| Flow              | How it works                                              |
|-------------------|-----------------------------------------------------------|
| Sign up           | Clerk SDK → auto-provisions user in DB on first API call |
| Sign in           | Clerk SDK → returns JWT session token                    |
| Forgot password   | Clerk sends reset code to email                          |
| Reset password    | Clerk verifies code → sets new password → creates session|
| API calls         | Attach `Authorization: Bearer <token>` to every request  |
| Sign out          | Clerk clears session                                     |
| Profile sync      | Clerk webhook → `POST /webhooks/clerk` → DB updated      |
