# Frontend Capability Matrix

Current backend-supported capabilities grouped by frontend audience.

## User View (Customer)

| Capability | Endpoint(s) |
|---|---|
| Sync Clerk account into backend user record | `POST /api/v1/auth/sync` |
| Get own profile | `GET /api/v1/users/me` |
| Check profile completeness before ordering | `GET /api/v1/users/me/completeness` |
| Update own profile, contact, and address | `PATCH /api/v1/users/me` |
| Get and update notification preferences | `GET /api/v1/users/me/notification-preferences`, `PATCH /api/v1/users/me/notification-preferences` |
| Export own account data | `GET /api/v1/users/me/export` |
| Delete own account (soft delete) | `DELETE /api/v1/users/me` |
| Public tracking by tracking number | `GET /api/v1/orders/track/:trackingNumber` |
| Create shipment order | `POST /api/v1/orders` |
| See own unified shipments (solo + bulk items) | `GET /api/v1/orders/my-shipments` |
| List own orders and view order detail | `GET /api/v1/orders`, `GET /api/v1/orders/:id` |
| View order images | `GET /api/v1/orders/:id/images`, `GET /api/v1/uploads/orders/:orderId/images` |
| Initialize and verify payment | `POST /api/v1/payments/initialize`, `POST /api/v1/payments/verify/:reference` |
| Notification inbox, unread count, read, save | `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`, `PATCH /api/v1/notifications/:id/read`, `PATCH /api/v1/notifications/:id/save` |
| Dashboard cards, charts, and delivery schedule | `GET /api/v1/dashboard`, `GET /api/v1/dashboard/stats`, `GET /api/v1/dashboard/trends`, `GET /api/v1/dashboard/active-deliveries` |
| Real-time push channel | `GET /ws?token=<jwt>` (WebSocket upgrade) |

## Internal View (Staff, Admin, Superadmin)

