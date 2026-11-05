# JuteWorks Mill ERP — Enterprise MVP

A complete, production-grade web-based Enterprise Resource Planning (ERP) application designed for **Bengal Jute Industries Ltd.**, operating two jute mills in Bangladesh with central administration:
- **Head Office**: Central Administration & Executive Control (Dhaka)
- **Factory A**: Dhaka Jute Mill (`F-A`)
- **Factory B**: Khulna Jute Mill (`F-B`)

Built as a centralized single-company, multi-branch ERP with strict backend authorization, logical factory isolation, transactional double-entry inventory ledgers, order-to-cash workflows, atomic production conversions, receivables aging, printable tax invoices, and comprehensive audit logging.

---

## Technology Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn UI patterns, React Router, TanStack Query, Recharts, Lucide Icons
- **Backend**: Node.js, Express.js, TypeScript, Prisma ORM, PostgreSQL, Zod validation, bcryptjs password hashing, cookie-based session auth & JWT
- **Database**: PostgreSQL with serializable transaction isolation, strict foreign keys, unique constraints, and check constraints

---

## Implemented Business Modules

### 1. Customer Management (Module A)
- Factory-scoped customer master records (`Dhaka Jute Mill` vs `Khulna Jute Mill`).
- CRUD operations, search by name/code/phone, business vs individual categorization, active/inactive status toggle.
- Customer detail view with order history, invoice history, current outstanding balance, and chronological debit/credit ledger.

### 2. Product Catalog (Module B)
- Shared company-wide catalog across both mills.
- Categorization into **Raw Materials** (Raw Jute grades, Jute Yarn) and **Finished Products** (Hessian Cloth, Jute Sacking Bags, Jute Shopping Bags, Jute Geotextiles).
- Standard measurement units (`kg`, `MT`, `Bale`, `Piece`, `Meter`), standard selling prices (BDT ৳), and active status.
- Factory stock distribution breakdown and per-factory minimum safety thresholds.

### 3. Inventory Management (Module C)
- Factory-specific warehouses and balances.
- Stock movements (`STOCK_IN`, `STOCK_OUT`, `ADJUSTMENT`) with audit reasons and reference tracking.
- Strict transaction isolation: **atomic balance update + movement ledger generation** in a single database transaction.
- **Negative stock prevention**: transactions immediately reject any operation that would reduce inventory balance below zero.
- Low-stock watch based on factory-specific minimum reorder thresholds.

### 4. Sales Order Management (Module D)
- Order lifecycle: `DRAFT` ➔ `CONFIRMED` ➔ `IN_PRODUCTION` ➔ `FULFILLED` ➔ `CANCELLED`.
- Human-readable order numbering with factory and date prefix (e.g. `SO-F-A-2611-0001`).
- Multi-line item selector with live subtotal, tax rate, and order total calculation.
- **Atomic Stock Fulfillment**: Fulfilling an order automatically verifies stock availability and creates `STOCK_OUT` inventory movements from the factory warehouse in a single transaction.
- Duplicate fulfillment and cancellation of fulfilled orders are strictly prevented.

### 5. Invoice Management (Module E)
- Generate tax invoices from confirmed or fulfilled sales orders.
- Itemized snapshot preservation (`InvoiceItem` stores frozen unit price, quantity, description, and subtotal at time of billing).
- Invoice lifecycle: `DRAFT` ➔ `ISSUED` ➔ `PART_PAID` ➔ `PAID` ➔ `VOID`.
- Clean printable tax invoice layout (`window.print()`) with Bengal Jute Industries corporate header, customer VAT/BIN details, line items, and payment status.
- Void restrictions: invoices with recorded payments cannot be voided without reversing collections.

### 6. Payments & Customer Ledger (Module F)
- Record collections against specific open invoices.
- **Overpayment prevention**: payments exceeding the invoice balance due are rejected with a clear error.
- Multiple payment methods: Bank Transfer (EFT/NPSB), Cash, Cheque, Mobile Banking (bKash/Nagad).
- Automatic receipt numbering (`RCT-F-A-2611-0001`).
- **Customer Running Balance Ledger**: Chronological audit trail showing every invoice debit (+), payment credit (-), and resulting net running balance.

