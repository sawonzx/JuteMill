import { Router } from 'express';
import { UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireSuperAdmin } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  password: z.string().min(6).optional(),
  role: z.nativeEnum(UserRole),
  factoryId: z.string().nullable().optional(),
  assignedFactoryIds: z.array(z.string()).optional(),
});
const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().optional(),
  password: z.string().min(6).optional().nullable(),
  role: z.nativeEnum(UserRole).optional(),
  factoryId: z.string().nullable().optional(),
  assignedFactoryIds: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});
export function createAdminRouter(prisma) {
  const router = Router();
  router.use(requireSuperAdmin);
  router.get('/users', async (_req, res, next) => {
    try {
      const users = await prisma.user.findMany({
        include: {
          factory: {
            select: {
              id: true,
              code: true,
              name: true,
              location: true,
            },
          },
          assignments: {
            include: {
              factory: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
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
      res.json(
        users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          active: u.active,
          factoryId: u.factoryId,
          factory: u.factory,
          assignments: u.assignments.map((a) => a.factory),
          createdAt: u.createdAt,
        }))
      );
    } catch (err) {
      next(err);
    }
  });
  router.post('/users', async (req, res, next) => {
    try {
      const user = req.user;
      const data = userCreateSchema.parse(req.body);
      const existing = await prisma.user.findUnique({
        where: {
          email: data.email,
        },
      });
      if (existing)
        return res.status(409).json({
          error: 'User with this email already exists.',
        });
      const passwordHash = data.password
        ? await bcrypt.hash(data.password, 10)
        : await bcrypt.hash('password123', 10);
      const newUser = await prisma.user.create({
        data: {
          name: data.name,
          email: data.email,
          passwordHash,
          role: data.role,
          factoryId: data.role === UserRole.HEAD_OFFICE_ADMIN ? null : data.factoryId,
          assignments: data.assignedFactoryIds?.length
            ? {
                create: data.assignedFactoryIds.map((fId) => ({
                  factoryId: fId,
                })),
              }
            : undefined,
        },
        include: {
          factory: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          assignments: {
            include: {
              factory: true,
            },
          },
        },
      });
      void recordAudit(prisma, {
        userId: user.id,
        action: 'ADMIN_CREATE_USER',
        entity: 'User',
        entityId: newUser.id,
        details: {
          email: newUser.email,
          role: newUser.role,
        },
      });
      res.status(201).json(newUser);
    } catch (err) {
      next(err);
    }
  });
  router.put('/users/:id', async (req, res, next) => {
    try {
      const user = req.user;
      const target = await prisma.user.findUnique({
        where: {
          id: req.params.id,
        },
      });
      if (!target)
        return res.status(404).json({
          error: 'User not found.',
        });
      const data = userUpdateSchema.parse(req.body);
      const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : undefined;
      const updated = await prisma.$transaction(async (tx) => {
        if (data.assignedFactoryIds) {
          await tx.userFactoryAssignment.deleteMany({
            where: {
              userId: target.id,
            },
          });
          if (data.assignedFactoryIds.length) {
            await tx.userFactoryAssignment.createMany({
              data: data.assignedFactoryIds.map((fId) => ({
                userId: target.id,
                factoryId: fId,
              })),
            });
          }
        }
        return tx.user.update({
          where: {
            id: target.id,
          },
          data: {
            name: data.name ?? target.name,
            email: data.email ?? target.email,
            role: data.role ?? target.role,
            active: data.active ?? target.active,
            factoryId:
              (data.role ?? target.role) === UserRole.HEAD_OFFICE_ADMIN
                ? null
                : data.factoryId !== undefined
                  ? data.factoryId
                  : target.factoryId,
            ...(passwordHash
              ? {
                  passwordHash,
                }
              : {}),
          },
          include: {
            factory: true,
            assignments: {
              include: {
                factory: true,
              },
            },
          },
        });
      });
      void recordAudit(prisma, {
        userId: user.id,
        action: 'ADMIN_UPDATE_USER',
        entity: 'User',
        entityId: updated.id,
        details: {
          email: updated.email,
          role: updated.role,
          active: updated.active,
        },
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
  router.patch('/users/:id/status', async (req, res, next) => {
    try {
      const user = req.user;
      const { active } = z
        .object({
          active: z.boolean(),
        })
        .parse(req.body);
      const target = await prisma.user.findUnique({
        where: {
          id: req.params.id,
        },
      });
      if (!target)
        return res.status(404).json({
          error: 'User not found.',
        });
      if (target.id === user.id) {
        return res.status(400).json({
          error: 'Cannot deactivate your own account.',
        });
      }
      const updated = await prisma.user.update({
        where: {
          id: target.id,
        },
        data: {
          active,
        },
      });
      void recordAudit(prisma, {
        userId: user.id,
        action: active ? 'ADMIN_ACTIVATE_USER' : 'ADMIN_DEACTIVATE_USER',
        entity: 'User',
        entityId: updated.id,
        details: {
          email: updated.email,
          active,
        },
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
  router.delete('/users/:id', async (req, res, next) => {
    try {
      const user = req.user;
      const target = await prisma.user.findUnique({
        where: {
          id: req.params.id,
        },
      });
      if (!target)
        return res.status(404).json({
          error: 'User not found.',
        });
      if (target.id === user.id) {
        return res.status(400).json({
          error: 'Cannot delete your own logged-in account.',
        });
      }
      if (target.role === UserRole.HEAD_OFFICE_ADMIN) {
        return res.status(400).json({
          error: 'Cannot delete Head Office Super Administrator.',
        });
      }
      if (target.active) {
        return res.status(400).json({
          error: 'Cannot delete an active account. Please deactivate the user first.',
        });
      }
      await prisma.$transaction(async (tx) => {
        await tx.inventoryMovement.updateMany({
          where: {
            createdById: target.id,
          },
          data: {
            createdById: user.id,
          },
        });
        await tx.salesOrder.updateMany({
          where: {
            createdById: target.id,
          },
          data: {
            createdById: null,
          },
        });
        await tx.payment.updateMany({
          where: {
            createdById: target.id,
          },
          data: {
            createdById: null,
          },
        });
        await tx.productionRecord.updateMany({
          where: {
            createdById: target.id,
          },
          data: {
            createdById: null,
          },
        });
        await tx.auditLog.updateMany({
          where: {
            userId: target.id,
          },
          data: {
            userId: null,
          },
        });
        await tx.userFactoryAssignment.deleteMany({
          where: {
            userId: target.id,
          },
        });
        await tx.user.delete({
          where: {
            id: target.id,
          },
        });
      });
      void recordAudit(prisma, {
        userId: user.id,
        action: 'ADMIN_DELETE_USER',
        entity: 'User',
        entityId: target.id,
        details: {
          name: target.name,
          email: target.email,
          role: target.role,
        },
      });
      res.json({
        success: true,
        message: `User ${target.name} (${target.email}) was successfully deleted.`,
      });
    } catch (err) {
      next(err);
    }
  });
  router.get('/factories', async (_req, res, next) => {
    try {
      const factories = await prisma.factory.findMany({
        include: {
          _count: {
            select: {
              users: true,
              customers: true,
              orders: true,
            },
          },
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
  router.put('/factories/:id', async (req, res, next) => {
    try {
      const user = req.user;
      const schema = z.object({
        name: z.string().trim().min(2),
        location: z.string().trim().min(2),
        address: z.string().trim().min(5),
        phone: z.string().optional().nullable(),
        email: z.string().email().optional().nullable(),
      });
      const data = schema.parse(req.body);
      const updated = await prisma.factory.update({
        where: {
          id: req.params.id,
        },
        data,
      });
      void recordAudit(prisma, {
        userId: user.id,
        action: 'ADMIN_UPDATE_FACTORY',
        entity: 'Factory',
        entityId: updated.id,
        factoryId: updated.id,
        details: {
          code: updated.code,
          name: updated.name,
        },
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });
  router.get('/company', async (_req, res, next) => {
    try {
      let company = await prisma.company.findFirst();
      if (!company) {
        company = await prisma.company.create({
          data: {
            name: 'Bengal Jute Industries Ltd.',
            code: 'BJIL',
            currency: 'BDT',
            email: 'info@bengaljute.demo',
            phone: '+880 2-9887766',
            address: 'Bengal House, 45 Dilkusha C/A, Dhaka, Bangladesh',
          },
        });
      }
      res.json(company);
    } catch (err) {
      next(err);
    }
  });
  router.put('/company', async (req, res, next) => {
    try {
      const user = req.user;
      const schema = z.object({
        name: z.string().trim().min(2),
        code: z.string().trim().min(2),
        currency: z.string().trim().min(1),
        email: z.string().email(),
        phone: z.string().min(5),
        address: z.string().min(5),
      });
      const data = schema.parse(req.body);
      let company = await prisma.company.findFirst();
      if (!company) {
        company = await prisma.company.create({
          data,
        });
      } else {
        company = await prisma.company.update({
          where: {
            id: company.id,
          },
          data,
        });
      }
      void recordAudit(prisma, {
        userId: user.id,
        action: 'ADMIN_UPDATE_COMPANY',
        entity: 'Company',
        entityId: company.id,
        details: data,
      });
      res.json(company);
    } catch (err) {
      next(err);
    }
  });
  router.get('/audit-logs', async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 50));
      const entity = req.query.entity?.trim();
      const action = (req.query.action || req.query.q)?.trim();
      const where = {
        ...(entity
          ? {
              entity: {
                equals: entity,
                mode: 'insensitive',
              },
            }
          : {}),
        ...(action
          ? {
              OR: [
                {
                  action: {
                    contains: action,
                    mode: 'insensitive',
                  },
                },
                {
                  entity: {
                    contains: action,
                    mode: 'insensitive',
                  },
                },
                {
                  details: {
                    contains: action,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
            factory: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.auditLog.count({
          where,
        }),
      ]);
      res.json({
        items,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