| Capability | Endpoint(s) |
|---|---|
| Operator login, session restore, logout | `POST /api/v1/auth/login`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout` |
| Operator forgot and reset password | `POST /api/v1/auth/forgot-password/send-otp`, `POST /api/v1/auth/forgot-password/verify-otp`, `POST /api/v1/auth/forgot-password/reset` |
| Internal auth login (internal namespace) | `POST /api/v1/internal/auth/login` |
| Change own internal password | `PATCH /api/v1/internal/me/password` |
| Create internal users (role-gated) | `POST /api/v1/internal/users` |
| Reset internal user password (superadmin) | `PATCH /api/v1/internal/users/:id/password` |
| Manage platform users (admin and superadmin routes) | `GET /api/v1/users`, `GET /api/v1/users/:id`, `PATCH /api/v1/users/:id`, `PATCH /api/v1/users/:id/role`, `DELETE /api/v1/users/:id` |
| Team directory (admin+) | `GET /api/v1/team` |
| Client and customer management (staff+) | `GET /api/v1/admin/clients`, `GET /api/v1/admin/clients/:id`, `GET /api/v1/admin/clients/:id/orders` |
| Create order on behalf of customer | `POST /api/v1/orders` (with `senderId`) |
| Update shipment status (staff+) | `PATCH /api/v1/orders/:id/status` |
| Warehouse verification + auto freight calculation (staff+, restricted override by admin+) | `POST /api/v1/orders/:id/warehouse-verify` |
| Manage restricted goods catalog (admin+) | `GET /api/v1/settings/restricted-goods`, `PATCH /api/v1/settings/restricted-goods` |
| Manage logistics settings (admin+, office address updates by superadmin) | `GET /api/v1/settings/logistics`, `PATCH /api/v1/settings/logistics` |
| Manage FX mode and manual rate (admin+) | `GET /api/v1/settings/fx-rate`, `PATCH /api/v1/settings/fx-rate` |
| Manage localized templates (admin+) | `GET /api/v1/settings/templates`, `PATCH /api/v1/settings/templates/:id` |
| Delete order (admin+) | `DELETE /api/v1/orders/:id` |
| List and filter all shipments | `GET /api/v1/shipments` |
| Bulk shipment lifecycle (staff+, admin+ for deletes) | `POST /api/v1/bulk-orders`, `GET /api/v1/bulk-orders`, `GET /api/v1/bulk-orders/:id`, `PATCH /api/v1/bulk-orders/:id/status`, `POST /api/v1/bulk-orders/:id/items`, `DELETE /api/v1/bulk-orders/:id/items/:itemId`, `DELETE /api/v1/bulk-orders/:id` |
| Upload package images (staff+) | `POST /api/v1/uploads/presign`, `POST /api/v1/uploads/confirm` |
| Delete uploaded image (admin+) | `DELETE /api/v1/uploads/images/:imageId` |
| Payments admin views | `GET /api/v1/payments`, `GET /api/v1/payments/:id` |
| Reports (admin+, IP whitelist enforced) | `GET /api/v1/reports/summary`, `GET /api/v1/reports/orders/by-status`, `GET /api/v1/reports/revenue` |
| Internal admin notifications inbox | `GET /api/v1/internal/notifications`, `GET /api/v1/internal/notifications/unread-count`, `PATCH /api/v1/internal/notifications/read-all`, `PATCH /api/v1/internal/notifications/:id/read` |
| Broadcast system notifications (admin+) | `POST /api/v1/notifications/broadcast` |
| Real-time push channel | `GET /ws?token=<jwt>` (WebSocket upgrade) |

## Current Functional Note

Tracking is available via `GET /api/v1/orders/track/:trackingNumber`.
Automatic shipment status progression is not currently implemented as a scheduler or worker process; status changes are driven by explicit status update APIs.

## Approved V2 Scope (Pending Refactor)

Business-approved V2 decisions are documented in detail in:

- `docs/business-process-refactor-blueprint.md`

Summary of approved changes that will be wired into the existing API surface:

### Customer-facing updates (planned)

| Capability | Endpoint(s) |
|---|---|
| Pre-order support with no price shown until Korea warehouse verification | `POST /api/v1/orders`, `GET /api/v1/orders/:id`, `GET /api/v1/orders/my-shipments` |
| Exact freight pricing after verification (`air` by kg, `sea` by cbm) with final adjusted amount visible to customer | `POST /api/v1/orders/:id/warehouse-verify`, `GET /api/v1/orders/:id`, `GET /api/v1/orders/my-shipments` |
| Mode-specific milestone tracking flow (`air` and `sea`) with customer-friendly status labels | `PATCH /api/v1/orders/:id/status`, `GET /api/v1/orders/track/:trackingNumber` |
| Amount-due visibility and pay-now states before pickup | `GET /api/v1/orders/:id`, `GET /api/v1/orders/my-shipments`, `POST /api/v1/payments/initialize`, `POST /api/v1/payments/verify/:reference` |
| Bilingual dynamic content (`en`, `ko`) with user default language preference (`en`) | `GET /api/v1/users/me`, `PATCH /api/v1/users/me` |

### Internal-facing updates (planned)

| Capability | Endpoint(s) |
|---|---|
| Staff warehouse intake verification with photo/package details and automatic pricing | `POST /api/v1/orders/:id/warehouse-verify` |
| Sequential status enforcement by mode with actor+timestamp history | `PATCH /api/v1/orders/:id/status` |
| Customer special pricing overrides (mode-specific, optional validity) with audit trail | `GET /api/v1/settings/pricing`, `PATCH /api/v1/settings/pricing` |
| Restricted-goods catalog management and admin override workflow with mandatory reason | `GET /api/v1/settings/restricted-goods`, `PATCH /api/v1/settings/restricted-goods`, `POST /api/v1/orders/:id/warehouse-verify` |
| Full-payment release control with card/transfer/cash support | `POST /api/v1/payments/initialize`, `POST /api/v1/payments/verify/:reference`, `POST /api/v1/payments/:orderId/record-offline` (proposed) |
| Editable office addresses and lane lock (Korea -> Lagos) | `GET /api/v1/settings/logistics`, `PATCH /api/v1/settings/logistics` |
| FX mode and rate controls (live/manual) | `GET /api/v1/settings/fx-rate`, `PATCH /api/v1/settings/fx-rate` |
| Localized template management | `GET /api/v1/settings/templates`, `PATCH /api/v1/settings/templates/:id` |
