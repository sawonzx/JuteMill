import { Router } from 'express';
import { UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireSuperAdmin, requireAdminOrManager } from '../middleware/auth.js';
import { recordAudit, resolveActorId } from '../services/audit.js';
import {
  mergePaginatedLists,
  resolveBranchClientByFactory,
  resolveBranchClientByRecord,
} from '../federation.js';

const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  password: z.string().min(6).optional(),
  role: z.nativeEnum(UserRole),
  permissions: z.array(z.string()).optional(),
  factoryId: z.string().nullable().optional(),
  assignedFactoryIds: z.array(z.string()).optional(),
});

const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: z.string().trim().email().optional(),
  password: z
    .string()
    .optional()
    .nullable()
    .refine((val) => !val || val.trim().length >= 6, {
      message: 'Password must be at least 6 characters if provided.',
    }),
  role: z.nativeEnum(UserRole).optional(),
  permissions: z.array(z.string()).optional(),
  factoryId: z.string().nullable().optional(),
  assignedFactoryIds: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

function formatAuditLogEntry(log) {
  if (log.user || !log.details) return log;
  try {
    const parsed = JSON.parse(log.details);
    if (parsed && parsed.remoteActor) {
      return {
        ...log,
        user: {
          id: parsed.remoteUserId || 'hq-admin',
          name: parsed.remoteActor,
          email: '',
          role: 'HEAD_OFFICE_ADMIN',
        },
      };
    }
  } catch {}
  return log;
}

const USER_INCLUDE = {
  factory: {
    select: { id: true, code: true, name: true, location: true },
  },
  assignments: {
    include: {
      factory: { select: { id: true, code: true, name: true } },
    },
  },
};

function formatUserResponse(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    permissions: u.permissions || [],
    active: u.active,
    factoryId: u.factoryId,
    factory: u.factory,
    assignments: (u.assignments || []).map((a) => a.factory),
    createdAt: u.createdAt,
  };
}

