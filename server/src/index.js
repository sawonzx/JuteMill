import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { Prisma, PrismaClient } from '@prisma/client';
import { authMiddleware } from './middleware/auth.js';
import { createAuthRouter } from './routes/auth.js';
import { createCustomersRouter } from './routes/customers.js';
import { createProductsRouter } from './routes/products.js';
import { createInventoryRouter } from './routes/inventory.js';
import { createOrdersRouter } from './routes/orders.js';
import { createInvoicesRouter } from './routes/invoices.js';
import { createPaymentsRouter } from './routes/payments.js';
import { createProductionRouter } from './routes/production.js';
import { createReportsRouter } from './routes/reports.js';
import { createAdminRouter } from './routes/admin.js';
import { createDashboardRouter } from './routes/dashboard.js';
import { InventoryOperationError } from './services/inventory.js';
import { OrderOperationError } from './services/orders.js';
import { InvoiceOperationError } from './services/invoices.js';
import { PaymentOperationError } from './services/payments.js';
import { ProductionOperationError } from './services/production.js';
const prisma = new PrismaClient();
const app = express();
app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, true);
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(authMiddleware(prisma));
const demoEnabled = process.env.DEMO_IMPERSONATION_ENABLED === 'true';
app.use('/api', (_req, res, next) => {
  if (demoEnabled) {
    res.setHeader('X-Demo-Mode', 'INSECURE_DEMO_IMPERSONATION');
  }
  next();
});
app.use('/api/auth', createAuthRouter(prisma));
app.use('/api/dashboard', createDashboardRouter(prisma));
app.use('/api/customers', createCustomersRouter(prisma));
app.use('/api/products', createProductsRouter(prisma));
app.use('/api/inventory', createInventoryRouter(prisma));
app.use('/api/orders', createOrdersRouter(prisma));
app.use('/api/invoices', createInvoicesRouter(prisma));
app.use('/api/payments', createPaymentsRouter(prisma));
app.use('/api/reports', createReportsRouter(prisma));
app.use('/api/admin', createAdminRouter(prisma));
app.get('/api/factories', async (req, res, next) => {
  try {
    const user = req.user;
    let where = {};
    if (user && !user.isSuperAdmin && user.accessibleFactoryIds) {
      where = {
        id: {
          in: user.accessibleFactoryIds,
        },
      };
    }
    const factories = await prisma.factory.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        location: true,
        address: true,
        phone: true,
        email: true,
      },
      orderBy: {
        code: 'asc',
      },
    });
    res.json(factories);
  } catch (err) {
    next(err);
  }
});
app.get('/api/demo-users', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        active: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        factory: {
          select: {
            id: true,
            code: true,
            name: true,
            location: true,
          },
        },
      },
      orderBy: [
        {
          role: 'asc',
        },
        {
          name: 'asc',
        },
      ],
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    system: 'Bengal Jute Industries Ltd. ERP',
    timestamp: new Date().toISOString(),
    demoImpersonation: demoEnabled,
  });
});
app.use((err, req, res, _next) => {
  if (
    err instanceof InventoryOperationError ||
    err instanceof OrderOperationError ||
    err instanceof InvoiceOperationError ||
    err instanceof PaymentOperationError ||
    err instanceof ProductionOperationError
  ) {
    return res.status(err.status).json({
      error: err.message,
    });
  }
  if (err && typeof err === 'object' && 'issues' in err && Array.isArray(err.issues)) {
    const zodErr = err;
    return res.status(400).json({
      error: 'Validation failed. Please check submitted data.',
      details: zodErr.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: 'A record with that unique identifier or code already exists.',
      });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({
        error: 'Requested database record not found.',
      });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({
        error: 'Cannot complete operation: foreign key constraint violation.',
      });
    }
  }
  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: 'An internal server error occurred. Please try again.',
  });
});
const port = Number(process.env.API_PORT ?? 4000);
app.listen(port, () => {
  console.log(`JuteWorks ERP API listening on http://localhost:${port}`);
});
