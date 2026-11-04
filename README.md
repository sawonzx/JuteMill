# JuteWorks Mill ERP

A demonstration ERP foundation for two independently operated jute mills and one head office. Phase 1 provides the app shell, demo identity switching, and overview dashboard. Phase 2 adds factory customers, a shared product catalog, warehouse balances, movement ledger, and low stock thresholds.

## Stack

- React, TypeScript, Vite, React Router, TanStack Query, Recharts, Lucide, Tailwind and shadcn style UI primitives
- Node.js, Express, TypeScript, Prisma and PostgreSQL

## Local setup

Prerequisites: Node.js 22.6+ and PostgreSQL 15+.

1. Create a PostgreSQL database named `jute_mill_erp` (or choose another name).
2. Copy `.env.example` to `.env`; set `DATABASE_URL` to your PostgreSQL credentials and database. Set `DEMO_IMPERSONATION_ENABLED=true` for local development.
3. From the repository root, run:

```powershell
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

The UI is at <http://localhost:5173>; the API is at <http://localhost:4000/api>. `npm run typecheck` and `npm run build` run the compile checks.

If using another API origin, set `VITE_API_URL` in `client/.env.local`, for example `http://localhost:4000/api`.

## Demo identities and access

The top-right switcher offers seven seeded demo users. The selected ID persists in `localStorage` and is sent as `X-Demo-User-Id`. This is **insecure development-only impersonation**. The backend looks up the identity, role, and factory scope from its database; client role or factory claims are never trusted. The API also sets `X-Demo-Mode: INSECURE_DEMO_IMPERSONATION`.

Managers can manage customers, the shared product catalog, stock, and factory thresholds within their factory. Accountants have read access to scoped customers, products, and inventory. Staff have operational stock in/out access; stock adjustments and threshold changes require a manager or Head Office Admin. Head Office Admin can access and manage both factories. These checks are enforced by the API.

Keep `DEMO_IMPERSONATION_ENABLED=true` only for local development or a controlled demonstration. Set it to `false` to disable API access. **Do not deploy publicly without replacing demo impersonation with real authentication and authorization.**

## Phase 2 data model

- Customers belong to a factory; codes are unique per factory. Contact, type, status, address, notes, and creation/update timestamps are stored. Customer detail shows read-only sales order history; customer accounting totals remain out of scope.
- Products are shared company-wide, with a unique SKU, category, raw/finished type, unit, description, optional default selling price, and active status.
- Each factory has a default warehouse. Factory/warehouse stock is represented by the existing balance table mapped to `InventoryBalance`; every stock change is written to the immutable `InventoryMovement` ledger in the same serializable transaction. Migration converts existing Phase 1 quantities into opening movements.
- `FactoryProductThreshold` stores optional per-factory minimum quantities. Quantities use `DECIMAL(14,3)`, and the API rejects stock that would become negative. A unique idempotency key plus payload hash prevents duplicate stock submissions.

Phase 2 includes customer and product create/view/edit/deactivate, paginated search and filters, stock overview, stock in/out, reasoned adjustments, movement history, low stock reporting, and threshold configuration. Sales orders, invoices, payments, production, procurement, supplier management, and advanced accounting remain outside this phase; the existing Phase 1 overview and read-only transaction history are preserved.

## Phase 2 API

All listed endpoints require `X-Demo-User-Id` and are scoped using the selected user's database role and factory assignment.

| Area | Endpoints |
|---|---|
| Factory scope | `GET /api/factories` |
| Customers | `GET, POST /api/customers`; `GET, PUT /api/customers/:id`; `PATCH /api/customers/:id/status` |
| Products | `GET, POST /api/products`; `GET, PUT /api/products/:id`; `PATCH /api/products/:id/status` |
| Inventory | `GET /api/inventory/summary`, `/balances`, `/movements`, `/warehouses`; `POST /api/inventory/movements`; `PUT /api/inventory/thresholds` |

Customer and product lists accept pagination and their respective search/status/type/category filters. Inventory balances support product/category/type/stock status and factory filters. Movement history supports product, movement type, date range, and factory filters.

## Database and seed

The initial schema is in `server/prisma/schema.prisma`; migrations are in `server/prisma/migrations`. `npm run db:migrate` applies the development migrations, and `npm run db:seed` is safe to rerun. The seed provides two fictional mills, seven demo identities, 12 factory-owned customers, 15 shared products, factory-specific balances, per-factory thresholds, opening stock ledger entries, and example movements. Some initial stock is below configured thresholds to demonstrate alerts.

## Verification

Run `npm run typecheck` and `npm run build`. The Phase 2 API was also checked against a disposable PostgreSQL database for CRUD, product sharing, factory isolation, stock in/out/adjustment, duplicate idempotency, negative-stock rejection, staff restrictions, and low-stock thresholds. There is no separate automated test runner configured yet.