export function createAdminRouter(prisma, dbManager) {
  const router = Router();
  const isFederated = Boolean(dbManager && dbManager.isFederated);

  function getAllUserClients() {
    if (!isFederated) return [prisma];
    return [dbManager.primaryClient, dbManager.clientA, dbManager.clientB].filter(Boolean);
  }

  async function findEmailOwner(email) {
    const clients = getAllUserClients();
    const matches = await Promise.all(
      clients.map((db) => db.user.findUnique({ where: { email }, select: { id: true, email: true } }))
    );
    return matches.find(Boolean) || null;
  }

  router.get('/users', requireAdminOrManager, async (req, res, next) => {
    try {
      const user = req.user;

      if (!isFederated) {
        const where = user.isSuperAdmin ? {} : { factoryId: user.factoryId };
        const users = await prisma.user.findMany({
          where,
          include: USER_INCLUDE,
          orderBy: [{ role: 'asc' }, { name: 'asc' }],
        });
        return res.json(users.map(formatUserResponse));
      }

      // Main HQ federated view: HQ admins live in primaryClient, branch staff live strictly in branch DBs
      const [mainUsers, facAUsers, facBUsers] = await Promise.all([
        dbManager.primaryClient.user.findMany({
          where: { role: UserRole.HEAD_OFFICE_ADMIN },
          include: USER_INCLUDE,
        }),
        dbManager.clientA.user.findMany({ include: USER_INCLUDE }),
        dbManager.clientB.user.findMany({ include: USER_INCLUDE }),
      ]);

      const merged = [...mainUsers, ...facAUsers, ...facBUsers].sort((a, b) => {
        const rc = a.role.localeCompare(b.role);
        return rc !== 0 ? rc : a.name.localeCompare(b.name);
      });

      res.json(merged.map(formatUserResponse));
    } catch (err) {
      next(err);
    }
  });

  router.post('/users', requireAdminOrManager, async (req, res, next) => {
    try {
      const user = req.user;
      const data = userCreateSchema.parse(req.body);

      if (!user.isSuperAdmin) {
        if (data.role === UserRole.HEAD_OFFICE_ADMIN || data.role === UserRole.FACTORY_MANAGER) {
          return res.status(403).json({
            error:
              'Factory managers cannot create administrative manager accounts. Only Head Office Admin can assign manager roles.',
          });
        }
        if (data.permissions && data.permissions.includes('admin:manage')) {
          return res.status(403).json({
            error:
              'Only the Head Office Main Admin can assign higher features like System Administration.',
          });
        }
        data.factoryId = user.factoryId;
      }

      const existing = await findEmailOwner(data.email);
      if (existing) {
        return res.status(409).json({ error: 'User with this email already exists.' });
      }

      const isHqAdmin = data.role === UserRole.HEAD_OFFICE_ADMIN;
      let targetClient = prisma;
      let effectiveFactoryId = isHqAdmin ? null : data.factoryId;

      if (isFederated) {
        if (isHqAdmin) {
          targetClient = dbManager.primaryClient;
          effectiveFactoryId = null;
        } else {
          if (!data.factoryId) {
            return res
              .status(400)
              .json({ error: 'Factory assignment is required for factory personnel.' });
          }
          const resolvedBranch = await dbManager.resolveBranchByFactoryId(data.factoryId);
          if (!resolvedBranch?.client) {
            return res.status(404).json({ error: 'Target factory database not found.' });
          }
          targetClient = resolvedBranch.client;
          effectiveFactoryId = resolvedBranch.factoryId;
        }
      } else if (!isHqAdmin && !effectiveFactoryId) {
        effectiveFactoryId = user.factoryId;
      }

      if (!isHqAdmin && effectiveFactoryId) {
        const facExists = await targetClient.factory.findUnique({
          where: { id: effectiveFactoryId },
          select: { id: true },
        });
        if (!facExists) {
          return res.status(404).json({ error: 'Selected factory does not exist in target branch.' });
        }
      }

      const validAssignmentIds =
        !isHqAdmin && effectiveFactoryId
          ? Array.from(
              new Set(
                (data.assignedFactoryIds?.length ? data.assignedFactoryIds : [effectiveFactoryId]).filter(
                  (id) => id === effectiveFactoryId
                )
              )
            )
          : [];

      const passwordHash = data.password
        ? await bcrypt.hash(data.password, 10)
        : await bcrypt.hash('password123', 10);

      const newUser = await targetClient.user.create({
        data: {
          name: data.name,
          email: data.email,
          passwordHash,
          role: data.role,
          permissions: data.permissions || [],
          factoryId: effectiveFactoryId,
          assignments:
            validAssignmentIds.length > 0
              ? {
                  create: validAssignmentIds.map((fId) => ({ factoryId: fId })),
                }
              : undefined,
        },
        include: USER_INCLUDE,
      });

      void recordAudit(targetClient, {
        userId: user.id,
        action: 'ADMIN_CREATE_USER',
        entity: 'User',
        entityId: newUser.id,
        factoryId: newUser.factoryId,
        details: { email: newUser.email, role: newUser.role },
      });

      res.status(201).json(formatUserResponse(newUser));
    } catch (err) {
      next(err);
    }
  });

  router.put('/users/:id', requireAdminOrManager, async (req, res, next) => {
    try {
      const user = req.user;
      const targetClient = isFederated
        ? await dbManager.resolveClientForUser(req.params.id)
        : prisma;

      if (!targetClient) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const target = await targetClient.user.findUnique({
        where: { id: req.params.id },
      });
      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }

      if (!user.isSuperAdmin) {
        if (target.id === user.id) {
          return res.status(403).json({
            error:
              'Factory administrators cannot edit their own account. It can only be edited via the Main branch admin.',
          });
        }
        if (target.role === UserRole.FACTORY_MANAGER && target.id !== user.id) {
          return res.status(403).json({
            error:
              'Factory administrators cannot modify manager accounts. It can only be edited via the Main branch admin.',
          });
        }
        if (target.factoryId !== user.factoryId) {
          return res.status(403).json({
            error: 'Access denied: You can only edit users within your assigned factory.',
          });
        }
        if (target.role === UserRole.HEAD_OFFICE_ADMIN) {
          return res.status(403).json({ error: 'Cannot modify Head Office Administrator.' });
        }
      }

      const data = userUpdateSchema.parse(req.body);

      if (user.isSuperAdmin && target.id === user.id) {
        if (data.role && data.role !== UserRole.HEAD_OFFICE_ADMIN) {
          return res.status(400).json({
            error: 'Main branch administrator cannot change their own administrative role.',
          });
        }
        if (data.active === false) {
          return res.status(400).json({
            error: 'Main branch administrator cannot deactivate their own account.',
          });
        }
      }

      if (!user.isSuperAdmin) {
        if (data.role === UserRole.HEAD_OFFICE_ADMIN) {
          return res.status(403).json({
            error: 'Factory managers cannot assign Head Office Administrator role.',
          });
        }
        if (data.role === UserRole.FACTORY_MANAGER) {
          return res.status(403).json({
            error:
              'Factory managers cannot assign Factory Manager role. It can only be assigned via the Main branch admin.',
          });
        }
        if (data.permissions && data.permissions.includes('admin:manage')) {
          return res.status(403).json({
            error:
              'Only the Head Office Main Admin can assign higher features like System Administration.',
          });
        }
        data.factoryId = user.factoryId;
      }

      if (data.email && data.email !== target.email) {
        const dup = await findEmailOwner(data.email);
        if (dup && dup.id !== target.id) {
          return res.status(409).json({ error: 'Another user with this email already exists.' });
        }
      }

      const nextRole = data.role ?? target.role;
      const isNextHqAdmin = nextRole === UserRole.HEAD_OFFICE_ADMIN;
      let nextFactoryId = isNextHqAdmin
        ? null
        : data.factoryId !== undefined
          ? data.factoryId
          : target.factoryId;

      let intendedClient = targetClient;
      if (isFederated) {
        if (isNextHqAdmin) {
          intendedClient = dbManager.primaryClient;
          nextFactoryId = null;
        } else {
          if (!nextFactoryId) {
            return res
              .status(400)
              .json({ error: 'Factory assignment is required for factory personnel.' });
          }
          const resolvedBranch = await dbManager.resolveBranchByFactoryId(nextFactoryId);
          if (!resolvedBranch?.client) {
            return res.status(404).json({ error: 'Target factory database not found.' });
          }
          intendedClient = resolvedBranch.client;
          nextFactoryId = resolvedBranch.factoryId;
        }
      }

      const passwordHash =
        data.password && data.password.trim().length >= 6
          ? await bcrypt.hash(data.password.trim(), 10)
          : undefined;

      const validAssignmentIds =
        !isNextHqAdmin && nextFactoryId
          ? Array.from(
              new Set(
                (data.assignedFactoryIds?.length ? data.assignedFactoryIds : [nextFactoryId]).filter(
                  (id) => id === nextFactoryId
                )
              )
            )
          : [];

      let updated;
      if (intendedClient === targetClient) {
        updated = await targetClient.$transaction(async (tx) => {
          await tx.userFactoryAssignment.deleteMany({ where: { userId: target.id } });
          if (validAssignmentIds.length > 0) {
            await tx.userFactoryAssignment.createMany({
              data: validAssignmentIds.map((fId) => ({ userId: target.id, factoryId: fId })),
            });
          }

          return tx.user.update({
            where: { id: target.id },
            data: {
              name: data.name ?? target.name,
              email: data.email ?? target.email,
              role: nextRole,
              permissions: data.permissions !== undefined ? data.permissions : target.permissions,
              active: data.active ?? target.active,
              factoryId: nextFactoryId,
              ...(passwordHash ? { passwordHash } : {}),
            },
            include: USER_INCLUDE,
          });
        });
      } else {
        // Reassigning user across isolated databases: cleanly decouple FKs on old DB & migrate row to target DB
        await targetClient.$transaction(async (tx) => {
          await tx.inventoryMovement.updateMany({
            where: { createdById: target.id },
            data: { createdById: null },
          });
          await tx.salesOrder.updateMany({
            where: { createdById: target.id },
            data: { createdById: null },
          });
          await tx.payment.updateMany({
            where: { createdById: target.id },
            data: { createdById: null },
          });
          await tx.productionRecord.updateMany({
            where: { createdById: target.id },
            data: { createdById: null },
          });
          await tx.auditLog.updateMany({
            where: { userId: target.id },
            data: { userId: null },
          });
          await tx.userFactoryAssignment.deleteMany({ where: { userId: target.id } });
          await tx.user.delete({ where: { id: target.id } });
        });

        updated = await intendedClient.user.create({
          data: {
            id: target.id,
            name: data.name ?? target.name,
            email: data.email ?? target.email,
            passwordHash: passwordHash ?? target.passwordHash,
            role: nextRole,
            permissions: data.permissions !== undefined ? data.permissions : target.permissions,
            active: data.active ?? target.active,
            factoryId: nextFactoryId,
            assignments:
              validAssignmentIds.length > 0
                ? { create: validAssignmentIds.map((fId) => ({ factoryId: fId })) }
                : undefined,
          },
          include: USER_INCLUDE,
        });
      }

      void recordAudit(intendedClient, {
        userId: user.id,
        action: 'ADMIN_UPDATE_USER',
        entity: 'User',
        entityId: updated.id,
        factoryId: updated.factoryId,
        details: { email: updated.email, role: updated.role, active: updated.active },
      });

      res.json(formatUserResponse(updated));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/users/:id/status', requireAdminOrManager, async (req, res, next) => {
    try {
      const user = req.user;
      const { active } = z.object({ active: z.boolean() }).parse(req.body);

      const targetClient = isFederated
        ? await dbManager.resolveClientForUser(req.params.id)
        : prisma;
      if (!targetClient) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const target = await targetClient.user.findUnique({ where: { id: req.params.id } });
      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }
      if (target.id === user.id) {
        return res.status(400).json({ error: 'Cannot deactivate your own account.' });
      }
      if (!user.isSuperAdmin) {
        if (target.role === UserRole.FACTORY_MANAGER || target.id === user.id) {
          return res.status(403).json({
            error:
              'Factory administrators cannot modify manager account status. It can only be edited via the Main branch admin.',
          });
        }
        if (target.factoryId !== user.factoryId) {
          return res.status(403).json({
            error: 'Access denied: You can only change status for users within your factory.',
          });
        }
        if (target.role === UserRole.HEAD_OFFICE_ADMIN) {
          return res.status(403).json({ error: 'Cannot modify Head Office Administrator.' });
        }
      }

      const updated = await targetClient.user.update({
        where: { id: target.id },
        data: { active },
      });

      void recordAudit(targetClient, {
        userId: user.id,
        action: active ? 'ADMIN_ACTIVATE_USER' : 'ADMIN_DEACTIVATE_USER',
        entity: 'User',
        entityId: updated.id,
        factoryId: updated.factoryId,
        details: { email: updated.email, active },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/users/:id', requireAdminOrManager, async (req, res, next) => {
    try {
      const user = req.user;
      const targetClient = isFederated
        ? await dbManager.resolveClientForUser(req.params.id)
        : prisma;
      if (!targetClient) {
        return res.status(404).json({ error: 'User not found.' });
      }

      const target = await targetClient.user.findUnique({ where: { id: req.params.id } });
      if (!target) {
        return res.status(404).json({ error: 'User not found.' });
      }
      if (target.id === user.id) {
        return res.status(400).json({ error: 'Cannot delete your own logged-in account.' });
      }
      if (target.role === UserRole.HEAD_OFFICE_ADMIN) {
        return res.status(400).json({ error: 'Cannot delete Head Office Super Administrator.' });
      }
      if (!user.isSuperAdmin) {
        if (target.role === UserRole.FACTORY_MANAGER) {
          return res.status(403).json({
            error:
              'Factory administrators cannot delete manager accounts. It can only be managed via the Main branch admin.',
          });
        }
        if (target.factoryId !== user.factoryId) {
          return res.status(403).json({
            error: 'Access denied: You can only delete users within your factory.',
          });
        }
      }
      if (target.active) {
        return res.status(400).json({
          error: 'Cannot delete an active account. Please deactivate the user first.',
        });
      }

      await targetClient.$transaction(async (tx) => {
        const replacementActorId = await resolveActorId(tx, user.id);
        await tx.inventoryMovement.updateMany({
          where: { createdById: target.id },
          data: { createdById: replacementActorId },
        });
        await tx.salesOrder.updateMany({
          where: { createdById: target.id },
          data: { createdById: null },
        });
        await tx.payment.updateMany({
          where: { createdById: target.id },
          data: { createdById: null },
        });
        await tx.productionRecord.updateMany({
          where: { createdById: target.id },
          data: { createdById: null },
        });
        await tx.auditLog.updateMany({
          where: { userId: target.id },
          data: { userId: null },
        });
        await tx.userFactoryAssignment.deleteMany({
          where: { userId: target.id },
        });
        await tx.user.delete({
          where: { id: target.id },
        });
      });

      void recordAudit(targetClient, {
        userId: user.id,
        action: 'ADMIN_DELETE_USER',
        entity: 'User',
        entityId: target.id,
        factoryId: target.factoryId,
        details: { name: target.name, email: target.email, role: target.role },
      });

      res.json({
        success: true,
        message: `User ${target.name} (${target.email}) was successfully deleted.`,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/factories', requireAdminOrManager, async (req, res, next) => {
    try {
      const user = req.user;
      const where = user.isSuperAdmin ? {} : { id: user.factoryId };
      const include = {
        _count: {
          select: { users: true, customers: true, orders: true },
        },
      };

      if (!isFederated) {
        const factories = await prisma.factory.findMany({
          where,
          include,
          orderBy: { code: 'asc' },
        });
        return res.json(factories);
      }

      const [facA, facB] = await Promise.all([
        dbManager.clientA.factory.findMany({ where, include }),
        dbManager.clientB.factory.findMany({ where, include }),
      ]);
      const factories = [...facA, ...facB].sort((a, b) => a.code.localeCompare(b.code));
      res.json(factories);
    } catch (err) {
      next(err);
    }
  });

  router.put('/factories/:id', requireSuperAdmin, async (req, res, next) => {
    try {
      const user = req.user;
      const schema = z.object({
        name: z.string().trim().min(2).optional(),
        location: z.string().trim().min(2).optional(),
        address: z.string().trim().min(2).nullable().optional(),
        phone: z.string().optional().nullable(),
        email: z
          .union([z.string().email(), z.literal(''), z.null()])
          .optional()
          .transform((v) => v || null),
      });
      const data = schema.parse(req.body);

      const targetClient = await resolveBranchClientByRecord(
        prisma,
        dbManager,
        'factory',
        req.params.id
      );
      if (!targetClient) {
        return res.status(404).json({ error: 'Factory not found.' });
      }

      const existing = await targetClient.factory.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        return res.status(404).json({ error: 'Factory not found.' });
      }

      const updateData = {
        ...(data.name ? { name: data.name } : {}),
        ...(data.location ? { location: data.location } : {}),
        ...(data.address ? { address: data.address } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
      };

      const updated = await targetClient.factory.update({
        where: { id: req.params.id },
        data: updateData,
      });

      await dbManager?.refreshFactoryLookup?.();

      void recordAudit(targetClient, {
        userId: user.id,
        action: 'ADMIN_UPDATE_FACTORY',
        entity: 'Factory',
        entityId: updated.id,
        factoryId: updated.id,
        details: { code: updated.code, name: updated.name },
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.get('/company', requireSuperAdmin, async (_req, res, next) => {
    try {
      const mainDb = dbManager?.primaryClient || prisma;
      let company = await mainDb.company.findFirst();
      if (!company) {
        company = await mainDb.company.create({
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

  router.put('/company', requireSuperAdmin, async (req, res, next) => {
    try {
      const user = req.user;
      const schema = z.object({
        name: z.string().trim().min(2).optional(),
        code: z.string().trim().min(2).optional(),
        currency: z.string().trim().min(1).optional(),
        email: z
          .union([z.string().email(), z.literal(''), z.null()])
          .optional()
          .transform((v) => v || undefined),
        phone: z
          .union([z.string().min(3), z.literal(''), z.null()])
          .optional()
          .transform((v) => v || undefined),
        address: z
          .union([z.string().min(3), z.literal(''), z.null()])
          .optional()
          .transform((v) => v || undefined),
      });
      const data = schema.parse(req.body);
      const cleanData = Object.fromEntries(
        Object.entries(data).filter(([, val]) => val !== undefined)
      );

      const mainDb = dbManager?.primaryClient || prisma;
      let company = await mainDb.company.findFirst();
      if (!company) {
        company = await mainDb.company.create({
          data: {
            name: cleanData.name || 'Bengal Jute Industries Ltd.',
            code: cleanData.code || 'BJIL',
            currency: cleanData.currency || 'BDT',
            email: cleanData.email || 'info@bengaljute.demo',
            phone: cleanData.phone || '+880 2-9887766',
            address: cleanData.address || 'Bengal House, 45 Dilkusha C/A, Dhaka, Bangladesh',
          },
        });
      } else {
        company = await mainDb.company.update({
          where: { id: company.id },
          data: cleanData,
        });
      }

      if (isFederated) {
        await Promise.all(
          [dbManager.clientA, dbManager.clientB].filter(Boolean).map(async (branchDb) => {
            const branchCompany = await branchDb.company.findFirst();
            if (branchCompany) {
              await branchDb.company.update({
                where: { id: branchCompany.id },
                data: {
                  name: company.name,
                  code: company.code,
                  currency: company.currency,
                  email: company.email,
                  phone: company.phone,
                  address: company.address,
                },
              });
            } else {
              await branchDb.company.create({
                data: {
                  name: company.name,
                  code: company.code,
                  currency: company.currency,
                  email: company.email,
                  phone: company.phone,
                  address: company.address,
                },
              });
            }
          })
        );
      }

      void recordAudit(mainDb, {
        userId: user.id,
        action: 'ADMIN_UPDATE_COMPANY',
        entity: 'Company',
        entityId: company.id,
        details: cleanData,
      });

      res.json(company);
    } catch (err) {
      next(err);
    }
  });

  router.get('/audit-logs', requireAdminOrManager, async (req, res, next) => {
    try {
      const user = req.user;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 50));
      const entity = req.query.entity?.trim();
      const action = (req.query.action || req.query.q)?.trim();

      const where = {
        ...(user.isSuperAdmin ? {} : { factoryId: user.factoryId }),
        ...(entity ? { entity: { equals: entity, mode: 'insensitive' } } : {}),
        ...(action
          ? {
              OR: [
                { action: { contains: action, mode: 'insensitive' } },
                { entity: { contains: action, mode: 'insensitive' } },
                { details: { contains: action, mode: 'insensitive' } },
              ],
            }
          : {}),
      };

      const include = {
        user: { select: { id: true, name: true, email: true, role: true } },
        factory: { select: { id: true, code: true, name: true } },
      };

      if (!isFederated) {
        const [items, total] = await Promise.all([
          prisma.auditLog.findMany({
            where,
            include,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          prisma.auditLog.count({ where }),
        ]);

        return res.json({
          items: items.map(formatAuditLogEntry),
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        });
      }

      const clients = getAllUserClients();
      const lists = await Promise.all(
        clients.map((db) =>
          db.auditLog.findMany({
            where,
            include,
            orderBy: { createdAt: 'desc' },
          })
        )
      );

      const result = mergePaginatedLists(
        lists.map((list) => list.map(formatAuditLogEntry)),
        page,
        pageSize,
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
