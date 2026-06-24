# Project Overview

## About the Project

Global Express Backend is the operational API for a Korea-to-Nigeria shipping business.

It powers:

- Customer shipment creation and tracking
- Internal warehouse and dispatch operations
- Supplier goods declaration workflows
- Payments, invoices, and pricing
- Public marketing and intake surfaces
- Notifications, support, and realtime updates

This repository is a backend-only TypeScript service built with Fastify, Drizzle ORM, and Postgres.

---

## The Problem It Solves

The business needs one system that can handle the full shipment lifecycle across multiple actor types:

- Customers who create and track shipments
- Staff who verify goods, price them, move them through the logistics pipeline, and support customers
- Superadmins who manage sensitive settings, permissions, rates, and approvals
- Suppliers who declare goods before warehouse receipt
- Anonymous/public users who browse the gallery, submit claims, or request D2D intake

The backend exists to keep those flows consistent, auditable, secure, and easy for frontend clients to integrate with.

---

## Primary Actors

- `user`
  Customer account authenticated through Clerk
- `staff`
  Internal operations user authenticated through internal JWT
- `superadmin`
  Highest-privilege internal operator authenticated through internal JWT
- `supplier`
  Supplier portal user authenticated through internal JWT
- `public`
  Anonymous traffic hitting explicitly public routes only

---

## Core Business Flows

### 1. Customer Account and Profile

- Customers sign in through Clerk
- `POST /api/v1/auth/sync` provisions or links the backend user record
- Required profile fields are enforced before customer order creation
- Sensitive user data is encrypted at rest

### 2. Order Creation

- Customers can create their own pre-orders
- Staff can create orders on behalf of customers
- Orders are tied to shipment type, transport mode, payer, and tracking number
- D2D, air, and ocean all flow through the same core order model

### 3. Warehouse Verification and Pricing

- Staff verify incoming goods at warehouse
- Package-level dimensions, weight, restrictions, and special packaging are captured
- Pricing is calculated from transport-mode rules and customer overrides
- Warehouse verification advances the order into priced operational flow

### 4. Payment and Invoicing

- Online payments are initialized and verified through Paystack
- Offline payments and receipt submission are supported
- Invoices begin as draft and are finalized as shipments move through dispatch
- Remaining balance and payment collection status are tracked per shipment

### 5. Dispatch Batches and Shipment Progression

- Orders are grouped into dispatch batches with a master tracking number
- Operational status uses the V2 shipment state machine
- Customer-facing tracking remains separate from internal operational visibility
- D2D flows extend into last-mile delivery statuses

### 6. Public Tracking and Public Intake

- Public users can track shipments by tracking number
- Public users can estimate rates through the calculator
- Public users can submit newsletter signup, anonymous gallery claims, and D2D intake requests
- Public mutation routes are protected by Turnstile when enabled

### 7. Gallery and Claims

- Staff can publish gallery items such as anonymous goods, cars, and adverts
- Public or authenticated users can submit ownership or purchase claims
- Approved claims can become real shipments through operational flows

### 8. Supplier Portal

- Suppliers log in separately from Clerk customers
- Suppliers submit goods declarations before warehouse receipt
- Staff review, accept, reject, and optionally link declarations to customers

### 9. Support, Notifications, and Realtime

- Support tickets exist for customers and staff workflows
- In-app notifications support role-targeted and user-targeted delivery
- WebSocket connections power realtime operational and support updates

---

## Main Domain Areas

- Authentication and authorization
- Users and profile completeness
- Orders and package-level goods
- Warehouse verification and pricing
- Dispatch batches and invoices
- Payments and payment receipts
- Shipments listing and tracking
- Notifications and WebSocket events
- Support tickets
- Public calculator, public D2D intake, and newsletter
- Gallery items and claims
- Supplier declarations
- Settings, reports, and dashboard metrics

---

## System Characteristics

- Backend-only service, not a monorepo
- REST API under `/api/v1`
- OpenAPI and Swagger exposed from the running service
- Dual-auth model:
  - Clerk JWT for customers
  - Internal JWT for staff, superadmin, and supplier
- Encrypted PII at column level
- Soft-delete model for important business records
- Idempotent create flows for selected endpoints
- Problem Details error responses

---

## In Scope

- Shipment ordering and tracking
- Internal warehouse operations
- Pricing and payment workflows
- Supplier declaration intake
- Public gallery and anonymous claim flows
- Public D2D intake
- Notifications, support, and realtime updates
- Settings and operational reporting
- Secure API contracts for multiple frontend surfaces

---

## Out of Scope

- Frontend UI implementation
- Card data handling beyond hosted Paystack flows
- Generic global logistics for arbitrary country pairs
- Multi-tenant SaaS behavior
- Native mobile apps in this repository
- Marketing website implementation

---

## Source of Truth

When context and code disagree, trust this order:

1. Runtime code in `src/` and `drizzle/schema/`
2. `API_ENDPOINTS.md`
3. `FRONTEND_FLOW_GUIDE.md`
4. Focused docs in `docs/`
5. Files in `context/`

The purpose of `context/` is to summarize the real codebase, not replace it.

---

## Success Criteria

- Frontend teams can integrate against a stable, documented contract
- Orders move through the correct state machine for air, ocean, and D2D flows
- Customers only see their own data; staff-only flows stay internal
- Public endpoints expose only public-safe data
- PII remains encrypted, redacted in logs, and protected from caching
- Payment, tracking, support, and notification flows are auditable and reliable
