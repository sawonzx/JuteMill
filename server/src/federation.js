export async function getQueryClients(prisma, dbManager, requestedFactoryId) {
  if (!dbManager || !dbManager.isFederated) {
    return [prisma];
  }
  return dbManager.getBranchClients(requestedFactoryId);
}

export async function resolveBranchClientByFactory(prisma, dbManager, factoryId) {
  if (!dbManager || !dbManager.isFederated) {
    return prisma;
  }
  if (!factoryId) return null;
  const branch = await dbManager.resolveBranchByFactoryId(factoryId);
  return branch?.client || null;
}

export async function resolveBranchClientByRecord(prisma, dbManager, model, id) {
  if (!dbManager || !dbManager.isFederated) {
    return prisma;
  }
  if (!id) return null;
  return dbManager.resolveClientByRecord(model, id);
}

export function mergePaginatedLists(lists, page, pageSize, sortComparator) {
  const merged = lists.flat();
  if (sortComparator) {
    merged.sort(sortComparator);
  }
  const total = merged.length;
  const offset = (page - 1) * pageSize;
  const paged = merged.slice(offset, offset + pageSize);
  return {
    items: paged,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}

export function formatActor(actor, fallbackName = 'Head Office Admin') {
  if (actor && actor.name) {
    return actor;
  }
  return {
    id: 'hq-admin',
    name: fallbackName,
  };
}

