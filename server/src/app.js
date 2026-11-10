import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { Prisma } from '@prisma/client';
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
import { createTrashRouter } from './routes/trash.js';
import { InventoryOperationError } from './services/inventory.js';
import { OrderOperationError } from './services/orders.js';
import { InvoiceOperationError } from './services/invoices.js';
import { PaymentOperationError } from './services/payments.js';
import { ProductionOperationError } from './services/production.js';

export function createApp(dbManager, port = 4000) {
  const { prisma, primaryClient, middleware, nodeRole } = dbManager;
  const app = express();

  app.use(
    cors({
      origin: (_origin, callback) => {
        callback(null, true);
      },
      credentials: true,
    })
  );

  // Normalize repeated /api/api/ prefixes if misconfigured on client env
  app.use((req, _res, next) => {
    if (req.url.startsWith('/api/api/')) {
      req.url = req.url.replace(/^\/api\/api\//, '/api/');
    }
    next();
  });

  app.use(express.json());
  app.use(cookieParser());

  // 1. Authenticate against this node's primary database
  app.use(authMiddleware(primaryClient));

  // 2. Set node headers
  const demoEnabled = process.env.DEMO_IMPERSONATION_ENABLED === 'true';
  app.use('/api', (_req, res, next) => {
    if (demoEnabled) {
      res.setHeader('X-Demo-Mode', 'INSECURE_DEMO_IMPERSONATION');
    }
    res.setHeader('X-Node-Role', nodeRole);
    next();
  });

  // 3. Context routing: selects target branch DB for super-admin or branch requests
  app.use(middleware);

  // 4. API Routers
  app.use('/api/auth', createAuthRouter(primaryClient));
  app.use('/api/dashboard', createDashboardRouter(prisma, dbManager));
  app.use('/api/customers', createCustomersRouter(prisma, dbManager));
  app.use('/api/products', createProductsRouter(prisma, dbManager));
  app.use('/api/inventory', createInventoryRouter(prisma, dbManager));
  app.use('/api/orders', createOrdersRouter(prisma, dbManager));
  app.use('/api/invoices', createInvoicesRouter(prisma, dbManager));
  app.use('/api/payments', createPaymentsRouter(prisma, dbManager));
  app.use('/api/production', createProductionRouter(prisma, dbManager));
  app.use('/api/reports', createReportsRouter(prisma, dbManager));
  app.use('/api/admin', createAdminRouter(primaryClient, dbManager));
  app.use('/api/trash', createTrashRouter(prisma, dbManager));

  app.get('/api/factories', async (req, res, next) => {
    try {
      const user = req.user;
      const filterIds =
        user && !user.isSuperAdmin && user.accessibleFactoryIds
          ? user.accessibleFactoryIds
          : null;
      const factories = await dbManager.getAllFactories(filterIds);
      res.json(factories);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/demo-users', async (_req, res, next) => {
    try {
      const where =
        nodeRole === 'main'
          ? { active: true, role: 'HEAD_OFFICE_ADMIN' }
          : { active: true };
      const users = await primaryClient.user.findMany({
        where,
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
      nodeRole,
      port,
      timestamp: new Date().toISOString(),
      demoImpersonation: demoEnabled,
    });
  });

  app.all('/api/*', (req, res) => {
    res.status(404).json({
      error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
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

  return app;
}
