# Global Express Backend

The Global Express backend is a Fastify, TypeScript, and PostgreSQL API for customer shipping, supplier workflows, staff operations, payments, notifications, public tracking, and the public Shop.

The backend is the contract and data source of truth for the dashboard and public website. Route schemas, services, and the Drizzle schema take precedence over historical documentation.

## Start here

- [API reference](API_ENDPOINTS.md) — HTTP and WebSocket contract.
- [Cross-repository reference](docs/CROSS_REPO_REFERENCE.md) — ownership and current integration state across the backend, dashboard, and public website.
- [Environment template](.env.example) — required configuration keys; never commit actual environment files.
- [Archived records](docs/archive/README.md) — completed audits and historical implementation trackers.

## Local development

Requirements: Node.js 20.9+ and a PostgreSQL connection configured in `.env`.

```bash
npm install
npm run dev
```

The API listens on `http://localhost:3000`. Interactive OpenAPI documentation is at `/docs`; the raw specification is at `/openapi.json`.

Docker development uses `.env.docker`:

```bash
docker compose up --build
```

## Database migrations

The repository uses a project-owned migration ledger because the historical SQL migrations predate Drizzle metadata. Do not use `drizzle-kit migrate` for this project.

Check migration state before applying changes:

```bash
npm run db:migrate:status
```

For a new empty database, apply pending migrations once:

```bash
npm run db:migrate
```

For an already-provisioned database with no ledger, first inspect it and then explicitly baseline it. Baseline records the committed migration checksums without executing SQL:

```bash
npm run db:migrate:baseline -- --confirm
```

`scripts/run-migration.ts` and `scripts/run-all-migrations.ts` are recovery-only tools. They require `--confirm-recovery` and `--confirm-replay` respectively; do not use either for normal development or deployment.

To validate every committed migration, point `MIGRATION_TEST_DATABASE_URL` at a dedicated disposable database and run the test suite. The test refuses a non-empty database and resets the test schema after it finishes.

## Verification

```bash
npm run typecheck
npm test
npm run lint
npm run format:check
```

## Project layout

- `src/routes` — Fastify route schemas and endpoint registration.
- `src/controllers` — HTTP boundary and request/response adaptation.
- `src/services` — business workflows and data access.
- `drizzle/schema` — PostgreSQL schema definitions.
- `drizzle/migrations` — committed SQL migrations.
- `tests` — unit and integration coverage.
- `scripts` — supported seed, audit, backfill, and maintenance utilities; review a script before running it against any shared database.

## Related applications

- Dashboard: customer, supplier, staff, and superadmin application.
- Public website: marketing pages, calculator, public Shop, and package-claim entry point.

For local integration, point each frontend's `VITE_API_BASE_URL` to the backend URL ending in `/api/v1`; run the two Vite applications on distinct ports.
