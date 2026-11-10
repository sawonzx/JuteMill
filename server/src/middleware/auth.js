import jwt from 'jsonwebtoken';
import { UserRole } from '@prisma/client';
import { getEffectivePermissions } from '../constants/permissions.js';
const JWT_SECRET = process.env.JWT_SECRET ?? 'jute-mill-erp-secret-key-2026';
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '7d',
  });
}
export function authMiddleware(prisma) {
  return async (req, res, next) => {
    try {
      let userId = null;
      const cookieToken = req.cookies?.['token'] || req.cookies?.['jwt'];
      if (cookieToken) {
        try {
          const decoded = jwt.verify(cookieToken, JWT_SECRET);
          userId = decoded.userId;
        } catch {}
      }
      if (!userId && req.headers.authorization?.startsWith('Bearer ')) {
        try {
          const bearer = req.headers.authorization.slice(7);
          const decoded = jwt.verify(bearer, JWT_SECRET);
          userId = decoded.userId;
        } catch {}
      }
      const demoEnabled = process.env.DEMO_IMPERSONATION_ENABLED === 'true';
      if (!userId && demoEnabled) {
        const demoHeader = req.header('x-demo-user-id');
        if (demoHeader) {
          userId = demoHeader;
        }
      }
      if (!userId) {
        return next();
      }
      const dbUser = await prisma.user.findFirst({
        where: {
          id: userId,
          active: true,
        },
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
            select: {
              factoryId: true,
            },
          },
        },
      });
      if (!dbUser) {
        return next();
      }
      const assigned = dbUser.assignments.map((a) => a.factoryId);
      if (dbUser.factoryId && !assigned.includes(dbUser.factoryId)) {
        assigned.push(dbUser.factoryId);
      }
      const isSuperAdmin = dbUser.role === UserRole.HEAD_OFFICE_ADMIN;
      const accessibleFactoryIds = isSuperAdmin ? null : assigned;
      const effectivePermissions = getEffectivePermissions(dbUser.role, dbUser.permissions);
      const user = {
        id: dbUser.id,
        name: dbUser.name,
        email: dbUser.email,
        role: dbUser.role,
        permissions: effectivePermissions,
        hasPermission: (permission) => isSuperAdmin || effectivePermissions.includes(permission),
        factoryId: dbUser.factoryId,
        factory: dbUser.factory,
        assignedFactoryIds: assigned,
        isSuperAdmin,
        isManager: dbUser.role === UserRole.FACTORY_MANAGER,
        isAccountant: dbUser.role === UserRole.ACCOUNTANT,
        isStaff: dbUser.role === UserRole.STAFF,
        accessibleFactoryIds,
        canAccessFactory: (targetFactoryId) => {
          if (isSuperAdmin) return true;
          if (!targetFactoryId) return false;
          return assigned.includes(targetFactoryId);
        },
      };
      req.user = user;
      res.locals.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required. Please log in or select a demo identity.',
    });
  }
  next();
}
export function requireSuperAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required.',
    });
  }
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({
      error: 'Access denied: Head office administrator privileges required.',
    });
  }
  next();
}
export function requireAdminOrManager(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required.',
    });
  }
  if (!req.user.isSuperAdmin && !req.user.isManager) {
    return res.status(403).json({
      error: 'Access denied: Administrator or Factory Manager privileges required.',
    });
  }
  next();
}
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required.',
      });
    }
    if (req.user.isSuperAdmin || roles.includes(req.user.role)) {
      return next();
    }
    return res.status(403).json({
      error: `Access denied for role ${req.user.role}.`,
    });
  };
}
export function requireFactoryScope(getFactoryId) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required.',
      });
    }
    const targetId = getFactoryId
      ? getFactoryId(req)
      : req.body?.factoryId || req.query?.factoryId || req.params?.factoryId;
    if (targetId && !req.user.canAccessFactory(targetId)) {
      return res.status(403).json({
        error: 'Access denied: You do not have permissions for this factory.',
      });
    }
    next();
  };
}