### 7. Production Management (Module G)
- Manufacturing batch processing (`PR-F-A-2611-0001`).
- Track scheduled date, supervisor, input raw material (e.g. Raw Jute in kg) and target finished yield (e.g. Hessian Cloth in MT).
- **Atomic Stock Conversion**: Completing a production batch in a single database transaction:
  1. Verifies raw material stock availability.
  2. Creates a `STOCK_OUT` movement for raw materials consumed.
  3. Creates a `STOCK_IN` movement for finished goods yielded.
  4. Updates batch status to `COMPLETED` with actual output quantity.

### 8. Operational & Consolidated Reports (Module H)
- **Sales & Collections Report**: Revenue collected, gross invoiced value, monthly comparative trend between Dhaka and Khulna mills, top customer contributors.
- **Sales Orders Book**: Breakdown by status, total order values, distribution by mill location.
- **Receivables Aging Schedule**: Aging buckets (Current 0-30 days, 31-60 days, 60+ days overdue), customer-by-customer breakdown with contact details.
- **Production Summary**: Raw materials consumed by unit, finished goods yielded by unit, batch completions by product.
- **Direct CSV Exports**: Export buttons for `Sales`, `Orders`, `Inventory`, `Receivables`, and `Production` with factory filtering.

### 9. Administration & Governance (Module I)
- Restricted to Head Office Super Administrators.
- **User Management**: View user accounts, active status, roles (`HEAD_OFFICE_ADMIN`, `FACTORY_MANAGER`, `ACCOUNTANT`, `STAFF`), and factory assignments. Create users with bcrypt-hashed passwords.
- **Mill Factory Settings**: View and update branch contact details, physical address, phone, and operational warehouse count.
- **Company Profile**: Update central corporate profile (BIN/Tax ID, registered address, official email, currency BDT ৳).
- **Audit Logs**: Tamper-evident chronological log of system actions (user, action, target entity, record ID, IP address, and JSON details).

---

## Demo Personas

The topbar identity switcher allows instant switching between standard personas:

| Persona | Email | Password | Scope & Permissions |
|---|---|---|---|
| **Head Office Admin** | `admin@juteworks.demo` | `password123` | Consolidated view across all mills, user management, factory configuration, audit logs, all reports. |
| **Factory A Manager** | `manager.a@juteworks.demo` | `password123` | Full operational control of Dhaka Jute Mill: orders, fulfillments, production batches, customer records. |
| **Factory B Manager** | `manager.b@juteworks.demo` | `password123` | Full operational control of Khulna Jute Mill (isolated from Factory A data). |
| **Factory A Accountant** | `accountant.a@juteworks.demo` | `password123` | Financial records for Dhaka Jute Mill: invoices, payments, receivables, customer ledger. |
| **Factory B Accountant** | `accountant.b@juteworks.demo` | `password123` | Financial records for Khulna Jute Mill: invoices, payments, customer ledger. |
| **Factory A Staff** | `staff.a@juteworks.demo` | `password123` | Dhaka Mill operational inventory stock in/out and viewing order commitments. |
| **Factory B Staff** | `staff.b@juteworks.demo` | `password123` | Khulna Mill operational inventory stock in/out. |

---

## Local Setup & Execution

### Prerequisites
- Node.js 22+ (tested on Node v24)
- PostgreSQL 15+ running locally (e.g. port 5432)

### 1. Configure Environment
Create `.env` in the root (and `server/.env`):
```env
PORT=4000
DATABASE_URL="postgresql://postgres:12345@localhost:5432/jute_mill_erp?schema=public"
JWT_SECRET="jute-mill-super-secret-jwt-key-2026-production"
DEMO_IMPERSONATION_ENABLED=true
CLIENT_ORIGIN="http://localhost:5173"
```

### 2. Database Sync & Seeding
From the project root:
```powershell
# Sync Prisma schema to PostgreSQL database
npm --workspace server run db:generate
npx prisma db push --schema=server/prisma/schema.prisma

# Seed realistic demo dataset (reconciled inventory, orders, invoices, payments, batches)
npm run db:seed
```

### 3. Run Automated Integration Test Suite
To verify all 37 business logic assertions (isolation, overdraft prevention, atomic fulfillment, invoice snapshots, overpayment rejection, production conversion):
```powershell
node --experimental-strip-types server/src/tests/integration.ts
```

### 4. Start Development Servers
```powershell
npm run dev
```
- **Web Application**: <http://localhost:5173>
- **Backend API**: <http://localhost:4000/api>

---

## Build Verification

Both frontend and backend compile cleanly with zero errors:
```powershell
# Verify TypeScript on server
npm --workspace server run typecheck

# Verify TypeScript and build production bundle on client
npm --workspace client run build
```
