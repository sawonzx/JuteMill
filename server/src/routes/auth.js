import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { signToken, requireAuth } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});
export function createAuthRouter(prisma) {
  const router = Router();
  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const user = await prisma.user.findFirst({
        where: {
          email,
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
      if (!user) {
        return res.status(401).json({
          error: 'Invalid email or password.',
        });
      }
      if (user.passwordHash) {
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          return res.status(401).json({
            error: 'Invalid email or password.',
          });
        }
      } else if (password !== 'password123' && password !== 'demo') {
        return res.status(401).json({
          error: 'Invalid email or password.',
        });
      }
      const token = signToken({
        userId: user.id,
      });
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      void recordAudit(prisma, {
        userId: user.id,
        action: 'USER_LOGIN',
        entity: 'User',
        entityId: user.id,
        factoryId: user.factoryId,
        details: {
          email: user.email,
        },
      });
      return res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          factoryId: user.factoryId,
          factory: user.factory,
          assignments: user.assignments.map((a) => a.factoryId),
        },
      });
    } catch (err) {
      next(err);
    }
  });
  router.post('/switch-demo', async (req, res, next) => {
    try {
      const { userId } = z
        .object({
          userId: z.string().min(1),
        })
        .parse(req.body);
      const user = await prisma.user.findFirst({
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
      if (!user) {
        return res.status(404).json({
          error: 'Demo user not found.',
        });
      }
      const token = signToken({
        userId: user.id,
      });
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      return res.json({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          factoryId: user.factoryId,
          factory: user.factory,
          assignments: user.assignments.map((a) => a.factoryId),
        },
      });
    } catch (err) {
      next(err);
    }
  });
  router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.clearCookie('jwt');
    res.json({
      message: 'Logged out successfully.',
    });
  });
  router.get('/me', requireAuth, async (req, res) => {
    return res.json({
      user: req.user,
    });
  });
  router.get('/demo-users', async (_req, res, next) => {
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
          permissions: true,
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
  return router;
}
