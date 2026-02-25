# Settings API Contract (Frozen v1)

Last updated: February 25, 2026

Purpose:

- Freeze customer settings endpoint contracts for frontend integration.
- Define current scope before additional settings modules are introduced.

Scope in this contract:

- Profile and account data
- Profile completeness
- Privacy controls
- Notifications inbox state

Out of scope in this contract:

- Billing/payment settings UI and customer billing endpoints (deferred)

## Base Rules

- Base URL prefix: `/api/v1`
- All endpoints below require `Authorization: Bearer <token>`
- Success shape: `{ "success": true, "data": ... }`
- Error shape: `{ "success": false, "message": "..." }`

## 1. Profile

### 1.1 Get current profile

- Method/Path: `GET /users/me`
- Response `data` fields:
- `id`, `clerkId`, `email`
- `firstName`, `lastName`, `businessName`
- `phone`, `whatsappNumber`
- `addressStreet`, `addressCity`, `addressState`, `addressCountry`, `addressPostalCode`
- `role`, `isActive`, `consentMarketing`
- `notifyEmailAlerts`, `notifySmsAlerts`, `notifyInAppAlerts`
- `deletedAt`, `createdAt`, `updatedAt`

### 1.2 Update current profile

- Method/Path: `PATCH /users/me`
- Request body (all optional):
- `firstName`, `lastName`, `businessName`
- `phone`, `whatsappNumber`
- `addressStreet`, `addressCity`, `addressState`, `addressCountry`, `addressPostalCode`
- `consentMarketing`
- `notifyEmailAlerts`, `notifySmsAlerts`, `notifyInAppAlerts`
- Response: full user profile object (same shape as `GET /users/me`)

## 2. Profile Completeness

### 2.1 Get completeness status

- Method/Path: `GET /users/me/completeness`
- Completeness rule:
- Name requirement: either (`firstName` + `lastName`) or `businessName`
- `phone` is required
- Address is required: `addressStreet`, `addressCity`, `addressState`, `addressCountry`, `addressPostalCode`
- `whatsappNumber` is optional for completeness
- Response:

```json
{
  "success": true,
  "data": {
    "isComplete": false,
    "missingFields": ["addressStreet", "addressCity"]
  }
}
```

- `missingFields` allowed values:
- `name`
- `phone`
- `addressStreet`
- `addressCity`
- `addressState`
- `addressCountry`
- `addressPostalCode`

## 3. Privacy Controls

### 3.1 Export own data

- Method/Path: `GET /users/me/export`
- Response: full decrypted user profile (same base shape as `GET /users/me`)

### 3.2 Delete own account

- Method/Path: `DELETE /users/me`
- Behavior: soft delete
- Post-delete auth behavior: Clerk-authenticated requests for the same deleted identity return `403` and are not auto-reprovisioned.
- Response:

```json
{
  "success": true,
  "data": {
    "message": "Account deleted successfully"
  }
}
```

## 4. Notifications

### 4.1 Notification preferences

- Method/Path: `GET /users/me/notification-preferences`
- Response fields:
- `notifyEmailAlerts`
- `notifySmsAlerts`
- `notifyInAppAlerts`
- `consentMarketing`

- Method/Path: `PATCH /users/me/notification-preferences`
- Request body (all optional):
- `notifyEmailAlerts`
- `notifySmsAlerts`
- `notifyInAppAlerts`
- `consentMarketing`
- Response: updated preferences object

### 4.2 List inbox

- Method/Path: `GET /notifications?page=1&limit=20`
- Includes:
- Personal notifications
- Broadcast notifications
- Response item fields:
- `id`, `userId`, `orderId`, `type`, `title`, `subtitle`, `body`, `metadata`
- `isBroadcast`, `isRead`, `isSaved`, `createdBy`, `createdAt`

### 4.3 Get unread count

- Method/Path: `GET /notifications/unread-count`
- Response:

```json
{
  "success": true,
  "data": {
    "count": 3
  }
}
```

### 4.4 Mark notification as read

- Method/Path: `PATCH /notifications/:id/read`
- Response:

```json
{
  "success": true,
  "data": {
    "message": "Marked as read"
  }
}
```

### 4.5 Toggle saved state

- Method/Path: `PATCH /notifications/:id/save`
- Response:

```json
{
  "success": true,
  "data": {
    "message": "Saved state toggled"
  }
}
```

## 5. Security Ownership

- Customer password/2FA/session management is Clerk-managed.
- Customer UI should not call internal operator auth/password endpoints.
- Internal password endpoint (`PATCH /api/v1/internal/me/password`) is for internal roles only.
