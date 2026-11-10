import { PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';

const asyncLocalStorage = new AsyncLocalStorage();

export function createDatabaseManager(nodeRole = process.env.NODE_ROLE || 'main') {
  const urlMain =
    process.env.DATABASE_URL_MAIN ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:12345@localhost:5432/jute_mill_main?schema=public';
  const urlFacA =
    process.env.DATABASE_URL_FAC_A ||
    'postgresql://postgres:12345@localhost:5432/jute_mill_fac_a?schema=public';
  const urlFacB =
    process.env.DATABASE_URL_FAC_B ||
    'postgresql://postgres:12345@localhost:5432/jute_mill_fac_b?schema=public';

  const normalizedRole = nodeRole.toLowerCase().replace('_', '-');
  const isFederated = normalizedRole === 'main';

  let primaryClient;
  let clientA = null;
  let clientB = null;

  if (normalizedRole === 'fac-a') {
    primaryClient = new PrismaClient({ datasources: { db: { url: urlFacA } } });
  } else if (normalizedRole === 'fac-b') {
    primaryClient = new PrismaClient({ datasources: { db: { url: urlFacB } } });
  } else {
    primaryClient = new PrismaClient({ datasources: { db: { url: urlMain } } });
    clientA = new PrismaClient({ datasources: { db: { url: urlFacA } } });
    clientB = new PrismaClient({ datasources: { db: { url: urlFacB } } });
  }

  let factoryLookup = null;
  let factoryLookupPromise = null;

  async function refreshFactoryLookup() {
    if (!isFederated) {
      const f = await primaryClient.factory.findFirst({ select: { id: true, code: true } }).catch(() => null);
      const map = new Map();
      if (f) {
        map.set(f.id, { client: primaryClient, code: f.code, factoryId: f.id });
        map.set(f.code, { client: primaryClient, code: f.code, factoryId: f.id });
      }
      factoryLookup = map;
      return map;
    }

    const [facA, facB] = await Promise.all([
      clientA.factory.findFirst({ select: { id: true, code: true } }).catch(() => null),
      clientB.factory.findFirst({ select: { id: true, code: true } }).catch(() => null),
    ]);

    const map = new Map();
    if (facA) {
      const entryA = { client: clientA, code: facA.code || 'F-A', factoryId: facA.id };
      map.set(facA.id, entryA);
      map.set(facA.code, entryA);
    }
    if (!map.has('F-A')) {
      map.set('F-A', { client: clientA, code: 'F-A', factoryId: facA?.id || 'factory-dhaka-fa' });
    }
    if (!map.has('factory-dhaka-fa')) {
      map.set('factory-dhaka-fa', map.get('F-A'));
    }

    if (facB) {
      const entryB = { client: clientB, code: facB.code || 'F-B', factoryId: facB.id };
      map.set(facB.id, entryB);
      map.set(facB.code, entryB);
    }
    if (!map.has('F-B')) {
      map.set('F-B', { client: clientB, code: 'F-B', factoryId: facB?.id || 'factory-khulna-fb' });
    }
    if (!map.has('factory-khulna-fb')) {
      map.set('factory-khulna-fb', map.get('F-B'));
    }

    factoryLookup = map;
    return map;
  }

  async function ensureFactoryLookup() {
    if (factoryLookup) return factoryLookup;
    if (!factoryLookupPromise) {
      factoryLookupPromise = refreshFactoryLookup().finally(() => {
        factoryLookupPromise = null;
      });
    }
    return factoryLookupPromise;
  }

  async function resolveBranchByFactoryId(factoryId) {
    if (!factoryId) return null;
    if (!isFederated) {
      return {
        client: primaryClient,
        code: normalizedRole === 'fac-a' ? 'F-A' : 'F-B',
        factoryId,
      };
    }
    const map = await ensureFactoryLookup();
    if (map.has(factoryId)) return map.get(factoryId);
    const fresh = await refreshFactoryLookup();
    return fresh.get(factoryId) || null;
  }

  async function getBranchClients(requestedFactoryId) {
    if (!isFederated) {
      return [primaryClient];
    }
    if (requestedFactoryId) {
      const match = await resolveBranchByFactoryId(requestedFactoryId);
      return match ? [match.client] : [];
    }
    return [clientA, clientB];
  }

  async function resolveClientByRecord(model, id) {
    if (!id) return null;
    if (!isFederated) {
      return primaryClient;
    }
    const [foundA, foundB] = await Promise.all([
      clientA[model].findUnique({ where: { id }, select: { id: true } }).catch(() => null),
      clientB[model].findUnique({ where: { id }, select: { id: true } }).catch(() => null),
    ]);
    if (foundA) return clientA;
    if (foundB) return clientB;
    return null;
  }

  async function resolveClientForUser(userId) {
    if (!userId) return null;
    if (!isFederated) {
      return primaryClient;
    }
    const [foundMain, foundA, foundB] = await Promise.all([
      primaryClient.user.findUnique({ where: { id: userId }, select: { id: true } }).catch(() => null),
      clientA.user.findUnique({ where: { id: userId }, select: { id: true } }).catch(() => null),
      clientB.user.findUnique({ where: { id: userId }, select: { id: true } }).catch(() => null),
    ]);
    if (foundMain) return primaryClient;
    if (foundA) return clientA;
    if (foundB) return clientB;
    return null;
  }

  async function getAllFactories(filterIds) {
    const where = filterIds ? { id: { in: filterIds } } : {};
    const select = {
      id: true,
      code: true,
      name: true,
      location: true,
      address: true,
      phone: true,
      email: true,
    };

    if (!isFederated) {
      return primaryClient.factory.findMany({
        where,
        select,
        orderBy: { code: 'asc' },
      });
    }

    const [facsA, facsB] = await Promise.all([
      clientA.factory.findMany({ where, select }),
      clientB.factory.findMany({ where, select }),
    ]);
    return [...facsA, ...facsB].sort((a, b) => a.code.localeCompare(b.code));
  }

  const prismaProxy = new Proxy(
    {},
    {
      get(_target, prop) {
        const store = asyncLocalStorage.getStore();
        const client = store?.prisma || primaryClient;
        const value = client[prop];
        if (typeof value === 'function') {
          return value.bind(client);
        }
        return value;
      },
    }
  );

  const middleware = async (req, _res, next) => {
    try {
      let selectedClient = primaryClient;

      if (isFederated) {
        const requestedFactoryId =
          req.query?.factoryId ||
          req.body?.factoryId ||
          req.headers['x-factory-id'] ||
          (req.user && !req.user.isSuperAdmin ? req.user.factoryId : null);

        if (requestedFactoryId) {
          const branch = await resolveBranchByFactoryId(String(requestedFactoryId));
          if (branch?.client) {
            selectedClient = branch.client;
          }
        }
      }

      asyncLocalStorage.run({ prisma: selectedClient }, () => {
        next();
      });
    } catch (err) {
      next(err);
    }
  };

  return {
    prisma: prismaProxy,
    primaryClient,
    clientA,
    clientB,
    isFederated,
    nodeRole: normalizedRole,
    middleware,
    refreshFactoryLookup,
    resolveBranchByFactoryId,
    getBranchClients,
    resolveClientByRecord,
    resolveClientForUser,
    getAllFactories,
  };
}
